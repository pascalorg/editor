import { describe, expect, it } from 'bun:test'
import { BuildingNode, CeilingNode, LevelNode, SlabNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { deriveLegacyLevelHeight, getCeilingAt, resolveCeilingHeight } from './level-height'

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
    ['level_standard_slab', 2.5],
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

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

// Post-migration stack: two stored-height levels; the upper level carries a
// deck slab occupying [-0.3, 0] over the lower level's plane, so the lower
// level's ceiling clamp bound is 2.5 − 0.3 − 0.01 = 2.19 under the deck.
function createResolverFixture(options: { deck?: boolean } = {}): Record<AnyNodeId, AnyNode> {
  const list: AnyNode[] = [
    BuildingNode.parse({
      id: 'building_a',
      children: ['level_low', 'level_high'],
    }),
    LevelNode.parse({ id: 'level_low', level: 0, height: 2.5, parentId: 'building_a' }),
    LevelNode.parse({
      id: 'level_high',
      level: 1,
      height: 2.5,
      parentId: 'building_a',
      children: options.deck ? ['slab_deck'] : [],
    }),
  ]
  if (options.deck) {
    list.push(
      SlabNode.parse({
        id: 'slab_deck',
        parentId: 'level_high',
        polygon: SQUARE,
        elevation: 0,
        thickness: 0.3,
      }),
    )
  }
  return Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

describe('resolveCeilingHeight', () => {
  it('returns the explicit height verbatim when stored', () => {
    const nodes = createResolverFixture({ deck: true })
    const ceiling = CeilingNode.parse({ parentId: 'level_low', polygon: SQUARE, height: 2.0 })

    expect(resolveCeilingHeight(ceiling, nodes)).toBe(2.0)
  })

  it('resolves an absent height to the level-top clamp bound', () => {
    const nodes = createResolverFixture()
    const ceiling = CeilingNode.parse({ parentId: 'level_low', polygon: SQUARE })

    expect(resolveCeilingHeight(ceiling, nodes)).toBeCloseTo(2.49)
  })

  it('tracks a level height change without any ceiling write', () => {
    const nodes = createResolverFixture()
    const ceiling = CeilingNode.parse({ parentId: 'level_low', polygon: SQUARE })
    expect(resolveCeilingHeight(ceiling, nodes)).toBeCloseTo(2.49)

    const level = nodes['level_low' as AnyNodeId] as AnyNode & { height?: number }
    const raised = {
      ...nodes,
      level_low: { ...level, height: 3.2 } as AnyNode,
    } as Record<AnyNodeId, AnyNode>

    expect(resolveCeilingHeight(ceiling, raised)).toBeCloseTo(3.19)
  })

  it('resolves under a covering deck from the level above', () => {
    const nodes = createResolverFixture({ deck: true })
    const ceiling = CeilingNode.parse({ parentId: 'level_low', polygon: SQUARE })

    expect(resolveCeilingHeight(ceiling, nodes)).toBeCloseTo(2.19)
  })

  it('falls back to the default plane when the level is unresolvable', () => {
    const ceiling = CeilingNode.parse({ parentId: null, polygon: SQUARE })

    expect(resolveCeilingHeight(ceiling, {} as Record<AnyNodeId, AnyNode>)).toBeCloseTo(2.49)
  })
})

describe('getCeilingAt lowest-wins with mixed follows/explicit', () => {
  it('picks the explicit low ceiling under a follows-mode one, and vice versa', () => {
    const base = createResolverFixture()
    const follows = CeilingNode.parse({
      id: 'ceiling_follows',
      parentId: 'level_low',
      polygon: SQUARE,
    })
    const explicitLow = CeilingNode.parse({
      id: 'ceiling_low',
      parentId: 'level_low',
      polygon: SQUARE,
      height: 2.0,
    })
    const level = base['level_low' as AnyNodeId] as AnyNode & { children: string[] }
    const nodes = {
      ...base,
      level_low: { ...level, children: ['ceiling_follows', 'ceiling_low'] } as AnyNode,
      ceiling_follows: follows,
      ceiling_low: explicitLow,
    } as Record<AnyNodeId, AnyNode>

    // Explicit 2.0 undercuts the 2.49 follows bound.
    expect(getCeilingAt('level_low', nodes, 2, 2)?.id).toBe(explicitLow.id)

    // Raise the explicit one above the bound comparison: 2.6 stored — the
    // follows ceiling (2.49) is now the lowest surface over the point.
    const nodesHighExplicit = {
      ...nodes,
      ceiling_low: { ...explicitLow, height: 2.6 } as AnyNode,
    } as Record<AnyNodeId, AnyNode>
    expect(getCeilingAt('level_low', nodesHighExplicit, 2, 2)?.id).toBe(follows.id)
  })
})
