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
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { snapFenceDraftPoint } from './fence-drafting'
import { CursorSphere } from '../shared/cursor-sphere'

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
}) {
  const { fenceId, fenceParentId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const snapshots: LinkedFenceSnapshot[] = []

  for (const node of Object.values(nodes)) {
    if (!(node?.type === 'fence' && node.id !== fenceId)) {
      continue
    }

    if ((node.parentId ?? null) !== fenceParentId) {
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
  const linkedOriginalsRef = useRef(
    getLinkedFenceSnapshots({
      fenceId: node.id,
      fenceParentId: node.parentId ?? null,
      originalStart: node.start,
      originalEnd: node.end,
    }),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const nodeIdRef = useRef(node.id)
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
    const nodeId = nodeIdRef.current
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

    const setMeshOffset = (fenceId: FenceNode['id'], deltaX: number, deltaZ: number) => {
      const mesh = sceneRegistry.nodes.get(fenceId) as THREE.Object3D | undefined
      if (!mesh) {
        return
      }

      mesh.position.set(deltaX, 0, deltaZ)
    }

    const setFenceLiveTransform = (fence: FenceNode, deltaX: number, deltaZ: number) => {
      const originalCenterX = (fence.start[0] + fence.end[0]) / 2
      const originalCenterZ = (fence.start[1] + fence.end[1]) / 2
      useLiveTransforms.getState().set(fence.id, {
        position: [originalCenterX + deltaX, 0, originalCenterZ + deltaZ],
        rotation: 0,
      })
    }

    const clearPreviewState = () => {
      setMeshOffset(nodeId, 0, 0)
      useLiveTransforms.getState().clear(nodeId)

      for (const linkedFence of linkedOriginalsRef.current) {
        setMeshOffset(linkedFence.id, 0, 0)
        useLiveTransforms.getState().clear(linkedFence.id)
      }
    }

    const applyNodePreview = (updates: Array<{ id: FenceNode['id']; start: [number, number]; end: [number, number] }>) => {
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

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      previewRef.current = { start: nextStart, end: nextEnd }
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])
      const deltaX = nextStart[0] - originalStart[0]
      const deltaZ = nextStart[1] - originalStart[1]
      setMeshOffset(nodeId, deltaX, deltaZ)
      setFenceLiveTransform(node, deltaX, deltaZ)

      for (const linkedFence of linkedOriginalsRef.current) {
        setMeshOffset(linkedFence.id, deltaX, deltaZ)
        setFenceLiveTransform(
          {
            ...node,
            id: linkedFence.id,
            start: linkedFence.start,
            end: linkedFence.end,
          },
          deltaX,
          deltaZ,
        )
      }
    }

    const onGridMove = (event: GridEvent) => {
      const [localX, localZ] = snapFenceDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls: levelWalls,
        fences: levelFences,
        ignoreFenceIds: [nodeId],
      })

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

      const nextStart: [number, number] = [originalStart[0] + deltaX, originalStart[1] + deltaZ]
      const nextEnd: [number, number] = [originalEnd[0] + deltaX, originalEnd[1] + deltaZ]

      applyPreview(nextStart, nextEnd)
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }

      wasCommitted = true

      useScene.temporal.getState().resume()
      applyNodePreview([
        { id: nodeId, start: preview.start, end: preview.end },
        ...getLinkedFenceUpdates(
          linkedOriginalsRef.current,
          originalStart,
          originalEnd,
          preview.start,
          preview.end,
        ),
      ])
      useLiveTransforms.getState().clear(nodeId)
      for (const linkedFence of linkedOriginalsRef.current) {
        useLiveTransforms.getState().clear(linkedFence.id)
      }
      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      clearPreviewState()
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        clearPreviewState()
      } else {
        useLiveTransforms.getState().clear(nodeId)
        for (const linkedFence of linkedOriginalsRef.current) {
          useLiveTransforms.getState().clear(linkedFence.id)
        }
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
