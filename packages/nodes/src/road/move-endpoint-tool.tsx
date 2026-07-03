'use client'

import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type LevelNode,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  type MovingRoadEndpoint,
  markToolCancelConsumed,
  snapWallDraftPoint,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useCallback, useEffect, useRef, useState } from 'react'

function getCurrentLevelWalls(parentId: string | null): WallNode[] {
  const { nodes } = useScene.getState()
  if (!parentId) return []
  const levelNode = nodes[parentId as AnyNodeId]
  if (levelNode?.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

export const MoveRoadEndpointTool: React.FC<{ target: MovingRoadEndpoint }> = ({ target }) => {
  const roadId = target.road.id
  const endpoint = target.endpoint
  const initialPoint: [number, number] =
    endpoint === 'start'
      ? [target.road.start[0], target.road.start[1]]
      : [target.road.end[0], target.road.end[1]]
  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>([
    initialPoint[0],
    target.road.elevation + 0.1,
    initialPoint[1],
  ])
  const originalStartRef = useRef<[number, number]>([...target.road.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...target.road.end] as [number, number])
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)
  const previousPointRef = useRef<[number, number] | null>(null)
  const shiftPressedRef = useRef(false)

  const exitMoveMode = useCallback(
    (committed: boolean) => {
      if (committed) triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [roadId] })
      useEditor.getState().setMovingRoadEndpoint(null)
      useEditor.getState().setActiveAffordance(null)
    },
    [roadId],
  )

  useEffect(() => {
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current
    const fixedPoint = endpoint === 'start' ? originalEnd : originalStart
    const walls = getCurrentLevelWalls(target.road.parentId ?? null)

    pauseSceneHistory(useScene)
    let committed = false

    const applyPreview = (start: [number, number], end: [number, number]) => {
      previewRef.current = { start, end }
      const movingPoint = endpoint === 'start' ? start : end
      setCursorLocalPos([movingPoint[0], target.road.elevation + 0.1, movingPoint[1]])
      useScene.getState().updateNode(roadId, { start, end })
      useScene.getState().markDirty(roadId as AnyNodeId)
    }

    const restoreOriginal = () => {
      useScene.getState().updateNode(roadId, { start: originalStart, end: originalEnd })
      useScene.getState().markDirty(roadId as AnyNodeId)
    }

    const onGridMove = (event: GridEvent) => {
      const snapped = snapWallDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls,
        start: fixedPoint,
        angleSnap: !shiftPressedRef.current,
      })
      const start = endpoint === 'start' ? snapped : originalStart
      const end = endpoint === 'end' ? snapped : originalEnd

      if (
        previousPointRef.current &&
        (snapped[0] !== previousPointRef.current[0] || snapped[1] !== previousPointRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousPointRef.current = snapped
      applyPreview(start, end)
    }

    const commitAtCursor = () => {
      if (committed) return
      const preview = previewRef.current
      if (!preview) {
        exitMoveMode(false)
        return
      }
      const dx = preview.end[0] - preview.start[0]
      const dz = preview.end[1] - preview.start[1]
      if (dx * dx + dz * dz < 0.01 * 0.01) return

      restoreOriginal()
      resumeSceneHistory(useScene)
      useScene.getState().updateNode(roadId, { start: preview.start, end: preview.end })
      useScene.getState().markDirty(roadId as AnyNodeId)
      pauseSceneHistory(useScene)
      committed = true
      exitMoveMode(true)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      commitAtCursor()
    }

    const onCancel = () => {
      restoreOriginal()
      resumeSceneHistory(useScene)
      markToolCancelConsumed()
      exitMoveMode(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPressedRef.current = true
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPressedRef.current = false
    }

    emitter.on('grid:move', onGridMove)
    window.addEventListener('pointerup', onPointerUp)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      emitter.off('grid:move', onGridMove)
      window.removeEventListener('pointerup', onPointerUp)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (!committed) {
        restoreOriginal()
      }
      resumeSceneHistory(useScene)
    }
  }, [endpoint, exitMoveMode, roadId, target.road])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}

export default MoveRoadEndpointTool
