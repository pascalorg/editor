import { useLiveNodeOverrides, useLiveTransforms, useScene } from '@pascal-app/core'

function refreshSceneAfterHistoryJump() {
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()

  const state = useScene.getState()
  for (const node of Object.values(state.nodes)) {
    state.markDirty(node.id)
  }
}

export function runUndo() {
  useScene.temporal.getState().undo()
  refreshSceneAfterHistoryJump()
}

export function runRedo() {
  useScene.temporal.getState().redo()
  refreshSceneAfterHistoryJump()
}

/**
 * ⌘Z / ⌘⇧Z (undo/redo). Pointer-drag sessions intercept these in the capture
 * phase and cancel the gesture instead — mid-drag, "undo" means "abort what my
 * mouse is doing", never a history jump under a live pointer.
 */
export function isHistoryShortcut(e: KeyboardEvent) {
  return (e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')
}
