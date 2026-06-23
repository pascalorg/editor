import { afterEach, describe, expect, test } from 'bun:test'
import { isActive, isIdle, scopeNodeId, selectionEnabled } from '../lib/interaction/scope'
import useInteractionScope from './use-interaction-scope'

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
    s.begin({ kind: 'moving', nodeId: 'item_1', nodeType: 'item', view: '3d' })
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'moving',
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
    s.begin({ kind: 'placing', nodeId: 'i1', nodeType: 'item', view: '3d', pressDrag: false })
    s.update({ pressDrag: true })
    const scope = useInteractionScope.getState().scope
    expect(scope.kind === 'placing' && scope.pressDrag).toBe(true)
  })

  test('update is a no-op when idle', () => {
    useInteractionScope
      .getState()
      .update({ kind: 'moving', nodeId: 'x', nodeType: 'item', view: '3d' })
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('update cannot change which interaction is running', () => {
    const s = useInteractionScope.getState()
    s.begin({ kind: 'moving', nodeId: 'i1', nodeType: 'item', view: '3d' })
    s.update({ kind: 'placing', nodeId: 'i1', nodeType: 'item', view: '3d', pressDrag: true })
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
