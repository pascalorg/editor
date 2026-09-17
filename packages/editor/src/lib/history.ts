import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  getHistoryDirtyNodeIds,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { markPerfAction } from '@pascal-app/viewer'
import useInteractionScope from '../store/use-interaction-scope'
import { registeredDraftingConfig } from './interaction/registered-drafting'

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

function capturePreviewLayout() {
  const overrides = useLiveNodeOverrides.getState().overrides
  if (overrides.size === 0) return null
  const nodes = { ...useScene.getState().nodes }
  for (const [id, values] of overrides) {
    const node = nodes[id as AnyNodeId]
    if (node) nodes[node.id] = { ...node, ...values } as AnyNode
  }
  return nodes
}

function refreshSceneAfterHistoryJump(previewLayout: Record<string, AnyNode> | null) {
  const target = useScene.getState().nodes
  const previewDirty = previewLayout
    ? getHistoryDirtyNodeIds(previewLayout, target)
    : new Set<AnyNodeId>()
  const previewIds = new Set([
    ...useLiveTransforms.getState().transforms.keys(),
    ...useLiveNodeOverrides.getState().overrides.keys(),
  ])
  const currentPreviewLayout = capturePreviewLayout()
  if (currentPreviewLayout) {
    for (const id of getHistoryDirtyNodeIds(currentPreviewLayout, target)) previewDirty.add(id)
  }
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  // Clearing overrides can republish stair holes while a live transform still
  // exists. Capture that final publication before clearing it too.
  const remainingOverrides = useLiveNodeOverrides.getState().overrides
  if (remainingOverrides.size > 0) {
    for (const id of remainingOverrides.keys()) previewIds.add(id)
    const remainingLayout = capturePreviewLayout()
    if (remainingLayout) {
      for (const id of getHistoryDirtyNodeIds(remainingLayout, target)) previewDirty.add(id)
    }
    useLiveNodeOverrides.getState().clearAll()
  }

  const state = useScene.getState()
  for (const id of previewDirty) {
    if (state.nodes[id]) state.markDirty(id)
  }
  for (const id of previewIds) {
    const node = state.nodes[id as AnyNodeId]
    if (!node) continue
    state.markDirty(node.id)
    if (node.parentId && state.nodes[node.parentId as AnyNodeId]) {
      state.markDirty(node.parentId as AnyNodeId)
    }
  }
}

export function shouldCancelDraftOnHistoryJump(): boolean {
  const scope = useInteractionScope.getState().scope
  return registeredDraftingConfig(scope)?.cancelOnHistoryJump === true
}

export function runUndo(): HistoryCommandResult {
  if (shouldCancelDraftOnHistoryJump()) emitter.emit('tool:cancel')
  if (historyCommandDelegate) {
    const result = historyCommandDelegate.undo()
    // Mark only real jumps: a no-op undo must not open a receipt (or
    // interrupt one that is still settling).
    if (result.kind !== 'empty') markPerfAction('undo')
    return result
  }
  if (useScene.temporal.getState().pastStates.length === 0) return { kind: 'empty' }
  markPerfAction('undo')
  const previewLayout = capturePreviewLayout()
  useScene.temporal.getState().undo()
  refreshSceneAfterHistoryJump(previewLayout)
  return { kind: 'applied', persistence: 'local' }
}

export function runRedo(): HistoryCommandResult {
  if (shouldCancelDraftOnHistoryJump()) emitter.emit('tool:cancel')
  if (historyCommandDelegate) {
    const result = historyCommandDelegate.redo()
    if (result.kind !== 'empty') markPerfAction('redo')
    return result
  }
  if (useScene.temporal.getState().futureStates.length === 0) return { kind: 'empty' }
  markPerfAction('redo')
  const previewLayout = capturePreviewLayout()
  useScene.temporal.getState().redo()
  refreshSceneAfterHistoryJump(previewLayout)
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
