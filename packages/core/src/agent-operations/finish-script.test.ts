import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools'
import type { FinishScriptInputs } from '../lib/finish-script'
import type { SceneNodes } from '../lib/structure-kernel'
import { reconcileSceneStructure } from '../lib/structure-reconcile'
import type { WallFaceScriptInputs } from '../lib/wall-face-script'
import {
  type CompiledGeometryScript,
  GeometryArtifactManifest,
  LevelNode,
  WallNode,
  type ZoneNode,
} from '../schema'
import { applySceneChanges } from './apply-changes'
import {
  type FinishScriptCompile,
  planFinishScript,
  type SetFinishScriptInput,
  setFinishScript,
} from './finish-script'

const LEVEL = 'level_fs'
const SOUTH = 'wall_fs_0'

let minted = 0
/**
 * An 8 × 4 m box of 0.2 m walls split by a partition at x = 3: a 3 m bathroom to the west and a
 * 5 m bedroom to the east. The south wall runs from (0, 0) to (8, 0), its face a looking into both.
 */
function flat(): { nodes: SceneNodes; bathroom: string; bedroom: string } {
  const corners: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 4],
    [0, 4],
  ]
  const walls = [
    ...corners.map((start, index) =>
      WallNode.parse({
        id: `wall_fs_${index}`,
        parentId: LEVEL,
        start,
        end: corners[(index + 1) % 4],
        thickness: 0.2,
      }),
    ),
    WallNode.parse({
      id: 'wall_fs_mid',
      parentId: LEVEL,
      start: [3, 0],
      end: [3, 4],
      thickness: 0.1,
    }),
  ]
  const level = LevelNode.parse({ id: LEVEL, children: walls.map((wall) => wall.id) })
  const nodes = {
    ...reconcileSceneStructure({
      nodes: Object.fromEntries([level, ...walls].map((node) => [node.id, node])),
      mintId: (kind) => `${kind}_fs_${minted++}`,
    }).nodes,
  } as SceneNodes
  const zones = Object.values(nodes).filter((node): node is ZoneNode => node.type === 'zone')
  const westOf = (zone: ZoneNode) => Math.max(...zone.polygon.map(([x]) => x)) < 4
  return {
    nodes,
    bathroom: zones.find(westOf)!.id,
    bedroom: zones.find((zone) => !westOf(zone))!.id,
  }
}

/** What a host would compile for each build: a GLB the size of what it was given. */
function compileAll(nodes: SceneNodes, input: SetFinishScriptInput) {
  const compiled: Record<string, FinishScriptCompile> = {}
  for (const build of planFinishScript(nodes, input).builds) {
    const outline = (build.inputs as WallFaceScriptInputs).outline ?? { x0: 0, y0: 0, x1: 1, y1: 1 }
    const script = {
      sha256: 'a'.repeat(64),
      script: 'b'.repeat(64),
      language: 'three',
      mount: 'wall-side',
      params: {},
      manifest: GeometryArtifactManifest.parse({
        bounds: { min: [outline.x0, outline.y0, 0], max: [outline.x1, outline.y1, 0.01] },
        slots: [{ id: 'tile' }],
        triangles: 12,
      }),
    } as CompiledGeometryScript
    compiled[build.key] = { script, inputs: build.inputs }
  }
  return compiled
}

