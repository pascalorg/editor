'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  type ColumnNode,
  type ElevatorNode,
  emitter,
  type FenceNode,
  type GridEvent,
  getFenceCenterlineLength,
  getScaledDimensions,
  getWallCurveLength,
  type ItemNode,
  type NodeEvent,
  type SlabNode,
  sceneRegistry,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Box3, BoxGeometry, BufferGeometry, Quaternion, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import {
  collectCommittedMeasurementSnapGeometry,
  collectPlanMeasurementSnapGeometry,
  type MeasurementSnapAnchor,
  measurementSnapKindFromLabel,
  mergeMeasurementSnapGeometry,
  resolvePlanMeasurementConstraint,
  resolvePlanMeasurementSnap,
} from '../../../lib/measurement-snapping'
import {
  angleBetweenMeasurements,
  formatAngleMeasurement,
  formatAreaMeasurement,
  formatLinearMeasurement,
} from '../../../lib/measurements'
import { cn } from '../../../lib/utils'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  axisLockedMeasurementPoint,
  distanceBetweenMeasurements,
  isDraggingMeasurementEndpoint,
  type MeasurementAngle,
  type MeasurementArea,
  type MeasurementPerimeter,
  type MeasurementPoint,
  type MeasurementSegment,
  type MeasurementSegmentEndpoint,
  type MeasurementSnapTarget,
  useMeasurementTool,
} from '../../../store/use-measurement-tool'

const MEASUREMENT_COLOR = 0x0e_a5_e9
const MEASUREMENT_DRAFT_COLOR = 0xf5_9e_0b
const MEASUREMENT_LINE_WIDTH = 0.018
const MEASUREMENT_END_TICK = 0.28
const MEASUREMENT_LABEL_LIFT = 0.08
const MEASUREMENT_CURSOR_SIZE = 0.18
const MEASUREMENT_CURSOR_WIDTH = 0.018
const MEASUREMENT_SNAP_LABEL_LIFT = 0.42
const MEASUREMENT_ENDPOINT_HANDLE_SIZE = 0.16
const MEASUREMENT_ENDPOINT_HANDLE_HIT_SIZE = 0.34
const MEASUREMENT_LABEL_COLLISION_CELL = 0.45
const MEASUREMENT_LABEL_STAGGER_STEP = 0.22
const MEASUREMENT_SURFACE_SNAP_RADIUS = 0.25
const MEASUREMENT_GRID_SNAP_RADIUS = 0.25
const MEASUREMENT_NODE_SNAP_PRIORITY_BUCKET = 1_000
const MEASUREMENT_PLAN_SNAP_Y_TOLERANCE = 1e-5
const SURFACE_EVENT_SUPPRESSION_MS = 80

const dashGeometry = new BoxGeometry(1, 1, 1)
const MEASUREMENT_BAR_AXIS = new Vector3(1, 0, 0)
const measurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.95,
  toneMapped: false,
  transparent: true,
})
const mutedMeasurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.38,
  toneMapped: false,
  transparent: true,
})
const draftMeasurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_DRAFT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.98,
  toneMapped: false,
  transparent: true,
})
const endpointHandleHitMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_DRAFT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
  toneMapped: false,
  transparent: true,
})

const MEASURABLE_NODE_KINDS = [
  'wall',
  'fence',
  'item',
  'column',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'window',
  'door',
  'stair',
  'stair-segment',
  'shelf',
  'spawn',
  'elevator',
] as const

function isCanvasEvent(event: GridEvent, canvas: HTMLCanvasElement): boolean {
  return event.nativeEvent?.target === canvas
}

function measurementPointFromGridEvent(event: GridEvent): MeasurementPoint {
  return [...event.localPosition] as MeasurementPoint
}

function resolveGridMeasurementSnap3D(point: MeasurementPoint): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  if (Math.abs(point[1]) > MEASUREMENT_PLAN_SNAP_Y_TOLERANCE) {
    return { point, target: null }
  }

  return resolvePlanMeasurementSnap(
    point,
    mergeMeasurementSnapGeometry(
      collectPlanMeasurementSnapGeometry(Object.values(useScene.getState().nodes)),
      collectCommittedMeasurementSnapGeometry(useMeasurementTool.getState().segments, '3d'),
    ),
    {
      enabledSnapKinds: useMeasurementTool.getState().enabledSnapKinds,
      radiusMeters: MEASUREMENT_GRID_SNAP_RADIUS,
      view: '3d',
    },
  )
}

function resolveGridMeasurementConstraint3D(
  start: MeasurementPoint,
  point: MeasurementPoint,
): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  return resolvePlanMeasurementConstraint(
    start,
    point,
    mergeMeasurementSnapGeometry(
      collectPlanMeasurementSnapGeometry(Object.values(useScene.getState().nodes)),
      collectCommittedMeasurementSnapGeometry(useMeasurementTool.getState().segments, '3d'),
    ),
    {
      enabledSnapKinds: useMeasurementTool.getState().enabledSnapKinds,
      radiusMeters: MEASUREMENT_GRID_SNAP_RADIUS,
      view: '3d',
    },
  )
}

function worldToBuildingLocal(point: [number, number, number]): MeasurementPoint {
  const buildingId = useViewer.getState().selection.buildingId
  const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
  const local = buildingMesh
    ? buildingMesh.worldToLocal(new Vector3(...point))
    : new Vector3(...point)
  return [local.x, local.y, local.z]
}

function measurementPointFromNodeEvent(event: NodeEvent): MeasurementPoint {
  return worldToBuildingLocal(event.position)
}

function measurementNormalFromNodeEvent(event: NodeEvent): MeasurementPoint | null {
  if (!event.normal) return null
  const localNormal = new Vector3(...event.normal).normalize()
  if (localNormal.lengthSq() < 1e-8) return null

  const worldOrigin = event.object.localToWorld(new Vector3(0, 0, 0))
  const worldNormalPoint = event.object.localToWorld(localNormal.clone())
  const localOrigin = worldToBuildingLocal([worldOrigin.x, worldOrigin.y, worldOrigin.z])
  const localNormalPoint = worldToBuildingLocal([
    worldNormalPoint.x,
    worldNormalPoint.y,
    worldNormalPoint.z,
  ])
  const normal = new Vector3(
    localNormalPoint[0] - localOrigin[0],
    localNormalPoint[1] - localOrigin[1],
    localNormalPoint[2] - localOrigin[2],
  ).normalize()
  if (normal.lengthSq() < 1e-8) return null
  return [normal.x, normal.y, normal.z]
}

function resolveSurfaceDistanceEndpoint(
  start: MeasurementPoint,
  startNormal: MeasurementPoint | undefined,
  endPoint: MeasurementPoint,
  endNormal: MeasurementPoint | null,
): { end: MeasurementPoint; measuredDistanceMeters: number } | null {
  if (!(startNormal && endNormal)) return null
  const startN = new Vector3(...startNormal).normalize()
  const endN = new Vector3(...endNormal).normalize()
  if (Math.abs(startN.dot(endN)) < 0.94) return null

  const delta = new Vector3(endPoint[0] - start[0], endPoint[1] - start[1], endPoint[2] - start[2])
  const signedDistance = delta.dot(startN)
  if (Math.abs(signedDistance) < 1e-4) return null
  const end = startN.multiplyScalar(signedDistance).add(new Vector3(...start))
  return {
    end: [end.x, end.y, end.z],
    measuredDistanceMeters: Math.abs(signedDistance),
  }
}

