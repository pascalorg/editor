'use client'

import { emitter, type FenceNode, type GridEvent } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import type { Group } from 'three'
import { moveFenceDragAction } from './actions/move'

/**
 * Phase 5 Stage D — thin React wrapper around `moveFenceDragAction`.
 *
 * Cursor sphere follows the raw grid pointer via direct ref mutation —
 * no React state, no per-tick re-render. The fence mesh translates
 * visually through the action's `mesh.position` + `useLiveTransforms`
 * writes (live-drag exception); scene start/end are written on commit
 * via the single-undo dance.
 */
export const FenceMoveTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const fenceId = node.id
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    const onMove = (event: GridEvent) => {
      if (!cursorRef.current) return
      cursorRef.current.position.set(
        event.localPosition[0],
        event.localPosition[1],
        event.localPosition[2],
      )
    }
    emitter.on('grid:move', onMove)
    return () => {
      emitter.off('grid:move', onMove)
    }
  }, [])

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
      // Initial point — useDragAction requires a Vec2. The action's
      // begin captures everything else from input.node; this is just
      // a placeholder until the first grid:move latches the anchor.
      point: [(node.start[0] + node.end[0]) / 2, (node.start[1] + node.end[1]) / 2],
    },
    onCommit: () => exitMoveMode(true),
    onCancel: () => exitMoveMode(false),
  })

  return (
    <group>
      <CursorSphere ref={cursorRef} showTooltip={false} />
    </group>
  )
}

export default FenceMoveTool
