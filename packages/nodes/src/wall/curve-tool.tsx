'use client'

import {
  type AnyNodeId,
  acquireSceneHistoryPause,
  constrainWallCurveOffsetToAvoidIntersections,
  emitter,
  type GridEvent,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallChordFrame,
  getWallMidpointHandlePoint,
  normalizeWallCurveOffset,
  useLiveNodeOverrides,
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
 * 1:1 port of the legacy `CurveWallTool`. Same snap pipeline and
 * activation grace. History uses an idempotent lease because cancel and
 * effect cleanup can both release the active interaction.
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
    const levelWalls = Object.values(useScene.getState().nodes).filter(
      (candidate): candidate is WallNode =>
        candidate.type === 'wall' && candidate.parentId === node.parentId,
    )

    let releaseHistory = acquireSceneHistoryPause(useScene)
    let wasFinalized = false

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
      useLiveNodeOverrides.getState().set(nodeId as AnyNodeId, { curveOffset })
      useScene.getState().markDirty(nodeId as AnyNodeId)
    }

    const restoreOriginal = () => {
      previewOffsetRef.current = originalCurveOffset
      useLiveNodeOverrides.getState().clear(nodeId as AnyNodeId)
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
      const requestedCurveOffset = normalizeWallCurveOffset(
        node,
        Math.max(-maxCurveOffset, Math.min(maxCurveOffset, snappedOffset)),
      )
      const nextCurveOffset = constrainWallCurveOffsetToAvoidIntersections(
        node,
        requestedCurveOffset,
        levelWalls,
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
      if (wasFinalized) return
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const curveOffset = previewOffsetRef.current
      wasFinalized = true
      useLiveNodeOverrides.getState().clear(nodeId as AnyNodeId)
      useScene.getState().markDirty(nodeId as AnyNodeId)

      if (curveOffset !== originalCurveOffset) {
        releaseHistory()
        useScene.getState().updateNode(nodeId, { curveOffset })
        useScene.getState().markDirty(nodeId as AnyNodeId)
        releaseHistory = acquireSceneHistoryPause(useScene)
      }

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitCurveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      if (wasFinalized) return
      restoreOriginal()
      wasFinalized = true
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      releaseHistory()
      markToolCancelConsumed()
      exitCurveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasFinalized) {
        restoreOriginal()
      }
      releaseHistory()
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
