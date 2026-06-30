'use client'

import {
  type AnyNodeId,
  constrainWallMoveDeltaToAxis,
  emitter,
  type FenceNode,
  type GridEvent,
  getPerpendicularWallMoveAxis,
  isCurvedWall,
  isSplineFence,
  type LevelNode,
  useLiveNodeOverrides,
  useScene,
  type WallMoveAxis,
  type WallNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  consumePlacementDragRelease,
  getSegmentGridStep,
  isGridSnapActive,
  isMagneticSnapActive,
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
 * Live-drag pattern: preview data-driven reshapes through live node
 * overrides. On commit we write the final position once for a single undo
 * step.
 * Straight fences use `constrainWallMoveDeltaToAxis` to keep side-moves
 * perpendicular; curved fences translate freely because their path shape
 * already carries direction.
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
  path?: [number, number][]
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
      path: node.path?.map((point) => [...point] as [number, number]),
    })
  }
  return snapshots
}

function translatePath(
  path: [number, number][] | undefined,
  deltaX: number,
  deltaZ: number,
): [number, number][] | undefined {
  return path?.map((point) => [point[0] + deltaX, point[1] + deltaZ])
}

function projectLinkedPath(
  path: [number, number][] | undefined,
  start: [number, number],
  end: [number, number],
): [number, number][] | undefined {
  if (!path || path.length === 0) return path
  const nextPath = path.map((point) => [...point] as [number, number])
  nextPath[0] = start
  nextPath[nextPath.length - 1] = end
  return nextPath
}

function getLinkedFenceUpdates(
  linkedFences: LinkedFenceSnapshot[],
  originalStart: [number, number],
  originalEnd: [number, number],
  nextStart: [number, number],
  nextEnd: [number, number],
) {
  return linkedFences.map((fence) => {
    const start = samePoint(fence.start, originalStart)
      ? nextStart
      : samePoint(fence.start, originalEnd)
        ? nextEnd
        : fence.start
    const end = samePoint(fence.end, originalStart)
      ? nextStart
      : samePoint(fence.end, originalEnd)
        ? nextEnd
        : fence.end

    return {
      id: fence.id,
      start,
      end,
      path: projectLinkedPath(fence.path, start, end),
    }
  })
}

export const MoveFenceTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const originalPathRef = useRef(node.path?.map((point) => [...point] as [number, number]))
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
  const previewRef = useRef<{
    start: [number, number]
    end: [number, number]
    path?: [number, number][]
  } | null>(null)
  const canMoveFreely = isSplineFence(node) || isCurvedWall(node)
  const moveAxisRef = useRef<WallMoveAxis | null>(
    canMoveFreely ? null : getPerpendicularWallMoveAxis(node.start, node.end),
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
      updates: Array<{
        id: FenceNode['id']
        start: [number, number]
        end: [number, number]
        path?: [number, number][]
      }>,
    ) => {
      useLiveNodeOverrides
        .getState()
        .setMany(
          updates.map((entry) => [
            entry.id as AnyNodeId,
            { start: entry.start, end: entry.end, path: entry.path },
          ]),
        )
      for (const entry of updates) {
        useScene.getState().markDirty(entry.id as AnyNodeId)
      }
    }

    const applyCommittedUpdates = (
      updates: Array<{
        id: FenceNode['id']
        start: [number, number]
        end: [number, number]
        path?: [number, number][]
      }>,
    ) => {
      useScene.getState().updateNodes(
        updates.map((entry) => ({
          id: entry.id as AnyNodeId,
          data: { start: entry.start, end: entry.end, path: entry.path },
        })),
      )
      for (const entry of updates) {
        useScene.getState().markDirty(entry.id as AnyNodeId)
      }
    }

    const restoreOriginal = () => {
      const overrides = useLiveNodeOverrides.getState()
      overrides.clear(fenceId)
      for (const linkedFence of linkedOriginalsRef.current) {
        overrides.clear(linkedFence.id)
      }
      useScene.getState().markDirty(fenceId)
      for (const linkedFence of linkedOriginalsRef.current) {
        useScene.getState().markDirty(linkedFence.id as AnyNodeId)
      }
    }

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      const deltaX = nextStart[0] - originalStart[0]
      const deltaZ = nextStart[1] - originalStart[1]
      const nextPath = translatePath(originalPathRef.current, deltaX, deltaZ)
      previewRef.current = { start: nextStart, end: nextEnd, path: nextPath }
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])
      const previewUpdates = [
        { id: fenceId, start: nextStart, end: nextEnd, path: nextPath },
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
      const gridSnapActive = isGridSnapActive()
      const magneticSnapActive = isMagneticSnapActive()
      const [localX, localZ] = snapFenceDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        fences: levelFences,
        ignoreFenceIds: [fenceId],
        magnetic: magneticSnapActive,
        step: gridSnapActive ? getSegmentGridStep() : 0,
      })

      if (
        (gridSnapActive || magneticSnapActive) &&
        previousGridPosRef.current &&
        (localX !== previousGridPosRef.current[0] || localZ !== previousGridPosRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousGridPosRef.current = [localX, localZ]

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      const rawDeltaX = localX - anchor[0]
      const rawDeltaZ = localZ - anchor[1]
      const [deltaX, deltaZ] = canMoveFreely
        ? [rawDeltaX, rawDeltaZ]
        : constrainWallMoveDeltaToAxis(rawDeltaX, rawDeltaZ, moveAxisRef.current)

      const nextStart: [number, number] = [originalStart[0] + deltaX, originalStart[1] + deltaZ]
      const nextEnd: [number, number] = [originalEnd[0] + deltaX, originalEnd[1] + deltaZ]

      applyPreview(nextStart, nextEnd)
    }

    const onGridClick = (event: GridEvent) => {
      if (wasCommitted) return
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

      useScene.temporal.getState().resume()
      applyCommittedUpdates([
        { id: fenceId, start: preview.start, end: preview.end, path: preview.path },
        ...getLinkedFenceUpdates(
          linkedOriginalsRef.current,
          originalStart,
          originalEnd,
          preview.start,
          preview.end,
        ),
      ])
      restoreOriginal()
      useScene.temporal.getState().pause()

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      activatedAtRef.current = 0
      onGridClick({ nativeEvent: event } as unknown as GridEvent)
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      // Claim teardown ownership so the 2D overlay doesn't redundantly
      // revert the same baseline on its own cleanup. Mirrors wall's
      // move-tool cancel path.
      useEditor.getState().setMovingNodeOrigin('3d')
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      if (!wasCommitted) {
        // The 2D `FloorplanRegistryMoveOverlay` mounts in parallel with
        // this 3D tool whenever the user enters fence move mode from the
        // floor plan. When the 2D overlay commits via
        // `fenceFloorplanMoveTarget.commit()` it calls
        // `setMovingNode(null)`, which unmounts this tool. Our local
        // `wasCommitted` is still false (its own `onGridClick` never
        // ran), so a blind `restoreOriginal()` here would overwrite the
        // just-committed new positions back to the originals — the
        // "fence reverts on commit" symptom users see in the 2D view.
        // The 2D overlay sets `movingNodeOrigin = '2d'` before clearing
        // movingNode; respect that flag and skip the restore. Mirrors
        // the wall move-tool's `finalisedBy2D` guard.
        const finalisedBy2D = useEditor.getState().movingNodeOrigin === '2d'
        if (!finalisedBy2D) {
          restoreOriginal()
        }
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
    }
  }, [exitMoveMode, node, canMoveFreely])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}

export default MoveFenceTool
