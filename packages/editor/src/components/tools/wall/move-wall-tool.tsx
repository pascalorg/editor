'use client'

import { type AnyNodeId, emitter, type GridEvent, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'
import { getWallGridStep, snapScalarToGrid } from './wall-drafting'

function rotateVector([x, z]: [number, number], angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos - z * sin, x * sin + z * cos]
}

function samePoint(a: [number, number], b: [number, number]) {
  return a[0] === b[0] && a[1] === b[1]
}

function stripWallIsNewMetadata(meta: WallNode['metadata']): WallNode['metadata'] {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return meta
  }

  const nextMeta = { ...(meta as Record<string, unknown>) }
  delete nextMeta.isNew
  return nextMeta
}

type LinkedWallSnapshot = {
  id: WallNode['id']
  start: [number, number]
  end: [number, number]
}

function getLinkedWallSnapshots(args: {
  wallId: WallNode['id']
  wallParentId: string | null
  originalStart: [number, number]
  originalEnd: [number, number]
}) {
  const { wallId, wallParentId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const snapshots: LinkedWallSnapshot[] = []

  for (const node of Object.values(nodes)) {
    if (!(node?.type === 'wall' && node.id !== wallId)) {
      continue
    }

    if ((node.parentId ?? null) !== wallParentId) {
      continue
    }

    if (
      !samePoint(node.start, originalStart) &&
      !samePoint(node.start, originalEnd) &&
      !samePoint(node.end, originalStart) &&
      !samePoint(node.end, originalEnd)
    ) {
      continue
    }

    snapshots.push({
      id: node.id,
      start: [...node.start] as [number, number],
      end: [...node.end] as [number, number],
    })
  }

  return snapshots
}

function getLinkedWallUpdates(
  linkedWalls: LinkedWallSnapshot[],
  originalStart: [number, number],
  originalEnd: [number, number],
  nextStart: [number, number],
  nextEnd: [number, number],
) {
  return linkedWalls.map((wall) => ({
    id: wall.id,
    start: samePoint(wall.start, originalStart)
      ? nextStart
      : samePoint(wall.start, originalEnd)
        ? nextEnd
        : wall.start,
    end: samePoint(wall.end, originalStart)
      ? nextStart
      : samePoint(wall.end, originalEnd)
        ? nextEnd
        : wall.end,
  }))
}

export const MoveWallTool: React.FC<{ node: WallNode }> = ({ node }) => {
  const meta =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}
  const isNew = !!meta.isNew
  const activatedAtRef = useRef<number>(Date.now())
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const originalCenterRef = useRef<[number, number]>([
    (node.start[0] + node.end[0]) / 2,
    (node.start[1] + node.end[1]) / 2,
  ])
  const originalHalfVectorRef = useRef<[number, number]>([
    (node.end[0] - node.start[0]) / 2,
    (node.end[1] - node.start[1]) / 2,
  ])
  const linkedOriginalsRef = useRef(
    isNew
      ? []
      : getLinkedWallSnapshots({
          wallId: node.id,
          wallParentId: node.parentId ?? null,
          originalStart: node.start,
          originalEnd: node.end,
        }),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const nodeIdRef = useRef(node.id)
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)
  const pendingRotationRef = useRef(0)
  const shiftPressedRef = useRef(false)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const centerX = (node.start[0] + node.end[0]) / 2
    const centerZ = (node.start[1] + node.end[1]) / 2
    return [centerX, 0, centerZ]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const nodeId = nodeIdRef.current
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current
    const originalCenter = originalCenterRef.current
    const originalHalfVector = originalHalfVectorRef.current

    useScene.temporal.getState().pause()
    let wasCommitted = false

    const applyNodePreview = (
      updates: Array<{ id: WallNode['id']; start: [number, number]; end: [number, number] }>,
    ) => {
      useScene.getState().updateNodes(
        updates.map((entry) => ({
          id: entry.id as AnyNodeId,
          data: { start: entry.start, end: entry.end },
        })),
      )
      for (const entry of updates) {
        useScene.getState().markDirty(entry.id as AnyNodeId)
      }
    }

    const buildWallFromCenter = (center: [number, number]) => {
      const rotatedHalf = rotateVector(originalHalfVector, pendingRotationRef.current)
      const nextStart: [number, number] = [center[0] - rotatedHalf[0], center[1] - rotatedHalf[1]]
      const nextEnd: [number, number] = [center[0] + rotatedHalf[0], center[1] + rotatedHalf[1]]
      return { start: nextStart, end: nextEnd }
    }

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      previewRef.current = { start: nextStart, end: nextEnd }
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])
      applyNodePreview([
        { id: nodeId, start: nextStart, end: nextEnd },
        ...getLinkedWallUpdates(
          linkedOriginalsRef.current,
          originalStart,
          originalEnd,
          nextStart,
          nextEnd,
        ),
      ])
    }

    const restoreOriginal = () => {
      applyNodePreview([
        { id: nodeId, start: originalStart, end: originalEnd },
        ...linkedOriginalsRef.current,
      ])
    }

    const onGridMove = (event: GridEvent) => {
      const rawX = event.localPosition[0]
      const rawZ = event.localPosition[2]
      const snapStep = getWallGridStep()
      const localX = shiftPressedRef.current ? rawX : snapScalarToGrid(rawX, snapStep)
      const localZ = shiftPressedRef.current ? rawZ : snapScalarToGrid(rawZ, snapStep)

      if (
        previousGridPosRef.current &&
        (localX !== previousGridPosRef.current[0] || localZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }
      previousGridPosRef.current = [localX, localZ]

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      const deltaX = localX - anchor[0]
      const deltaZ = localZ - anchor[1]

      const nextCenter: [number, number] = [originalCenter[0] + deltaX, originalCenter[1] + deltaZ]
      const nextWall = buildWallFromCenter(nextCenter)
      applyPreview(nextWall.start, nextWall.end)
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }

      wasCommitted = true

      // Restore original baseline while paused so the next resume+update
      // registers as a single tracked change (undo reverts to original).
      applyNodePreview([
        { id: nodeId, start: originalStart, end: originalEnd },
        ...linkedOriginalsRef.current,
      ])

      useScene.temporal.getState().resume()

      const commitUpdates = [
        {
          id: nodeId as AnyNodeId,
          data: isNew
            ? {
                start: preview.start,
                end: preview.end,
                metadata: stripWallIsNewMetadata(node.metadata),
              }
            : { start: preview.start, end: preview.end },
        },
        ...getLinkedWallUpdates(
          linkedOriginalsRef.current,
          originalStart,
          originalEnd,
          preview.start,
          preview.end,
        ).map((entry) => ({
          id: entry.id as AnyNodeId,
          data: { start: entry.start, end: entry.end },
        })),
      ]
      useScene.getState().updateNodes(commitUpdates)
      for (const { id } of commitUpdates) {
        useScene.getState().markDirty(id)
      }

      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.key === 'Shift') {
        shiftPressedRef.current = true
        return
      }

      const ROTATION_STEP = Math.PI / 4
      let rotationDelta = 0
      if (event.key === 'r' || event.key === 'R') rotationDelta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') rotationDelta = -ROTATION_STEP

      if (rotationDelta === 0) {
        return
      }

      event.preventDefault()
      pendingRotationRef.current += rotationDelta
      sfxEmitter.emit('sfx:item-rotate')

      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }
      const currentCenter: [number, number] = [
        (preview.start[0] + preview.end[0]) / 2,
        (preview.start[1] + preview.end[1]) / 2,
      ]
      const nextWall = buildWallFromCenter(currentCenter)
      applyPreview(nextWall.start, nextWall.end)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftPressedRef.current = false
      }
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      if (!wasCommitted) {
        restoreOriginal()
      }
      shiftPressedRef.current = false
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [exitMoveMode, isNew, node.metadata])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}
