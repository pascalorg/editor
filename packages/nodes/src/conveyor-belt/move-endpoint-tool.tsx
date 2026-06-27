'use client'

import {
  addTransferConnectionToMetadata,
  type AnyNode,
  type AnyNodeId,
  createConveyorEndpointConnection,
  emitter,
  type GridEvent,
  pauseSceneHistory,
  removeTransferConnectionsFromMetadata,
  resolveConveyorEndpointSnap,
  resumeSceneHistory,
  snapPointToGrid,
  type TransferPort,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  type MovingConveyorBeltEndpoint,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useEffect, useRef, useState } from 'react'
import { addConnectionToPeerNode, removeMovingEndpointConnectionsFromPeers } from './connection-sync'
import type { ConveyorBeltNode } from './schema'

type RoutePoint = [number, number, number]
type PlanPoint = [number, number]
type SnapTargetPreview = {
  position: RoutePoint
  label: string
}
type PeerMetadataSnapshot = Map<AnyNodeId, ConveyorBeltNode['metadata']>

function endpointPort(endpoint: 'start' | 'end'): TransferPort {
  return endpoint === 'start' ? 'in' : 'out'
}

function updateEndpoint(
  points: Array<RoutePoint>,
  endpoint: 'start' | 'end',
  point: RoutePoint,
) {
  const next = points.map((entry) => [...entry] as RoutePoint)
  if (endpoint === 'start') next[0] = point
  else next[next.length - 1] = point
  return next
}

function calculateSnapPoint(lastPoint: PlanPoint, currentPoint: PlanPoint): PlanPoint {
  const [x1, z1] = lastPoint
  const [x, z] = currentPoint
  const dx = x - x1
  const dz = z - z1
  const absDx = Math.abs(dx)
  const absDz = Math.abs(dz)
  const diagonalDist = Math.abs(absDx - absDz)
  const horizontalDist = absDz
  const verticalDist = absDx
  const minDist = Math.min(horizontalDist, verticalDist, diagonalDist)
  if (minDist === diagonalDist) {
    const diagonalLength = Math.min(absDx, absDz)
    return [x1 + Math.sign(dx) * diagonalLength, z1 + Math.sign(dz) * diagonalLength]
  }
  if (minDist === horizontalDist) return [x, z1]
  return [x1, z]
}

function endpointPosition(node: ConveyorBeltNode, endpoint: 'start' | 'end'): RoutePoint {
  const point = endpoint === 'start' ? node.points[0] : node.points[node.points.length - 1]
  return point ? [point[0], point[1], point[2]] : [0, 0, 0]
}

function adjacentPoint(node: ConveyorBeltNode, endpoint: 'start' | 'end'): RoutePoint {
  const point = endpoint === 'start' ? node.points[1] : node.points[node.points.length - 2]
  return point ? [point[0], point[1], point[2]] : endpointPosition(node, endpoint)
}

function isValidRoute(node: ConveyorBeltNode) {
  const first = node.points[0]
  const last = node.points[node.points.length - 1]
  return !!(first && last && Math.hypot(last[0] - first[0], last[2] - first[2]) > 0.1)
}

