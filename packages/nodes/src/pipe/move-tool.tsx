'use client'

import {
  type AnyNodeId,
  type GridEvent,
  type LevelNode,
  type PipeNode,
  emitter,
  sceneRegistry,
  type WallNode,
  useScene,
} from '@pascal-app/core'
import {
  applyPipeEndpointPreview,
  computePipeDragEndpoints,
  floorItemDragSuppressClickRef,
  getLinkedPipeSnapshots,
  getPipePlanMidpoint,
  lastGridMoveRef,
  markToolCancelConsumed,
  snapPipeDraftPoint,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useCallback, useEffect, useRef } from 'react'
import type { Object3D } from 'three'

export const MovePipeTool: React.FC<{ node: PipeNode }> = ({ node }) => {
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
      : getLinkedPipeSnapshots({
          pipeId: node.id,
          pipeParentId: node.parentId ?? null,
          originalStart: node.start,
          originalEnd: node.end,
        }),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    if (useEditor.getState().isFloorplanHovered) return

    const pipeId = node.id
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
    const levelPipes = levelChildren
      .map((childId) => useScene.getState().nodes[childId as AnyNodeId])
      .filter((child): child is PipeNode => child?.type === 'pipe')

    useScene.temporal.getState().pause()
    let committed = false

    const mesh = sceneRegistry.nodes.get(node.id)
    const restoreRaycasts: Array<() => void> = []
    if (mesh) {
      mesh.traverse((child: Object3D) => {
        const original = child.raycast
        child.raycast = () => {}
        restoreRaycasts.push(() => {
          child.raycast = original
        })
      })
    }

    const restoreOriginal = () => {
      applyPipeEndpointPreview(
        pipeId,
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        originalStart,
        originalEnd,
      )
    }

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      previewRef.current = { start: nextStart, end: nextEnd }
      applyPipeEndpointPreview(
        pipeId,
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        nextStart,
        nextEnd,
      )
    }

    const onGridMove = (event: GridEvent) => {
      const [localX, localZ] = snapPipeDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        pipes: levelPipes,
        ignorePipeIds: [pipeId],
      })

      const anchor = dragAnchorRef.current ?? getPipePlanMidpoint(node)
      dragAnchorRef.current = anchor

      const { start, end } = computePipeDragEndpoints({
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
      if (committed) return
      const preview = previewRef.current
      if (!preview) {
        exitMoveMode()
        return
      }

      restoreOriginal()

      useScene.temporal.getState().resume()
      applyPipeEndpointPreview(
        pipeId,
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        preview.start,
        preview.end,
      )
      useScene.temporal.getState().pause()
      committed = true

      floorItemDragSuppressClickRef.current = true
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [pipeId] })
      exitMoveMode()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      commitAtCursor()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [pipeId] })
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

  return null
}

export default MovePipeTool
