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
  type MovingFenceControlPoint,
  snapScalarToGrid,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'

/**
 * 3D drag tool for a single spline-fence control point. Mounted by the
 * ToolManager when `useEditor.movingFenceControlPoint` is set (engaged by the
 * per-point corner-picker handle). Drags `path[index]` on the ground plane
 * with grid snap (Shift bypasses), live-updating the fence geometry, and
 * commits as a single tracked change on click. Esc cancels and restores.
 *
 * Kept self-contained (its own grid-event listener + single-undo dance)
 * rather than sharing the endpoint `DragAction`, because reshaping `path` has
 * no linked-fence cascade — it only rewrites one point of one node.
 */
export const MoveFenceControlPointTool: React.FC<{ target: MovingFenceControlPoint }> = ({
  target,
}) => {
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
      const nextPath = fence.path.map((p, i) => (i === index ? point : p))
      // Keep start/end pinned to the path ends so endpoint-dependent code
      // (bbox, miter references, linked-fence matching) stays valid.
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
      useEditor.getState().setMovingFenceControlPoint(null)
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
      // Restore the original while paused, then resume + write once so the
      // whole drag records as a single undo step.
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
    // Re-running on identity change would tear the drag down mid-gesture;
    // the target is stable for the tool's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fenceId, index])

  return (
    <group>
      <CursorSphere position={cursor} showTooltip={false} />
    </group>
  )
}

export default MoveFenceControlPointTool
