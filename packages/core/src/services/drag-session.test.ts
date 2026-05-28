import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import { nodeRegistry, registerNode } from '../registry/registry'
import type { AnyNodeDefinition, DragAction, Relations, SceneApi } from '../registry/types'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { createDragSession } from './drag-session'

const id = (s: string) => s as AnyNodeId

function makeSpyScene(initial: Record<string, AnyNode> = {}): SceneApi & {
  _calls: {
    pauseHistory: number
    resumeHistory: number
    restoreAll: number
    markedDirty: AnyNodeId[]
    updated: Array<[AnyNodeId, Partial<AnyNode>]>
  }
} {
  const calls = {
    pauseHistory: 0,
    resumeHistory: 0,
    restoreAll: 0,
    markedDirty: [] as AnyNodeId[],
    updated: [] as Array<[AnyNodeId, Partial<AnyNode>]>,
  }
  const nodes = { ...initial }
  return {
    get: ((nid: AnyNodeId) => nodes[nid as string]) as SceneApi['get'],
    nodes: () => nodes as Readonly<Record<AnyNodeId, AnyNode>>,
    update: (nid, patch) => {
      calls.updated.push([nid, patch])
      const existing = nodes[nid as string]
      if (existing) nodes[nid as string] = { ...existing, ...patch } as AnyNode
    },
    upsert: (n: AnyNode) => {
      nodes[n.id as string] = n
      return n.id
    },
    delete: (nid) => {
      delete nodes[nid as string]
    },
    restore: () => {},
    restoreAll: () => {
      calls.restoreAll += 1
    },
    markDirty: (nid) => {
      calls.markedDirty.push(nid)
    },
    pauseHistory: () => {
      calls.pauseHistory += 1
    },
    resumeHistory: () => {
      calls.resumeHistory += 1
    },
    getSubtree: () => null,
    cloneNodesInto: () => null,
    _calls: calls,
  }
}

function makeDef(kind: string, relations?: Relations): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as any,
    category: 'utility',
    defaults: () => ({}) as any,
    capabilities: {},
    relations,
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  }
}

function makeAction(): DragAction<{ id: AnyNodeId }, { x: number }> {
  return {
    begin: ({ node }) => ({ id: node?.id ?? id('default') }),
    preview: (_ctx, point) => ({ x: point[0] }),
    apply: (_draft, ctx) => [ctx.id],
    cancel: () => {},
  }
}

