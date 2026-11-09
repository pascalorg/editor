import { type AnyNodeId, emitter, useScene } from '@pascal-app/core'
import { beginGesture, type GestureHandle, markToolCancelConsumed } from '@pascal-app/editor'
import { useEffect, useRef } from 'react'

export type ClaimHandleDrag = (nodeId: string, handle: string, onCancel: () => void) => () => void

/**
 * Starts one host component's selection-handle drags under the editor's
 * gesture owner, each claiming the `handle-drag` scope. The snap helpers
 * (`isGridSnapActive()` and friends) resolve the kind's snap context from that
 * scope, and the HUD shows its chip; with no scope, Select mode reads every
 * snap mode as off. `onCancel` must drop the drag without committing it. It
 * runs on Escape (`tool:cancel`), on any undo or redo, when the mode, level or
 * selection changes or the scope is replaced, when the node is deleted, and
 * when the host unmounts. The release a claim returns ends the drag and only
 * the scope it claimed.
 */
export function useHandleDragScope(): ClaimHandleDrag {
  const live = useRef<GestureHandle | null>(null)
  useEffect(() => () => live.current?.cancel('unmount'), [])
  return (nodeId, handle, onCancel) => {
    const gesture = beginGesture({
      kind: 'handle-drag',
      scope: { kind: 'handle-drag', nodeId, handle },
      onCancel,
      stale: () => !useScene.getState().nodes[nodeId as AnyNodeId],
    })
    live.current = gesture
    const cancel = () => {
      markToolCancelConsumed()
      gesture.cancel('cancel')
    }
    emitter.on('tool:cancel', cancel)
    return () => {
      emitter.off('tool:cancel', cancel)
      gesture.end()
    }
  }
}
