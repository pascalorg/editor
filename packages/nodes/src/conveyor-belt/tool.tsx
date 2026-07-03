'use client'

import {
  type AnyNodeId,
  addTransferConnectionToMetadata,
  buildDynamicCapabilityMetadata,
  createConveyorEndpointConnection,
  emitter,
  type GridEvent,
  type LevelNode,
  resolveConveyorEndpointSnap,
  snapPointToGrid,
  type TransferConnection,
  type TransferPort,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  EDITOR_LAYER,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group, Mesh, Object3D } from 'three'
import { buildConveyorBeltGeometry } from './geometry'
import { ConveyorBeltNode } from './schema'

type PlanPoint = [number, number]
type RoutePoint = [number, number, number]

const PREVIEW_Y_OFFSET = 0.04
const PREVIEW_OPACITY = 0.62

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

function routeDistance(a: PlanPoint, b: PlanPoint) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function toRoutePoints(points: PlanPoint[]): RoutePoint[] {
  return points.map(([x, z]) => [x, 0, z])
}

function snapRouteEndpoint(args: {
  point: RoutePoint
  selfPort: TransferPort
  nodes: ReturnType<typeof useScene.getState>['nodes']
}) {
  const preferredTargetPort = args.selfPort === 'in' ? 'out' : 'in'
  const snap = resolveConveyorEndpointSnap({
    point: args.point,
    nodes: args.nodes,
    preferredTargetPort,
  })
  if (!snap) return { point: args.point, connection: null }
  return {
    point: snap.point,
    connection: createConveyorEndpointConnection({
      selfNodeId: '',
      selfPort: args.selfPort,
      targetNodeId: snap.targetNodeId,
      targetPort: snap.targetPort,
    }),
  }
}

function commitConveyorBeltDrawing(levelId: LevelNode['id'], points: PlanPoint[]): string {
  const { createNode, nodes, updateNode } = useScene.getState()
  const count = Object.values(nodes).filter((node) => node.type === 'conveyor-belt').length
  const routePoints = toRoutePoints(points)
  const startSnap = snapRouteEndpoint({ point: routePoints[0]!, selfPort: 'in', nodes })
  const endSnap = snapRouteEndpoint({
    point: routePoints[routePoints.length - 1]!,
    selfPort: 'out',
    nodes,
  })
  routePoints[0] = startSnap.point
  routePoints[routePoints.length - 1] = endSnap.point
  const node = ConveyorBeltNode.parse({
    name: `Conveyor Belt ${count + 1}`,
    points: routePoints,
    metadata: {
      semanticType: 'conveyor',
      dynamicCapabilities: buildDynamicCapabilityMetadata('conveyor', 'builtin-node'),
    },
  })
  const connections = [startSnap.connection, endSnap.connection]
    .filter((connection): connection is TransferConnection => !!connection)
    .map((connection) => ({
      ...connection,
      fromNodeId: connection.fromNodeId || node.id,
      toNodeId: connection.toNodeId || node.id,
    }))
  const metadata = connections.reduce<unknown>(
    (metadata, connection) => addTransferConnectionToMetadata(metadata, connection),
    node.metadata,
  )
  const nodeWithConnections = { ...node, metadata: metadata as typeof node.metadata }
  createNode(nodeWithConnections, levelId)
  for (const connection of connections) {
    const targetId = connection.fromNodeId === node.id ? connection.toNodeId : connection.fromNodeId
    const target = nodes[targetId as AnyNodeId]
    if (!target) continue
    updateNode(target.id, {
      metadata: addTransferConnectionToMetadata(
        target.metadata,
        connection,
      ) as typeof target.metadata,
    })
  }
  triggerSFX('sfx:structure-build')
  return node.id
}

function appendPoint(points: PlanPoint[], point: PlanPoint) {
  const last = points[points.length - 1]
  if (last && routeDistance(last, point) < 0.08) return points
  return [...points, point]
}

