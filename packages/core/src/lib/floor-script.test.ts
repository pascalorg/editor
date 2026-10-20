import { describe, expect, test } from 'bun:test'
import { applySceneChanges } from '../agent-operations/apply-changes'
import { setRoomFloorScript } from '../agent-operations/room-floor-script'
import { isAgentRefusal } from '../agent-tools'
import { setZoneIntent } from '../commands/structure'
import {
  type AnyNode,
  type CompiledGeometryScript,
  GeometryArtifactManifest,
  LevelNode,
  type SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import {
  type FinishScriptHost,
  finishScriptWrites,
  refreshFinishScripts,
  staleFinishScripts,
} from './finish-script'
import { floorPlatePaintRefusal } from './floor-plate-paint'
import { type FloorScriptInputs, floorScriptInputs } from './floor-script'
import { computePlateSurfacePartition, plateLevelContext } from './plate-surface'
import { area } from './polygon-boolean'
import type { SceneNodes } from './structure-kernel'
import { reconcileSceneStructure } from './structure-reconcile'

const LEVEL = 'level_floor_script'
const corners: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]

/** An 8 × 4 m room of 0.2 m walls, reconciled into its zone and floor plate. */
function room(): SceneNodes {
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_fs_${index}`,
      parentId: LEVEL,
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.2,
    }),
  )
  const level = LevelNode.parse({ id: LEVEL, children: walls.map((wall) => wall.id) })
  const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
  return reconcile(nodes)
}

let minted = 0
function reconcile(nodes: SceneNodes, previousNodes?: SceneNodes): SceneNodes {
  return reconcileSceneStructure({
    nodes,
    previousNodes,
    mintId: (kind) => `${kind}_fs_${minted++}`,
  }).nodes
}

const zoneOf = (nodes: SceneNodes) =>
  Object.values(nodes).find((node): node is ZoneNode => node.type === 'zone')!

/** A host that compiles nothing: it counts its builds and answers with hashes of what it was given. */
function fakeHost() {
  const builds: FloorScriptInputs[] = []
  const host: FinishScriptHost = {
    readScript: async (sha) => (sha === 'a'.repeat(64) ? 'export default () => {}' : null),
    build: async (input) => {
      const inputs = input.inputs as FloorScriptInputs
      builds.push(inputs)
      const xs = inputs.polygon.map(([x]) => x)
      const zs = inputs.polygon.map(([, z]) => z)
      return {
        sha256: builds.length.toString(16).padStart(64, '0'),
        script: 'a'.repeat(64),
        language: 'three',
        mount: 'floor',
        params: { plank: 0.18 },
        manifest: GeometryArtifactManifest.parse({
          bounds: {
            min: [Math.min(...xs), inputs.elevation, Math.min(...zs)],
            max: [Math.max(...xs), inputs.elevation + 0.01, Math.max(...zs)],
          },
          slots: [{ id: 'oak' }],
          triangles: 12,
        }),
      } satisfies CompiledGeometryScript
    },
  }
  return { host, builds }
}

/** The room with a floor script, built once by `host` for the room's floor. */
async function scripted(host: FinishScriptHost) {
  const nodes = room()
  const zone = zoneOf(nodes)
  const inputs = floorScriptInputs(nodes, zone.id)!
  const compiled = await host.build({ nodeId: zone.id, code: '', params: {}, inputs })
  const { changes } = setRoomFloorScript(
    nodes,
    { zoneId: zone.id, compiled, inputs },
    {
      activeLevelId: LEVEL,
    },
  )
  return applySceneChanges(nodes, changes) as Record<string, AnyNode>
}

function refusal(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    if (isAgentRefusal(error)) return error.code
    throw error
  }
  throw new Error('expected a refusal')
}

/** The room's north wall moved 1 m north, its neighbours following, then reconciled. */
function pushNorth(nodes: SceneNodes): SceneNodes {
  const moved: Record<string, AnyNode> = { ...nodes }
  const wall = (id: string, data: Partial<WallNode>) => {
    moved[id] = { ...(nodes[id] as WallNode), ...data }
  }
  wall('wall_fs_1', { end: [8, 5] })
  wall('wall_fs_2', { start: [8, 5], end: [0, 5] })
  wall('wall_fs_3', { start: [0, 5] })
  return reconcile(moved, nodes)
}

describe("a room's floor script", () => {
  test('is built for the floor inside the wall faces, at the plate top', () => {
    const nodes = room()
    const inputs = floorScriptInputs(nodes, zoneOf(nodes).id)!
    expect(area([{ outer: inputs.polygon, holes: inputs.holes }])).toBeCloseTo(7.8 * 3.8, 3)
    const plate = Object.values(nodes).find((node): node is SlabNode => node.type === 'slab')!
    expect(inputs.elevation).toBeCloseTo(plate.elevation ?? 0, 6)
  })

  test('compiles once, and again only after the reconcile re-derives its room', async () => {
    const { host, builds } = fakeHost()
    let nodes: SceneNodes = await scripted(host)
    expect(builds).toHaveLength(1)
    expect(staleFinishScripts(nodes)).toEqual([])
    expect(await refreshFinishScripts(nodes, host)).toEqual({ rebuilt: [], failed: [] })
    expect(builds).toHaveLength(1)

    nodes = pushNorth(nodes)
    const zone = zoneOf(nodes)
    expect(zone.floor?.script?.artifact).toBe('1'.padStart(64, '0'))
    expect(staleFinishScripts(nodes).map((stale) => stale.nodeId)).toEqual([zone.id])

    const refresh = await refreshFinishScripts(nodes, host)
    expect(refresh.failed).toEqual([])
    expect(builds).toHaveLength(2)
    expect(Math.max(...builds[1]!.polygon.map(([, z]) => z))).toBeCloseTo(4.9, 6)
    nodes = applySceneChanges(nodes, {
      update: finishScriptWrites(nodes, refresh.rebuilt),
    }) as SceneNodes
    const rebuilt = zoneOf(nodes).floor?.script
    expect(rebuilt?.artifact).toBe('2'.padStart(64, '0'))
    expect(rebuilt?.params).toEqual({ plank: 0.18 })
    expect(staleFinishScripts(nodes)).toEqual([])
  })

  test('refuses paint on its floor, through the Paint tool and the room intent, until removed', async () => {
    let nodes: SceneNodes = await scripted(fakeHost().host)
    const zone = zoneOf(nodes)
    const plate = Object.values(nodes).find((node): node is SlabNode => node.type === 'slab')!
    const role = computePlateSurfacePartition(
      plate,
      plateLevelContext(nodes[LEVEL]!, (id) => nodes[id]),
    )!.cells.find((cell) => cell.role.startsWith('room:'))!.role
    expect(floorPlatePaintRefusal(nodes, plate, role)?.code).toBe('floor-built-by-script')
    expect(
      setZoneIntent(nodes, {
        zoneId: zone.id,
        patch: { floor: { finish: 'library:preset-white' } },
      }).conflicts?.[0]?.code,
    ).toBe('floor-built-by-script')

    nodes = applySceneChanges(
      nodes,
      setRoomFloorScript(nodes, { zoneId: zone.id, remove: true }, { activeLevelId: LEVEL })
        .changes,
    ) as SceneNodes
    expect(zoneOf(nodes).floor?.script).toBeUndefined()
    expect(floorPlatePaintRefusal(nodes, plate, role)).toBeUndefined()
  })

  test('a room with no floor has no script built for it', async () => {
    const nodes = room()
    const zone = zoneOf(nodes)
    const { host } = fakeHost()
    const inputs = floorScriptInputs(nodes, zone.id)!
    const compiled = await host.build({ nodeId: zone.id, code: '', params: {}, inputs })
    const off = reconcile({ ...nodes, [zone.id]: { ...zone, hasFloor: false } }, nodes)
    expect(floorScriptInputs(off, zone.id)).toBeNull()
    expect(
      refusal(() =>
        setRoomFloorScript(off, { zoneId: zone.id, compiled, inputs }, { activeLevelId: LEVEL }),
      ),
    ).toBe('no_floor')
  })
})

test('a zone saved before floor scripts parses as it did, and nothing in its scene is stale', () => {
  const nodes = room()
  const zone = zoneOf(nodes)
  const saved = JSON.parse(JSON.stringify({ ...zone, floor: { finish: 'library:preset-white' } }))
  expect(ZoneNode.parse(saved)).toEqual(saved)
  expect(staleFinishScripts({ ...nodes, [zone.id]: saved })).toEqual([])
})
