import { describe, expect, test } from 'bun:test'
import { readableScript } from '../agent-operations/add-object'
import { applySceneChanges } from '../agent-operations/apply-changes'
import { paint } from '../agent-operations/paint'
import { setSlabSurfaceScript } from '../agent-operations/slab-surface-script'
import { isAgentRefusal } from '../agent-tools'
import {
  type AnyNode,
  type CompiledGeometryScript,
  GeometryArtifactManifest,
  LevelNode,
  SlabNode,
  WallNode,
} from '../schema'
import {
  type FinishScriptHost,
  finishScriptWrites,
  refreshFinishScripts,
  staleFinishScripts,
} from './finish-script'
import { floorPlatePaintRefusal } from './floor-plate-paint'
import {
  FLOOR_SCRIPT_LIFT,
  type FloorScriptInputs,
  floorFinishTopAt,
  slabScriptSurface,
  slabSurfaceScriptInputs,
} from './floor-script'
import type { SceneNodes } from './structure-kernel'
import { reconcileSceneStructure } from './structure-reconcile'

const LEVEL = 'level_slab_script'
const TERRACE = 'slab_terrace'
const corners: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]

let minted = 0
/**
 * An 8 × 4 m room of 0.2 m walls reconciled into its zone and floor plate, and beside it a 4 × 3 m
 * terrace slab, 0.3 m high, with a 1 m square hole (a tree pit).
 */
