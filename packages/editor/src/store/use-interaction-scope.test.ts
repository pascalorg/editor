import { afterEach, describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import {
  type ActiveInteractionScope,
  editingHoleInfo,
  handleDragInfo,
  isActive,
  isIdle,
  scopeNodeId,
  selectionEnabled,
} from '../lib/interaction/scope'
import useInteractionScope from './use-interaction-scope'

// A placing/moving scope carries the node inline. Tests only assert on id/type,
// so a structural stand-in is enough.
const mockNode = (id: string, type: string): AnyNode => ({ id, type }) as unknown as AnyNode

function reset() {
  useInteractionScope.getState().end()
}
afterEach(reset)

describe('use-interaction-scope state machine', () => {
  test('starts idle', () => {
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(isIdle(useInteractionScope.getState().scope)).toBe(true)
  })

  test('begin enters an interaction; end returns to idle atomically', () => {
    const s = useInteractionScope.getState()
    s.begin({
      kind: 'moving',
      node: mockNode('item_1', 'item'),
      nodeId: 'item_1',
      nodeType: 'item',
      view: '3d',
    })
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'moving',
      node: mockNode('item_1', 'item'),
      nodeId: 'item_1',
      nodeType: 'item',
      view: '3d',
    })
    s.end()
    // No interaction payload leaks past end — the scope is plain idle, so a
    // stale nodeId/handle is unrepresentable.
    expect(useInteractionScope.getState().scope).toEqual({ kind: 'idle' })
    expect(scopeNodeId(useInteractionScope.getState().scope)).toBeNull()
  })

  test('begin is single-owner: a new interaction replaces the prior one', () => {
    const s = useInteractionScope.getState()
    s.begin({ kind: 'drafting', tool: 'wall' })
    s.begin({ kind: 'handle-drag', nodeId: 'wall_1', handle: 'height' })
    const scope = useInteractionScope.getState().scope
    expect(scope.kind).toBe('handle-drag')
    // The prior drafting payload is gone — illegal "drafting + handle-drag"
    // combination is unrepresentable.
    expect(scopeNodeId(scope)).toBe('wall_1')
  })

  test('update patches the live payload of the active scope', () => {
    const s = useInteractionScope.getState()
    s.begin({
      kind: 'placing',
      node: mockNode('i1', 'item'),
      nodeId: 'i1',
      nodeType: 'item',
      view: '3d',
      pressDrag: false,
    })
    s.update({ pressDrag: true })
    const scope = useInteractionScope.getState().scope
    expect(scope.kind === 'placing' && scope.pressDrag).toBe(true)
  })

  test('update is a no-op when idle', () => {
    useInteractionScope.getState().update({
      kind: 'moving',
      node: mockNode('x', 'item'),
      nodeId: 'x',
      nodeType: 'item',
      view: '3d',
    })
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('update cannot change which interaction is running', () => {
    const s = useInteractionScope.getState()
    s.begin({
      kind: 'moving',
      node: mockNode('i1', 'item'),
      nodeId: 'i1',
      nodeType: 'item',
      view: '3d',
    })
    s.update({
      kind: 'placing',
      node: mockNode('i1', 'item'),
      nodeId: 'i1',
      nodeType: 'item',
      view: '3d',
      pressDrag: true,
    })
    expect(useInteractionScope.getState().scope.kind).toBe('moving')
  })

  test('selectionEnabled only while idle', () => {
    const s = useInteractionScope.getState()
    expect(selectionEnabled(useInteractionScope.getState().scope)).toBe(true)
    s.begin({ kind: 'box-select' })
    expect(selectionEnabled(useInteractionScope.getState().scope)).toBe(false)
    expect(isActive(useInteractionScope.getState().scope)).toBe(true)
  })

  test('end is idempotent', () => {
    const s = useInteractionScope.getState()
    s.end()
    s.end()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })
})

describe('derived flag views are leak-free (no parallel flags)', () => {
  const scope = () => useInteractionScope.getState().scope

  test('handleDragInfo mirrors handle-drag and clears on end', () => {
    const s = useInteractionScope.getState()
    s.begin({ kind: 'handle-drag', nodeId: 'wall_1', handle: 'height' })
    expect(handleDragInfo(scope())).toEqual({ nodeId: 'wall_1', label: 'height' })
    s.end()
    // After end the derived view is null — a stale activeHandleDrag is
    // unrepresentable because it is a pure function of the single scope.
    expect(handleDragInfo(scope())).toBeNull()
  })

  test('editingHoleInfo mirrors a hole reshape and clears on end', () => {
    const s = useInteractionScope.getState()
    s.begin({ kind: 'reshaping', nodeId: 'slab_1', reshape: 'hole', holeIndex: 2 })
    expect(editingHoleInfo(scope())).toEqual({ nodeId: 'slab_1', holeIndex: 2 })
    s.end()
    expect(editingHoleInfo(scope())).toBeNull()
  })

  test('a non-hole reshape never reads as an editing hole', () => {
    const s = useInteractionScope.getState()
    s.begin({ kind: 'reshaping', nodeId: 'wall_1', reshape: 'curve' })
    expect(editingHoleInfo(scope())).toBeNull()
  })

  test('switching interactions never leaks the prior derived view', () => {
    const s = useInteractionScope.getState()
    s.begin({ kind: 'handle-drag', nodeId: 'wall_1', handle: 'height' })
    // Single-owner replacement: the handle-drag view must vanish the instant a
    // different interaction begins — the two cannot be simultaneously active.
    s.begin({ kind: 'reshaping', nodeId: 'slab_1', reshape: 'hole', holeIndex: 0 })
    expect(handleDragInfo(scope())).toBeNull()
    expect(editingHoleInfo(scope())).toEqual({ nodeId: 'slab_1', holeIndex: 0 })
  })

  test('every active scope kind leaves at most the views it owns', () => {
    const s = useInteractionScope.getState()
    const kinds: ActiveInteractionScope[] = [
      {
        kind: 'placing',
        node: mockNode('i', 'item'),
        nodeId: 'i',
        nodeType: 'item',
        view: '3d',
        pressDrag: false,
      },
      { kind: 'moving', node: mockNode('i', 'item'), nodeId: 'i', nodeType: 'item', view: '3d' },
      { kind: 'drafting', tool: 'wall' },
      { kind: 'box-select' },
      { kind: 'painting' },
    ]
    for (const k of kinds) {
      s.begin(k)
      // None of these own a handle-drag or hole view.
      expect(handleDragInfo(scope())).toBeNull()
      expect(editingHoleInfo(scope())).toBeNull()
    }
    s.end()
  })
})
