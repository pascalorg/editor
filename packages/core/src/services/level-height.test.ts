import { describe, expect, it } from 'bun:test'
import { CeilingNode, LevelNode, SlabNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { deriveLegacyLevelHeight } from './level-height'

function createFixture(): Record<AnyNodeId, AnyNode> {
  const nodes: AnyNode[] = [
    LevelNode.parse({ id: 'level_empty', children: [] }),
    LevelNode.parse({ id: 'level_no_slab', children: ['wall_no_slab'] }),
    WallNode.parse({
      id: 'wall_no_slab',
      parentId: 'level_no_slab',
      start: [10, 0],
      end: [12, 0],
    }),
    LevelNode.parse({ id: 'level_standard_slab', children: ['slab_standard', 'wall_standard'] }),
    SlabNode.parse({
      id: 'slab_standard',
      parentId: 'level_standard_slab',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      elevation: 0.05,
    }),
    WallNode.parse({
      id: 'wall_standard',
      parentId: 'level_standard_slab',
      start: [1, 2],
      end: [3, 2],
    }),
    LevelNode.parse({ id: 'level_tall_wall', children: ['slab_raised', 'wall_tall'] }),
    SlabNode.parse({
      id: 'slab_raised',
      parentId: 'level_tall_wall',
      polygon: [
        [20, 0],
        [24, 0],
        [24, 4],
        [20, 4],
      ],
      elevation: 0.35,
    }),
    WallNode.parse({
      id: 'wall_tall',
      parentId: 'level_tall_wall',
      start: [21, 2],
      end: [23, 2],
      height: 3.2,
    }),
    LevelNode.parse({ id: 'level_ceiling', children: ['wall_below_ceiling', 'ceiling_tall'] }),
    WallNode.parse({
      id: 'wall_below_ceiling',
      parentId: 'level_ceiling',
      start: [40, 0],
      end: [42, 0],
    }),
    CeilingNode.parse({
      id: 'ceiling_tall',
      parentId: 'level_ceiling',
      polygon: [
        [40, 0],
        [42, 0],
        [42, 2],
        [40, 2],
      ],
      height: 3.4,
    }),
    LevelNode.parse({ id: 'level_negative_slab', children: ['slab_negative', 'wall_negative'] }),
    SlabNode.parse({
      id: 'slab_negative',
      parentId: 'level_negative_slab',
      polygon: [
        [30, 0],
        [34, 0],
        [34, 4],
        [30, 4],
      ],
      elevation: -0.4,
    }),
    WallNode.parse({
      id: 'wall_negative',
      parentId: 'level_negative_slab',
      start: [31, 2],
      end: [33, 2],
      height: 2.8,
    }),
  ]

  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

describe('deriveLegacyLevelHeight', () => {
  const nodes = createFixture()
  const cases = [
    ['level_no_slab', 2.5],
    ['level_standard_slab', 2.55],
    ['level_tall_wall', 3.55],
    ['level_ceiling', 3.4],
    ['level_negative_slab', 2.8],
    ['level_empty', 2.5],
  ] as const

  for (const [levelId, expected] of cases) {
    it(`derives ${expected} for ${levelId}`, () => {
      expect(deriveLegacyLevelHeight(levelId, nodes)).toBeCloseTo(expected)
    })
  }
})
