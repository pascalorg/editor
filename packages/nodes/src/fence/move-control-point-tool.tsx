'use client'

import {
  type AnyNodeId,
  emitter,
  type FenceNode,
  type GridEvent,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  getSegmentGridStep,
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
    let shiftPressed = false
    let committed = false
    let lastPoint: [number, number] = [originalPoint[0], originalPoint[1]]

    const liveFence = (): FenceNode | null => {
      const node = useScene.getState().nodes[fenceId]
      return node?.type === 'fence' ? (node as FenceNode) : null
    }

    const writePath = (point: [number, number]) => {
      const fence = liveFence()
      if (!fence?.path) return
      const nextPath = fence.path.map((pathPoint, pathIndex) => (pathIndex === index ? point : pathPoint))
      const patch: Partial<FenceNode> = { path: nextPath }
      if (index === 0) patch.start = point
      if (index === nextPath.length - 1) patch.end = point
      useScene.getState().updateNode(fenceId, patch)
      useScene.getState().markDirty(fenceId)
    }

    const restore = () => {
      writePath([originalPoint[0], originalPoint[1]])
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
      const bypass = shiftPressed || event.nativeEvent?.shiftKey === true
      const step = getSegmentGridStep()
      const x = bypass ? event.localPosition[0] : snapScalarToGrid(event.localPosition[0], step)
      const z = bypass ? event.localPosition[2] : snapScalarToGrid(event.localPosition[2], step)
      if (x !== lastPoint[0] || z !== lastPoint[1]) {
        if (!bypass) triggerSFX('sfx:grid-snap')
        lastPoint = [x, z]
        setCursor([x, 0, z])
        writePath([x, z])
      }
    }

    const onGridClick = (event: GridEvent) => {
      committed = true
      restore()
      resumeSceneHistory(useScene)
      writePath(lastPoint)
      pauseSceneHistory(useScene)
      exit(true)
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restore()
      resumeSceneHistory(useScene)
      markToolCancelConsumed()
      exit(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPressed = true
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPressed = false
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      if (!committed) {
        restore()
        resumeSceneHistory(useScene)
      }
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [fenceId, index, originalPoint[0], originalPoint[1]])

  return (
    <group>
      <CursorSphere position={cursor} showTooltip={false} />
    </group>
  )
}

export default MoveFenceControlPointTool
