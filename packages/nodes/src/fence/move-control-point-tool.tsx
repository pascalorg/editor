'use client'

import {
  type AnyNodeId,
  emitter,
  type FenceNode,
  type GridEvent,
  pauseSceneHistory,
  resumeSceneHistory,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  getSegmentGridStep,
  isGridSnapActive,
  markToolCancelConsumed,
  snapScalarToGrid,
  triggerSFX,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'

export const MoveFenceControlPointTool: React.FC<{
  target: { fence: FenceNode; index: number }
}> = ({ target }) => {
  const fenceId = target.fence.id as AnyNodeId
  const index = target.index
  const originalPath = target.fence.path ?? []
  const originalPoint = originalPath[index] ?? target.fence.start

  const [cursor, setCursor] = useState<[number, number, number]>([
    originalPoint[0],
    0,
    originalPoint[1],
  ])

  useEffect(() => {
    pauseSceneHistory(useScene)
    let committed = false
    let lastPoint: [number, number] = [originalPoint[0], originalPoint[1]]

    const buildPatch = (point: [number, number]): Partial<FenceNode> => {
      const nextPath = originalPath.map((pathPoint, pathIndex) =>
        pathIndex === index ? point : pathPoint,
      )
      const patch: Partial<FenceNode> = { path: nextPath }
      if (index === 0) patch.start = point
      if (index === nextPath.length - 1) patch.end = point
      return patch
    }

    const previewPath = (point: [number, number]) => {
      useLiveNodeOverrides.getState().set(fenceId, buildPatch(point))
      useScene.getState().markDirty(fenceId)
    }

    const restore = () => {
      useLiveNodeOverrides.getState().clear(fenceId)
      useScene.getState().markDirty(fenceId)
    }

    const exit = (didCommit: boolean) => {
      if (didCommit) triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      useInteractionScope
        .getState()
        .endIf(
          (scope) =>
            scope.kind === 'reshaping' &&
            scope.reshape === 'control-point' &&
            scope.nodeId === fenceId &&
            scope.index === index,
        )
    }

    const onGridMove = (event: GridEvent) => {
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      const x = step > 0 ? snapScalarToGrid(event.localPosition[0], step) : event.localPosition[0]
      const z = step > 0 ? snapScalarToGrid(event.localPosition[2], step) : event.localPosition[2]
      if (x !== lastPoint[0] || z !== lastPoint[1]) {
        if (step > 0) triggerSFX('sfx:grid-snap')
        lastPoint = [x, z]
        setCursor([x, 0, z])
        previewPath([x, z])
      }
    }

    const onGridClick = (event: GridEvent) => {
      committed = true
      resumeSceneHistory(useScene)
      useScene.getState().updateNode(fenceId, buildPatch(lastPoint))
      useLiveNodeOverrides.getState().clear(fenceId)
      useScene.getState().markDirty(fenceId)
      exit(true)
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restore()
      resumeSceneHistory(useScene)
      markToolCancelConsumed()
      exit(false)
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!committed) {
        restore()
        resumeSceneHistory(useScene)
      }
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [fenceId, index, originalPath, originalPoint, originalPoint[0], originalPoint[1]])

  return (
    <group>
      <CursorSphere position={cursor} showTooltip={false} />
    </group>
  )
}

export default MoveFenceControlPointTool
