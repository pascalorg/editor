'use client'

import {
  type AnyNodeId,
  type ConveyorBeltNode,
  emitter,
  type GridEvent,
  pauseSceneHistory,
  resumeSceneHistory,
  sceneRegistry,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  floorItemDragSuppressClickRef,
  lastGridMoveRef,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'

type RoutePoint = [number, number, number]
type PlanPoint = [number, number]

function midpoint(points: RoutePoint[]): PlanPoint {
  if (points.length === 0) return [0, 0]
  let x = 0
  let z = 0
  for (const point of points) {
    x += point[0]
    z += point[2]
  }
  return [x / points.length, z / points.length]
}

function translatePoints(points: RoutePoint[], deltaX: number, deltaZ: number): RoutePoint[] {
  return points.map((point) => [point[0] + deltaX, point[1], point[2] + deltaZ])
}

export const MoveConveyorBeltTool: React.FC<{ node: ConveyorBeltNode }> = ({ node }) => {
  const originalPointsRef = useRef<RoutePoint[]>(
    node.points.map((point) => [...point] as RoutePoint),
  )
  const dragAnchorRef = useRef<PlanPoint | null>(null)
  const previewRef = useRef<RoutePoint[] | null>(null)
  const cursorRef = useRef<Group>(null)
  const originalMidpoint = useMemo(() => midpoint(originalPointsRef.current), [])
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>([
    originalMidpoint[0],
    node.elevation + node.thickness + 0.24,
    originalMidpoint[1],
  ])

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    if (useEditor.getState().isFloorplanHovered) return

    const conveyorBeltId = node.id
    const originalPoints = originalPointsRef.current
    const cursorY = node.elevation + node.thickness + 0.24

    pauseSceneHistory(useScene)
    let committed = false

    const mesh = sceneRegistry.nodes.get(conveyorBeltId)
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
      useScene.getState().updateNode(conveyorBeltId, { points: originalPoints })
      useScene.getState().markDirty(conveyorBeltId as AnyNodeId)
    }

    const applyPreview = (points: RoutePoint[]) => {
      previewRef.current = points
      useScene.getState().updateNode(conveyorBeltId, { points })
      useScene.getState().markDirty(conveyorBeltId as AnyNodeId)
    }

    const onGridMove = (event: GridEvent) => {
      const raw: PlanPoint = [event.localPosition[0], event.localPosition[2]]
      const snapped = event.nativeEvent?.shiftKey
        ? raw
        : ([...snapPointToGrid(raw, useEditor.getState().gridSnapStep)] as PlanPoint)
      const anchor = dragAnchorRef.current ?? snapped
      dragAnchorRef.current = anchor
      const deltaX = snapped[0] - anchor[0]
      const deltaZ = snapped[1] - anchor[1]
      const nextPoints = translatePoints(originalPoints, deltaX, deltaZ)
      const nextMidpoint = midpoint(nextPoints)
      const nextCursor: [number, number, number] = [nextMidpoint[0], cursorY, nextMidpoint[1]]
      setCursorPosition(nextCursor)
      cursorRef.current?.position.set(...nextCursor)
      applyPreview(nextPoints)
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
      useScene.getState().updateNode(conveyorBeltId, { points: preview })
      useScene.getState().markDirty(conveyorBeltId as AnyNodeId)
      pauseSceneHistory(useScene)
      committed = true

      floorItemDragSuppressClickRef.current = true
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [conveyorBeltId] })
      exitMoveMode()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      commitAtCursor()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [conveyorBeltId] })
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
        resumeSceneHistory(useScene)
      }
    }
  }, [exitMoveMode, node])

  return (
    <CursorSphere color="#a78bfa" ref={cursorRef} showTooltip={false} position={cursorPosition} />
  )
}

export default MoveConveyorBeltTool
