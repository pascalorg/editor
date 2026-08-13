import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema'
import { getLevelIndex } from './level-index'

function node(partial: Record<string, unknown>): AnyNode {
  return partial as unknown as AnyNode
}

function scene(entries: AnyNode[]): Record<AnyNodeId, AnyNode> {
  return Object.fromEntries(
    entries.map((entry) => [(entry as { id: string }).id, entry]),
  ) as Record<AnyNodeId, AnyNode>
}

describe('getLevelIndex', () => {
  test('groups levels by building and sorts by ordinal, fractional and negative included', () => {
    const nodes = scene([
      node({ id: 'b1', type: 'building', children: ['l2', 'l1', 'l15'] }),
      node({ id: 'l2', type: 'level', parentId: 'b1', level: 2, children: [] }),
      node({ id: 'l1', type: 'level', parentId: 'b1', level: -1, children: [] }),
      node({ id: 'l15', type: 'level', parentId: 'b1', level: 1.5, children: [] }),
    ])

    const levels = getLevelIndex(nodes).levelsByBuilding.get('b1') ?? []
    expect(levels.map((level) => level.id)).toEqual(['l1', 'l15', 'l2'])
  })

  test('parentId pointing at a building wins over membership in another building', () => {
    // A corrupt graph can list a level in one building's children while its
    // parentId names another. Elevation stacking (storey.ts) resolves by
    // parentId first; the index must agree, or a stair would pick its
    // destination level from a different stack than the one its elevation
    // is computed in.
    const nodes = scene([
      node({ id: 'b1', type: 'building', children: ['shared'] }),
      node({ id: 'b2', type: 'building', children: [] }),
      node({ id: 'shared', type: 'level', parentId: 'b2', level: 0, children: [] }),
    ])

    const index = getLevelIndex(nodes)
    expect(index.buildingOfLevel.get('shared')).toBe('b2')
    expect(index.levelsByBuilding.get('b2')?.map((level) => level.id)).toEqual(['shared'])
    expect(index.levelsByBuilding.get('b1') ?? []).toEqual([])
  })

  test('legacy level with no parentId resolves through building membership', () => {
    const nodes = scene([
      node({ id: 'b1', type: 'building', children: ['legacy'] }),
      node({ id: 'legacy', type: 'level', parentId: null, level: 0, children: [] }),
    ])

    expect(getLevelIndex(nodes).buildingOfLevel.get('legacy')).toBe('b1')
  })

  test('level without any building lands in the null group', () => {
    const nodes = scene([
      node({ id: 'orphan', type: 'level', parentId: null, level: 0, children: [] }),
    ])

    const index = getLevelIndex(nodes)
    expect(index.buildingOfLevel.get('orphan')).toBeNull()
    expect(index.levelsByBuilding.get(null)?.map((level) => level.id)).toEqual(['orphan'])
  })

  test('levelOfChild maps membership, first claim winning in iteration order', () => {
    const nodes = scene([
      node({ id: 'lA', type: 'level', parentId: null, level: 0, children: ['stair1'] }),
      node({ id: 'lB', type: 'level', parentId: null, level: 1, children: ['stair1', 'stair2'] }),
    ])

    const index = getLevelIndex(nodes)
    expect(index.levelOfChild.get('stair1')).toBe('lA')
    expect(index.levelOfChild.get('stair2')).toBe('lB')
  })

  test('memoized per nodes identity — same object returns the same instance', () => {
    const nodes = scene([node({ id: 'l', type: 'level', parentId: null, level: 0, children: [] })])

    expect(getLevelIndex(nodes)).toBe(getLevelIndex(nodes))
    expect(getLevelIndex({ ...nodes })).not.toBe(getLevelIndex(nodes))
  })
})
