'use client'

import {
  type AnyNodeId,
  constrainWallMoveDeltaToAxis,
  emitter,
  type FenceNode,
  type GridEvent,
  getPerpendicularWallMoveAxis,
  type LevelNode,
  useScene,
  type WallMoveAxis,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  markToolCancelConsumed,
  snapFenceDraftPoint,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phase 5 Stage D — fence whole-move tool.
 *
 * Live-drag pattern: translate the fence via direct scene updates while
 * temporal history is paused. On commit we restore the original, resume
 * history, apply the final position (single undo step), then re-pause.
 * `constrainWallMoveDeltaToAxis` keeps moves axis-aligned.
 *
 * Wired via `def.affordanceTools.move`. The editor's `MoveTool`
 * dispatcher picks this up before its legacy chain.
 */
function samePoint(a: [number, number], b: [number, number]) {
  return a[0] === b[0] && a[1] === b[1]
}

type LinkedFenceSnapshot = {
  id: FenceNode['id']
  start: [number, number]
  end: [number, number]
}

function getLinkedFenceSnapshots(args: {
  fenceId: FenceNode['id']
  fenceParentId: string | null
  originalStart: [number, number]
  originalEnd: [number, number]
}): LinkedFenceSnapshot[] {
  const { fenceId, fenceParentId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const snapshots: LinkedFenceSnapshot[] = []
  for (const node of Object.values(nodes)) {
    if (!(node?.type === 'fence' && node.id !== fenceId)) continue
    if ((node.parentId ?? null) !== fenceParentId) continue
    if (
      !(
        samePoint(node.start, originalStart) ||
        samePoint(node.start, originalEnd) ||
        samePoint(node.end, originalStart) ||
        samePoint(node.end, originalEnd)
      )
    )
      continue
    snapshots.push({
      id: node.id,
      start: [...node.start] as [number, number],
      end: [...node.end] as [number, number],
    })
  }
  return snapshots
}

function getLinkedFenceUpdates(
  linkedFences: LinkedFenceSnapshot[],
  originalStart: [number, number],
  originalEnd: [number, number],
  nextStart: [number, number],
  nextEnd: [number, number],
) {
  return linkedFences.map((fence) => ({
    id: fence.id,
    start: samePoint(fence.start, originalStart)
      ? nextStart
      : samePoint(fence.start, originalEnd)
        ? nextEnd
        : fence.start,
    end: samePoint(fence.end, originalStart)
      ? nextStart
      : samePoint(fence.end, originalEnd)
        ? nextEnd
        : fence.end,
  }))
}

export const MoveFenceTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const previousGridPosRef = useRef<[number, number] | null>(null)
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
      : getLinkedFenceSnapshots({
          fenceId: node.id,
          fenceParentId: node.parentId ?? null,
          originalStart: node.start,
          originalEnd: node.end,
        }),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previewRef = useRef<{ start: [number, number]; end: [number, number] } | null>(null)
  const moveAxisRef = useRef<WallMoveAxis | null>(
    getPerpendicularWallMoveAxis(node.start, node.end),
  )

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const centerX = (node.start[0] + node.end[0]) / 2
    const centerZ = (node.start[1] + node.end[1]) / 2
    return [centerX, 0, centerZ]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
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
    let wasCommitted = false

    const applyNodePreview = (
      updates: Array<{ id: FenceNode['id']; start: [number, number]; end: [number, number] }>,
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

    const restoreOriginal = () => {
      applyNodePreview([
        { id: fenceId, start: originalStart, end: originalEnd },
        ...linkedOriginalsRef.current,
      ])
    }

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      previewRef.current = { start: nextStart, end: nextEnd }
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])
      const previewUpdates = [
        { id: fenceId, start: nextStart, end: nextEnd },
        ...getLinkedFenceUpdates(
          linkedOriginalsRef.current,
          originalStart,
          originalEnd,
          nextStart,
          nextEnd,
        ),
      ]

      applyNodePreview(previewUpdates)
    }

    const onGridMove = (event: GridEvent) => {
      const [localX, localZ] = snapFenceDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        fences: levelFences,
        ignoreFenceIds: [fenceId],
      })

      if (
        previousGridPosRef.current &&
        (localX !== previousGridPosRef.current[0] || localZ !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousGridPosRef.current = [localX, localZ]

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      const [deltaX, deltaZ] = constrainWallMoveDeltaToAxis(
        localX - anchor[0],
        localZ - anchor[1],
        moveAxisRef.current,
      )

      const nextStart: [number, number] = [originalStart[0] + deltaX, originalStart[1] + deltaZ]
      const nextEnd: [number, number] = [originalEnd[0] + deltaX, originalEnd[1] + deltaZ]

      applyPreview(nextStart, nextEnd)
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      wasCommitted = true

      const preview = previewRef.current
      if (!preview) {
        exitMoveMode()
        event.nativeEvent?.stopPropagation?.()
        return
      }

      // Restore original baseline while paused so the next resume+update
      // registers as a single tracked change (undo reverts to original).
      restoreOriginal()

      useScene.temporal.getState().resume()
      applyNodePreview([
        { id: fenceId, start: preview.start, end: preview.end },
        ...getLinkedFenceUpdates(
          linkedOriginalsRef.current,
          originalStart,
          originalEnd,
          preview.start,
          preview.end,
        ),
      ])
      useScene.temporal.getState().pause()

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        restoreOriginal()
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [exitMoveMode, node])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}

export default MoveFenceTool
