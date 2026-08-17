import { describe, expect, test } from 'bun:test'
import {
  applySceneDelta,
  type DeltaGraph,
  deltaIsWorthSending,
  diffSceneGraphs,
  type SceneDelta,
} from './scene-delta'

type Node = Record<string, unknown>

function node(id: string, extra: Record<string, unknown> = {}): Node {
  return {
    object: 'node',
    id,
    type: 'wall',
    parentId: 'building_a',
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [1, 0],
    thickness: 0.2,
    height: 2.7,
    ...extra,
  }
}

function graph(nodes: Record<string, Node>, overrides: Partial<DeltaGraph> = {}): DeltaGraph {
  return { nodes, rootNodeIds: ['site_a'], ...overrides }
}

describe('diffSceneGraphs', () => {
  test('an untouched graph produces no ops', () => {
    const nodes = { wall_a: node('wall_a'), wall_b: node('wall_b') }
    expect(diffSceneGraphs(graph(nodes), graph(nodes)).ops).toEqual([])
  })

  test('a node replaced by reference is the only thing sent', () => {
    const shared = node('wall_b')
    const before = graph({ wall_a: node('wall_a'), wall_b: shared })
    const moved = node('wall_a', { end: [5, 0] })
    const after = graph({ wall_a: moved, wall_b: shared })

    const { ops } = diffSceneGraphs(before, after)
    expect(ops).toEqual([{ op: 'set', id: 'wall_a', node: moved }])
  })

  test('a deleted node becomes a delete op', () => {
    const before = graph({ wall_a: node('wall_a'), wall_b: node('wall_b') })
    const after = graph({ wall_a: before.nodes.wall_a as Node })

    expect(diffSceneGraphs(before, after).ops).toEqual([{ op: 'delete', id: 'wall_b' }])
  })

  test('root order is compared by value, not by reference', () => {
    const nodes = { wall_a: node('wall_a') }
    const before = graph(nodes, { rootNodeIds: ['site_a', 'site_b'] })
    const sameOrder = graph(nodes, { rootNodeIds: ['site_a', 'site_b'] })
    const reordered = graph(nodes, { rootNodeIds: ['site_b', 'site_a'] })

    // A fresh array with the same contents must not read as a change: the store
    // rebuilds this array on mutations that never touched the roots.
    expect(diffSceneGraphs(before, sameOrder).ops).toEqual([])
    expect(diffSceneGraphs(before, reordered).ops).toEqual([
      { op: 'roots', rootNodeIds: ['site_b', 'site_a'] },
    ])
  })

  test('the bags beside nodes travel whole when their reference moves', () => {
    const nodes = { wall_a: node('wall_a') }
    const before = graph(nodes, { materials: {}, comments: {} })
    const materials = { mat_a: { id: 'mat_a' } } as unknown
    const after = graph(nodes, { materials, comments: before.comments })

    expect(diffSceneGraphs(before, after).ops).toEqual([
      { op: 'record', record: 'materials', value: materials },
    ])
  })
})

describe('applySceneDelta', () => {
  test('round-trips a diff back to the graph it describes', () => {
    const before = graph({ wall_a: node('wall_a'), wall_b: node('wall_b') }, { materials: {} })
    const after = graph(
      { wall_a: node('wall_a', { height: 4 }), wall_c: node('wall_c') },
      {
        rootNodeIds: ['site_b'],
        materials: { mat_a: { id: 'mat_a' } } as unknown,
      },
    )

    const applied = applySceneDelta(before, diffSceneGraphs(before, after))
    expect(applied.nodes).toEqual(after.nodes)
    expect(applied.rootNodeIds).toEqual(after.rootNodeIds)
    expect(applied.materials).toEqual(after.materials)
  })

  test('leaves the base graph untouched', () => {
    const before = graph({ wall_a: node('wall_a') })
    const snapshot = JSON.stringify(before)

    applySceneDelta(before, {
      ops: [
        { op: 'set', id: 'wall_z', node: node('wall_z') },
        { op: 'delete', id: 'wall_a' },
      ],
    })

    expect(JSON.stringify(before)).toBe(snapshot)
  })

  test('carries through keys the delta never mentions', () => {
    const before = graph({ wall_a: node('wall_a') }, { definitions: { def_a: {} } as unknown })
    const applied = applySceneDelta(before, {
      ops: [{ op: 'set', id: 'wall_a', node: node('wall_a', { height: 3 }) }],
    })

    expect(applied.definitions).toBe(before.definitions)
  })
})

describe('deltaIsWorthSending', () => {
  const big = graph(
    Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`wall_${i}`, node(`wall_${i}`)])),
  )

  test('nothing to send when the delta is empty', () => {
    expect(deltaIsWorthSending({ ops: [] }, big)).toBe(false)
  })

  test('a handful of touched nodes is worth sending', () => {
    const delta: SceneDelta = {
      ops: [{ op: 'set', id: 'wall_1', node: node('wall_1') }],
    }
    expect(deltaIsWorthSending(delta, big)).toBe(true)
  })

  test('a delta that rewrites most of the scene is not', () => {
    const delta: SceneDelta = {
      ops: Array.from({ length: 80 }, (_, i) => ({
        op: 'set' as const,
        id: `wall_${i}`,
        node: node(`wall_${i}`),
      })),
    }
    expect(deltaIsWorthSending(delta, big)).toBe(false)
  })
})
