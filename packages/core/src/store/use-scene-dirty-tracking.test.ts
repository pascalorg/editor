import { beforeEach, describe, expect, test } from 'bun:test'
import { nodeRegistry } from '../registry/registry'
import type { AnyNodeDefinition } from '../registry/types'
import type { AnyNode, AnyNodeId } from '../schema/types'
import useScene from './use-scene'

const untrackedDef = {
  kind: 'test-untracked',
  schemaVersion: 1,
  schema: {} as never,
  category: 'furnishing',
  defaults: () => ({}),
  capabilities: {},
  dirtyTracking: false,
} as unknown as AnyNodeDefinition

const trackedDef = {
  ...untrackedDef,
  kind: 'test-tracked',
  dirtyTracking: undefined,
} as unknown as AnyNodeDefinition

const UNTRACKED = 'item_untracked' as AnyNodeId
const TRACKED = 'item_tracked' as AnyNodeId
const UNREGISTERED = 'item_unregistered' as AnyNodeId

const makeNode = (id: AnyNodeId, type: string): AnyNode =>
  ({
    object: 'node',
    id,
    type,
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
  }) as unknown as AnyNode

describe('dirty tracking', () => {
  beforeEach(() => {
    if (!nodeRegistry.has(untrackedDef.kind)) nodeRegistry._register(untrackedDef)
    if (!nodeRegistry.has(trackedDef.kind)) nodeRegistry._register(trackedDef)
    // Clear rather than replace the dirty set: the store's own instance is the
    // guarded one, and the raw-add tests below exercise that guard.
    useScene.getState().dirtyNodes.clear()
    useScene.setState({
      nodes: {
        [UNTRACKED]: makeNode(UNTRACKED, 'test-untracked'),
        [TRACKED]: makeNode(TRACKED, 'test-tracked'),
        [UNREGISTERED]: makeNode(UNREGISTERED, 'unregistered-kind'),
      },
      rootNodeIds: [UNTRACKED, TRACKED, UNREGISTERED],
      collections: {},
    } as never)
    useScene.temporal.getState().clear()
  })

  // Membership asserts (not set size/equality): the scene store is a module
  // singleton, and subscribers leaked by other test files can add their own
  // dirty marks when `setState` fires.
  test('markDirty skips kinds whose definition opts out', () => {
    useScene.getState().markDirty(UNTRACKED)
    expect(useScene.getState().dirtyNodes.has(UNTRACKED)).toBe(false)
  })

  test('markDirty tracks kinds without the opt-out, registered or not', () => {
    useScene.getState().markDirty(TRACKED)
    useScene.getState().markDirty(UNREGISTERED)
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(true)
    expect(useScene.getState().dirtyNodes.has(UNREGISTERED)).toBe(true)
  })

  test('raw dirtyNodes.add applies the same consumer-kind guard as markDirty', () => {
    useScene.getState().dirtyNodes.add(UNTRACKED)
    useScene.getState().dirtyNodes.add(TRACKED)
    expect(useScene.getState().dirtyNodes.has(UNTRACKED)).toBe(false)
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(true)
  })

  test('raw dirtyNodes.add accepts ids with no node yet', () => {
    const pending = 'item_pending_create' as AnyNodeId
    useScene.getState().dirtyNodes.add(pending)
    expect(useScene.getState().dirtyNodes.has(pending)).toBe(true)
  })

  test('undo clears dirty marks whose node no longer exists', async () => {
    const NEW = 'item_undone_away' as AnyNodeId
    // Tracked write: pushes the pre-write state (without NEW) onto pastStates.
    useScene.setState({
      nodes: { ...useScene.getState().nodes, [NEW]: makeNode(NEW, 'test-tracked') },
    } as never)
    useScene.getState().markDirty(NEW)
    expect(useScene.getState().dirtyNodes.has(NEW)).toBe(true)

    useScene.temporal.getState().undo()
    // The sweep runs in the temporal subscriber's microtask.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useScene.getState().nodes[NEW]).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(NEW)).toBe(false)
  })

  test('deleteNodes removes deleted ids from the dirty set', () => {
    useScene.getState().markDirty(TRACKED)
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(true)
    useScene.getState().deleteNodes([TRACKED])
    expect(useScene.getState().nodes[TRACKED]).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(false)
  })

  test('visibility updates mark dirty before the batched RAF callback', () => {
    let scheduled: ((time: number) => void) | null = null
    const previousRaf = globalThis.requestAnimationFrame
    const previousCancelRaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((callback: (time: number) => void) => {
      scheduled = callback
      return 1
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame

    try {
      useScene.getState().updateNode(TRACKED, { visible: false })

      expect(scheduled).not.toBeNull()
      expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(true)
      ;(scheduled as ((time: number) => void) | null)?.(0)
    } finally {
      globalThis.requestAnimationFrame = previousRaf
      globalThis.cancelAnimationFrame = previousCancelRaf
    }
  })
})
