import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { buildSubtreeSnapshot, materializeSubtree } from './subtree'

function makeNode(id: string, type: string, extra: Record<string, unknown> = {}): AnyNode {
  return {
    object: 'node',
    id,
    type,
    parentId: null,
    visible: true,
    metadata: {},
    ...extra,
  } as unknown as AnyNode
}

describe('buildSubtreeSnapshot', () => {
  test('returns null for missing root', () => {
    expect(buildSubtreeSnapshot({}, 'missing' as AnyNodeId)).toBeNull()
  })

  test('strips id / parentId / position / wallId from the root', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      ['door_1' as AnyNodeId]: makeNode('door_1', 'door', {
        parentId: 'level_1',
        position: [1, 2, 3],
        wallId: 'wall_x',
        wallT: 0.4,
        width: 0.9,
        height: 2.1,
      }),
    }
    const snap = buildSubtreeSnapshot(nodes, 'door_1' as AnyNodeId)
    expect(snap).not.toBeNull()
    expect((snap?.root as any).id).toBeUndefined()
    expect((snap?.root as any).parentId).toBeUndefined()
    expect((snap?.root as any).position).toBeUndefined()
    expect((snap?.root as any).wallId).toBeUndefined()
    expect((snap?.root as any).wallT).toBeUndefined()
    expect((snap?.root as any).width).toBe(0.9)
    expect((snap?.root as any).height).toBe(2.1)
    expect(snap?.rootKind).toBe('door')
  })

  test('captures descendants via the children array', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      ['shelf_1' as AnyNodeId]: makeNode('shelf_1', 'shelf', {
        position: [5, 0, 5],
        children: ['item_a', 'item_b'],
        width: 1,
      }),
      ['item_a' as AnyNodeId]: makeNode('item_a', 'item', {
        parentId: 'shelf_1',
        position: [0, 0, 0],
      }),
      ['item_b' as AnyNodeId]: makeNode('item_b', 'item', {
        parentId: 'shelf_1',
        position: [0.3, 0, 0],
      }),
    }
    const snap = buildSubtreeSnapshot(nodes, 'shelf_1' as AnyNodeId)
    expect(snap?.descendants).toHaveLength(2)
    // Descendants keep their local positions.
    expect((snap?.descendants[0] as any).position).toEqual([0, 0, 0])
    expect((snap?.descendants[1] as any).position).toEqual([0.3, 0, 0])
    // Internal child references rewritten to tokens, not original ids.
    const childTokens = (snap?.root as any).children as string[]
    expect(childTokens).toHaveLength(2)
    for (const t of childTokens) {
      expect(t.includes('::')).toBe(true)
      expect(t.startsWith('item::')).toBe(true)
    }
  })
})

describe('materializeSubtree', () => {
  test('round-trips a single-node snapshot at a new position with fresh ids', () => {
    const original = makeNode('door_orig', 'door', {
      position: [1, 2, 3],
      wallId: 'wall_x',
      width: 0.9,
      height: 2.1,
    })
    const snap = buildSubtreeSnapshot(
      { ['door_orig' as AnyNodeId]: original },
      'door_orig' as AnyNodeId,
    )
    if (!snap) throw new Error('snap')

    const { rootId, nodes } = materializeSubtree(snap, [10, 0, -4])
    expect(nodes).toHaveLength(1)
    const newRoot = nodes[0] as any
    expect(newRoot.id).toBe(rootId)
    expect(newRoot.id).not.toBe('door_orig')
    expect(newRoot.id.startsWith('door_')).toBe(true)
    expect(newRoot.parentId).toBeNull()
    expect(newRoot.position).toEqual([10, 0, -4])
    // Host ref was stripped at snapshot time; materialize doesn't re-add it.
    expect(newRoot.wallId).toBeUndefined()
    // Parametric fields preserved verbatim.
    expect(newRoot.width).toBe(0.9)
    expect(newRoot.height).toBe(2.1)
  })

  test('preserves a parent/child subtree with remapped ids and relative positions', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      ['shelf_1' as AnyNodeId]: makeNode('shelf_1', 'shelf', {
        position: [5, 0, 5],
        children: ['item_a', 'item_b'],
        width: 1,
      }),
      ['item_a' as AnyNodeId]: makeNode('item_a', 'item', {
        parentId: 'shelf_1',
        position: [0, 0, 0],
      }),
      ['item_b' as AnyNodeId]: makeNode('item_b', 'item', {
        parentId: 'shelf_1',
        position: [0.3, 0, 0],
      }),
    }
    const snap = buildSubtreeSnapshot(nodes, 'shelf_1' as AnyNodeId)!
    const { rootId, nodes: out } = materializeSubtree(snap, [99, 0, -99])
    expect(out).toHaveLength(3)
    const root = out[0] as any
    expect(root.id).toBe(rootId)
    expect(root.id).not.toBe('shelf_1')
    expect(root.position).toEqual([99, 0, -99])
    // Children point at fresh ids that exist in the output.
    const ids = new Set(out.map((n) => (n as any).id))
    expect(root.children).toHaveLength(2)
    for (const cid of root.children) expect(ids.has(cid)).toBe(true)
    // Descendant parentIds point at the new root id.
    for (let i = 1; i < out.length; i += 1) {
      const desc = out[i] as any
      expect(desc.parentId).toBe(rootId)
      // Position preserved.
      expect(Array.isArray(desc.position)).toBe(true)
    }
    // Internal-token metadata is gone.
    for (const node of out) {
      const md = (node as any).metadata ?? {}
      expect(md.__subtreeKey).toBeUndefined()
    }
  })

  test('two materializations yield disjoint id sets', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      ['shelf_1' as AnyNodeId]: makeNode('shelf_1', 'shelf', {
        position: [0, 0, 0],
        children: ['item_a'],
      }),
      ['item_a' as AnyNodeId]: makeNode('item_a', 'item', {
        parentId: 'shelf_1',
        position: [0, 0, 0],
      }),
    }
    const snap = buildSubtreeSnapshot(nodes, 'shelf_1' as AnyNodeId)!
    const first = materializeSubtree(snap, [0, 0, 0])
    const second = materializeSubtree(snap, [1, 0, 0])
    const idsA = new Set(first.nodes.map((n) => (n as any).id))
    const idsB = new Set(second.nodes.map((n) => (n as any).id))
    for (const id of idsA) expect(idsB.has(id)).toBe(false)
  })
})
