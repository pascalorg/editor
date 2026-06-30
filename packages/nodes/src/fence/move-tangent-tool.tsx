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

const TANGENT_HANDLE_ARM_SCALE = 3

export const MoveFenceTangentTool: React.FC<{
  target: { fence: FenceNode; index: number; side: 'in' | 'out' }
}> = ({ target }) => {
  const fenceId = target.fence.id as AnyNodeId
  const { index, side } = target
  const anchor = target.fence.path?.[index] ?? target.fence.start

  const [cursor, setCursor] = useState<[number, number, number]>([anchor[0], 0, anchor[1]])

  useEffect(() => {
    pauseSceneHistory(useScene)
    let committed = false
    const originalTangents: Array<[number, number] | null> = (target.fence.tangents ?? []).map(
      (t) => (t ? [t[0], t[1]] : null),
    )
    let lastTangents = originalTangents

    const writeTangent = (vector: [number, number]) => {
      const pathLength = target.fence.path?.length ?? originalTangents.length
      const next: Array<[number, number] | null> = Array.from(
        { length: pathLength },
        (_, tangentIndex) => lastTangents[tangentIndex] ?? null,
      )
      next[index] = vector
      lastTangents = next
      useLiveNodeOverrides.getState().set(fenceId, { tangents: next })
      useScene.getState().markDirty(fenceId)
    }

    const restore = () => {
      useLiveNodeOverrides.getState().clear(fenceId)
      useScene.getState().markDirty(fenceId)
      lastTangents = originalTangents
    }

    const exit = (didCommit: boolean) => {
      if (didCommit) triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      useInteractionScope
        .getState()
        .endIf(
          (scope) =>
            scope.kind === 'reshaping' &&
            scope.reshape === 'tangent' &&
            scope.nodeId === fenceId &&
            scope.index === index &&
            scope.side === side,
        )
    }

    const onGridMove = (event: GridEvent) => {
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      const px = step > 0 ? snapScalarToGrid(event.localPosition[0], step) : event.localPosition[0]
      const pz = step > 0 ? snapScalarToGrid(event.localPosition[2], step) : event.localPosition[2]
      setCursor([px, 0, pz])
      let armX = px - anchor[0]
      let armZ = pz - anchor[1]
      if (side === 'in') {
        armX = -armX
        armZ = -armZ
      }
      writeTangent([armX / TANGENT_HANDLE_ARM_SCALE, armZ / TANGENT_HANDLE_ARM_SCALE])
    }

    const onGridClick = (event: GridEvent) => {
      committed = true
      const finalTangents = lastTangents
      resumeSceneHistory(useScene)
      useScene.getState().updateNode(fenceId, { tangents: finalTangents })
      useLiveNodeOverrides.getState().clear(fenceId)
      useScene.getState().markDirty(fenceId)
      lastTangents = finalTangents
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
  }, [anchor[0], anchor[1], fenceId, index, side, target.fence])

  return (
    <group>
      <CursorSphere position={cursor} showTooltip={false} />
    </group>
  )
}

export default MoveFenceTangentTool