function nodeLocalToMeasurementPoint(node: AnyNode, point: Vector3): MeasurementPoint | null {
  const object = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!object) return null
  const worldPoint = object.localToWorld(point.clone())
  return worldToBuildingLocal([worldPoint.x, worldPoint.y, worldPoint.z])
}

function wallLengthSegment(node: WallNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} {
  return {
    start: [node.start[0], 0, node.start[1]],
    end: [node.end[0], 0, node.end[1]],
    measuredDistanceMeters: getWallCurveLength(node),
  }
}

function fenceLengthSegment(node: FenceNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} {
  return {
    start: [node.start[0], 0, node.start[1]],
    end: [node.end[0], 0, node.end[1]],
    measuredDistanceMeters: getFenceCenterlineLength(node),
  }
}

function horizontalBoxLengthSegment(
  node: AnyNode,
  dimensions: readonly [number, number, number],
): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  const [width, , depth] = dimensions
  const measureWidth = width >= depth
  const halfLength = (measureWidth ? width : depth) / 2
  if (halfLength < 1e-4) return null

  const start = nodeLocalToMeasurementPoint(
    node,
    measureWidth ? new Vector3(-halfLength, 0, 0) : new Vector3(0, 0, -halfLength),
  )
  const end = nodeLocalToMeasurementPoint(
    node,
    measureWidth ? new Vector3(halfLength, 0, 0) : new Vector3(0, 0, halfLength),
  )
  if (!(start && end)) return null

  return {
    start,
    end,
    measuredDistanceMeters: halfLength * 2,
  }
}

function directLengthSegmentFromNode(node: AnyNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  if (node.type === 'wall') return wallLengthSegment(node as WallNode)
  if (node.type === 'fence') return fenceLengthSegment(node as FenceNode)
  if (node.type === 'item')
    return horizontalBoxLengthSegment(node, getScaledDimensions(node as ItemNode))
  if (node.type === 'column') {
    const column = node as ColumnNode
    return horizontalBoxLengthSegment(node, [column.width, column.height, column.depth])
  }
  if (node.type === 'elevator') {
    const elevator = node as ElevatorNode
    return horizontalBoxLengthSegment(node, [
      elevator.shaftWidth ?? elevator.width,
      elevator.cabHeight,
      elevator.shaftDepth ?? elevator.depth,
    ])
  }
  return null
}

function polygonAreaAndCentroid(polygon: ReadonlyArray<readonly [number, number]>): {
  area: number
  centroid: { x: number; y: number }
} {
  let cx = 0
  let cy = 0
  let area = 0

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p1 = polygon[j]!
    const p2 = polygon[i]!
    const f = p1[0] * p2[1] - p2[0] * p1[1]
    cx += (p1[0] + p2[0]) * f
    cy += (p1[1] + p2[1]) * f
    area += f
  }

  area /= 2

  if (Math.abs(area) < 1e-9) {
    const fallback = polygon[0] ?? [0, 0]
    return { area: 0, centroid: { x: fallback[0], y: fallback[1] } }
  }

  return {
    area: Math.abs(area),
    centroid: { x: cx / (6 * area), y: cy / (6 * area) },
  }
}

function surfaceAreaMeasurementFromNode(node: AnyNode): {
  areaSquareMeters: number
  labelPoint: MeasurementPoint
} | null {
  if (!(node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone')) return null

  const surface = node as SlabNode | CeilingNode | ZoneNode
  const outer = polygonAreaAndCentroid(surface.polygon)
  const holes = 'holes' in surface ? surface.holes : []
  const holesArea = holes.reduce((sum, hole) => sum + polygonAreaAndCentroid(hole).area, 0)
  const labelY =
    surface.type === 'ceiling' ? surface.height : surface.type === 'slab' ? surface.elevation : 0

  return {
    areaSquareMeters: Math.max(0, outer.area - holesArea),
    labelPoint: [outer.centroid.x, labelY + 0.05, outer.centroid.y],
  }
}

function polygonPerimeter(polygon: ReadonlyArray<readonly [number, number]>): number {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1])
  }, 0)
}

