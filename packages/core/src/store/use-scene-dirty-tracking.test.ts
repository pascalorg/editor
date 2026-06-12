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
    useScene.setState({
      nodes: {
        [UNTRACKED]: makeNode(UNTRACKED, 'test-untracked'),
        [TRACKED]: makeNode(TRACKED, 'test-tracked'),
        [UNREGISTERED]: makeNode(UNREGISTERED, 'unregistered-kind'),
      },
      rootNodeIds: [UNTRACKED, TRACKED, UNREGISTERED],
      dirtyNodes: new Set(),
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

  test('deleteNodes removes deleted ids from the dirty set', () => {
    useScene.getState().markDirty(TRACKED)
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(true)
    useScene.getState().deleteNodes([TRACKED])
    expect(useScene.getState().nodes[TRACKED]).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(TRACKED)).toBe(false)
  })
})
