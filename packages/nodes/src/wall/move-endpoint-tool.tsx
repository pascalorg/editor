'use client'

import { type GridEvent, useScene, type WallNode } from '@pascal-app/core'
import {
  CursorSphere,
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
  type MovingWallEndpoint,
  triggerSFX,
  useDragAction,
  useEditor,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Html } from '@react-three/drei'
import { useCallback, useEffect, useState } from 'react'
import { moveWallEndpointDragAction } from './actions/move-endpoint'

type WallSegmentLike = {
  id: WallNode['id']
  start: [number, number]
  end: [number, number]
  curveOffset?: number
}

type AngleLabelState = {
  label: string
  position: [number, number, number]
} | null

function getEndpointAngleLabel(args: {
  preview: { start: [number, number]; end: [number, number]; curveOffset?: number }
  walls: WallSegmentLike[]
  nodeId: WallNode['id']
}): AngleLabelState {
  const { preview, walls, nodeId } = args
  const endpoints = [{ point: preview.start }, { point: preview.end }]
  const targetSegment: WallSegmentLike = {
    id: nodeId,
    start: preview.start,
    end: preview.end,
    curveOffset: preview.curveOffset,
  }

  for (const endpoint of endpoints) {
    const targetReference = getSegmentAngleReferenceAtPoint(endpoint.point, targetSegment)
    if (!targetReference) continue

    const connectedWall = walls.find(
      (wall) =>
        wall.id !== nodeId && Boolean(getSegmentAngleReferenceAtPoint(endpoint.point, wall)),
    )
    if (!connectedWall) continue

    const connectedReference = getSegmentAngleReferenceAtPoint(endpoint.point, connectedWall)
    if (!connectedReference) continue

    const angle = getAngleToSegmentReference(targetReference.vector, connectedReference)
    if (angle === null) continue

    return {
      label: formatAngleRadians(angle),
      position: [endpoint.point[0], 0.34, endpoint.point[1]],
    }
  }

  return null
}

export const MoveWallEndpointTool: React.FC<{ target: MovingWallEndpoint }> = ({ target }) => {
  const wallId = target.wall.id
  const endpoint = target.endpoint
  const initialPoint: [number, number] =
    endpoint === 'start'
      ? [target.wall.start[0], target.wall.start[1]]
      : [target.wall.end[0], target.wall.end[1]]

  const [altPressed, setAltPressed] = useState(false)
  const [angleLabel, setAngleLabel] = useState<AngleLabelState>(null)
  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>([
    initialPoint[0],
    0,
    initialPoint[1],
  ])

  const exitMoveMode = useCallback(
    (committed: boolean) => {
      if (committed) triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [wallId] })
      useEditor.getState().setMovingWallEndpoint(null)
      useEditor.getState().setActiveAffordance(null)
      setAngleLabel(null)
    },
    [wallId],
  )

  const handleMove = useCallback(
    (event: GridEvent) => {
      const wall = useScene.getState().nodes[wallId]
      if (wall?.type !== 'wall') return
      const live = wall as WallNode
      const movingPoint = endpoint === 'start' ? live.start : live.end
      setCursorLocalPos([movingPoint[0], 0, movingPoint[1]])

      const levelWalls = Object.values(useScene.getState().nodes).filter(
        (node): node is WallNode =>
          node?.type === 'wall' && (node.parentId ?? null) === (live.parentId ?? null),
      )
      setAngleLabel(
        getEndpointAngleLabel({
          preview: {
            start: live.start,
            end: live.end,
            curveOffset: live.curveOffset,
          },
          walls: levelWalls.map((entry) => ({
            id: entry.id,
            start: entry.start,
            end: entry.end,
            curveOffset: entry.curveOffset,
          })),
          nodeId: wallId,
        }),
      )

      if (event.nativeEvent?.altKey !== undefined) {
        setAltPressed(event.nativeEvent.altKey)
      }
    },
    [endpoint, wallId],
  )

  useDragAction({
    active: true,
    action: moveWallEndpointDragAction,
    activationGraceMs: 0,
    initial: {
      node: target.wall,
      handleId: endpoint,
      point: initialPoint,
    },
    onMove: handleMove,
    onCommit: () => exitMoveMode(true),
    onCancel: () => exitMoveMode(false),
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Alt') setAltPressed(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltPressed(false)
    }
    const onBlur = () => setAltPressed(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

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
            className={`whitespace-nowrap rounded-full border px-2 py-1 font-medium text-[11px] shadow-lg backdrop-blur-md transition-colors ${
              altPressed
                ? 'border-amber-500/80 bg-amber-500/15 text-amber-100'
                : 'border-border bg-background/95 text-muted-foreground'
            }`}
          >
            {altPressed ? 'Detaching corner' : 'Alt to detach'}
          </div>
        </div>
      </Html>
      {angleLabel && <EndpointAngleLabel label={angleLabel.label} position={angleLabel.position} />}
    </group>
  )
}

function EndpointAngleLabel({
  label,
  position,
}: {
  label: string
  position: [number, number, number]
}) {
  return (
    <Html center position={position} style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
      <div className="whitespace-nowrap rounded-full border border-border bg-background/95 px-2 py-1 font-mono font-semibold text-[11px] text-foreground shadow-lg backdrop-blur-md">
        {label}
      </div>
    </Html>
  )
}

export default MoveWallEndpointTool
