import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { nodeRegistry, registerNode } from './registry'
import { cascadeDirty, collectDescendants, type SpatialQuery } from './relations-resolver'
import type { AnyNodeDefinition, Relations, SceneApi } from './types'

const id = (s: string) => s as AnyNodeId

function makeDef(
  kind: string,
  relations?: Relations,
  overrides: Partial<AnyNodeDefinition> = {},
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as any,
    category: 'utility',
    defaults: () => ({}) as any,
    capabilities: {},
    relations,
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
    ...overrides,
  }
}

function makeNode(kind: string, idStr: string, extra: Partial<AnyNode> = {}): AnyNode {
  return {
    id: id(idStr),
    type: kind,
    parentId: null,
    visible: true,
    ...extra,
  } as unknown as AnyNode
}

function makeFakeScene(nodes: Record<string, AnyNode>): SceneApi {
  return {
    get: ((nid: AnyNodeId) => nodes[nid as string]) as SceneApi['get'],
    nodes: () => nodes as Readonly<Record<AnyNodeId, AnyNode>>,
    update: () => {},
    upsert: () => id(''),
    delete: () => {},
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: () => null,
    cloneNodesInto: () => null,
  }
}

describe('cascadeDirty', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('starting node alone when registry is empty', () => {
    const scene = makeFakeScene({ a: makeNode('unknown', 'a') })
    const dirty = cascadeDirty(id('a'), { scene })
    expect(Array.from(dirty)).toEqual([id('a')])
  })

  test('starting node alone when no relations declared', () => {
    registerNode(makeDef('thing'))
    const scene = makeFakeScene({ a: makeNode('thing', 'a') })
    const dirty = cascadeDirty(id('a'), { scene })
    expect(Array.from(dirty)).toEqual([id('a')])
  })

  test('hosts cascade marks matching children dirty', () => {
    registerNode(makeDef('wall', { hosts: ['door', 'window'] }))
    registerNode(makeDef('door'))
    registerNode(makeDef('window'))
    registerNode(makeDef('lamp'))

    const wall = makeNode('wall', 'w1', {
      children: [id('d1'), id('w2'), id('l1')],
    } as Partial<AnyNode>)
    const scene = makeFakeScene({
      w1: wall,
      d1: makeNode('door', 'd1', { parentId: id('w1') }),
      w2: makeNode('window', 'w2', { parentId: id('w1') }),
      l1: makeNode('lamp', 'l1', { parentId: id('w1') }), // not in hosts list
    })

    const dirty = cascadeDirty(id('w1'), { scene })
    const ids = Array.from(dirty).sort()
    expect(ids).toEqual([id('d1'), id('w1'), id('w2')]) // l1 excluded
  })

  test('hosts cascade is recursive but bounded by maxDepth', () => {
    registerNode(makeDef('a', { hosts: ['a'] })) // a hosts more a
    const nodes: Record<string, AnyNode> = {}
    for (let i = 0; i < 25; i++) {
      const childId = i < 24 ? id(`a${i + 1}`) : undefined
      nodes[`a${i}`] = makeNode('a', `a${i}`, {
        children: childId ? [childId] : [],
      } as Partial<AnyNode>)
    }
    const scene = makeFakeScene(nodes)
    const dirty = cascadeDirty(id('a0'), { scene, maxDepth: 5 })
    expect(dirty.size).toBe(6) // a0 + 5 descendants
  })

  test('affectsSpatial cascade uses spatialQuery to find neighbors', () => {
    registerNode(makeDef('wall', { affectsSpatial: ['slab', 'zone'] }))
    registerNode(makeDef('slab'))
    registerNode(makeDef('zone'))

    const scene = makeFakeScene({
      w1: makeNode('wall', 'w1'),
      s1: makeNode('slab', 's1'),
      z1: makeNode('zone', 'z1'),
      unrelated: makeNode('door', 'unrelated'),
    })

    const spatialQuery: SpatialQuery = (node, kinds) => {
      if (node.id !== id('w1')) return []
      const matches: AnyNodeId[] = []
      if (kinds.includes('slab')) matches.push(id('s1'))
      if (kinds.includes('zone')) matches.push(id('z1'))
      return matches
    }

    const dirty = cascadeDirty(id('w1'), { scene, spatialQuery })
    expect(Array.from(dirty).sort()).toEqual([id('s1'), id('w1'), id('z1')])
  })

  test('affectsSpatial is a no-op when no spatialQuery is provided', () => {
    registerNode(makeDef('wall', { affectsSpatial: ['slab'] }))
    const scene = makeFakeScene({ w1: makeNode('wall', 'w1') })
    const dirty = cascadeDirty(id('w1'), { scene })
    expect(Array.from(dirty)).toEqual([id('w1')]) // spatial branch silently skipped
  })

  test('cycle in hosts cascade does not loop forever', () => {
    registerNode(makeDef('a', { hosts: ['a'] }))
    const nodes: Record<string, AnyNode> = {
      a1: makeNode('a', 'a1', { children: [id('a2')] } as Partial<AnyNode>),
      a2: makeNode('a', 'a2', { children: [id('a1')] } as Partial<AnyNode>), // cycle
    }
    const scene = makeFakeScene(nodes)
    const dirty = cascadeDirty(id('a1'), { scene })
    expect(dirty.size).toBe(2)
    expect(dirty.has(id('a1'))).toBe(true)
    expect(dirty.has(id('a2'))).toBe(true)
  })

  test('custom childQuery overrides the default node.children lookup', () => {
    registerNode(makeDef('wall', { hosts: ['door'] }))
    registerNode(makeDef('door'))
    const scene = makeFakeScene({
      w1: makeNode('wall', 'w1'), // no children field
      d1: makeNode('door', 'd1', { parentId: id('w1') }),
    })

    // childQuery iterates the scene to find parentId matches — what you would
    // do for kinds that don't carry an explicit children array.
    const childQuery = (node: AnyNode) => {
      const result: AnyNodeId[] = []
      for (const candidate of [id('d1')]) {
        const c = scene.get(candidate)
        if (c && c.parentId === node.id) result.push(c.id)
      }
      return result
    }

    const dirty = cascadeDirty(id('w1'), { scene, childQuery })
    expect(Array.from(dirty).sort()).toEqual([id('d1'), id('w1')])
  })
})

