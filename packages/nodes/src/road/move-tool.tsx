'use client'

import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type LevelNode,
  pauseSceneHistory,
  type RoadNode,
  resumeSceneHistory,
  sceneRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  floorItemDragSuppressClickRef,
  lastGridMoveRef,
  markToolCancelConsumed,
  snapWallDraftPoint,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef } from 'react'

function getCurrentLevelWalls(parentId: string | null): WallNode[] {
  const { nodes } = useScene.getState()
  if (!parentId) return []
  const levelNode = nodes[parentId as AnyNodeId]
  if (levelNode?.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

export const MoveRoadTool: React.FC<{ node: RoadNode }> = ({ node }) => {
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previousPointRef = useRef<[number, number] | null>(null)
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    if (useEditor.getState().isFloorplanHovered) return

    const roadId = node.id
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current
    const walls = getCurrentLevelWalls(node.parentId ?? null)

    pauseSceneHistory(useScene)
    let committed = false

    const mesh = sceneRegistry.nodes.get(roadId)
    const restoreRaycasts: Array<() => void> = []
    if (mesh) {
      mesh.traverse((child) => {
        const original = child.raycast
        child.raycast = () => {}
        restoreRaycasts.push(() => {
          child.raycast = original
        })
      })
    }

    const applyPreview = (start: [number, number], end: [number, number]) => {
      previewRef.current = { start, end }
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
      })
      const anchor = dragAnchorRef.current ?? snapped
      dragAnchorRef.current = anchor
      const deltaX = snapped[0] - anchor[0]
      const deltaZ = snapped[1] - anchor[1]
      const nextStart: [number, number] = [originalStart[0] + deltaX, originalStart[1] + deltaZ]
      const nextEnd: [number, number] = [originalEnd[0] + deltaX, originalEnd[1] + deltaZ]

      if (
        previousPointRef.current &&
        (snapped[0] !== previousPointRef.current[0] || snapped[1] !== previousPointRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousPointRef.current = snapped
      applyPreview(nextStart, nextEnd)
    }

    if (lastGridMoveRef.localPosition) {
      onGridMove({ localPosition: lastGridMoveRef.localPosition } as GridEvent)
    }

    const commitAtCursor = () => {
      if (committed) return
      const preview = previewRef.current
      if (!preview) {
        exitMoveMode()
        return
      }

      restoreOriginal()
      resumeSceneHistory(useScene)
      useScene.getState().updateNode(roadId, { start: preview.start, end: preview.end })
      useScene.getState().markDirty(roadId as AnyNodeId)
      pauseSceneHistory(useScene)
      committed = true

      floorItemDragSuppressClickRef.current = true
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [roadId] })
      exitMoveMode()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      commitAtCursor()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [roadId] })
      resumeSceneHistory(useScene)
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    window.addEventListener('pointerup', onPointerUp)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      window.removeEventListener('pointerup', onPointerUp)
      emitter.off('tool:cancel', onCancel)
      for (const restore of restoreRaycasts) restore()
      if (!committed) {
        restoreOriginal()
      }
      resumeSceneHistory(useScene)
    }
  }, [exitMoveMode, node])

  return null
}

export default MoveRoadTool
