import { describe, expect, test } from 'bun:test'
import { applySceneChanges } from '../agent-operations/apply-changes'
import { paint } from '../agent-operations/paint'
import { setWallFaceScript } from '../agent-operations/wall-face-script'
import { isAgentRefusal } from '../agent-tools'
import {
  type AnyNode,
  type CompiledGeometryScript,
  DoorNode,
  GeometryArtifactManifest,
  LevelNode,
  WallNode,
  WindowNode,
} from '../schema'
import {
  type FinishScriptHost,
  finishScriptWrites,
  refreshFinishScripts,
  staleFinishScripts,
} from './finish-script'
import type { SceneNodes } from './structure-kernel'
import { reconcileSceneStructure } from './structure-reconcile'
import {
  type WallFaceScriptInputs,
  wallFaceScriptInputs,
  wallFaceScriptPaintRefusal,
  wallFaceScriptPlacement,
} from './wall-face-script'

const LEVEL = 'level_face_script'
const SOUTH = 'wall_wf_0'
const corners: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]

let minted = 0
/**
 * A copy of the reconciled scene: the reconcile patches its draft in place after reading wall
 * support from it, and support is memoised per nodes object, so the draft itself reads stale.
 */
function reconcile(nodes: SceneNodes, previousNodes?: SceneNodes): SceneNodes {
  return {
    ...reconcileSceneStructure({
      nodes,
      previousNodes,
      mintId: (kind) => `${kind}_wf_${minted++}`,
    }).nodes,
  }
}

/**
 * An 8 × 4 m room of 0.2 m walls, reconciled into its zone and floor plate. Its south wall runs
 * from (0, 0) to (8, 0), so its face a looks into the room; it has a 0.9 × 2.1 m door 2 m along
 * and a 1.2 × 1 m window 5 m along with its sill at 1 m.
 */