function run(nodes: SceneNodes, input: SetFinishScriptInput) {
  const outcome = setFinishScript(nodes, { ...input, compiled: compileAll(nodes, input) })
  return {
    result: outcome.result as Record<string, unknown>,
    nodes: applySceneChanges(nodes, outcome.changes) as SceneNodes,
  }
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

const tile = 'export default () => null'
const south = (nodes: SceneNodes) => (nodes[SOUTH] as WallNode).finishScripts?.a

describe('set_finish_script', () => {
  test("a room's walls are built on the room's own stretch of each face, to a height", () => {
    const { nodes, bathroom } = flat()
    const plan = planFinishScript(nodes, {
      targetId: bathroom,
      surface: 'walls',
      code: tile,
      toHeight: 2.1,
    })
    // Four faces look into the bathroom: its west wall whole, and stretches of the long walls.
    expect(plan.builds).toHaveLength(4)
    const outline = (
      plan.builds.find((build) => build.nodeId === SOUTH)!.inputs as WallFaceScriptInputs
    ).outline
    expect(outline.x1).toBeLessThan(3.1)
    expect(outline.y1).toBe(2.1)

    const { result, nodes: built } = run(nodes, {
      targetId: bathroom,
      surface: 'walls',
      code: tile,
      toHeight: 2.1,
    })
    expect(south(built)).toMatchObject({ toHeight: 2.1 })
    expect(south(built)?.u0).toBeUndefined()
    expect(south(built)?.u1).toBeCloseTo(3, 1)
    expect(result.built).toHaveLength(4)
  })

  test("the next room's walls skip a face another room's script already covers", () => {
    const { nodes, bathroom, bedroom } = flat()
    const tiled = run(nodes, { targetId: bathroom, surface: 'walls', code: tile }).nodes
    const plan = planFinishScript(tiled, { targetId: bedroom, surface: 'walls', code: tile })
    // Both long walls run past the partition: the bathroom's tile holds their faces.
    expect(plan.skipped.map((skip) => [skip.wallId, skip.code]).sort()).toEqual([
      [SOUTH, 'face_taken'],
      ['wall_fs_2', 'face_taken'],
    ])
    expect(plan.builds.some((build) => build.nodeId === SOUTH)).toBe(false)
  })

  test("remove takes off only the room's own scripts", () => {
    const { nodes, bathroom } = flat()
    const tiled = run(nodes, { targetId: bathroom, surface: 'walls', code: tile }).nodes
    const { result, nodes: bare } = run(tiled, {
      targetId: bathroom,
      surface: 'walls',
      remove: true,
    })
    expect(result.removed).toBe(4)
    expect(south(bare)).toBeUndefined()
  })

  test('a wall face, a floor and the refusals', () => {
    const { nodes, bathroom } = flat()
    const whole = run(nodes, { targetId: SOUTH, face: 'a', code: tile }).nodes
    expect(south(whole)?.u0).toBeUndefined()
    expect(south(whole)?.u1).toBeUndefined()

    const floor = planFinishScript(nodes, { targetId: bathroom, surface: 'floor', code: tile })
    expect(
      (floor.builds[0]!.inputs as FinishScriptInputs & { polygon: unknown[] }).polygon.length,
    ).toBeGreaterThan(2)

    expect(refusal(() => planFinishScript(nodes, { targetId: SOUTH, code: tile }))).toBe(
      'face_required',
    )
    expect(refusal(() => planFinishScript(nodes, { targetId: bathroom, code: tile }))).toBe(
      'surface_required',
    )
    expect(refusal(() => planFinishScript(nodes, { targetId: SOUTH, face: 'a' }))).toBe(
      'code_required',
    )
    expect(
      refusal(() =>
        planFinishScript(nodes, { targetId: bathroom, surface: 'floor', code: tile, toHeight: 1 }),
      ),
    ).toBe('invalid_height')
    expect(refusal(() => setFinishScript(nodes, { targetId: SOUTH, face: 'a', code: tile }))).toBe(
      'not_compiled',
    )
  })

  test('a surface that changed while its module compiled is refused, not built stale', () => {
    const { nodes, bathroom } = flat()
    const input = { targetId: bathroom, surface: 'walls' as const, code: tile }
    const compiled = compileAll(nodes, input)
    // The south wall is lengthened while the compile runs: its stretch is no longer what was built.
    const moved = {
      ...nodes,
      [SOUTH]: { ...(nodes[SOUTH] as WallNode), start: [-1, 0] as [number, number] },
    } as SceneNodes
    expect(refusal(() => setFinishScript(moved, { ...input, compiled }))).toBe('scene_changed')
  })
})
