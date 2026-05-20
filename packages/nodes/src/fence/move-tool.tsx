'use client'

import {
  type AnyNodeId,
  emitter,
  type FenceNode,
  type GridEvent,
  type LevelNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
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
import type * as THREE from 'three'

/**
 * Phase 5 Stage D — fence whole-move tool.
 *
 * Live-drag pattern: translate the fence MESH (and any linked fences
 * sharing an endpoint) via `sceneRegistry.nodes.get(id).position` +
 * `useLiveTransforms`. No `scene.update` during the drag — fence
 * geometry isn't rebuilt per tick. On commit we write the translated
 * start/end (plus the linked-fence cascade) to the scene once.
 * `GeometrySystem` resets `mesh.position` on rebuild, so the visual
 * transitions smoothly with no teleport.
 *
 * History stays UNPAUSED during the drag (we're only mutating Three.js
 * mesh transforms). The single `scene.update` on commit is the single
 * undo step.
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

function setMeshOffset(fenceId: FenceNode['id'], deltaX: number, deltaZ: number): void {
  const mesh = sceneRegistry.nodes.get(fenceId) as THREE.Object3D | undefined
  if (mesh) mesh.position.set(deltaX, 0, deltaZ)
}

function setFenceLiveTransform(fenceId: FenceNode['id'], deltaX: number, deltaZ: number): void {
  // useLiveTransforms holds the SAME delta the direct mesh.position
  // mutation uses — ParametricNodeRenderer reads it and reconciles
  // `<group position={liveTransform.position}>` via React. Mismatched
  // values here cause the two systems to fight per frame (jitter
  // during drag).
  useLiveTransforms.getState().set(fenceId, {
    position: [deltaX, 0, deltaZ],
    rotation: 0,
  })
}

export const MoveFenceTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const linkedOriginalsRef = useRef(
    getLinkedFenceSnapshots({
      fenceId: node.id,
      fenceParentId: node.parentId ?? null,
      originalStart: node.start,
      originalEnd: node.end,
    }),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const deltaRef = useRef<[number, number]>([0, 0])

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
    const linkedOriginals = linkedOriginalsRef.current

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

    let wasCommitted = false

    const applyPreview = (deltaX: number, deltaZ: number) => {
      deltaRef.current = [deltaX, deltaZ]
      setMeshOffset(fenceId, deltaX, deltaZ)
      setFenceLiveTransform(fenceId, deltaX, deltaZ)
      for (const linked of linkedOriginals) {
        setMeshOffset(linked.id, deltaX, deltaZ)
        setFenceLiveTransform(linked.id, deltaX, deltaZ)
      }
      // Cursor at translated polygon center.
      const centerX = (originalStart[0] + originalEnd[0]) / 2
      const centerZ = (originalStart[1] + originalEnd[1]) / 2
      setCursorLocalPos([centerX + deltaX, 0, centerZ + deltaZ])
    }

    const clearPreview = () => {
      setMeshOffset(fenceId, 0, 0)
      useLiveTransforms.getState().clear(fenceId)
      for (const linked of linkedOriginals) {
        setMeshOffset(linked.id, 0, 0)
        useLiveTransforms.getState().clear(linked.id)
      }
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

      applyPreview(localX - anchor[0], localZ - anchor[1])
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const [deltaX, deltaZ] = deltaRef.current
      wasCommitted = true

      if (deltaX !== 0 || deltaZ !== 0) {
        const nextStart: [number, number] = [originalStart[0] + deltaX, originalStart[1] + deltaZ]
        const nextEnd: [number, number] = [originalEnd[0] + deltaX, originalEnd[1] + deltaZ]
        const linkedUpdates = getLinkedFenceUpdates(
          linkedOriginals,
          originalStart,
          originalEnd,
          nextStart,
          nextEnd,
        )
        useScene.getState().updateNodes([
          { id: fenceId as AnyNodeId, data: { start: nextStart, end: nextEnd } },
          ...linkedUpdates.map((u) => ({
            id: u.id as AnyNodeId,
            data: { start: u.start, end: u.end },
          })),
        ])
        useScene.getState().markDirty(fenceId as AnyNodeId)
        for (const linked of linkedOriginals) {
          useScene.getState().markDirty(linked.id as AnyNodeId)
        }
      }
      // Clear useLiveTransforms but leave mesh.position — GeometrySystem
      // resets it on the rebuild next frame.
      useLiveTransforms.getState().clear(fenceId)
      for (const linked of linkedOriginals) {
        useLiveTransforms.getState().clear(linked.id)
      }

      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      clearPreview()
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        clearPreview()
      } else {
        useLiveTransforms.getState().clear(fenceId)
        for (const linked of linkedOriginals) {
          useLiveTransforms.getState().clear(linked.id)
        }
      }
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
