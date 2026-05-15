'use client'

import { type FenceNode, getWallMidpointHandlePoint, useScene } from '@pascal-app/core'
import { CursorSphere, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { curveFenceDragAction } from './actions/curve'

/**
 * Phase 5 Stage D — thin React wrapper around `curveFenceDragAction`.
 *
 * Replaces the legacy `CurveFenceTool` (editor/tools/fence/curve-fence-
 * tool.tsx). Same UX: a cursor sphere follows the chord-perpendicular
 * projection of the pointer, dragging the fence's `curveOffset` live;
 * grid:click commits, Esc cancels.
 *
 * All the lifecycle (history pause/resume, grid:move → preview, snap,
 * apply, grid:click → commit, Esc → cancel, unmount cleanup) is owned
 * by `useDragAction`. This component only renders the cursor sphere
 * and tracks its level-local position to mirror the active curveOffset
 * for visual feedback.
 *
 * Mounted by the legacy ToolManager via the same `curvingFence` editor
 * state (drop-in replacement for the old CurveFenceTool import).
 */
export const FenceCurveTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const initialHandle = getWallMidpointHandlePoint(node)
  const [cursorPos, setCursorPos] = useState<[number, number, number]>([
    initialHandle.x,
    0,
    initialHandle.y,
  ])

  const exitCurveMode = () => {
    useViewer.getState().setSelection({ selectedIds: [node.id] })
    useEditor.getState().setCurvingFence(null)
  }

  useDragAction({
    active: true,
    action: curveFenceDragAction,
    initial: {
      node,
      // Initial point — useDragAction requires a Vec2; the action's begin
      // reads everything it needs from input.node, so this is just a
      // placeholder until the first grid:move fires.
      point: [initialHandle.x, initialHandle.y],
    },
    onCommit: exitCurveMode,
    onCancel: exitCurveMode,
  })

  // Mirror the active curveOffset back into the cursor position. The
  // useDragAction loop's apply() writes curveOffset onto the node; we
  // subscribe to that field and recompute the handle point.
  const liveCurveOffset = useScene((s) => {
    const live = s.nodes[node.id]
    return live?.type === 'fence' ? ((live as FenceNode).curveOffset ?? 0) : 0
  })

  useEffect(() => {
    const handlePoint = getWallMidpointHandlePoint({ ...node, curveOffset: liveCurveOffset })
    setCursorPos([handlePoint.x, 0, handlePoint.y])
  }, [liveCurveOffset, node])

  return (
    <group>
      <CursorSphere position={cursorPos} showTooltip={false} />
    </group>
  )
}

export default FenceCurveTool
