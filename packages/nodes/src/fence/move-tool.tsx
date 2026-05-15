'use client'

import { type FenceNode, useLiveTransforms } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { moveFenceDragAction } from './actions/move'

/**
 * Phase 5 Stage D — thin React wrapper around `moveFenceDragAction`.
 *
 * Replaces the legacy `MoveFenceTool` (302 LoC). The action owns all
 * the math (snap + linked cascade + live-drag mesh offsets +
 * single-undo dance on commit). The wrapper just renders the cursor
 * sphere and tracks its position from the live-transform store.
 *
 * Mounted by ToolManager when `useEditor.movingNode` is a fence
 * (capability-driven dispatch — fence has no `movable` capability, so
 * the legacy MoveTool's per-kind branch chain falls through to here
 * via the new affordance dispatch).
 */
export const FenceMoveTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const fenceId = node.id
  const originalCenter: [number, number, number] = [
    (node.start[0] + node.end[0]) / 2,
    0,
    (node.start[1] + node.end[1]) / 2,
  ]

  // Live position from the live-transforms store — the action writes
  // here every preview tick (live-drag exception). Falls back to the
  // original center until the first move.
  const liveCenter = useLiveTransforms((s) => {
    const t = s.get(fenceId)
    return t?.position ?? originalCenter
  })

  const exitMoveMode = (committed: boolean) => {
    if (committed) triggerSFX('sfx:item-place')
    useViewer.getState().setSelection({ selectedIds: [fenceId] })
    useEditor.getState().setMovingNode(null)
  }

  useDragAction({
    active: true,
    action: moveFenceDragAction,
    initial: {
      node,
      point: [originalCenter[0], originalCenter[2]],
    },
    onCommit: () => exitMoveMode(true),
    onCancel: () => exitMoveMode(false),
  })

  return (
    <group>
      <CursorSphere position={liveCenter as [number, number, number]} showTooltip={false} />
    </group>
  )
}

export default FenceMoveTool
