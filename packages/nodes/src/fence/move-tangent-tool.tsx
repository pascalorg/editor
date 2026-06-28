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
  type MovingFenceTangent,
  snapScalarToGrid,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'

// Must match the on-screen arm multiplier used by the handle placement
// (definition.ts) and the 2D builder so the stored tangent matches the visual.
const TANGENT_HANDLE_ARM_SCALE = 3

/**
 * 3D drag tool for a spline-fence tangent handle. Mounted when
 * `useEditor.movingFenceTangent` is set (engaged by the per-point tangent
 * picker). Drags the handle end on the ground; the vector from the control
 * point (÷ arm scale) becomes the stored OUT tangent (negated when the IN end
 * is grabbed), so the curve bends symmetrically through that point. Commits as
 * one tracked change on click; Esc cancels.
 */
export const MoveFenceTangentTool: React.FC<{ target: MovingFenceTangent }> = ({ target }) => {
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

    const writeTangent = (vec: [number, number]) => {
      const fence = liveFence()
      const pathLength = fence?.path?.length ?? originalTangents.length
      const next: Array<[number, number] | null> = Array.from(
        { length: pathLength },
        (_, i) => lastTangents[i] ?? null,
      )
      next[index] = vec
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
      useEditor.getState().setMovingFenceTangent(null)
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

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed = false
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fenceId, index, side])

  return (
    <group>
      <CursorSphere position={cursor} showTooltip={false} />
    </group>
  )
}

export default MoveFenceTangentTool