function surfacePerimeterMeasurementFromNode(node: AnyNode): {
  labelPoint: MeasurementPoint
  lengthMeters: number
} | null {
  if (!(node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone')) return null

  const surface = node as SlabNode | CeilingNode | ZoneNode
  const outer = polygonAreaAndCentroid(surface.polygon)
  const holes = 'holes' in surface ? surface.holes : []
  const holesLength = holes.reduce((sum, hole) => sum + polygonPerimeter(hole), 0)
  const labelY =
    surface.type === 'ceiling' ? surface.height : surface.type === 'slab' ? surface.elevation : 0

  return {
    labelPoint: [outer.centroid.x, labelY + 0.05, outer.centroid.y],
    lengthMeters: polygonPerimeter(surface.polygon) + holesLength,
  }
}

function squaredMeasurementDistance(a: MeasurementPoint, b: MeasurementPoint): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

function projectVectorToSegment(point: Vector3, start: Vector3, end: Vector3): Vector3 | null {
  const direction = end.clone().sub(start)
  const lengthSq = direction.lengthSq()
  if (lengthSq < 1e-8) return null
  const t = Math.min(1, Math.max(0, point.clone().sub(start).dot(direction) / lengthSq))
  return start.clone().add(direction.multiplyScalar(t))
}

function measurementPointFromObjectLocalPoint(
  object: NodeEvent['object'],
  point: Vector3,
): MeasurementPoint {
  const worldPoint = object.localToWorld(point.clone())
  return worldToBuildingLocal([worldPoint.x, worldPoint.y, worldPoint.z])
}

function isBufferGeometry(value: unknown): value is BufferGeometry {
  return value instanceof BufferGeometry
}

type MeshSnapCandidate = {
  kind: 'center' | 'edge' | 'vertex'
  label: string
  localPoint: Vector3
  priority: number
}

function meshSnapCandidatesFromEvent(event: NodeEvent): MeshSnapCandidate[] {
  const geometry = (event.object as { geometry?: unknown }).geometry
  if (!isBufferGeometry(geometry)) return []

  const position = geometry.getAttribute('position')
  const faceIndex = event.faceIndex
  if (!position || typeof faceIndex !== 'number') return []

  const readVertexIndex = (triangleCorner: 0 | 1 | 2) =>
    geometry.index
      ? geometry.index.getX(faceIndex * 3 + triangleCorner)
      : faceIndex * 3 + triangleCorner
  const readVertex = (triangleCorner: 0 | 1 | 2) =>
    new Vector3().fromBufferAttribute(position, readVertexIndex(triangleCorner))
  const localHit = new Vector3(...event.localPosition)
  const vertices = [readVertex(0), readVertex(1), readVertex(2)] as const
  const triangleEdges: Array<readonly [Vector3, Vector3]> = [
    [vertices[0], vertices[1]],
    [vertices[1], vertices[2]],
    [vertices[2], vertices[0]],
  ]
  const edges = triangleEdges.flatMap(([start, end]) => {
    const projection = projectVectorToSegment(localHit, start, end)
    return projection
      ? [{ kind: 'edge' as const, label: 'Mesh edge', localPoint: projection, priority: 2 }]
      : []
  })
  const faceCenter = vertices[0]
    .clone()
    .add(vertices[1])
    .add(vertices[2])
    .multiplyScalar(1 / 3)

  return [
    ...vertices.map((localPoint) => ({
      kind: 'vertex' as const,
      label: 'Mesh vertex',
      localPoint,
      priority: 0,
    })),
    { kind: 'center' as const, label: 'Face center', localPoint: faceCenter, priority: 1 },
    ...edges,
  ]
}

function surfaceMeasurementAnchors(
  node: SlabNode | CeilingNode | ZoneNode,
): MeasurementSnapAnchor[] {
  const centroid = polygonAreaAndCentroid(node.polygon).centroid
  const y = node.type === 'ceiling' ? node.height : node.type === 'slab' ? node.elevation : 0
  const edgeMidpoints = node.polygon.map((point, index) => {
    const next = node.polygon[(index + 1) % node.polygon.length] ?? point
    return {
      label: 'Edge midpoint',
      point: [(point[0] + next[0]) / 2, y, (point[1] + next[1]) / 2] as MeasurementPoint,
    }
  })
  return [
    ...node.polygon.map((point) => ({
      label: 'Vertex',
      point: [point[0], y, point[1]] as MeasurementPoint,
    })),
    ...edgeMidpoints,
    { label: 'Center', point: [centroid.x, y, centroid.y] },
  ]
}

function localBoxMeasurementAnchors(
  node: AnyNode,
  dimensions: readonly [number, number, number],
): MeasurementSnapAnchor[] {
  const [width, , depth] = dimensions
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const localAnchors = [
    new Vector3(-halfWidth, 0, -halfDepth),
    new Vector3(halfWidth, 0, -halfDepth),
    new Vector3(halfWidth, 0, halfDepth),
    new Vector3(-halfWidth, 0, halfDepth),
    new Vector3(0, 0, -halfDepth),
    new Vector3(halfWidth, 0, 0),
    new Vector3(0, 0, halfDepth),
    new Vector3(-halfWidth, 0, 0),
    new Vector3(0, 0, 0),
  ]

  return localAnchors
    .map((anchor, index) => {
      const point = nodeLocalToMeasurementPoint(node, anchor)
      if (!point) return null
      return { label: index < 4 ? 'Corner' : index < 8 ? 'Edge midpoint' : 'Center', point }
    })
    .filter((anchor): anchor is MeasurementSnapAnchor => anchor !== null)
}

function boundingBoxMeasurementAnchors(node: AnyNode): MeasurementSnapAnchor[] {
  const object = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!object) return []

  object.updateWorldMatrix(true, true)
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) return []

  const min = box.min
  const max = box.max
  const center = box.getCenter(new Vector3())
  const corners = [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(max.x, max.y, max.z),
    new Vector3(min.x, max.y, max.z),
  ]
  const edgeMidpoints = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
    [corners[4], corners[5]],
    [corners[5], corners[6]],
    [corners[6], corners[7]],
    [corners[7], corners[4]],
    [corners[0], corners[4]],
    [corners[1], corners[5]],
    [corners[2], corners[6]],
    [corners[3], corners[7]],
  ].map(([a, b]) => a!.clone().add(b!).multiplyScalar(0.5))
  const faceCenters = [
    new Vector3(center.x, min.y, center.z),
    new Vector3(center.x, max.y, center.z),
    new Vector3(min.x, center.y, center.z),
    new Vector3(max.x, center.y, center.z),
    new Vector3(center.x, center.y, min.z),
    new Vector3(center.x, center.y, max.z),
  ]

  return [...corners, ...edgeMidpoints, ...faceCenters, center].map((point, index) => ({
    label:
      index < 8 ? 'Box corner' : index < 20 ? 'Box edge' : index < 26 ? 'Face center' : 'Center',
    point: worldToBuildingLocal([point.x, point.y, point.z]),
  }))
}

function nodeMeasurementAnchors(node: AnyNode): MeasurementSnapAnchor[] {
  const boxAnchors = boundingBoxMeasurementAnchors(node)

  if (node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone') {
    return [...surfaceMeasurementAnchors(node as SlabNode | CeilingNode | ZoneNode), ...boxAnchors]
  }
  if (node.type === 'item') {
    return [
      ...localBoxMeasurementAnchors(node, getScaledDimensions(node as ItemNode)),
      ...boxAnchors,
    ]
  }
  if (node.type === 'column') {
    const column = node as ColumnNode
    return [
      ...localBoxMeasurementAnchors(node, [column.width, column.height, column.depth]),
      ...boxAnchors,
    ]
  }
  if (node.type === 'elevator') {
    const elevator = node as ElevatorNode
    return [
      ...localBoxMeasurementAnchors(node, [
        elevator.shaftWidth ?? elevator.width,
        elevator.cabHeight,
        elevator.shaftDepth ?? elevator.depth,
      ]),
      ...boxAnchors,
    ]
  }
  return boxAnchors
}

function resolveNodeMeasurementSnap(
  event: NodeEvent,
  point: MeasurementPoint,
): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  const anchors = [
    ...meshSnapCandidatesFromEvent(event).map((candidate) => ({
      kind: candidate.kind,
      label: candidate.label,
      point: measurementPointFromObjectLocalPoint(event.object, candidate.localPoint),
      priority: candidate.priority,
    })),
    ...nodeMeasurementAnchors(event.node).map((anchor) => ({
      ...anchor,
      priority: anchor.priority ?? 3,
    })),
  ]
  const enabledSnapKinds = useMeasurementTool.getState().enabledSnapKinds
  const enabledAnchors = anchors.filter((anchor) => {
    const kind = anchor.kind ?? measurementSnapKindFromLabel(anchor.label)
    return enabledSnapKinds[kind]
  })

  if (enabledAnchors.length === 0) return { point, target: null }

  const maxDistanceSq = MEASUREMENT_SURFACE_SNAP_RADIUS * MEASUREMENT_SURFACE_SNAP_RADIUS
  let closest: MeasurementSnapAnchor | null = null
  let closestDistanceSq = Number.POSITIVE_INFINITY
  let closestScore = Number.POSITIVE_INFINITY

  for (const anchor of enabledAnchors) {
    const distanceSq = squaredMeasurementDistance(point, anchor.point)
    if (distanceSq > maxDistanceSq) continue
    const score = (anchor.priority ?? 10) * MEASUREMENT_NODE_SNAP_PRIORITY_BUCKET + distanceSq
    if (
      score < closestScore ||
      (Math.abs(score - closestScore) < 1e-8 && (anchor.priority ?? 10) < (closest?.priority ?? 10))
    ) {
      closest = anchor
      closestDistanceSq = distanceSq
      closestScore = score
    }
  }

  return {
    point: closest?.point ?? point,
    target: closest
      ? {
          kind: closest.kind ?? measurementSnapKindFromLabel(closest.label),
          label: closest.label,
          point: closest.point,
          view: '3d',
        }
      : null,
  }
}

