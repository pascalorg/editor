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
    let shiftPressed = false
    let committed = false
    const originalTangents: Array<[number, number] | null> = (target.fence.tangents ?? []).map((t) =>
      t ? [t[0], t[1]] : null,
    )
    let lastTangents = originalTangents

    const liveFence = (): FenceNode | null => {
      const node = useScene.getState().nodes[fenceId]
      return node?.type === 'fence' ? (node as FenceNode) : null
    }

    const writeTangent = (vector: [number, number]) => {
      const fence = liveFence()
      const pathLength = fence?.path?.length ?? originalTangents.length
      const next: Array<[number, number] | null> = Array.from(
        { length: pathLength },
        (_, tangentIndex) => lastTangents[tangentIndex] ?? null,
      )
      next[index] = vector
      lastTangents = next
      useScene.getState().updateNode(fenceId, { tangents: next })
      useScene.getState().markDirty(fenceId)
    }

    const restore = () => {
      useScene.getState().updateNode(fenceId, { tangents: originalTangents })
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
      const bypass = shiftPressed || event.nativeEvent?.shiftKey === true
      const step = getSegmentGridStep()
      const px = bypass ? event.localPosition[0] : snapScalarToGrid(event.localPosition[0], step)
      const pz = bypass ? event.localPosition[2] : snapScalarToGrid(event.localPosition[2], step)
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
      restore()
      resumeSceneHistory(useScene)
      useScene.getState().updateNode(fenceId, { tangents: finalTangents })
      useScene.getState().markDirty(fenceId)
      pauseSceneHistory(useScene)
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
  }, [anchor[0], anchor[1], fenceId, index, side, target.fence])

  return (
    <group>
      <CursorSphere position={cursor} showTooltip={false} />
    </group>
  )
}

export default MoveFenceTangentTool
