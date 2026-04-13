'use client'

import { type FenceNode, emitter, type GridEvent, useLiveFenceSegments, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

function snap(value: number) {
  return Math.round(value * 2) / 2
}

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
  originalStart: [number, number]
  originalEnd: [number, number]
}) {
  const { fenceId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const snapshots: LinkedFenceSnapshot[] = []

  for (const node of Object.values(nodes)) {
    if (!(node?.type === 'fence' && node.id !== fenceId)) {
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
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const linkedOriginalsRef = useRef(
    getLinkedFenceSnapshots({
      fenceId: node.id,
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
    const { updateNode } = useScene.getState()
    const liveSegments = useLiveFenceSegments.getState()

    useScene.temporal.getState().pause()
    let wasCommitted = false

    const applyPreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      previewRef.current = { start: nextStart, end: nextEnd }
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])
      liveSegments.set(nodeId, { start: nextStart, end: nextEnd })
      updateNode(nodeId, { start: nextStart, end: nextEnd })

      for (const linkedFence of getLinkedFenceUpdates(
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        nextStart,
        nextEnd,
      )) {
        liveSegments.set(linkedFence.id, {
          start: linkedFence.start,
          end: linkedFence.end,
        })
        updateNode(linkedFence.id, {
          start: linkedFence.start,
          end: linkedFence.end,
        })
      }
    }

    const onGridMove = (event: GridEvent) => {
      const localX = snap(event.localPosition[0])
      const localZ = snap(event.localPosition[2])

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
      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }

      wasCommitted = true
      useScene.temporal.getState().resume()
      updateNode(nodeId, { start: preview.start, end: preview.end })
      for (const linkedFence of getLinkedFenceUpdates(
        linkedOriginalsRef.current,
        originalStart,
        originalEnd,
        preview.start,
        preview.end,
      )) {
        updateNode(linkedFence.id, {
          start: linkedFence.start,
          end: linkedFence.end,
        })
      }
      liveSegments.clear(nodeId)
      for (const linkedFence of linkedOriginalsRef.current) {
        liveSegments.clear(linkedFence.id)
      }
      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      liveSegments.clear(nodeId)
      updateNode(nodeId, { start: originalStart, end: originalEnd })
      for (const linkedFence of linkedOriginalsRef.current) {
        liveSegments.clear(linkedFence.id)
        updateNode(linkedFence.id, {
          start: linkedFence.start,
          end: linkedFence.end,
        })
      }
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
        liveSegments.clear(nodeId)
        updateNode(nodeId, { start: originalStart, end: originalEnd })
        for (const linkedFence of linkedOriginalsRef.current) {
          liveSegments.clear(linkedFence.id)
          updateNode(linkedFence.id, {
            start: linkedFence.start,
            end: linkedFence.end,
          })
        }
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [exitMoveMode])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}