function resolveGridEditablePoint3D(event: GridEvent): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  const measurement = useMeasurementTool.getState()
  const snap = resolveGridMeasurementSnap3D(measurementPointFromGridEvent(event))
  const drag = measurement.draggingSegmentEndpoint
  if (!drag) return snap

  const segment = measurement.segments.find((entry) => entry.id === drag.id)
  const anchor =
    drag.endpoint === 'start'
      ? (segment?.end ?? null)
      : drag.endpoint === 'end'
        ? (segment?.start ?? null)
        : null
  const constrained =
    !event.nativeEvent.shiftKey && anchor
      ? resolveGridMeasurementConstraint3D(anchor, snap.point)
      : null
  const point =
    event.nativeEvent.shiftKey && anchor
      ? axisLockedMeasurementPoint(anchor, snap.point, '3d')
      : (constrained?.point ?? snap.point)

  return {
    point,
    target: event.nativeEvent.shiftKey ? null : (constrained?.target ?? snap.target),
  }
}

export function handleMeasurementGridMove3D(
  event: GridEvent,
  canvas: HTMLCanvasElement,
  shouldIgnoreGridEvent: () => boolean = () => false,
): void {
  if (!isCanvasEvent(event, canvas)) return
  if (shouldIgnoreGridEvent()) return
  const measurement = useMeasurementTool.getState()
  if (measurement.draggingSegmentEndpoint) {
    const resolved = resolveGridEditablePoint3D(event)
    measurement.updateSegmentEndpoint(
      measurement.draggingSegmentEndpoint.id,
      measurement.draggingSegmentEndpoint.endpoint,
      resolved.point,
    )
    measurement.setSnapTarget(resolved.target)
    measurement.setCursor('3d', resolved.point)
    return
  }
  const rawPoint = measurementPointFromGridEvent(event)
  const snap = resolveGridMeasurementSnap3D(rawPoint)
  const constrained =
    !event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
      ? resolveGridMeasurementConstraint3D(measurement.draft.start, snap.point)
      : null
  const point =
    event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
      ? axisLockedMeasurementPoint(measurement.draft.start, snap.point, '3d')
      : (constrained?.point ?? snap.point)
  measurement.setSnapTarget(
    event.nativeEvent.shiftKey ? null : (constrained?.target ?? snap.target),
  )
  measurement.setCursor('3d', point)
  if (measurement.angleDraft) {
    measurement.updateAngle(point)
    return
  }
  if (!measurement.draft) return
  measurement.update(point)
}

export function handleMeasurementGridClick3D(
  event: GridEvent,
  canvas: HTMLCanvasElement,
  shouldIgnoreGridEvent: () => boolean = () => false,
): void {
  if (!isCanvasEvent(event, canvas)) return
  if (shouldIgnoreGridEvent()) return
  const measurement = useMeasurementTool.getState()
  if (measurement.draggingSegmentEndpoint) {
    const resolved = resolveGridEditablePoint3D(event)
    measurement.updateSegmentEndpoint(
      measurement.draggingSegmentEndpoint.id,
      measurement.draggingSegmentEndpoint.endpoint,
      resolved.point,
    )
    measurement.setSnapTarget(resolved.target)
    measurement.setCursor('3d', resolved.point)
    measurement.endSegmentEndpointDrag()
    return
  }
  const rawPoint = measurementPointFromGridEvent(event)
  const snap = resolveGridMeasurementSnap3D(rawPoint)
  const constrained =
    !event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
      ? resolveGridMeasurementConstraint3D(measurement.draft.start, snap.point)
      : null
  const point =
    event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
      ? axisLockedMeasurementPoint(measurement.draft.start, snap.point, '3d')
      : (constrained?.point ?? snap.point)
  measurement.setSnapTarget(
    event.nativeEvent.shiftKey ? null : (constrained?.target ?? snap.target),
  )
  measurement.setCursor('3d', point)
  if (event.nativeEvent.shiftKey && measurement.draft?.view === '3d') {
    measurement.commit(point)
    return
  }
  if (event.nativeEvent.shiftKey || measurement.mode === 'angle' || measurement.angleDraft) {
    if (measurement.angleDraft) {
      measurement.commitAngle(point)
    } else {
      measurement.beginAngle('3d', point)
    }
    return
  }
  if (measurement.mode !== 'distance') return
  if (measurement.draft) {
    measurement.commit(point)
  } else {
    measurement.begin('3d', point)
  }
}

export function handleMeasurementNodeClick3D(event: NodeEvent): void {
  event.stopPropagation()

  const measurement = useMeasurementTool.getState()
  const snap = resolveNodeMeasurementSnap(event, measurementPointFromNodeEvent(event))
  const surfaceNormal = measurementNormalFromNodeEvent(event)
  const isAxisLocked = event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
  const point =
    isAxisLocked && measurement.draft
      ? axisLockedMeasurementPoint(measurement.draft.start, snap.point, '3d')
      : snap.point
  const quickMeasure = Boolean(
    event.nativeEvent.altKey || event.nativeEvent.ctrlKey || event.nativeEvent.metaKey,
  )
  measurement.setCursor('3d', point)
  measurement.setSnapTarget(isAxisLocked ? null : snap.target)
  if (measurement.draggingSegmentEndpoint) {
    measurement.updateSegmentEndpoint(
      measurement.draggingSegmentEndpoint.id,
      measurement.draggingSegmentEndpoint.endpoint,
      point,
    )
    measurement.endSegmentEndpointDrag()
    return
  }
  if (event.nativeEvent.shiftKey && measurement.draft?.view === '3d') {
    measurement.commit(point)
    return
  }
  if (event.nativeEvent.shiftKey || measurement.mode === 'angle' || measurement.angleDraft) {
    if (measurement.angleDraft) {
      measurement.commitAngle(point)
    } else {
      measurement.beginAngle('3d', point)
    }
    return
  }

  if (!measurement.draft) {
    if (quickMeasure || measurement.mode === 'perimeter') {
      const perimeter = surfacePerimeterMeasurementFromNode(event.node)
      if (perimeter) {
        measurement.addPerimeter('3d', perimeter.labelPoint, perimeter.lengthMeters)
        return
      }
    }

    if (measurement.mode === 'area') {
      const area = surfaceAreaMeasurementFromNode(event.node)
      if (area) {
        measurement.addArea('3d', area.labelPoint, area.areaSquareMeters)
        return
      }
    }

    if (measurement.mode === 'distance' && quickMeasure) {
      const segment = directLengthSegmentFromNode(event.node)
      if (segment) {
        measurement.addSegment('3d', segment.start, segment.end, segment.measuredDistanceMeters)
        return
      }
    }
  }

  if (measurement.mode !== 'distance') return

  if (measurement.draft) {
    const surfaceDistance = measurement.enabledSnapKinds.surface
      ? resolveSurfaceDistanceEndpoint(
          measurement.draft.start,
          measurement.draft.surfaceNormal,
          point,
          surfaceNormal,
        )
      : null
    if (surfaceDistance) {
      measurement.setSnapTarget({
        kind: 'surface',
        label: 'Surface distance',
        point: surfaceDistance.end,
        view: '3d',
      })
      measurement.commit(surfaceDistance.end, surfaceDistance.measuredDistanceMeters)
    } else {
      measurement.commit(point)
    }
  } else {
    measurement.begin('3d', point, surfaceNormal ?? undefined)
  }
}

