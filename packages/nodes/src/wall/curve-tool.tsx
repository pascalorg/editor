'use client'

import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallChordFrame,
  getWallMidpointHandlePoint,
  normalizeWallCurveOffset,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  getSegmentGridStep,
  markToolCancelConsumed,
  snapBuildingLocalToWorldGrid,
  snapScalarToGrid,
  triggerSFX,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phase 5 Stage D — wall curve tool (kind-owned).
 *
 * 1:1 port of the legacy `CurveWallTool`. Same snap pipeline,
 * history dance, activation grace. The wall variant uses
 * `useScene.temporal.getState().pause()` / `.resume()` directly rather
 * than the depth-counted `pauseSceneHistory` helpers — matches legacy.
 */
export const CurveWallTool: React.FC<{ node: WallNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const originalCurveOffsetRef = useRef(getClampedWallCurveOffset(node))
  const previousCurveOffsetRef = useRef<number | null>(null)
  const previewOffsetRef = useRef<number>(originalCurveOffsetRef.current)

  const initialHandle = getWallMidpointHandlePoint(node)
  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>([
    initialHandle.x,
    0,
    initialHandle.y,
  ])

  const exitCurveMode = useCallback(() => {
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'curve')
  }, [])

  useEffect(() => {
    const nodeId = node.id
    const originalCurveOffset = originalCurveOffsetRef.current
    const chord = getWallChordFrame(node)
    const maxCurveOffset = getMaxWallCurveOffset(node)

    useScene.temporal.getState().pause()
    let wasCommitted = false

    const applyPreview = (curveOffset: number) => {
      if (previewOffsetRef.current === curveOffset) {
        return
      }
      previewOffsetRef.current = curveOffset

      const nextNode = {
        ...node,
        curveOffset,
      }
      const handlePoint = getWallMidpointHandlePoint(nextNode)
      setCursorLocalPos([handlePoint.x, 0, handlePoint.y])
      useScene.getState().updateNode(nodeId, { curveOffset })
      useScene.getState().markDirty(nodeId as AnyNodeId)
    }

    const restoreOriginal = () => {
      if (previewOffsetRef.current === originalCurveOffset) {
        return
      }
      previewOffsetRef.current = originalCurveOffset
      useScene.getState().updateNode(nodeId, { curveOffset: originalCurveOffset })
      useScene.getState().markDirty(nodeId as AnyNodeId)
    }

    const onGridMove = (event: GridEvent) => {
      const snapStep = getSegmentGridStep()
      // Snap the cursor on the WORLD XZ grid (still in building-local
      // coords for the rest of the math) so a rotated building doesn't
      // pull the curve handle off the visible grid lines.
      const [snappedLocalX, snappedLocalZ] = snapBuildingLocalToWorldGrid(
        [event.localPosition[0], event.localPosition[2]],
        snapStep,
      )
      const localX = snappedLocalX
      const localZ = snappedLocalZ

      const offsetFromMidpoint = -(
        (localX - chord.midpoint.x) * chord.normal.x +
        (localZ - chord.midpoint.y) * chord.normal.y
      )
      const snappedOffset = snapScalarToGrid(offsetFromMidpoint, snapStep)
      const nextCurveOffset = normalizeWallCurveOffset(
        node,
        Math.max(-maxCurveOffset, Math.min(maxCurveOffset, snappedOffset)),
      )

      if (
        previousCurveOffsetRef.current !== null &&
        nextCurveOffset !== previousCurveOffsetRef.current
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousCurveOffsetRef.current = nextCurveOffset

      applyPreview(nextCurveOffset)
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const curveOffset = previewOffsetRef.current
      wasCommitted = true

      if (curveOffset !== originalCurveOffset) {
        // Restore original baseline while paused so the next resume+update
        // registers as a single tracked change (undo reverts to original).
        useScene.getState().updateNode(nodeId, { curveOffset: originalCurveOffset })
        useScene.getState().markDirty(nodeId as AnyNodeId)

        useScene.temporal.getState().resume()
        useScene.getState().updateNode(nodeId, { curveOffset })
        useScene.getState().markDirty(nodeId as AnyNodeId)
        useScene.temporal.getState().pause()
      }

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitCurveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitCurveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        restoreOriginal()
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [exitCurveMode, node])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}

export default CurveWallTool
