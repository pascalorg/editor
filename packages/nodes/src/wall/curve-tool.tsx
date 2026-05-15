'use client'

import { getWallMidpointHandlePoint, useScene, type WallNode } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { curveWallDragAction } from './actions/curve'

/**
 * Phase 5 Stage D — thin React wrapper around `curveWallDragAction`.
 *
 * Replaces the legacy `CurveWallTool` (178 LoC). Same UX as the fence
 * curve port — cursor sphere follows the chord-perpendicular projection
 * of the pointer, dragging the wall's `curveOffset` live; grid:click
 * commits with the single-undo dance, Esc cancels.
 *
 * Mounted by ToolManager via `def.affordanceTools.curve` when
 * `useEditor.curvingWall` activates.
 */
export const WallCurveTool: React.FC<{ node: WallNode }> = ({ node }) => {
  const initialHandle = getWallMidpointHandlePoint(node)
  const [cursorPos, setCursorPos] = useState<[number, number, number]>([
    initialHandle.x,
    0,
    initialHandle.y,
  ])

  const exitCurveMode = (committed: boolean) => {
    if (committed) triggerSFX('sfx:item-place')
    useViewer.getState().setSelection({ selectedIds: [node.id] })
    useEditor.getState().setCurvingWall(null)
  }

  useDragAction({
    active: true,
    action: curveWallDragAction,
    initial: {
      node,
      point: [initialHandle.x, initialHandle.y],
    },
    onCommit: () => exitCurveMode(true),
    onCancel: () => exitCurveMode(false),
  })

  const liveCurveOffset = useScene((s) => {
    const live = s.nodes[node.id]
    return live?.type === 'wall' ? ((live as WallNode).curveOffset ?? 0) : 0
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

export default WallCurveTool