function MeasurementCursor3D({
  kind = 'vertex',
  point,
}: {
  kind?: MeasurementSnapTarget['kind']
  point: MeasurementPoint
}) {
  const bars =
    kind === 'edge'
      ? [
          {
            position: [0, 0, 0] as const,
            scale: [
              MEASUREMENT_CURSOR_SIZE * 1.6,
              MEASUREMENT_CURSOR_WIDTH,
              MEASUREMENT_CURSOR_WIDTH,
            ] as const,
          },
        ]
      : kind === 'grid'
        ? [
            {
              position: [0, 0, -MEASUREMENT_CURSOR_SIZE / 2] as const,
              scale: [
                MEASUREMENT_CURSOR_SIZE,
                MEASUREMENT_CURSOR_WIDTH,
                MEASUREMENT_CURSOR_WIDTH,
              ] as const,
            },
            {
              position: [0, 0, MEASUREMENT_CURSOR_SIZE / 2] as const,
              scale: [
                MEASUREMENT_CURSOR_SIZE,
                MEASUREMENT_CURSOR_WIDTH,
                MEASUREMENT_CURSOR_WIDTH,
              ] as const,
            },
            {
              position: [-MEASUREMENT_CURSOR_SIZE / 2, 0, 0] as const,
              scale: [
                MEASUREMENT_CURSOR_WIDTH,
                MEASUREMENT_CURSOR_WIDTH,
                MEASUREMENT_CURSOR_SIZE,
              ] as const,
            },
            {
              position: [MEASUREMENT_CURSOR_SIZE / 2, 0, 0] as const,
              scale: [
                MEASUREMENT_CURSOR_WIDTH,
                MEASUREMENT_CURSOR_WIDTH,
                MEASUREMENT_CURSOR_SIZE,
              ] as const,
            },
          ]
        : kind === 'guide'
          ? [
              {
                position: [0, 0, 0] as const,
                scale: [
                  MEASUREMENT_CURSOR_SIZE * 1.6,
                  MEASUREMENT_CURSOR_WIDTH,
                  MEASUREMENT_CURSOR_WIDTH,
                ] as const,
              },
              {
                position: [0, 0, 0] as const,
                rotationZ: Math.PI / 2,
                scale: [
                  MEASUREMENT_CURSOR_SIZE * 1.6,
                  MEASUREMENT_CURSOR_WIDTH,
                  MEASUREMENT_CURSOR_WIDTH,
                ] as const,
              },
            ]
          : kind === 'surface'
            ? [
                {
                  position: [0, 0, 0] as const,
                  scale: [
                    MEASUREMENT_CURSOR_WIDTH,
                    MEASUREMENT_CURSOR_SIZE * 1.7,
                    MEASUREMENT_CURSOR_WIDTH,
                  ] as const,
                },
                {
                  position: [0, 0, 0] as const,
                  scale: [
                    MEASUREMENT_CURSOR_SIZE * 0.9,
                    MEASUREMENT_CURSOR_WIDTH,
                    MEASUREMENT_CURSOR_WIDTH,
                  ] as const,
                },
              ]
            : kind === 'intersection'
              ? [
                  {
                    position: [0, 0, 0] as const,
                    rotationY: Math.PI / 4,
                    scale: [
                      MEASUREMENT_CURSOR_SIZE * 1.35,
                      MEASUREMENT_CURSOR_WIDTH,
                      MEASUREMENT_CURSOR_WIDTH,
                    ] as const,
                  },
                  {
                    position: [0, 0, 0] as const,
                    rotationY: -Math.PI / 4,
                    scale: [
                      MEASUREMENT_CURSOR_SIZE * 1.35,
                      MEASUREMENT_CURSOR_WIDTH,
                      MEASUREMENT_CURSOR_WIDTH,
                    ] as const,
                  },
                ]
              : kind === 'midpoint'
                ? [
                    {
                      position: [0, MEASUREMENT_CURSOR_SIZE * 0.3, 0] as const,
                      scale: [
                        MEASUREMENT_CURSOR_SIZE,
                        MEASUREMENT_CURSOR_WIDTH,
                        MEASUREMENT_CURSOR_WIDTH,
                      ] as const,
                    },
                    {
                      position: [0, 0, 0] as const,
                      rotationZ: Math.PI / 2,
                      scale: [
                        MEASUREMENT_CURSOR_SIZE,
                        MEASUREMENT_CURSOR_WIDTH,
                        MEASUREMENT_CURSOR_WIDTH,
                      ] as const,
                    },
                  ]
                : kind === 'measurement'
                  ? [
                      {
                        position: [0, 0, 0] as const,
                        scale: [
                          MEASUREMENT_CURSOR_SIZE * 1.4,
                          MEASUREMENT_CURSOR_WIDTH,
                          MEASUREMENT_CURSOR_WIDTH,
                        ] as const,
                      },
                      {
                        position: [0, 0, 0] as const,
                        rotationY: Math.PI / 2,
                        scale: [
                          MEASUREMENT_CURSOR_SIZE * 1.4,
                          MEASUREMENT_CURSOR_WIDTH,
                          MEASUREMENT_CURSOR_WIDTH,
                        ] as const,
                      },
                    ]
                  : [
                      {
                        position: [0, 0, 0] as const,
                        scale: [
                          MEASUREMENT_CURSOR_SIZE,
                          MEASUREMENT_CURSOR_WIDTH,
                          MEASUREMENT_CURSOR_WIDTH,
                        ] as const,
                      },
                      {
                        position: [0, 0, 0] as const,
                        scale: [
                          MEASUREMENT_CURSOR_WIDTH,
                          MEASUREMENT_CURSOR_WIDTH,
                          MEASUREMENT_CURSOR_SIZE,
                        ] as const,
                      },
                      {
                        position: [0, 0, 0] as const,
                        scale: [
                          MEASUREMENT_CURSOR_WIDTH,
                          MEASUREMENT_CURSOR_SIZE,
                          MEASUREMENT_CURSOR_WIDTH,
                        ] as const,
                      },
                    ]

  return (
    <group position={point}>
      {bars.map((bar, index) => (
        <mesh
          geometry={dashGeometry}
          key={`${kind}-${index}`}
          layers={EDITOR_LAYER}
          material={draftMeasurementMaterial}
          position={bar.position}
          renderOrder={1001}
          rotation-y={'rotationY' in bar ? bar.rotationY : 0}
          rotation-z={'rotationZ' in bar ? bar.rotationZ : 0}
          scale={bar.scale}
        />
      ))}
    </group>
  )
}