function disposeObject(object: Object3D) {
  object.traverse((child) => {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) {
      for (const item of material) item.dispose()
    } else {
      material?.dispose()
    }
  })
}

function preparePreviewObject(object: Object3D) {
  object.traverse((child) => {
    child.layers.set(EDITOR_LAYER)
    child.raycast = () => {}
    const mesh = child as Mesh
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []
    for (const material of materials) {
      material.transparent = true
      material.opacity = PREVIEW_OPACITY
      material.depthWrite = false
    }
  })
}

export const ConveyorBeltTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)
  const [points, setPoints] = useState<PlanPoint[]>([])
  const [cursorPosition, setCursorPosition] = useState<PlanPoint>([0, 0])
  const [levelY, setLevelY] = useState(0)
  const shiftPressed = useRef(false)
  const previewPoints = useMemo(() => {
    if (points.length === 0) return []
    const draftPoints = appendPoint(points, cursorPosition)
    return draftPoints.length >= 2 ? toRoutePoints(draftPoints) : []
  }, [cursorPosition, points])
  const previewObject = useMemo(() => {
    if (previewPoints.length < 2) return null
    const node = ConveyorBeltNode.parse({
      name: 'Conveyor Belt Preview',
      points: previewPoints,
    })
    const object = buildConveyorBeltGeometry(node)
    preparePreviewObject(object)
    return object
  }, [previewPoints])

  useEffect(() => {
    return () => {
      if (previewObject) disposeObject(previewObject)
    }
  }, [previewObject])

  useEffect(() => {
    if (!currentLevelId) return

    const resolveCursor = (event?: GridEvent): PlanPoint => {
      const raw: PlanPoint = event
        ? [event.localPosition[0], event.localPosition[2]]
        : cursorPosition
      const bypassSnap = shiftPressed.current || event?.nativeEvent?.shiftKey === true
      const gridPosition: PlanPoint = bypassSnap
        ? raw
        : [...snapPointToGrid(raw, useEditor.getState().gridSnapStep)]
      const lastPoint = points[points.length - 1]
      return bypassSnap || !lastPoint ? gridPosition : calculateSnapPoint(lastPoint, gridPosition)
    }

    const finish = (withCursor: boolean) => {
      const finalPoints = withCursor ? appendPoint(points, cursorPosition) : points
      if (finalPoints.length < 2) return
      const nodeId = commitConveyorBeltDrawing(currentLevelId, finalPoints)
      setSelection({ selectedIds: [nodeId] })
      setPoints([])
    }

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return
      const next = resolveCursor(event)
      setCursorPosition(next)
      setLevelY(event.localPosition[1])
      cursorRef.current.position.set(next[0], event.localPosition[1], next[1])
    }

    const onGridClick = () => {
      setPoints((current) => appendPoint(current, cursorPosition))
    }

    const onGridDoubleClick = () => {
      finish(true)
    }

    const onCancel = () => {
      if (points.length > 0) markToolCancelConsumed()
      if (points.length >= 2) {
        finish(false)
        return
      }
      setPoints([])
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPressed.current = true
      if (event.key === 'Backspace' && points.length > 0) {
        event.preventDefault()
        setPoints((current) => current.slice(0, -1))
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        finish(true)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftPressed.current = false
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('grid:double-click', onGridDoubleClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('grid:double-click', onGridDoubleClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [currentLevelId, cursorPosition, points, setSelection])

  return (
    <group>
      <CursorSphere ref={cursorRef} />
      {previewObject ? <primitive object={previewObject} renderOrder={1} /> : null}
      {points.map(([x, z], index) => (
        <CursorSphere
          color="#a78bfa"
          height={0}
          key={`${x}:${z}:${index}`}
          position={[x, levelY + PREVIEW_Y_OFFSET, z]}
          showTooltip={false}
        />
      ))}
    </group>
  )
}

export default ConveyorBeltTool