describe('collectDescendants', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('returns just the start when no children', () => {
    const scene = makeFakeScene({ a: makeNode('thing', 'a') })
    const result = collectDescendants(id('a'), { scene })
    expect(Array.from(result)).toEqual([id('a')])
  })

  test('returns full subtree regardless of relations declarations', () => {
    // No def registered — descendants still found via the children array.
    const scene = makeFakeScene({
      root: makeNode('thing', 'root', { children: [id('c1'), id('c2')] } as Partial<AnyNode>),
      c1: makeNode('thing', 'c1', { children: [id('g1')] } as Partial<AnyNode>),
      c2: makeNode('thing', 'c2'),
      g1: makeNode('thing', 'g1'),
    })

    const result = collectDescendants(id('root'), { scene })
    expect(Array.from(result).sort()).toEqual([id('c1'), id('c2'), id('g1'), id('root')])
  })

  test('respects maxDepth', () => {
    const scene = makeFakeScene({
      a: makeNode('thing', 'a', { children: [id('b')] } as Partial<AnyNode>),
      b: makeNode('thing', 'b', { children: [id('c')] } as Partial<AnyNode>),
      c: makeNode('thing', 'c', { children: [id('d')] } as Partial<AnyNode>),
      d: makeNode('thing', 'd'),
    })
    const result = collectDescendants(id('a'), { scene, maxDepth: 2 })
    expect(Array.from(result).sort()).toEqual([id('a'), id('b'), id('c')]) // d truncated
  })
})