function MeasurementSnapTarget3D({ target }: { target: MeasurementSnapTarget }) {
  return (
    <>
      {target.guideLine ? (
        <MeasurementBar3D
          end={new Vector3(...target.guideLine.end)}
          material={draftMeasurementMaterial}
          start={new Vector3(...target.guideLine.start)}
          width={MEASUREMENT_LINE_WIDTH * 0.65}
        />
      ) : null}
      <group position={target.point}>
        <MeasurementCursor3D kind={target.kind} point={[0, 0, 0]} />
        <Html center distanceFactor={12} position={getMeasurementSnapLabelPosition3D()}>
          <MeasurementValuePill draft>{target.label}</MeasurementValuePill>
        </Html>
      </group>
    </>
  )
}

export function getMeasurementSnapLabelPosition3D(): [number, number, number] {
  return [0, MEASUREMENT_SNAP_LABEL_LIFT, 0]
}

function MeasurementArea3D({
  area,
  displayPrecision,
  isSelected,
  onSelect,
}: {
  area: MeasurementArea
  displayPrecision: ReturnType<typeof useMeasurementTool.getState>['displayPrecision']
  isSelected: boolean
  onSelect: (id: string, event: PointerEvent<HTMLSpanElement>) => void
}) {
  const unit = useViewer((s) => s.unit)

  return (
    <Html center distanceFactor={12} position={area.labelPoint}>
      <MeasurementValuePill
        isSelected={isSelected}
        onPointerDown={(event) => onSelect(area.id, event)}
      >
        {formatAreaMeasurement(area.areaSquareMeters, unit, { precision: displayPrecision })}
      </MeasurementValuePill>
    </Html>
  )
}

function MeasurementPerimeter3D({
  displayPrecision,
  isSelected,
  onSelect,
  perimeter,
}: {
  displayPrecision: ReturnType<typeof useMeasurementTool.getState>['displayPrecision']
  isSelected: boolean
  onSelect: (id: string, event: PointerEvent<HTMLSpanElement>) => void
  perimeter: MeasurementPerimeter
}) {
  const unit = useViewer((s) => s.unit)

  return (
    <Html center distanceFactor={12} position={perimeter.labelPoint}>
      <MeasurementValuePill
        isSelected={isSelected}
        onPointerDown={(event) => onSelect(perimeter.id, event)}
      >
        {`P ${formatLinearMeasurement(perimeter.lengthMeters, unit, { precision: displayPrecision })}`}
      </MeasurementValuePill>
    </Html>
  )
}

function MeasurementValuePill({
  children,
  draft = false,
  isSelected = true,
  onPointerDown,
}: {
  children: ReactNode
  draft?: boolean
  isSelected?: boolean
  onPointerDown?: (event: PointerEvent<HTMLSpanElement>) => void
}) {
  return (
    <span
      className={getMeasurementValuePillClassName({
        draft,
        interactive: Boolean(onPointerDown),
        isSelected,
      })}
      onPointerDown={onPointerDown}
    >
      {children}
    </span>
  )
}

export function getMeasurementValuePillClassName({
  draft = false,
  interactive = false,
  isSelected = true,
}: {
  draft?: boolean
  interactive?: boolean
  isSelected?: boolean
}) {
  return cn(
    'pointer-events-none whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 font-medium text-xs text-foreground tabular-nums shadow-sm backdrop-blur',
    'transition-[border-color,color,opacity]',
    interactive && 'pointer-events-auto cursor-pointer',
    draft && 'border-amber-500/60 text-amber-700 dark:text-amber-300',
    !isSelected && 'opacity-45',
  )
}

function MeasurementBar3D({
  end,
  material,
  start,
  width = MEASUREMENT_LINE_WIDTH,
}: {
  end: Vector3
  material: MeshBasicNodeMaterial
  start: Vector3
  width?: number
}) {
  const segment = useMemo(() => {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (!Number.isFinite(length) || length < 1e-4) return null

    return {
      length,
      position: start.clone().add(end).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(MEASUREMENT_BAR_AXIS, direction.normalize()),
    }
  }, [end, start])

  if (!segment) return null

  return (
    <mesh
      geometry={dashGeometry}
      layers={EDITOR_LAYER}
      material={material}
      position={segment.position}
      quaternion={segment.quaternion}
      renderOrder={1000}
      scale={[segment.length, width, width]}
    />
  )
}

type MeasurementLabelLayout3D = {
  id: string
  labelPosition: Vector3
  tickDirection: Vector3
}

export function staggerMeasurementLabelLayouts3D<T extends MeasurementLabelLayout3D>(
  layouts: T[],
): T[] {
  const seen = new Map<string, number>()
  return layouts.map((layout) => {
    const key = `${Math.round(layout.labelPosition.x / MEASUREMENT_LABEL_COLLISION_CELL)}:${Math.round(
      layout.labelPosition.y / MEASUREMENT_LABEL_COLLISION_CELL,
    )}:${Math.round(layout.labelPosition.z / MEASUREMENT_LABEL_COLLISION_CELL)}`
    const index = seen.get(key) ?? 0
    seen.set(key, index + 1)
    if (index === 0) return layout

    const direction = index % 2 === 0 ? -1 : 1
    const magnitude = Math.ceil(index / 2) * MEASUREMENT_LABEL_STAGGER_STEP
    return {
      ...layout,
      labelPosition: layout.labelPosition.clone().add(
        layout.tickDirection
          .clone()
          .normalize()
          .multiplyScalar(direction * magnitude),
      ),
    }
  })
}

function measurementLineLayout3D(segment: Pick<MeasurementSegment, 'end' | 'id' | 'start'>) {
  const start = new Vector3(...segment.start)
  const end = new Vector3(...segment.end)
  const direction = end.clone().sub(start)
  const length = direction.length()
  const midpoint = start.clone().add(end).multiplyScalar(0.5)
  const unitDirection = length > 1e-4 ? direction.clone().normalize() : new Vector3(1, 0, 0)
  const tickDirection =
    Math.abs(unitDirection.dot(new Vector3(0, 1, 0))) > 0.94
      ? new Vector3(1, 0, 0)
      : new Vector3(0, 1, 0)
  const tickOffset = tickDirection.clone().multiplyScalar(MEASUREMENT_END_TICK / 2)

  return {
    end,
    id: segment.id,
    labelPosition: midpoint
      .clone()
      .add(tickDirection.clone().multiplyScalar(MEASUREMENT_END_TICK / 2 + MEASUREMENT_LABEL_LIFT)),
    start,
    tickDirection,
    tickEndA: end.clone().add(tickOffset),
    tickEndB: end.clone().sub(tickOffset),
    tickStartA: start.clone().add(tickOffset),
    tickStartB: start.clone().sub(tickOffset),
  }
}

