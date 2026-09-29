import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  LevelNode,
} from '@pascal-app/core'
import { CEILING_PANEL_MIN_HEIGHT, ceilingHeightRange, clampCeilingHeight } from './height-bounds'

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

// The panel slider's change handler clamps through this range.
function panelClamp(nodes: Record<AnyNodeId, AnyNode>, ceilingId: string, proposed: number) {
  const node = nodes[ceilingId as AnyNodeId] as CeilingNode
  return clampCeilingHeight(proposed, ceilingHeightRange(node, nodes, CEILING_PANEL_MIN_HEIGHT))
}

describe('ceiling panel height bounds', () => {
  const nodes = ceilingBoundsScene([
    { id: 'ceiling_soffit', levelId: 'level_roof', height: -2.5 },
    { id: 'ceiling_ground', levelId: 'level_0', height: 2.4 },
  ])

  test('a roof-level ceiling below its level floor keeps its height', () => {
    expect(panelClamp(nodes, 'ceiling_soffit', -2.5)).toBeCloseTo(-2.5)
    expect(panelClamp(nodes, 'ceiling_soffit', -3.409)).toBeCloseTo(-3.409)
  })

  test('nothing renders below grade', () => {
    // The ceiling renderers draw the surface 1 cm under the stored height
    // (ceiling-system.tsx, ceiling/renderer.tsx); the drawn world Y must stay at or above grade.
    const baseY = 6.4
    const clamped = panelClamp(nodes, 'ceiling_soffit', -10)
    expect(baseY + clamped - 0.01).toBeGreaterThanOrEqual(-1e-9)
    expect(baseY + clamped - 0.01).toBeCloseTo(0)
  })

  test('the upper bound is unchanged', () => {
    expect(panelClamp(nodes, 'ceiling_soffit', 5)).toBeCloseTo(2.49)
    expect(panelClamp(nodes, 'ceiling_ground', 5)).toBeCloseTo(3.19)
  })

  test('a ground-storey ceiling still clamps at 0', () => {
    expect(panelClamp(nodes, 'ceiling_ground', 0.2)).toBeCloseTo(0.2)
    expect(panelClamp(nodes, 'ceiling_ground', -1)).toBe(0)
  })
})