export const MoveConveyorBeltEndpointTool: React.FC<{
  target: MovingConveyorBeltEndpoint
}> = ({ target }) => {
  const conveyorBeltId = target.conveyorBelt.id
  const endpoint = target.endpoint
  const initial = endpointPosition(target.conveyorBelt, endpoint)
  const [cursorLocalPos, setCursorLocalPos] = useState<RoutePoint>([
    initial[0],
    target.conveyorBelt.elevation + target.conveyorBelt.thickness + 0.2,
    initial[2],
  ])
  const [altPressed, setAltPressed] = useState(false)
  const [snapTarget, setSnapTarget] = useState<SnapTargetPreview | null>(null)
  const originalPointsRef = useRef<Array<RoutePoint>>(target.conveyorBelt.points.map((point) => [...point] as RoutePoint))
  const originalMetadataRef = useRef(target.conveyorBelt.metadata)
  const previewRef = useRef<{ points: Array<RoutePoint>; metadata: ConveyorBeltNode['metadata'] } | null>(null)
  const previousPointRef = useRef<PlanPoint | null>(null)
  const shiftPressedRef = useRef(false)

  const exitMoveMode = useCallback(
    (committed: boolean) => {
      if (committed) triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [conveyorBeltId] })
      useEditor.getState().setMovingConveyorBeltEndpoint(null)
    },
    [conveyorBeltId],
  )

  useEffect(() => {
    const originalPoints = originalPointsRef.current
    const originalMetadata = originalMetadataRef.current
    const fixed = adjacentPoint(target.conveyorBelt, endpoint)
    const fixedPlan: PlanPoint = [fixed[0], fixed[2]]
    const port = endpointPort(endpoint)
    const originalPeerMetadata: PeerMetadataSnapshot = new Map()
    for (const node of Object.values(useScene.getState().nodes)) {
      if (node.id === conveyorBeltId) continue
      originalPeerMetadata.set(node.id, node.metadata as ConveyorBeltNode['metadata'])
    }

    pauseSceneHistory(useScene)
    let committed = false

    const restoreOriginalPeers = () => {
      const scene = useScene.getState()
      for (const [id, metadata] of originalPeerMetadata) {
        const node = scene.nodes[id]
        if (!node) continue
        scene.updateNode(id, { metadata } as Partial<AnyNode>)
        scene.markDirty(id)
      }
    }

    const restoreOriginal = () => {
      useScene.getState().updateNode(conveyorBeltId, {
        points: originalPoints,
        metadata: originalMetadata,
      })
      useScene.getState().markDirty(conveyorBeltId as AnyNodeId)
    }

    const applyPreview = (event: GridEvent) => {
      const scene = useScene.getState()
      const raw: PlanPoint = [event.localPosition[0], event.localPosition[2]]
      const bypassSnap = shiftPressedRef.current || event.nativeEvent?.shiftKey === true
      const gridPoint = bypassSnap
        ? raw
        : ([...snapPointToGrid(raw, useEditor.getState().gridSnapStep)] as PlanPoint)
      const snappedPlan = bypassSnap ? gridPoint : calculateSnapPoint(fixedPlan, gridPoint)
      let routePoint: RoutePoint = [snappedPlan[0], 0, snappedPlan[1]]
      let metadata = removeTransferConnectionsFromMetadata(originalMetadata, {
        nodeId: conveyorBeltId,
        port,
      })
      const detach = event.nativeEvent?.altKey === true
      let nextSnapTarget: SnapTargetPreview | null = null
      removeMovingEndpointConnectionsFromPeers({
        nodes: scene.nodes as Record<string, AnyNode>,
        movingNodeId: conveyorBeltId,
        movingPort: port,
        updateNode: scene.updateNode,
        markDirty: scene.markDirty,
      })

      if (!detach) {
        const snap = resolveConveyorEndpointSnap({
          point: routePoint,
          nodes: scene.nodes as Record<string, AnyNode>,
          selfId: conveyorBeltId,
          preferredTargetPort: port === 'in' ? 'out' : 'in',
        })
        if (snap) {
          const targetNode = scene.nodes[snap.targetNodeId] as ConveyorBeltNode | undefined
          routePoint = snap.point
          nextSnapTarget = {
            position: [
              snap.point[0],
              (targetNode?.elevation ?? target.conveyorBelt.elevation) +
                (targetNode?.thickness ?? target.conveyorBelt.thickness) +
                snap.point[1] +
                0.24,
              snap.point[2],
            ],
            label: targetNode?.name || '\u76ee\u6807\u7aef\u70b9',
          }
          const connection = createConveyorEndpointConnection({
            selfNodeId: conveyorBeltId,
            selfPort: port,
            targetNodeId: snap.targetNodeId,
            targetPort: snap.targetPort,
          })
          metadata = addTransferConnectionToMetadata(metadata, connection)
          addConnectionToPeerNode({
            nodes: useScene.getState().nodes as Record<string, AnyNode>,
            selfNodeId: conveyorBeltId,
            connection,
            updateNode: scene.updateNode,
            markDirty: scene.markDirty,
          })
        }
      }

      const points = updateEndpoint(originalPoints, endpoint, routePoint)
      previewRef.current = { points, metadata: metadata as ConveyorBeltNode['metadata'] }
      setSnapTarget(nextSnapTarget)
      setCursorLocalPos([
        routePoint[0],
        target.conveyorBelt.elevation + target.conveyorBelt.thickness + 0.2,
        routePoint[2],
      ])
      if (
        previousPointRef.current &&
        (snappedPlan[0] !== previousPointRef.current[0] || snappedPlan[1] !== previousPointRef.current[1])
      ) {
        triggerSFX('sfx:grid-snap')
      }
      previousPointRef.current = snappedPlan
      scene.updateNode(conveyorBeltId, {
        points,
        metadata: metadata as ConveyorBeltNode['metadata'],
      })
      scene.markDirty(conveyorBeltId as AnyNodeId)
    }

    const commitAtCursor = () => {
      if (committed) return
      const preview = previewRef.current
      const live = useScene.getState().nodes[conveyorBeltId as AnyNodeId] as ConveyorBeltNode | undefined
      if (!(preview && live && live.type === 'conveyor-belt' && isValidRoute(live))) {
        exitMoveMode(false)
        return
      }
      const finalPeerMetadata: PeerMetadataSnapshot = new Map()
      for (const [id] of originalPeerMetadata) {
        const node = useScene.getState().nodes[id]
        if (node) finalPeerMetadata.set(id, node.metadata as ConveyorBeltNode['metadata'])
      }
      restoreOriginal()
      restoreOriginalPeers()
      resumeSceneHistory(useScene)
      useScene.getState().updateNode(conveyorBeltId, {
        points: preview.points,
        metadata: preview.metadata,
      })
      useScene.getState().markDirty(conveyorBeltId as AnyNodeId)
      for (const [id, metadata] of finalPeerMetadata) {
        const node = useScene.getState().nodes[id]
        if (!node) continue
        useScene.getState().updateNode(id, { metadata } as Partial<AnyNode>)
        useScene.getState().markDirty(id)
      }
      pauseSceneHistory(useScene)
      committed = true
      exitMoveMode(true)
    }

    const onGridMove = (event: GridEvent) => {
      setAltPressed(event.nativeEvent?.altKey === true)
      applyPreview(event)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      commitAtCursor()
    }

    const onCancel = () => {
      setSnapTarget(null)
      restoreOriginal()
      restoreOriginalPeers()
      resumeSceneHistory(useScene)
      markToolCancelConsumed()
      exitMoveMode(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPressedRef.current = true
      if (event.key === 'Alt') setAltPressed(true)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPressedRef.current = false
      if (event.key === 'Alt') setAltPressed(false)
    }

    emitter.on('grid:move', onGridMove)
    window.addEventListener('pointerup', onPointerUp)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      emitter.off('grid:move', onGridMove)
      window.removeEventListener('pointerup', onPointerUp)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (!committed) {
        restoreOriginal()
        restoreOriginalPeers()
      }
      resumeSceneHistory(useScene)
    }
  }, [conveyorBeltId, endpoint, exitMoveMode, target.conveyorBelt])

  return (
    <group>
      <CursorSphere color="#a78bfa" position={cursorLocalPos} showTooltip={false} />
      {snapTarget ? (
        <>
          <CursorSphere
            color="#22c55e"
            height={0.5}
            position={snapTarget.position}
            showTooltip={false}
          />
          <Html
            center
            position={[snapTarget.position[0], snapTarget.position[1] + 0.62, snapTarget.position[2]]}
            style={{ pointerEvents: 'none', touchAction: 'none' }}
            zIndexRange={[110, 0]}
          >
            <div className="whitespace-nowrap rounded-full border border-emerald-400/70 bg-emerald-500/20 px-2 py-1 font-medium text-[11px] text-emerald-50 shadow-lg backdrop-blur-md">
              {'\u5c06\u5438\u9644\u5230'} {snapTarget.label}
            </div>
          </Html>
        </>
      ) : null}
      <Html
        position={cursorLocalPos}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="translate-y-10">
          <div
            className={`whitespace-nowrap rounded-full border px-2 py-1 font-medium text-[11px] shadow-lg backdrop-blur-md transition-colors ${
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

export default MoveConveyorBeltEndpointTool
