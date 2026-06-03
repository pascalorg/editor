import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { cloneNodesInto, collectSubtree } from './subtree'

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

describe('collectSubtree', () => {
  test('returns null for missing root', () => {
    expect(collectSubtree({}, 'missing' as AnyNodeId)).toBeNull()
  })

  test('returns just the root for a leaf node', () => {
    const root = makeNode('shelf_1', 'shelf', { width: 1 })
    const sub = collectSubtree({ ['shelf_1' as AnyNodeId]: root }, 'shelf_1' as AnyNodeId)
    expect(sub?.root).toBe(root)
    expect(sub?.descendants).toEqual([])
  })

  test('walks descendants in BFS / declaration order', () => {
    const nodes: Record<AnyNodeId, AnyNode> = {
      ['shelf_1' as AnyNodeId]: makeNode('shelf_1', 'shelf', {
        position: [0, 0, 0],
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
    const sub = collectSubtree(nodes, 'shelf_1' as AnyNodeId)
    expect(sub?.descendants.map((n) => n.id)).toEqual(['item_a', 'item_b'])
  })

  test('returned nodes are live references — no cloning', () => {
    const item = makeNode('item_a', 'item', { parentId: 'shelf_1', position: [0, 0, 0] })
    const nodes: Record<AnyNodeId, AnyNode> = {
      ['shelf_1' as AnyNodeId]: makeNode('shelf_1', 'shelf', { children: ['item_a'] }),
      ['item_a' as AnyNodeId]: item,
    }
    const sub = collectSubtree(nodes, 'shelf_1' as AnyNodeId)
    expect(sub?.descendants[0]).toBe(item)
  })
})

describe('cloneNodesInto', () => {
  test('clones a single root with fresh id and supplied position', () => {
    const original = makeNode('door_orig', 'door', {
      position: [1, 2, 3],
      wallId: 'wall_x',
      width: 0.9,
    })
    const { rootId, nodes } = cloneNodesInto([original], {
      rootId: 'door_orig' as AnyNodeId,
      position: [10, 0, -4],
    })
    expect(nodes).toHaveLength(1)
    const cloned = nodes[0] as any
    expect(cloned.id).toBe(rootId)
    expect(cloned.id).not.toBe('door_orig')
    expect(cloned.id.startsWith('door_')).toBe(true)
    expect(cloned.position).toEqual([10, 0, -4])
    expect(cloned.width).toBe(0.9)
    // cloneNodesInto is host-ref-agnostic — wallId is preserved
    // verbatim. Stripping is the caller's job (see getHostRefFields).
    expect(cloned.wallId).toBe('wall_x')
  })

  test('preserves root position when none is supplied', () => {
    const original = makeNode('shelf_orig', 'shelf', { position: [5, 0, 5] })
    const { nodes } = cloneNodesInto([original], { rootId: 'shelf_orig' as AnyNodeId })
    expect((nodes[0] as any).position).toEqual([5, 0, 5])
  })

  test('preserves parent/child subtree with remapped ids and relative positions', () => {
    const shelf = makeNode('shelf_1', 'shelf', {
      position: [5, 0, 5],
      children: ['item_a', 'item_b'],
    })
    const itemA = makeNode('item_a', 'item', { parentId: 'shelf_1', position: [0, 0, 0] })
    const itemB = makeNode('item_b', 'item', { parentId: 'shelf_1', position: [0.3, 0, 0] })

    const { rootId, nodes: out } = cloneNodesInto([shelf, itemA, itemB], {
      rootId: 'shelf_1' as AnyNodeId,
      position: [99, 0, -99],
    })
    expect(out).toHaveLength(3)
    const root = out[0] as any
    expect(root.id).toBe(rootId)
    expect(root.id).not.toBe('shelf_1')
    expect(root.position).toEqual([99, 0, -99])
    // Root's children rewritten to fresh ids; descendants' parentIds
    // point at the new root id.
    const ids = new Set(out.map((n) => (n as any).id))
    expect(root.children).toHaveLength(2)
    for (const cid of root.children) expect(ids.has(cid)).toBe(true)
    for (let i = 1; i < out.length; i += 1) {
      const desc = out[i] as any
      expect(desc.parentId).toBe(rootId)
      expect(Array.isArray(desc.position)).toBe(true)
    }
  })

  test('parents the cloned root under opts.parentId when supplied', () => {
    const orig = makeNode('shelf_1', 'shelf', { parentId: 'level_old' })
    const { nodes } = cloneNodesInto([orig], {
      rootId: 'shelf_1' as AnyNodeId,
      parentId: 'level_new' as AnyNodeId,
    })
    expect((nodes[0] as any).parentId).toBe('level_new')
  })

  test('two clones produce disjoint id sets', () => {
    const orig = makeNode('shelf_1', 'shelf', {
      position: [0, 0, 0],
      children: ['item_a'],
    })
    const child = makeNode('item_a', 'item', { parentId: 'shelf_1', position: [0, 0, 0] })
    const first = cloneNodesInto([orig, child], { rootId: 'shelf_1' as AnyNodeId })
    const second = cloneNodesInto([orig, child], { rootId: 'shelf_1' as AnyNodeId })
    const idsA = new Set(first.nodes.map((n) => (n as any).id))
    const idsB = new Set(second.nodes.map((n) => (n as any).id))
    for (const id of idsA) expect(idsB.has(id)).toBe(false)
  })

  test('throws if rootId is missing from the input array', () => {
    const orig = makeNode('shelf_1', 'shelf', {})
    expect(() => cloneNodesInto([orig], { rootId: 'shelf_other' as AnyNodeId })).toThrow(/rootId/)
  })
})