function scene(): SceneNodes {
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_ss_${index}`,
      parentId: LEVEL,
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.2,
    }),
  )
  const terrace = SlabNode.parse({
    id: TERRACE,
    parentId: LEVEL,
    name: 'Terrace',
    polygon: [
      [10, 0],
      [14, 0],
      [14, 3],
      [10, 3],
    ],
    holes: [
      [
        [11, 1],
        [12, 1],
        [12, 2],
        [11, 2],
      ],
    ],
    elevation: 0.3,
    thickness: 0.3,
  })
  const level = LevelNode.parse({
    id: LEVEL,
    children: [...walls.map((wall) => wall.id), terrace.id],
  })
  const nodes = Object.fromEntries([level, ...walls, terrace].map((node) => [node.id, node]))
  return reconcileSceneStructure({ nodes, mintId: (kind) => `${kind}_ss_${minted++}` }).nodes
}

const terraceOf = (nodes: SceneNodes) => nodes[TERRACE] as SlabNode
const plateOf = (nodes: SceneNodes) =>
  Object.values(nodes).find(
    (node): node is SlabNode => node.type === 'slab' && node.boundary === 'auto',
  )!

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
        params: { board: 0.14 },
        manifest: GeometryArtifactManifest.parse({
          bounds: {
            min: [Math.min(...xs), 0, Math.min(...zs)],
            max: [Math.max(...xs), 0.025, Math.max(...zs)],
          },
          slots: [{ id: 'teak' }],
          triangles: 12,
        }),
      } satisfies CompiledGeometryScript
    },
  }
  return { host, builds }
}

/** The scene with decking on its terrace, built once by `host` for the terrace's outline. */
async function scripted(host: FinishScriptHost) {
  const nodes = scene()
  const inputs = slabSurfaceScriptInputs(nodes, TERRACE)!
  const compiled = await host.build({ nodeId: TERRACE, code: '', params: {}, inputs })
  const { changes } = setSlabSurfaceScript(
    nodes,
    { slabId: TERRACE, compiled, inputs },
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

describe("a slab's surface script", () => {
  test("is built for the slab's own outline less its holes, its y = 0 on the slab's top", () => {
    const nodes = scene()
    expect(slabSurfaceScriptInputs(nodes, TERRACE)).toEqual({
      polygon: terraceOf(nodes).polygon,
      holes: terraceOf(nodes).holes,
    })
    expect(slabScriptSurface(nodes, TERRACE)).toBeCloseTo(0.3, 9)
  })

  test("a room's floor plate has none: the room's floor script builds there", async () => {
    const nodes = scene()
    const plate = plateOf(nodes)
    expect(slabSurfaceScriptInputs(nodes, plate.id)).toBeNull()
    expect(slabScriptSurface(nodes, plate.id)).toBeNull()
    const { host } = fakeHost()
    const inputs = slabSurfaceScriptInputs(nodes, TERRACE)!
    const compiled = await host.build({ nodeId: plate.id, code: '', params: {}, inputs })
    expect(
      refusal(() =>
        setSlabSurfaceScript(
          nodes,
          { slabId: plate.id, compiled, inputs },
          { activeLevelId: LEVEL },
        ),
      ),
    ).toBe('room_floor_plate')
  })

  test('is written with the key of its outline, and taken off again', async () => {
    let nodes = await scripted(fakeHost().host)
    const script = terraceOf(nodes).surfaceScript!
    expect(script).toMatchObject({ script: 'a'.repeat(64), params: { board: 0.14 } })
    expect(script.inputs).toEqual(expect.any(String))
    expect(staleFinishScripts(nodes)).toEqual([])
    expect(readableScript(nodes, TERRACE)).toMatchObject({
      id: TERRACE,
      type: 'slab',
      source: script,
    })

    nodes = applySceneChanges(
      nodes,
      setSlabSurfaceScript(nodes, { slabId: TERRACE, remove: true }, { activeLevelId: LEVEL })
        .changes,
    ) as SceneNodes
    expect(terraceOf(nodes).surfaceScript).toBeUndefined()
    expect(refusal(() => readableScript(nodes, TERRACE))).toBe('not_authored')
  })

  test('refuses a Blender module and a build that cannot be measured', async () => {
    const nodes = scene()
    const inputs = slabSurfaceScriptInputs(nodes, TERRACE)!
    const compiled = await fakeHost().host.build({ nodeId: TERRACE, code: '', params: {}, inputs })
    const set = (built: CompiledGeometryScript) => () =>
      setSlabSurfaceScript(
        nodes,
        { slabId: TERRACE, compiled: built, inputs },
        { activeLevelId: LEVEL },
      )
    expect(refusal(set({ ...compiled, language: 'bpy' }))).toBe('three_only')
    const unmeasurable = {
      ...compiled,
      manifest: { ...compiled.manifest, bounds: { min: [0, 0, 0], max: [Number.NaN, 0, 0] } },
    } as CompiledGeometryScript
    expect(refusal(set(unmeasurable))).toBe('unmeasurable_object')
  })

  test('a raised slab moves the build; a reshaped one runs the module again', async () => {
    const { host, builds } = fakeHost()
    let nodes = await scripted(host)
    const raised = { ...nodes, [TERRACE]: { ...terraceOf(nodes), elevation: 0.45 } }
    expect(slabScriptSurface(raised, TERRACE)).toBeCloseTo(0.45, 9)
    expect(staleFinishScripts(raised)).toEqual([])

    const wider: [number, number][] = [
      [10, 0],
      [15, 0],
      [15, 3],
      [10, 3],
    ]
    nodes = { ...nodes, [TERRACE]: { ...terraceOf(nodes), polygon: wider } }
    expect(staleFinishScripts(nodes).map((stale) => stale.nodeId)).toEqual([TERRACE])
    const refresh = await refreshFinishScripts(nodes, host)
    expect(refresh.failed).toEqual([])
    expect(builds).toHaveLength(2)
    expect(builds[1]!.polygon).toEqual(wider)
    nodes = applySceneChanges(nodes, {
      update: finishScriptWrites(nodes, refresh.rebuilt),
    }) as SceneNodes
    expect(terraceOf(nodes).surfaceScript?.artifact).toBe('2'.padStart(64, '0'))
    expect(terraceOf(nodes).surfaceScript?.params).toEqual({ board: 0.14 })
    expect(terraceOf(nodes).polygon).toEqual(wider)
    expect(staleFinishScripts(nodes)).toEqual([])
  })

  test('refuses paint on its surface, through the Paint tool and the agent, until removed', async () => {
    let nodes = await scripted(fakeHost().host)
    expect(floorPlatePaintRefusal(nodes, terraceOf(nodes), 'surface')?.code).toBe(
      'floor-built-by-script',
    )
    expect(floorPlatePaintRefusal(nodes, terraceOf(nodes), 'edge')).toBeUndefined()
    const painting = (role?: string) =>
      paint(nodes, { targets: [TERRACE], role, color: '#336699' }, { activeLevelId: LEVEL })
    expect(refusal(() => painting())).toBe('surface_built_by_script')
    expect(refusal(() => painting('surface'))).toBe('surface_built_by_script')
    expect(painting('side').changes?.update).toHaveLength(1)

    nodes = applySceneChanges(
      nodes,
      setSlabSurfaceScript(nodes, { slabId: TERRACE, remove: true }, { activeLevelId: LEVEL })
        .changes,
    ) as SceneNodes
    expect(floorPlatePaintRefusal(nodes, terraceOf(nodes), 'surface')).toBeUndefined()
    expect(painting('surface').changes?.update).toHaveLength(1)
  })

  test('what stands on it stands on the build; in its hole or off it, on nothing it built', async () => {
    const nodes = await scripted(fakeHost().host)
    expect(floorFinishTopAt(nodes, LEVEL, TERRACE, 13, 2)).toBeCloseTo(
      0.3 + FLOOR_SCRIPT_LIFT + 0.025,
      9,
    )
    expect(floorFinishTopAt(nodes, LEVEL, TERRACE, 11.5, 1.5)).toBeNull()
    expect(floorFinishTopAt(nodes, LEVEL, TERRACE, 16, 2)).toBeNull()
    expect(floorFinishTopAt(scene(), LEVEL, TERRACE, 13, 2)).toBeNull()
  })
})

test('a slab saved before surface scripts parses as it did, and nothing in its scene is stale', () => {
  const nodes = scene()
  const saved = JSON.parse(
    JSON.stringify({ ...terraceOf(nodes), slots: { surface: 'library:tile' } }),
  )
  expect(SlabNode.parse(saved)).toEqual(saved)
  expect(staleFinishScripts({ ...nodes, [TERRACE]: saved as AnyNode })).toEqual([])
})
