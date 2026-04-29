'use client'

import {
  type AnyNodeId,
  emitter,
  type FenceNode,
  type GridEvent,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallChordFrame,
  getWallMidpointHandlePoint,
  normalizeWallCurveOffset,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'
import { getWallGridStep, snapScalarToGrid } from '../wall/wall-drafting'

export const CurveFenceTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const originalCurveOffsetRef = useRef(getClampedWallCurveOffset(node))
  const previousCurveOffsetRef = useRef<number | null>(null)
  const shiftPressedRef = useRef(false)
  const previewOffsetRef = useRef<number>(originalCurveOffsetRef.current)

  const initialHandle = getWallMidpointHandlePoint(node)
  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>([
    initialHandle.x,
    0,
    initialHandle.y,
  ])

  const exitCurveMode = useCallback(() => {
    useEditor.getState().setCurvingFence(null)
  }, [])

  useEffect(() => {
    const nodeId = node.id
    const originalCurveOffset = originalCurveOffsetRef.current
    const chord = getWallChordFrame(node)
    const maxCurveOffset = getMaxWallCurveOffset(node)

    pauseSceneHistory(useScene)
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
      const snapStep = getWallGridStep()
      const localX = shiftPressedRef.current
        ? event.localPosition[0]
        : snapScalarToGrid(event.localPosition[0], snapStep)
      const localZ = shiftPressedRef.current
        ? event.localPosition[2]
        : snapScalarToGrid(event.localPosition[2], snapStep)

      const offsetFromMidpoint =
        -(
          (localX - chord.midpoint.x) * chord.normal.x +
          (localZ - chord.midpoint.y) * chord.normal.y
        )
      const snappedOffset = shiftPressedRef.current
        ? offsetFromMidpoint
        : snapScalarToGrid(offsetFromMidpoint, snapStep)
      const nextCurveOffset = normalizeWallCurveOffset(
        node,
        Math.max(-maxCurveOffset, Math.min(maxCurveOffset, snappedOffset)),
      )

      if (
        previousCurveOffsetRef.current !== null &&
        nextCurveOffset !== previousCurveOffsetRef.current
      ) {
        sfxEmitter.emit('sfx:grid-snap')
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
        useScene.getState().updateNode(nodeId, { curveOffset: originalCurveOffset })
        useScene.getState().markDirty(nodeId as AnyNodeId)

        resumeSceneHistory(useScene)
        useScene.getState().updateNode(nodeId, { curveOffset })
        useScene.getState().markDirty(nodeId as AnyNodeId)
        pauseSceneHistory(useScene)
      }

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitCurveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      resumeSceneHistory(useScene)
      markToolCancelConsumed()
      exitCurveMode()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftPressedRef.current = true
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftPressedRef.current = false
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      if (!wasCommitted) {
        restoreOriginal()
      }
      resumeSceneHistory(useScene)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [exitCurveMode, node])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}
