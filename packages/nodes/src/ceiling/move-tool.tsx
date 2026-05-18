'use client'

import { type CeilingNode, emitter, type GridEvent } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { moveCeilingDragAction } from './actions/move'

/**
 * Phase 5 Stage D — thin React wrapper around `moveCeilingDragAction`.
 *
 * Same shape as `slab/move-tool.tsx`: cursor sphere follows the raw
 * grid pointer via direct ref mutation, the ceiling mesh translates
 * visually via `mesh.position` + `useLiveTransforms`, scene polygon is
 * written only on commit (single-undo dance).
 *
 * No preview fill / outline mesh — moving a translucent overlay every
 * tick adds the same per-frame React reconciliation cost we're trying
 * to avoid here. The real ceiling mesh translates in place; that's
 * enough visual feedback.
 */
export const CeilingMoveTool: React.FC<{ node: CeilingNode }> = ({ node }) => {
  const ceilingId = node.id
  const cursorRef = useRef<Group>(null)

  const initialCenter: [number, number] = useMemo(() => {
    if (node.polygon.length === 0) return [0, 0]
    let sx = 0
    let sz = 0
    for (const [x, z] of node.polygon) {
      sx += x
      sz += z
    }
    return [sx / node.polygon.length, sz / node.polygon.length]
  }, [node.polygon])

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
    useViewer.getState().setSelection({ selectedIds: [ceilingId] })
    useEditor.getState().setMovingNode(null)
  }

  useDragAction({
    active: true,
    action: moveCeilingDragAction,
    initial: {
      node,
      point: initialCenter,
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

export default CeilingMoveTool
