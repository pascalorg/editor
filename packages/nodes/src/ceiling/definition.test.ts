import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  createSceneApi,
  LevelNode,
  type SceneStoreLike,
} from '@pascal-app/core'
import { ceilingDefinition } from './definition'

const polygon: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

/**
 * Test scene: ground 3.2 m + upper 3.2 m, so the roof level's floor sits
 * 6.4 m above grade, like the /next house roof level that owns its eave
 * soffits and porch ceilings.
 */
function ceilingBoundsScene(
  ceilings: Array<{ id: string; levelId: string; height: number }>,
): Record<AnyNodeId, AnyNode> {
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: ['level_0', 'level_1', 'level_roof'] }),
    LevelNode.parse({ id: 'level_0', level: 0, height: 3.2, parentId: 'building_a' }),
    LevelNode.parse({ id: 'level_1', level: 1, height: 3.2, parentId: 'building_a' }),
    LevelNode.parse({ id: 'level_roof', level: 2, height: 2.5, parentId: 'building_a' }),
    ...ceilings.map((c) =>
      CeilingNode.parse({ id: c.id, parentId: c.levelId, polygon, height: c.height }),
    ),
  ]
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

// Mirrors the arrow-handle drag path (editor node-arrow-handles.tsx): resolve
// the descriptor's min/max once, then clamp every proposed value into them.
function handleClamp(nodes: Record<AnyNodeId, AnyNode>, ceilingId: string, proposed: number) {
  const node = nodes[ceilingId as AnyNodeId] as CeilingNode
  const sceneApi = createSceneApi({ getState: () => ({ nodes }) } as unknown as SceneStoreLike)
  const handles =
    typeof ceilingDefinition.handles === 'function'
      ? ceilingDefinition.handles(node)
      : (ceilingDefinition.handles ?? [])
  const handle = handles[0]
  if (handle?.kind !== 'linear-resize') throw new Error('no ceiling height handle')
  const resolve = (bound: typeof handle.min, fallback: number) =>
    bound === undefined ? fallback : typeof bound === 'function' ? bound(node, sceneApi) : bound
  const min = resolve(handle.min, Number.NEGATIVE_INFINITY)
  const max = resolve(handle.max, Number.POSITIVE_INFINITY)
  return Math.min(max, Math.max(min, proposed))
}

describe('ceiling height handle bounds', () => {
  const nodes = ceilingBoundsScene([
    { id: 'ceiling_soffit', levelId: 'level_roof', height: -2.5 },
    { id: 'ceiling_ground', levelId: 'level_0', height: 2.4 },
  ])

  test('a roof-level ceiling below its level floor keeps its height', () => {
    expect(handleClamp(nodes, 'ceiling_soffit', -2.5)).toBeCloseTo(-2.5)
    expect(handleClamp(nodes, 'ceiling_soffit', -2.49)).toBeCloseTo(-2.49)
  })

  test('nothing goes below grade', () => {
    expect(handleClamp(nodes, 'ceiling_soffit', -10)).toBeCloseTo(-6.4)
  })

  test('the upper bound is unchanged', () => {
    expect(handleClamp(nodes, 'ceiling_soffit', 5)).toBeCloseTo(2.49)
    expect(handleClamp(nodes, 'ceiling_ground', 5)).toBeCloseTo(3.19)
  })

  test('a ground-storey ceiling still clamps at 0.5', () => {
    expect(handleClamp(nodes, 'ceiling_ground', 0.2)).toBe(0.5)
    expect(handleClamp(nodes, 'ceiling_ground', -1)).toBe(0.5)
  })
})
