'use client'

import { type FenceNode, useLiveTransforms } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { moveFenceDragAction } from './actions/move'

/**
 * Phase 5 Stage D — thin React wrapper around `moveFenceDragAction`.
 *
 * Replaces the legacy `MoveFenceTool` (302 LoC). The action owns all
 * the math (snap + linked cascade + live-drag mesh offsets +
 * single-undo dance on commit). The wrapper renders the cursor sphere
 * tracking its position from the live-transform store.
 *
 * Selector stability: `originalCenter` is memoized so the live-transform
 * fallback doesn't return a new array per render — that pattern blows
 * up zustand's `Object.is` check and trips "getSnapshot result not
 * cached" → infinite re-render. Same recipe in slab/ceiling move-tool.
 *
 * Mounted by ToolManager when `useEditor.movingNode` is a fence
 * (capability-driven dispatch — fence has no `movable` capability, so
 * the legacy MoveTool's per-kind branch chain falls through to here
 * via the new affordance dispatch).
 */
export const FenceMoveTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const fenceId = node.id
  const originalCenter: [number, number, number] = useMemo(
    () => [(node.start[0] + node.end[0]) / 2, 0, (node.start[1] + node.end[1]) / 2],
    [node.start, node.end],
  )

  // Subscribe to the live-transform reference only (stable across
  // renders unless set/clear was called). Derive position via useMemo
  // so the selector itself stays cached.
  const liveTransform = useLiveTransforms((s) => s.get(fenceId))
  const liveCenter: [number, number, number] = useMemo(
    () => liveTransform?.position ?? originalCenter,
    [liveTransform, originalCenter],
  )

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
      <CursorSphere position={liveCenter} showTooltip={false} />
    </group>
  )
}

export default FenceMoveTool
