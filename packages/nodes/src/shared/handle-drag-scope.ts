import { emitter } from '@pascal-app/core'
import { markToolCancelConsumed, useInteractionScope } from '@pascal-app/editor'

/**
 * Claims the `handle-drag` scope for one selection-handle drag. The snap
 * helpers (`isGridSnapActive()` and friends) resolve the kind's snap context
 * from that scope, and the HUD shows its chip; with no scope, Select mode
 * reads every snap mode as off. Escape and a mid-drag undo arrive as
 * `tool:cancel` and go to `onCancel`, which must drop the drag without
 * committing it. The returned release ends only the scope this drag claimed.
 */
export function claimHandleDragScope(
  nodeId: string,
  handle: string,
  onCancel: () => void,
): () => void {
  useInteractionScope.getState().begin({ kind: 'handle-drag', nodeId, handle })
  const cancel = () => {
    markToolCancelConsumed()
    onCancel()
  }
  emitter.on('tool:cancel', cancel)
  return () => {
    emitter.off('tool:cancel', cancel)
    useInteractionScope
      .getState()
      .endIf(
        (scope) =>
          scope.kind === 'handle-drag' && scope.nodeId === nodeId && scope.handle === handle,
      )
  }
}
