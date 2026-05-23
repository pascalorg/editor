'use client'

import {
  type AnyNodeId,
  emitter,
  type FenceNode,
  type GridEvent,
  type LevelNode,
  sceneRegistry,
  type WallNode,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  floorItemDragSuppressClickRef,
  getLinkedSegmentSnapshots,
  getSegmentPlanMidpoint,
  applySegmentEndpointPreview,
  computeSegmentDragEndpoints,
  lastGridMoveRef,
  markToolCancelConsumed,
  snapFenceDraftPoint,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'

export const MoveFenceTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const meta =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}
  const isNew = !!meta.isNew

  const linkedOriginalsRef = useRef(
    isNew
      ? []
      : getLinkedSegmentSnapshots({
          segmentId: node.id,
          segmentParentId: node.parentId ?? null,
          segmentType: 'fence',
          originalStart: node.start,
          originalEnd: node.end,
        }),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const centerX = (node.start[0] + node.end[0]) / 2
    const centerZ = (node.start[1] + node.end[1]) / 2
    return [centerX, 0, centerZ]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    if (useEditor.getState().isFloorplanHovered) return

    const fenceId = node.id
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current

    const levelNode =
      node.parentId && useScene.getState().nodes[node.parentId as AnyNodeId]?.type === 'level'
        ? (useScene.getState().nodes[node.parentId as AnyNodeId] as LevelNode)
        : null
    const levelChildren = levelNode?.children ?? []
    const levelWalls = levelChildren
      .map((childId) => useScene.getState().nodes[childId as AnyNodeId])
      .filter((child): child is WallNode => child?.type === 'wall')
    const levelFences = levelChildren
      .map((childId) => useScene.getState().nodes[childId as AnyNodeId])
      .filter((child): child is FenceNode => child?.type === 'fence')

    useScene.temporal.getState().pause()
    let committed = false
    let hasMoved = false

    const mesh = sceneRegistry.nodes.get(node.id)
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

    const restoreOriginal = () => {
      applySegmentEndpointPreview(
        fenceId,
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        originalStart,
        originalEnd,
      )
    }

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      previewRef.current = { start: nextStart, end: nextEnd }
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])
      applySegmentEndpointPreview(
        fenceId,
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        nextStart,
        nextEnd,
      )
    }

    const onGridMove = (event: GridEvent) => {
      hasMoved = true
      const [localX, localZ] = snapFenceDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        fences: levelFences,
        ignoreFenceIds: [fenceId],
      })

      const anchor = dragAnchorRef.current ?? getSegmentPlanMidpoint(node)
      dragAnchorRef.current = anchor

      const { start, end } = computeSegmentDragEndpoints({
        originalStart,
        originalEnd,
        dragAnchor: anchor,
        cursorPlan: [localX, localZ],
      })

      applyPreview(start, end)
    }

    if (lastGridMoveRef.localPosition) {
      onGridMove({ localPosition: lastGridMoveRef.localPosition } as GridEvent)
    }

    const commitAtCursor = () => {
      if (committed || !hasMoved) return
      const preview = previewRef.current
      if (!preview) {
        exitMoveMode()
        return
      }

      committed = true
      restoreOriginal()

      useScene.temporal.getState().resume()
      applySegmentEndpointPreview(
        fenceId,
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        preview.start,
        preview.end,
      )
      useScene.temporal.getState().pause()

      floorItemDragSuppressClickRef.current = true
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      exitMoveMode()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      commitAtCursor()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      useScene.temporal.getState().resume()
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
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}

export default MoveFenceTool
