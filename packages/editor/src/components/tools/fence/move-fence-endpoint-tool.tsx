'use client'

import {
  type AnyNodeId,
  type FenceNode,
  type WallNode,
  emitter,
  type GridEvent,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor, { type MovingFenceEndpoint } from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'
import { snapFenceDraftPoint, type FencePlanPoint } from './fence-drafting'
import { isWallLongEnough } from '../wall/wall-drafting'

function samePoint(a: FencePlanPoint, b: FencePlanPoint) {
  return a[0] === b[0] && a[1] === b[1]
}

type LinkedFenceSnapshot = {
  id: FenceNode['id']
  start: FencePlanPoint
  end: FencePlanPoint
}

function getLinkedFenceSnapshots(args: {
  fenceId: FenceNode['id']
  fenceParentId: string | null
  originalStart: FencePlanPoint
  originalEnd: FencePlanPoint
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
      start: [...node.start] as FencePlanPoint,
      end: [...node.end] as FencePlanPoint,
    })
  }

  return snapshots
}

function getLinkedFenceUpdates(
  linkedFences: LinkedFenceSnapshot[],
  originalStart: FencePlanPoint,
  originalEnd: FencePlanPoint,
  nextStart: FencePlanPoint,
  nextEnd: FencePlanPoint,
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

export const MoveFenceEndpointTool: React.FC<{ target: MovingFenceEndpoint }> = ({ target }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const previousGridPosRef = useRef<FencePlanPoint | null>(null)
  const shiftPressedRef = useRef(false)
  const altPressedRef = useRef(false)
  const nodeIdRef = useRef(target.fence.id)
  const originalStartRef = useRef<FencePlanPoint>([...target.fence.start] as FencePlanPoint)
  const originalEndRef = useRef<FencePlanPoint>([...target.fence.end] as FencePlanPoint)
  const fixedPointRef = useRef<FencePlanPoint>(
    target.endpoint === 'start'
      ? ([...target.fence.end] as FencePlanPoint)
      : ([...target.fence.start] as FencePlanPoint),
  )
  const linkedOriginalsRef = useRef(
    getLinkedFenceSnapshots({
      fenceId: target.fence.id,
      fenceParentId: target.fence.parentId ?? null,
      originalStart: target.fence.start,
      originalEnd: target.fence.end,
    }),
  )
  const previewRef = useRef<{ start: FencePlanPoint; end: FencePlanPoint } | null>(null)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const point = target.endpoint === 'start' ? target.fence.start : target.fence.end
    return [point[0], 0, point[1]]
  })
  const [altPressed, setAltPressed] = useState(false)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingFenceEndpoint(null)
  }, [])

  useEffect(() => {
    const nodeId = nodeIdRef.current
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current
    const fixedPoint = fixedPointRef.current
    const siblings = Object.values(useScene.getState().nodes)
    const levelWalls = siblings.filter(
      (node): node is WallNode =>
        node?.type === 'wall' && (node.parentId ?? null) === (target.fence.parentId ?? null),
    )
    const levelFences = siblings.filter(
      (node): node is FenceNode =>
        node?.type === 'fence' && (node.parentId ?? null) === (target.fence.parentId ?? null),
    )

    pauseSceneHistory(useScene)
    let wasCommitted = false

    const applyNodePreview = (
      updates: Array<{ id: FenceNode['id']; start: FencePlanPoint; end: FencePlanPoint }>,
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

    const applyPreview = (movingPoint: FencePlanPoint, detachLinkedFences = false) => {
      const nextStart = target.endpoint === 'start' ? movingPoint : fixedPoint
      const nextEnd = target.endpoint === 'end' ? movingPoint : fixedPoint
      previewRef.current = { start: nextStart, end: nextEnd }
      setCursorLocalPos([movingPoint[0], 0, movingPoint[1]])
      applyNodePreview([
        { id: nodeId, start: nextStart, end: nextEnd },
        ...(detachLinkedFences
          ? []
          : getLinkedFenceUpdates(
              linkedOriginalsRef.current,
              originalStart,
              originalEnd,
              nextStart,
              nextEnd,
            )),
      ])
    }

    const restoreOriginal = () => {
      applyNodePreview([
        { id: nodeId, start: originalStart, end: originalEnd },
        ...linkedOriginalsRef.current,
      ])
    }

    const onGridMove = (event: GridEvent) => {
      const planPoint: FencePlanPoint = [event.localPosition[0], event.localPosition[2]]
      const snappedPoint = snapFenceDraftPoint({
        point: planPoint,
        walls: levelWalls,
        fences: levelFences,
        start: fixedPoint,
        angleSnap: !shiftPressedRef.current,
        ignoreFenceIds: [nodeId],
      })

      if (
        previousGridPosRef.current &&
        (snappedPoint[0] !== previousGridPosRef.current[0] ||
          snappedPoint[1] !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }
      previousGridPosRef.current = snappedPoint

      applyPreview(snappedPoint, event.nativeEvent.altKey)
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const preview = previewRef.current ?? { start: originalStart, end: originalEnd }
      const hasChanged =
        !samePoint(preview.start, originalStart) || !samePoint(preview.end, originalEnd)

      if (hasChanged && isWallLongEnough(preview.start, preview.end)) {
        wasCommitted = true

        applyNodePreview([
          { id: nodeId, start: originalStart, end: originalEnd },
          ...linkedOriginalsRef.current,
        ])

        resumeSceneHistory(useScene)
        applyNodePreview([
          { id: nodeId, start: preview.start, end: preview.end },
          ...(altPressedRef.current
            ? []
            : getLinkedFenceUpdates(
                linkedOriginalsRef.current,
                originalStart,
                originalEnd,
                preview.start,
                preview.end,
              )),
        ])
        pauseSceneHistory(useScene)
        sfxEmitter.emit('sfx:item-place')
      }

      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      resumeSceneHistory(useScene)
      markToolCancelConsumed()
      exitMoveMode()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      if (event.key === 'Shift') {
        shiftPressedRef.current = true
      }
      if (event.key === 'Alt') {
        altPressedRef.current = true
        setAltPressed(true)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftPressedRef.current = false
      }
      if (event.key === 'Alt') {
        altPressedRef.current = false
        setAltPressed(false)
      }
    }

    const onWindowBlur = () => {
      shiftPressedRef.current = false
      altPressedRef.current = false
      setAltPressed(false)
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      if (!wasCommitted) {
        restoreOriginal()
      }
      resumeSceneHistory(useScene)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [exitMoveMode, target])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
      <Html
        position={[cursorLocalPos[0], 0, cursorLocalPos[2]]}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="translate-y-10">
          <div
            className={`whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-medium shadow-lg backdrop-blur-md transition-colors ${
              altPressed
                ? 'border-amber-500/70 bg-amber-500/15 text-amber-100'
                : 'border-border/70 bg-background/90 text-foreground/80'
            }`}
          >
            {altPressed ? 'Detach endpoint' : 'Drag endpoint'}
          </div>
        </div>
      </Html>
    </group>
  )
}