function MeasurementLine3D({
  displayPrecision,
  draft = false,
  isSelected = true,
  labelPosition,
  onSelect,
  segment,
  showLabel = true,
}: {
  displayPrecision: ReturnType<typeof useMeasurementTool.getState>['displayPrecision']
  draft?: boolean
  isSelected?: boolean
  labelPosition?: Vector3
  onSelect?: (id: string, event: PointerEvent<HTMLSpanElement>) => void
  segment: Pick<MeasurementSegment, 'id' | 'start' | 'end' | 'measuredDistanceMeters'>
  showLabel?: boolean
}) {
  const unit = useViewer((s) => s.unit)
  const distance =
    segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end)
  const lineLayout = useMemo(() => measurementLineLayout3D(segment), [segment])

  if (distance < 1e-4) return null

  const material = draft
    ? draftMeasurementMaterial
    : isSelected
      ? measurementMaterial
      : mutedMeasurementMaterial

  return (
    <group>
      <MeasurementBar3D end={lineLayout.end} material={material} start={lineLayout.start} />
      <MeasurementBar3D
        end={lineLayout.tickStartB}
        material={material}
        start={lineLayout.tickStartA}
      />
      <MeasurementBar3D end={lineLayout.tickEndB} material={material} start={lineLayout.tickEndA} />
      {showLabel ? (
        <Html center distanceFactor={12} position={labelPosition ?? lineLayout.labelPosition}>
          <MeasurementValuePill
            draft={draft}
            isSelected={isSelected}
            onPointerDown={onSelect && !draft ? (event) => onSelect(segment.id, event) : undefined}
          >
            {formatLinearMeasurement(distance, unit, { precision: displayPrecision })}
          </MeasurementValuePill>
        </Html>
      ) : null}
    </group>
  )
}

function MeasurementEndpointHandles3D({
  draggingEndpoint,
  segment,
}: {
  draggingEndpoint: ReturnType<typeof useMeasurementTool.getState>['draggingSegmentEndpoint']
  segment: Pick<MeasurementSegment, 'end' | 'id' | 'start'>
}) {
  const handles: Array<{ endpoint: MeasurementSegmentEndpoint; point: MeasurementPoint }> = [
    { endpoint: 'start', point: segment.start },
    { endpoint: 'end', point: segment.end },
  ]

  return (
    <group>
      {handles.map(({ endpoint, point }) => {
        const activeHandle = isDraggingMeasurementEndpoint(draggingEndpoint, segment.id, endpoint)
        const handleSize = activeHandle
          ? MEASUREMENT_ENDPOINT_HANDLE_SIZE * 1.35
          : MEASUREMENT_ENDPOINT_HANDLE_SIZE
        return (
          <group key={endpoint} position={point}>
            <mesh
              geometry={dashGeometry}
              layers={EDITOR_LAYER}
              material={endpointHandleHitMaterial}
              onPointerDown={(event) => {
                event.stopPropagation()
                useMeasurementTool.getState().startSegmentEndpointDrag(segment.id, endpoint)
              }}
              renderOrder={1003}
              scale={[
                MEASUREMENT_ENDPOINT_HANDLE_HIT_SIZE,
                MEASUREMENT_ENDPOINT_HANDLE_HIT_SIZE,
                MEASUREMENT_ENDPOINT_HANDLE_HIT_SIZE,
              ]}
            />
            <mesh
              geometry={dashGeometry}
              layers={EDITOR_LAYER}
              material={activeHandle ? draftMeasurementMaterial : measurementMaterial}
              renderOrder={1002}
              scale={[handleSize, handleSize, handleSize]}
            />
          </group>
        )
      })}
    </group>
  )
}

function MeasurementAngle3D({
  angle,
  displayPrecision,
  draft = false,
  isSelected,
  onSelect,
}: {
  angle: MeasurementAngle
  displayPrecision: ReturnType<typeof useMeasurementTool.getState>['displayPrecision']
  draft?: boolean
  isSelected: boolean
  onSelect?: (id: string, event: PointerEvent<HTMLSpanElement>) => void
}) {
  const labelPosition = useMemo(() => {
    const first = new Vector3(...angle.first)
    const vertex = new Vector3(...angle.vertex)
    const second = new Vector3(...angle.second)
    const firstDirection = first.sub(vertex).normalize()
    const secondDirection = second.sub(vertex).normalize()
    const bisector = firstDirection.add(secondDirection)
    if (bisector.lengthSq() < 1e-6) {
      bisector.copy(secondDirection)
    }
    return vertex.clone().add(bisector.normalize().multiplyScalar(0.45))
  }, [angle.first, angle.second, angle.vertex])

  return (
    <group>
      <MeasurementLine3D
        displayPrecision={displayPrecision}
        draft={draft}
        isSelected={isSelected}
        segment={{ id: `${angle.id}-a`, start: angle.vertex, end: angle.first }}
        showLabel={false}
      />
      <MeasurementLine3D
        displayPrecision={displayPrecision}
        draft={draft}
        isSelected={isSelected}
        segment={{ id: `${angle.id}-b`, start: angle.vertex, end: angle.second }}
        showLabel={false}
      />
      <Html center distanceFactor={12} position={labelPosition}>
        <MeasurementValuePill
          draft={draft}
          isSelected={isSelected}
          onPointerDown={onSelect && !draft ? (event) => onSelect(angle.id, event) : undefined}
        >
          {formatAngleMeasurement(
            angleBetweenMeasurements(angle.first, angle.vertex, angle.second),
            { precision: displayPrecision },
          )}
        </MeasurementValuePill>
      </Html>
    </group>
  )
}