function room(): SceneNodes {
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_wf_${index}`,
      parentId: LEVEL,
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.2,
    }),
  )
  const door = DoorNode.parse({
    id: 'door_wf',
    parentId: SOUTH,
    wallId: SOUTH,
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const window = WindowNode.parse({
    id: 'window_wf',
    parentId: SOUTH,
    wallId: SOUTH,
    position: [5, 1.5, 0],
    width: 1.2,
    height: 1,
  })
  walls[0] = { ...walls[0]!, children: [door.id, window.id] }
  const level = LevelNode.parse({ id: LEVEL, children: walls.map((wall) => wall.id) })
  return reconcile(
    Object.fromEntries([level, ...walls, door, window].map((node) => [node.id, node])),
  )
}

const wallOf = (nodes: SceneNodes, id = SOUTH) => nodes[id] as WallNode

/** A host that compiles nothing: it counts its builds and answers with the face's rectangle. */
function fakeHost() {
  const builds: WallFaceScriptInputs[] = []
  const host: FinishScriptHost = {
    readScript: async (sha) => (sha === 'c'.repeat(64) ? 'export default () => {}' : null),
    build: async (input) => {
      const { outline } = input.inputs as WallFaceScriptInputs
      builds.push(input.inputs as WallFaceScriptInputs)
      return {
        sha256: builds.length.toString(16).padStart(64, '0'),
        script: 'c'.repeat(64),
        language: 'three',
        mount: 'wall-side',
        params: { tile: 0.3 },
        manifest: GeometryArtifactManifest.parse({
          bounds: {
            min: [outline.x0, outline.y0, 0],
            max: [outline.x1, outline.y1, 0.01],
          },
          slots: [{ id: 'tile' }],
          triangles: 12,
        }),
      } satisfies CompiledGeometryScript
    },
  }
  return { host, builds }
}

/** The south wall with a script on its face a (to `toHeight`), built once by `host`. */
async function scripted(host: FinishScriptHost, toHeight?: number, nodes = room()) {
  const inputs = wallFaceScriptInputs(nodes, SOUTH, 'a', toHeight)!
  const compiled = await host.build({ nodeId: SOUTH, face: 'a', code: '', params: {}, inputs })
  const { changes } = setWallFaceScript(
    nodes,
    { wallId: SOUTH, face: 'a', compiled, inputs, toHeight },
    { activeLevelId: LEVEL },
  )
  return applySceneChanges(nodes, changes) as SceneNodes
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

describe("a wall face's script", () => {
  test('is given its face in wall-local metres: a door from the floor, a window at its sill', () => {
    const nodes = room()
    // Face a meets the side walls' inner faces 0.1 m in from each end; face b runs past them.
    // Both stand on the 0.05 m floor plate, 2.45 m under the 2.5 m storey.
    expect(wallFaceScriptInputs(nodes, SOUTH, 'a')).toEqual({
      outline: { x0: 0.1, y0: 0, x1: 7.9, y1: 2.45 },
      holes: [
        { x0: 1.55, y0: 0, x1: 2.45, y1: 2.1 },
        { x0: 4.4, y0: 1, x1: 5.6, y1: 2 },
      ],
      base: [
        [0.1, 0],
        [7.9, 0],
      ],
      thickness: 0.2,
    })
    expect(wallFaceScriptInputs(nodes, SOUTH, 'b')?.outline).toEqual({
      x0: -0.1,
      y0: 0,
      x1: 8.1,
      y1: 2.45,
    })
    // A dado to 1.2 m keeps the door, cut at its top, and the window's lower 0.2 m.
    expect(wallFaceScriptInputs(nodes, SOUTH, 'a', 1.2)?.holes).toEqual([
      { x0: 1.55, y0: 0, x1: 2.45, y1: 1.2 },
      { x0: 4.4, y0: 1, x1: 5.6, y1: 1.2 },
    ])
  })

  test('is built once, and again only after an opening is added or the wall is lengthened', async () => {
    const { host, builds } = fakeHost()
    let nodes = await scripted(host)
    expect(builds).toHaveLength(1)
    expect(staleFinishScripts(nodes)).toEqual([])
    expect(await refreshFinishScripts(nodes, host)).toEqual({ rebuilt: [], failed: [] })
    // Painting the other face changes nothing the script was built for.
    nodes = applySceneChanges(
      nodes,
      paint(nodes, { targets: [SOUTH], role: 'b', color: '#336699' }, { activeLevelId: LEVEL })
        .changes,
    ) as SceneNodes
    expect(staleFinishScripts(nodes)).toEqual([])

    const rebuild = async () => {
      expect(staleFinishScripts(nodes).map(({ nodeId, face }) => [nodeId, face])).toEqual([
        [SOUTH, 'a'],
      ])
      const refresh = await refreshFinishScripts(nodes, host)
      expect(refresh.failed).toEqual([])
      nodes = applySceneChanges(nodes, {
        update: finishScriptWrites(nodes, refresh.rebuilt),
      }) as SceneNodes
      expect(staleFinishScripts(nodes)).toEqual([])
    }

    const window = WindowNode.parse({
      id: 'window_wf_2',
      parentId: SOUTH,
      wallId: SOUTH,
      position: [6.8, 1.5, 0],
      width: 0.6,
      height: 0.6,
    })
    nodes = {
      ...nodes,
      [window.id]: window,
      [SOUTH]: { ...wallOf(nodes), children: [...wallOf(nodes).children, window.id] },
    }
    await rebuild()
    expect(builds).toHaveLength(2)
    expect(builds[1]!.holes).toHaveLength(3)

    const lengthened: Record<string, AnyNode> = { ...nodes }
    const wall = (id: string, data: Partial<WallNode>) => {
      lengthened[id] = { ...wallOf(nodes, id), ...data }
    }
    wall(SOUTH, { end: [9, 0] })
    wall('wall_wf_1', { start: [9, 0], end: [9, 4] })
    wall('wall_wf_2', { start: [9, 4] })
    nodes = reconcile(lengthened, nodes)
    await rebuild()
    expect(builds).toHaveLength(3)
    expect(builds[2]!.outline.x1).toBeCloseTo(8.9, 6)
    const rebuilt = wallOf(nodes).finishScripts?.a
    expect(rebuilt?.artifact).toBe('3'.padStart(64, '0'))
    expect(rebuilt?.params).toEqual({ tile: 0.3 })
  })

  test('refuses paint on its face until removed, and leaves the other face and a dado face paintable', async () => {
    let nodes = await scripted(fakeHost().host)
    const region = { id: 'region_wf', face: 'a' as const, v1: 0.9, finish: 'library:preset-white' }
    nodes = { ...nodes, [SOUTH]: { ...wallOf(nodes), faceRegions: [region] } }
    const zoneId = Object.values(nodes).find((node) => node.type === 'zone')!.id
    for (const role of ['a', `region:${region.id}`, `room:${zoneId}/a`])
      expect(wallFaceScriptPaintRefusal(wallOf(nodes), role)?.code).toBe(
        'wall-face-built-by-script',
      )
    expect(wallFaceScriptPaintRefusal(wallOf(nodes), 'b')).toBeUndefined()
    expect(wallFaceScriptPaintRefusal(wallOf(nodes), 'aSkirting')).toBeUndefined()
    const painting = (role: string) =>
      paint(nodes, { targets: [SOUTH], role, color: '#336699' }, { activeLevelId: LEVEL })
    expect(refusal(() => painting('a'))).toBe('face_built_by_script')
    expect(painting('b').changes?.update).toHaveLength(1)

    const dado = await scripted(fakeHost().host, 1.2)
    expect(wallFaceScriptPaintRefusal(wallOf(dado), 'a')).toBeUndefined()

    nodes = applySceneChanges(
      nodes,
      setWallFaceScript(nodes, { wallId: SOUTH, face: 'a', remove: true }, { activeLevelId: LEVEL })
        .changes,
    ) as SceneNodes
    expect(wallOf(nodes).finishScripts).toBeUndefined()
    expect(wallFaceScriptPaintRefusal(wallOf(nodes), 'a')).toBeUndefined()
  })

  test('is placed on its own face, 1 mm proud, its z out of that face', () => {
    const nodes = room()
    // The south wall's local frame is the plan's: x east from its start, local z = plan y (north).
    const onPlan = (face: 'a' | 'b', [x, y, z]: [number, number, number]) => {
      const { position, scale } = wallFaceScriptPlacement(nodes, SOUTH, face)!
      return [position[0] + x * scale[0], position[1] + y * scale[1], position[2] + z * scale[2]]
    }
    // A tile 1 cm thick, 1 m along: on face a its front is in the room, on face b outside it.
    const [ax, ay, az] = onPlan('a', [1, 0.5, 0.01])
    expect([ax, ay]).toEqual([1, 0.5])
    expect(az).toBeCloseTo(0.1 + 0.001 + 0.01, 9)
    const [bx, , bz] = onPlan('b', [1, 0.5, 0.01])
    expect(bx).toBe(1)
    expect(bz).toBeCloseTo(-(0.1 + 0.001 + 0.01), 9)
  })

  test('a curved wall has no face a script can build on', async () => {
    const nodes = room()
    const { host } = fakeHost()
    const inputs = wallFaceScriptInputs(nodes, SOUTH, 'a')!
    const compiled = await host.build({ nodeId: SOUTH, face: 'a', code: '', params: {}, inputs })
    const curved = { ...nodes, [SOUTH]: { ...wallOf(nodes), curveOffset: 0.5 } }
    expect(wallFaceScriptInputs(curved, SOUTH, 'a')).toBeNull()
    expect(
      refusal(() =>
        setWallFaceScript(
          curved,
          { wallId: SOUTH, face: 'a', compiled, inputs },
          { activeLevelId: LEVEL },
        ),
      ),
    ).toBe('no_face')
  })
})

test('a wall saved before face scripts parses as it did, and nothing in its scene is stale', () => {
  const nodes = room()
  const saved = JSON.parse(JSON.stringify({ ...wallOf(nodes), slots: { a: 'library:tile' } }))
  expect(WallNode.parse(saved)).toEqual(saved)
  expect(staleFinishScripts({ ...nodes, [SOUTH]: saved })).toEqual([])
})
