import { beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { resetSceneHistoryPauseDepth } from '../store/history-control'
import { coerce } from '../test-utils'
import { createSceneApi, type SceneStoreLike } from './scene-api'

function makeFakeStore(initial: Record<string, AnyNode> = {}) {
  const state = {
    nodes: { ...initial } as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [] as AnyNodeId[],
    dirtyNodes: new Set<AnyNodeId>(),
    createNode(node: AnyNode) {
      state.nodes[node.id] = node
    },
    updateNode(id: AnyNodeId, data: Partial<AnyNode>) {
      const existing = state.nodes[id]
      if (existing) state.nodes[id] = { ...existing, ...data } as AnyNode
    },
    deleteNode(id: AnyNodeId) {
      delete state.nodes[id]
    },
    markDirty(id: AnyNodeId) {
      state.dirtyNodes.add(id)
    },
  }

  let paused = 0
  const temporal = {
    getState: () => ({
      pause: () => {
        paused += 1
      },
      resume: () => {
        paused -= 1
      },
    }),
  }

  const store: SceneStoreLike & { _state: typeof state; _pausedCount: () => number } = {
    getState: () => state,
    temporal,
    _state: state,
    _pausedCount: () => paused,
  }
  return store
}

function makeNode(id: string, extra: Record<string, unknown> = {}): AnyNode {
  return coerce<AnyNode>({ id, type: 'site', parentId: null, visible: true, ...extra })
}

// Tests use short string IDs ("a", "b") for readability. The store's
// AnyNodeId is a branded template-literal type — cast at the boundary.
const id = (s: string) => s as AnyNodeId
const nodes = (store: ReturnType<typeof makeFakeStore>): Record<string, AnyNode> =>
  store._state.nodes

describe('SceneApi', () => {
  beforeEach(() => {
    resetSceneHistoryPauseDepth()
  })

  test('get reads node from store', () => {
    const store = makeFakeStore({ a: makeNode('a') })
    const api = createSceneApi(store)
    expect(api.get(id('a'))).toEqual(makeNode('a'))
    expect(api.get(id('missing'))).toBeUndefined()
  })

  test('update applies patch via store.updateNode', () => {
    const store = makeFakeStore({ a: makeNode('a', { visible: true }) })
    const api = createSceneApi(store)
    api.update(id('a'), { visible: false } as Partial<AnyNode>)
    expect(nodes(store)['a']).toMatchObject({ visible: false })
  })

  test('upsert calls createNode and returns the id', () => {
    const store = makeFakeStore()
    const api = createSceneApi(store)
    const returnedId = api.upsert(makeNode('a'))
    expect(returnedId).toBe(id('a'))
    expect(nodes(store)['a']).toBeDefined()
  })

  test('delete removes node from store', () => {
    const store = makeFakeStore({ a: makeNode('a') })
    const api = createSceneApi(store)
    api.delete(id('a'))
    expect(nodes(store)['a']).toBeUndefined()
  })

  test('markDirty forwards to store', () => {
    const store = makeFakeStore({ a: makeNode('a') })
    const api = createSceneApi(store)
    api.markDirty(id('a'))
    expect(store._state.dirtyNodes.has(id('a'))).toBe(true)
  })

  test('pauseHistory and resumeHistory bracket store.temporal pause/resume', () => {
    const store = makeFakeStore()
    const api = createSceneApi(store)
    expect(store._pausedCount()).toBe(0)
    api.pauseHistory()
    expect(store._pausedCount()).toBe(1)
    api.resumeHistory()
    expect(store._pausedCount()).toBe(0)
  })

  test('nested pause/resume use a depth counter (single pause call to temporal)', () => {
    const store = makeFakeStore()
    const api = createSceneApi(store)
    api.pauseHistory()
    api.pauseHistory()
    expect(store._pausedCount()).toBe(1) // only one actual pause
    api.resumeHistory()
    expect(store._pausedCount()).toBe(1) // still paused — inner resume
    api.resumeHistory()
    expect(store._pausedCount()).toBe(0)
  })
})

describe('SceneApi snapshot / restore', () => {
  beforeEach(() => {
    resetSceneHistoryPauseDepth()
  })

  test('restore returns a touched node to its pre-pause state', () => {
    const store = makeFakeStore({ a: makeNode('a', { visible: true }) })
    const api = createSceneApi(store)
    api.pauseHistory()
    api.update(id('a'), { visible: false } as Partial<AnyNode>)
    expect(nodes(store)['a']).toMatchObject({ visible: false })
    api.restore(id('a'))
    expect(nodes(store)['a']).toMatchObject({ visible: true })
    api.resumeHistory()
  })

  test('restore on a node never touched is a no-op', () => {
    const store = makeFakeStore({ a: makeNode('a', { visible: true }) })
    const api = createSceneApi(store)
    api.pauseHistory()
    api.restore(id('a'))
    expect(nodes(store)['a']).toMatchObject({ visible: true })
    api.resumeHistory()
  })

  test('restoreAll reverts every touched node', () => {
    const store = makeFakeStore({
      a: makeNode('a', { visible: true }),
      b: makeNode('b', { visible: true }),
    })
    const api = createSceneApi(store)
    api.pauseHistory()
    api.update(id('a'), { visible: false } as Partial<AnyNode>)
    api.update(id('b'), { visible: false } as Partial<AnyNode>)
    api.restoreAll()
    expect(nodes(store)['a']).toMatchObject({ visible: true })
    expect(nodes(store)['b']).toMatchObject({ visible: true })
    api.resumeHistory()
  })

  test('restore re-creates a node that was deleted mid-pause', () => {
    const original = makeNode('a', { visible: true })
    const store = makeFakeStore({ a: original })
    const api = createSceneApi(store)
    api.pauseHistory()
    api.delete(id('a'))
    expect(nodes(store)['a']).toBeUndefined()
    api.restore(id('a'))
    expect(nodes(store)['a']).toEqual(original)
    api.resumeHistory()
  })

  test('restore deletes a node that was upserted mid-pause', () => {
    const store = makeFakeStore()
    const api = createSceneApi(store)
    api.pauseHistory()
    api.upsert(makeNode('a'))
    expect(nodes(store)['a']).toBeDefined()
    api.restore(id('a'))
    expect(nodes(store)['a']).toBeUndefined()
    api.resumeHistory()
  })

  test('snapshot is dropped on resumeHistory; restore after resume is a no-op', () => {
    const store = makeFakeStore({ a: makeNode('a', { visible: true }) })
    const api = createSceneApi(store)
    api.pauseHistory()
    api.update(id('a'), { visible: false } as Partial<AnyNode>)
    api.resumeHistory()
    api.restore(id('a')) // snapshot gone — no effect
    expect(nodes(store)['a']).toMatchObject({ visible: false })
  })

  test('only the first mutation in a pause window captures the original', () => {
    const store = makeFakeStore({ a: makeNode('a', { visible: true }) })
    const api = createSceneApi(store)
    api.pauseHistory()
    api.update(id('a'), { visible: false } as Partial<AnyNode>)
    api.update(id('a'), { visible: true } as Partial<AnyNode>) // second update — must not overwrite snapshot
    api.update(id('a'), { visible: false } as Partial<AnyNode>)
    api.restore(id('a'))
    expect(nodes(store)['a']).toMatchObject({ visible: true }) // the *first* pre-pause value
    api.resumeHistory()
  })
})