export function MeasurementTool() {
  const unit = useViewer((state) => state.unit)
  const canvas = useThree((state) => state.gl.domElement)
  const segments = useMeasurementTool((state) => state.segments)
  const areas = useMeasurementTool((state) => state.areas)
  const perimeters = useMeasurementTool((state) => state.perimeters)
  const angles = useMeasurementTool((state) => state.angles)
  const draft = useMeasurementTool((state) => state.draft)
  const angleDraft = useMeasurementTool((state) => state.angleDraft)
  const cursor = useMeasurementTool((state) => state.cursor)
  const displayPrecision = useMeasurementTool((state) => state.displayPrecision)
  const snapTarget = useMeasurementTool((state) => state.snapTarget)
  const selectedId = useMeasurementTool((state) => state.selectedId)
  const draggingSegmentEndpoint = useMeasurementTool((state) => state.draggingSegmentEndpoint)
  const lastSurfaceEventAtRef = useRef(0)

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'measurement' })
    return () => {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'measurement')
      useMeasurementTool.getState().cancelDraft()
      useMeasurementTool.getState().setCursor('3d', null)
    }
  }, [])

  useEffect(() => {
    const noteSurfaceEvent = () => {
      lastSurfaceEventAtRef.current = performance.now()
    }
    const shouldIgnoreGridEvent = () =>
      performance.now() - lastSurfaceEventAtRef.current < SURFACE_EVENT_SUPPRESSION_MS

    const handleMove = (event: GridEvent) => {
      handleMeasurementGridMove3D(event, canvas, shouldIgnoreGridEvent)
    }

    const handleClick = (event: GridEvent) => {
      handleMeasurementGridClick3D(event, canvas, shouldIgnoreGridEvent)
    }
    const handlePointerUp = () => {
      useMeasurementTool.getState().endSegmentEndpointDrag()
    }

    const handleNodeMove = (event: NodeEvent) => {
      noteSurfaceEvent()
      const snap = resolveNodeMeasurementSnap(event, measurementPointFromNodeEvent(event))
      const measurement = useMeasurementTool.getState()
      const surfaceNormal = measurementNormalFromNodeEvent(event)
      const isAxisLocked = event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
      const snappedPoint =
        isAxisLocked && measurement.draft
          ? axisLockedMeasurementPoint(measurement.draft.start, snap.point, '3d')
          : snap.point
      const surfaceDistance =
        measurement.enabledSnapKinds.surface && measurement.draft?.view === '3d'
          ? resolveSurfaceDistanceEndpoint(
              measurement.draft.start,
              measurement.draft.surfaceNormal,
              snappedPoint,
              surfaceNormal,
            )
          : null
      const point = surfaceDistance?.end ?? snappedPoint
      if (measurement.draggingSegmentEndpoint) {
        measurement.updateSegmentEndpoint(
          measurement.draggingSegmentEndpoint.id,
          measurement.draggingSegmentEndpoint.endpoint,
          point,
        )
        measurement.setCursor('3d', point)
        measurement.setSnapTarget(isAxisLocked ? null : snap.target)
        return
      }
      measurement.setCursor('3d', point)
      measurement.setSnapTarget(
        isAxisLocked
          ? null
          : surfaceDistance
            ? { kind: 'surface', label: 'Surface distance', point: surfaceDistance.end, view: '3d' }
            : snap.target,
      )
      if (measurement.angleDraft) {
        measurement.updateAngle(point)
        return
      }
      if (!measurement.draft) return
      measurement.update(point)
    }

    const handleNodeClick = (event: NodeEvent) => {
      noteSurfaceEvent()
      handleMeasurementNodeClick3D(event)
    }

    const handleCancel = () => {
      const measurement = useMeasurementTool.getState()
      if (
        !measurement.cursor &&
        !measurement.angleDraft &&
        !measurement.draft &&
        measurement.segments.length === 0 &&
        measurement.areas.length === 0 &&
        measurement.perimeters.length === 0 &&
        measurement.angles.length === 0
      )
        return
      markToolCancelConsumed()
      measurement.clear()
    }

    emitter.on('grid:move', handleMove)
    emitter.on('grid:click', handleClick)
    emitter.on('tool:cancel', handleCancel)
    window.addEventListener('pointerup', handlePointerUp, true)
    for (const kind of MEASURABLE_NODE_KINDS) {
      emitter.on(`${kind}:move` as never, handleNodeMove as never)
      emitter.on(`${kind}:click` as never, handleNodeClick as never)
    }
    return () => {
      emitter.off('grid:move', handleMove)
      emitter.off('grid:click', handleClick)
      emitter.off('tool:cancel', handleCancel)
      window.removeEventListener('pointerup', handlePointerUp, true)
      for (const kind of MEASURABLE_NODE_KINDS) {
        emitter.off(`${kind}:move` as never, handleNodeMove as never)
        emitter.off(`${kind}:click` as never, handleNodeClick as never)
      }
    }
  }, [canvas])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.key === 'Delete' || event.key === 'Backspace')) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return
      const measurement = useMeasurementTool.getState()
      if (!measurement.selectedId) return
      event.preventDefault()
      event.stopPropagation()
      measurement.deleteSelected()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  const handleSelectMeasurement = (id: string, event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    useMeasurementTool.getState().selectMeasurement(id)
  }
  const draftAngle =
    angleDraft?.view === '3d' && angleDraft.vertex && angleDraft.second
      ? {
          first: angleDraft.first,
          id: 'measurement-angle-draft',
          second: angleDraft.second,
          vertex: angleDraft.vertex,
          view: angleDraft.view,
        }
      : null
  const selectedSegment = selectedId
    ? segments.find((segment) => segment.id === selectedId && segment.view === '3d')
    : null
  const segmentLabelPositions = useMemo(() => {
    const layouts = staggerMeasurementLabelLayouts3D(
      segments
        .filter((segment) => segment.view === '3d')
        .map((segment) => measurementLineLayout3D(segment)),
    )
    return new Map(layouts.map((layout) => [layout.id, layout.labelPosition]))
  }, [segments])

  return (
    <>
      {segments
        .filter((segment) => segment.view === '3d')
        .map((segment) => (
          <MeasurementLine3D
            displayPrecision={displayPrecision}
            isSelected={selectedId ? selectedId === segment.id : true}
            key={segment.id}
            labelPosition={segmentLabelPositions.get(segment.id)}
            onSelect={handleSelectMeasurement}
            segment={segment}
          />
        ))}
      {draft?.view === '3d' && draft.end ? (
        <MeasurementLine3D
          displayPrecision={displayPrecision}
          draft
          segment={{ id: 'measurement-draft', start: draft.start, end: draft.end }}
        />
      ) : null}
      {areas
        .filter((area) => area.view === '3d')
        .map((area) => (
          <MeasurementArea3D
            area={area}
            displayPrecision={displayPrecision}
            isSelected={selectedId ? selectedId === area.id : true}
            key={area.id}
            onSelect={handleSelectMeasurement}
          />
        ))}
      {perimeters
        .filter((perimeter) => perimeter.view === '3d')
        .map((perimeter) => (
          <MeasurementPerimeter3D
            displayPrecision={displayPrecision}
            isSelected={selectedId ? selectedId === perimeter.id : true}
            key={perimeter.id}
            onSelect={handleSelectMeasurement}
            perimeter={perimeter}
          />
        ))}
      {angles
        .filter((angle) => angle.view === '3d')
        .map((angle) => (
          <MeasurementAngle3D
            angle={angle}
            displayPrecision={displayPrecision}
            isSelected={selectedId ? selectedId === angle.id : true}
            key={angle.id}
            onSelect={handleSelectMeasurement}
          />
        ))}
      {draftAngle ? (
        <MeasurementAngle3D
          angle={draftAngle}
          displayPrecision={displayPrecision}
          draft
          isSelected
        />
      ) : null}
      {snapTarget?.view === '3d' ? <MeasurementSnapTarget3D target={snapTarget} /> : null}
      {selectedSegment ? (
        <MeasurementEndpointHandles3D
          draggingEndpoint={draggingSegmentEndpoint}
          segment={selectedSegment}
        />
      ) : null}
      {cursor?.view === '3d' ? <MeasurementCursor3D point={cursor.point} /> : null}
    </>
  )
}
