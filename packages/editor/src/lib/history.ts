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
