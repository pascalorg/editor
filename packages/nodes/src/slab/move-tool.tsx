'use client'

import { emitter, type GridEvent, type SlabNode } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { moveSlabDragAction } from './actions/move'

/**
 * Phase 5 Stage D — thin React wrapper around `moveSlabDragAction`.
 *
 * The cursor sphere follows the raw grid pointer via direct ref mutation
 * (no React state, no per-tick re-render). The slab mesh itself is
 * translated by the action using `mesh.position` + `useLiveTransforms`
 * (live-drag exception). Scene polygon is only written on commit.
 */
export const SlabMoveTool: React.FC<{ node: SlabNode }> = ({ node }) => {
  const slabId = node.id
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

  // Cursor follows the raw grid pointer — direct Three.js mutation,
  // bypassing React reconciliation for the per-tick position update.
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
    useViewer.getState().setSelection({ selectedIds: [slabId] })
    useEditor.getState().setMovingNode(null)
  }

  useDragAction({
    active: true,
    action: moveSlabDragAction,
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

export default SlabMoveTool