describe('createDragSession', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  test('start pauses history; commit resumes', () => {
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene)
    session.start({ point: [0, 0] })
    expect(scene._calls.pauseHistory).toBe(1)
    expect(scene._calls.resumeHistory).toBe(0)
    session.commit()
    expect(scene._calls.resumeHistory).toBe(1)
  })

  test('cancel resumes history and calls restoreAll', () => {
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene)
    session.start({ point: [0, 0] })
    session.cancel()
    expect(scene._calls.resumeHistory).toBe(1)
    expect(scene._calls.restoreAll).toBe(1)
  })

  test('move runs preview + apply and marks the returned id dirty', () => {
    const scene = makeSpyScene({ a: { id: id('a'), type: 'thing' } as any })
    const session = createDragSession(makeAction(), scene)
    session.start({ point: [0, 0], node: { id: id('a') } as any })
    session.move([1, 0], { shift: false, alt: false, ctrl: false, meta: false })
    expect(session.getDraft()).toEqual({ x: 1 })
    expect(scene._calls.markedDirty).toContain(id('a'))
  })

  test('snap callback is invoked when defined', () => {
    const action: DragAction<{ id: AnyNodeId }, { x: number }> = {
      ...makeAction(),
      snap: (draft) => ({ x: Math.round(draft.x) }),
    }
    const scene = makeSpyScene({ a: { id: id('a'), type: 'thing' } as any })
    const session = createDragSession(action, scene)
    session.start({ point: [0, 0], node: { id: id('a') } as any })
    session.move([0.7, 0], { shift: false, alt: false, ctrl: false, meta: false })
    expect(session.getDraft()).toEqual({ x: 1 })
  })

  test('commit returns false when action.commit returns false; calls action.cancel and restoreAll', () => {
    const cancelSpy = mock(() => {})
    const action: DragAction<{ id: AnyNodeId }, { x: number }> = {
      ...makeAction(),
      cancel: cancelSpy,
      commit: () => false,
    }
    const scene = makeSpyScene({ a: { id: id('a'), type: 'thing' } as any })
    const session = createDragSession(action, scene)
    session.start({ point: [0, 0], node: { id: id('a') } as any })
    session.move([1, 0], { shift: false, alt: false, ctrl: false, meta: false })
    const result = session.commit()
    expect(result).toBe(false)
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(scene._calls.restoreAll).toBe(1)
  })

  test('move is a no-op when session is not active', () => {
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene)
    session.move([1, 0], { shift: false, alt: false, ctrl: false, meta: false })
    expect(scene._calls.markedDirty.length).toBe(0)
  })

  test('repeated start is a no-op (re-entry guard)', () => {
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene)
    session.start({ point: [0, 0] })
    session.start({ point: [99, 99] })
    expect(scene._calls.pauseHistory).toBe(1) // only one pause
  })

  test('dispose mid-drag cancels and cleans up', () => {
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene)
    session.start({ point: [0, 0] })
    expect(session.isActive()).toBe(true)
    session.dispose()
    expect(session.isActive()).toBe(false)
    expect(scene._calls.resumeHistory).toBe(1)
    expect(scene._calls.restoreAll).toBe(1)
  })

  test('dispose when inactive is a no-op', () => {
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene)
    session.dispose()
    expect(scene._calls.pauseHistory).toBe(0)
    expect(scene._calls.resumeHistory).toBe(0)
  })

  test('onCommit callback fires on successful commit', () => {
    const onCommit = mock(() => {})
    const onCancel = mock(() => {})
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene, { onCommit, onCancel })
    session.start({ point: [0, 0] })
    session.commit()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(0)
  })

  test('onCancel callback fires on explicit cancel', () => {
    const onCommit = mock(() => {})
    const onCancel = mock(() => {})
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene, { onCommit, onCancel })
    session.start({ point: [0, 0] })
    session.cancel()
    expect(onCommit).toHaveBeenCalledTimes(0)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('dispose does NOT fire onCancel (silent cleanup)', () => {
    const onCommit = mock(() => {})
    const onCancel = mock(() => {})
    const scene = makeSpyScene()
    const session = createDragSession(makeAction(), scene, { onCommit, onCancel })
    session.start({ point: [0, 0] })
    session.dispose()
    expect(onCommit).toHaveBeenCalledTimes(0)
    expect(onCancel).toHaveBeenCalledTimes(0)
    expect(scene._calls.resumeHistory).toBe(1)
    expect(scene._calls.restoreAll).toBe(1)
  })

  test('dirty cascade fires once per id even across multiple move ticks', () => {
    // Register a kind with no relations — cascade returns just {startId}.
    registerNode(makeDef('thing'))
    const scene = makeSpyScene({ a: { id: id('a'), type: 'thing' } as any })
    const session = createDragSession(makeAction(), scene)
    session.start({ point: [0, 0], node: { id: id('a') } as any })
    session.move([1, 0], { shift: false, alt: false, ctrl: false, meta: false })
    session.move([2, 0], { shift: false, alt: false, ctrl: false, meta: false })
    session.move([3, 0], { shift: false, alt: false, ctrl: false, meta: false })
    // a is marked once, not three times
    expect(scene._calls.markedDirty.filter((mid) => mid === id('a')).length).toBe(1)
  })

  test('dirty cascade follows hosts relations from the registry', () => {
    registerNode(makeDef('wall', { hosts: ['door'] }))
    registerNode(makeDef('door'))
    const scene = makeSpyScene({
      w: { id: id('w'), type: 'wall', children: [id('d')] } as any,
      d: { id: id('d'), type: 'door', parentId: id('w') } as any,
    })
    const action: DragAction<{ id: AnyNodeId }, { x: number }> = {
      begin: () => ({ id: id('w') }),
      preview: (_ctx, point) => ({ x: point[0] }),
      apply: (_draft, ctx) => [ctx.id],
      cancel: () => {},
    }
    const session = createDragSession(action, scene)
    session.start({ point: [0, 0], node: { id: id('w') } as any })
    session.move([1, 0], { shift: false, alt: false, ctrl: false, meta: false })
    // both wall and door marked dirty
    expect(scene._calls.markedDirty).toContain(id('w'))
    expect(scene._calls.markedDirty).toContain(id('d'))
  })
})
