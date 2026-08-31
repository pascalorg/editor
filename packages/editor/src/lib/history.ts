import { useLiveNodeOverrides, useLiveTransforms, useScene } from '@pascal-app/core'

export type HistoryCommandState = {
  canRedo: boolean
  canUndo: boolean
  mode: 'collaborative' | 'standalone'
  status: 'offline' | 'ready' | 'syncing' | 'unavailable'
}

export type HistoryCommandResult =
  | { kind: 'applied'; persistence: 'local' | 'queued' }
  | { kind: 'empty' }
  | { kind: 'unavailable' }

export type HistoryCommandDelegate = {
  getState: () => HistoryCommandState
  redo: () => HistoryCommandResult
  subscribe: (listener: () => void) => () => void
  undo: () => HistoryCommandResult
}

let historyCommandDelegate: HistoryCommandDelegate | null = null
let historyCommandDelegateSubscription: (() => void) | null = null
const historyCommandListeners = new Set<() => void>()

export function installHistoryCommandDelegate(delegate: HistoryCommandDelegate): () => void {
  historyCommandDelegateSubscription?.()
  historyCommandDelegate = delegate
  historyCommandDelegateSubscription = delegate.subscribe(notifyHistoryCommandListeners)
  notifyHistoryCommandListeners()
  return () => {
    if (historyCommandDelegate !== delegate) return
    historyCommandDelegateSubscription?.()
    historyCommandDelegateSubscription = null
    historyCommandDelegate = null
    notifyHistoryCommandListeners()
  }
}

export function getHistoryCommandState(): HistoryCommandState {
  if (historyCommandDelegate) return historyCommandDelegate.getState()
  const temporal = useScene.temporal.getState()
  return {
    canRedo: temporal.futureStates.length > 0,
    canUndo: temporal.pastStates.length > 0,
    mode: 'standalone',
    status: 'ready',
  }
}

export function subscribeHistoryCommandState(listener: () => void): () => void {
  historyCommandListeners.add(listener)
  const unsubscribeTemporal = useScene.temporal.subscribe(listener)
  return () => {
    historyCommandListeners.delete(listener)
    unsubscribeTemporal()
  }
}

function notifyHistoryCommandListeners() {
  for (const listener of [...historyCommandListeners]) listener()
}

function refreshSceneAfterHistoryJump() {
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()

  const state = useScene.getState()
  for (const node of Object.values(state.nodes)) {
    state.markDirty(node.id)
  }
}

export function runUndo(): HistoryCommandResult {
  if (historyCommandDelegate) return historyCommandDelegate.undo()
  if (useScene.temporal.getState().pastStates.length === 0) return { kind: 'empty' }
  useScene.temporal.getState().undo()
  refreshSceneAfterHistoryJump()
  return { kind: 'applied', persistence: 'local' }
}

export function runRedo(): HistoryCommandResult {
  if (historyCommandDelegate) return historyCommandDelegate.redo()
  if (useScene.temporal.getState().futureStates.length === 0) return { kind: 'empty' }
  useScene.temporal.getState().redo()
  refreshSceneAfterHistoryJump()
  return { kind: 'applied', persistence: 'local' }
}

/**
 * ⌘Z / ⌘⇧Z (undo/redo). Pointer-drag sessions intercept these in the capture
 * phase and cancel the gesture instead — mid-drag, "undo" means "abort what my
 * mouse is doing", never a history jump under a live pointer.
 */
export function isHistoryShortcut(e: KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')
}
