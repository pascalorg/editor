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
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Box3, BoxGeometry, BufferGeometry, Quaternion, SphereGeometry, Vector3 } from 'three'
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
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  axisLockedMeasurementPoint,
  distanceBetweenMeasurements,
  isDraggingMeasurementEndpoint,
  type MeasurementAngle,
  type MeasurementArea,
  type MeasurementPerimeter,
  type MeasurementPoint,
  type MeasurementPolygonDraft,
  type MeasurementSegment,
  type MeasurementSegmentEndpoint,
  type MeasurementSnapTarget,
  polygonAreaAndLabelPointFromMeasurements,
  polygonPerimeterFromMeasurements,
  useMeasurementTool,
} from '../../../store/use-measurement-tool'
import {
  DIMENSION_PILL_PRIMARY_CLASS_NAME,
  DimensionPillShell,
} from '../../editor/measurement-pill'

const MEASUREMENT_COLOR = 0x8b_5c_f6
const MEASUREMENT_LINE_WIDTH = 0.018
const MEASUREMENT_END_TICK = 0.28
const MEASUREMENT_LABEL_LIFT = 0.08
const MEASUREMENT_CURSOR_SIZE = 0.18
const MEASUREMENT_CURSOR_WIDTH = 0.018
const MEASUREMENT_ENDPOINT_HANDLE_SIZE = 0.16
const MEASUREMENT_ENDPOINT_HANDLE_HIT_SIZE = 0.34
const MEASUREMENT_LABEL_COLLISION_CELL = 0.45
const MEASUREMENT_LABEL_STAGGER_STEP = 0.22
const MEASUREMENT_ANGLE_ARC_MIN_RADIUS = 0.22
const MEASUREMENT_ANGLE_ARC_MAX_RADIUS = 0.72
const MEASUREMENT_ANGLE_ARC_SEGMENTS = 32
const MEASUREMENT_SURFACE_SNAP_RADIUS = 0.25
const MEASUREMENT_GRID_SNAP_RADIUS = 0.25
const MEASUREMENT_NODE_SNAP_PRIORITY_BUCKET = 1_000
const MEASUREMENT_PLAN_SNAP_Y_TOLERANCE = 1e-5
const SURFACE_EVENT_SUPPRESSION_MS = 80

const dashGeometry = new BoxGeometry(1, 1, 1)
const endpointHandleGeometry = new SphereGeometry(0.5, 24, 16)
const MEASUREMENT_BAR_AXIS = new Vector3(1, 0, 0)
const measurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.95,
  toneMapped: false,
  transparent: true,
})
const darkMeasurementMaterial = new MeshBasicNodeMaterial({
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
const darkMutedMeasurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.38,
  toneMapped: false,
  transparent: true,
})
const draftMeasurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.98,
  toneMapped: false,
  transparent: true,
})
const darkDraftMeasurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.98,
  toneMapped: false,
  transparent: true,
})
const endpointHandleHitMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0,
  toneMapped: false,
  transparent: true,
})

const MEASURABLE_NODE_KINDS = [
  'box-vent',
  'chimney',
  'cupola',
  'dormer',
  'downspout',
  'duct-fitting',
  'duct-segment',
  'duct-terminal',
  'eyebrow-vent',
  'gutter',
  'hvac-equipment',
  'lineset',
  'liquid-line',
  'pipe-fitting',
  'pipe-segment',
  'pipe-trap',
  'ridge-vent',
  'scan',
  'skylight',
  'solar-panel',
  'turbine-vent',
  'wall',
  'fence',
  'zone',
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

export function getMeasurementAnnotationColors(appearance: 'dark' | 'light') {
  return appearance === 'dark'
    ? {
        backgroundColor: 'rgba(24, 24, 27, 0.94)',
        borderColor: 'rgba(139, 92, 246, 0.72)',
        color: '#c4b5fd',
        shadowColor: '#111111',
      }
    : {
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        borderColor: 'rgba(139, 92, 246, 0.72)',
        color: '#7c3aed',
        shadowColor: '#ffffff',
      }
}

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
      collectCommittedMeasurementSnapGeometry(useMeasurementTool.getState().segments),
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
      collectCommittedMeasurementSnapGeometry(useMeasurementTool.getState().segments),
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

type DirectLengthSegment = {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
}

function distancePointToMeasurementSegmentSq(
  point: MeasurementPoint,
  start: MeasurementPoint,
  end: MeasurementPoint,
): number {
  const px = point[0]
  const py = point[1]
  const pz = point[2]
  const sx = start[0]
  const sy = start[1]
  const sz = start[2]
  const dx = end[0] - sx
  const dy = end[1] - sy
  const dz = end[2] - sz
  const lengthSq = dx * dx + dy * dy + dz * dz
  if (lengthSq < 1e-8) {
    const ox = px - sx
    const oy = py - sy
    const oz = pz - sz
    return ox * ox + oy * oy + oz * oz
  }
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy + (pz - sz) * dz) / lengthSq))
  const cx = sx + dx * t
  const cy = sy + dy * t
  const cz = sz + dz * t
  const ox = px - cx
  const oy = py - cy
  const oz = pz - cz
  return ox * ox + oy * oy + oz * oz
}

function closestSegmentToPoint(
  segments: DirectLengthSegment[],
  point: MeasurementPoint | null,
): DirectLengthSegment | null {
  if (segments.length === 0) return null
  if (!point) {
    return segments.reduce((longest, segment) =>
      segment.measuredDistanceMeters > longest.measuredDistanceMeters ? segment : longest,
    )
  }

  return segments.reduce((closest, segment) => {
    const closestDistanceSq = distancePointToMeasurementSegmentSq(point, closest.start, closest.end)
    const segmentDistanceSq = distancePointToMeasurementSegmentSq(point, segment.start, segment.end)
    if (Math.abs(segmentDistanceSq - closestDistanceSq) < 1e-8) {
      return segment.measuredDistanceMeters > closest.measuredDistanceMeters ? segment : closest
    }
    return segmentDistanceSq < closestDistanceSq ? segment : closest
  })
}

function localBoxLengthSegment(
  node: AnyNode,
  dimensions: readonly [number, number, number],
  hitPoint: MeasurementPoint | null,
): DirectLengthSegment | null {
  const [width, height, depth] = dimensions
  const halfWidth = width / 2
  const halfHeight = height / 2
  const halfDepth = depth / 2
  if (Math.max(width, height, depth) < 1e-4) return null

  const localEdges: Array<[Vector3, Vector3]> = []
  for (const y of [-halfHeight, halfHeight]) {
    for (const z of [-halfDepth, halfDepth]) {
      if (width >= 1e-4)
        localEdges.push([new Vector3(-halfWidth, y, z), new Vector3(halfWidth, y, z)])
    }
  }
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfDepth, halfDepth]) {
      if (height >= 1e-4)
        localEdges.push([new Vector3(x, -halfHeight, z), new Vector3(x, halfHeight, z)])
    }
  }
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight]) {
      if (depth >= 1e-4)
        localEdges.push([new Vector3(x, y, -halfDepth), new Vector3(x, y, halfDepth)])
    }
  }

  const segments = localEdges.flatMap(([localStart, localEnd]) => {
    const start = nodeLocalToMeasurementPoint(node, localStart)
    const end = nodeLocalToMeasurementPoint(node, localEnd)
    if (!(start && end)) return []
    return [{ start, end, measuredDistanceMeters: distanceBetweenMeasurements(start, end) }]
  })

  return closestSegmentToPoint(segments, hitPoint)
}

function wallHostedOpeningLengthSegment(node: AnyNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  if (!(node.type === 'door' || node.type === 'window')) return null
  const hostId =
    ('wallId' in node && typeof node.wallId === 'string' ? node.wallId : null) ??
    (typeof node.parentId === 'string' ? node.parentId : null)
  const host = hostId ? useScene.getState().nodes[hostId as AnyNodeId] : null
  if (host?.type !== 'wall') return null

  const dx = host.end[0] - host.start[0]
  const dz = host.end[1] - host.start[1]
  const hostLength = Math.hypot(dx, dz)
  if (hostLength < 1e-4) return null
  const position = Array.isArray(node.position) ? node.position : [hostLength / 2, 0, 0]
  const positionAlongWall = typeof position[0] === 'number' ? position[0] : hostLength / 2
  const positionY = typeof position[1] === 'number' ? position[1] : 0
  const width = 'width' in node && typeof node.width === 'number' ? node.width : 0
  if (width < 1e-4) return null

  const dirX = dx / hostLength
  const dirZ = dz / hostLength
  const centerX = host.start[0] + dirX * positionAlongWall
  const centerZ = host.start[1] + dirZ * positionAlongWall
  const halfWidth = width / 2

  return {
    start: [centerX - dirX * halfWidth, positionY, centerZ - dirZ * halfWidth],
    end: [centerX + dirX * halfWidth, positionY, centerZ + dirZ * halfWidth],
    measuredDistanceMeters: width,
  }
}

function renderedBoundingBoxLengthSegment(
  node: AnyNode,
  hitPoint: MeasurementPoint | null = null,
  hitNormal: MeasurementPoint | null = null,
): DirectLengthSegment | null {
  const object = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!object) return null

  object.updateWorldMatrix(true, true)
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) return null

  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  const measureX = size.x >= size.z
  const length = measureX ? size.x : size.z
  if (length < 1e-4) return null

  if (hitPoint && hitNormal && Math.abs(hitNormal[1]) < 0.7 && size.y >= 1e-4) {
    const corners = [
      [box.min.x, box.min.y, box.min.z],
      [box.min.x, box.min.y, box.max.z],
      [box.min.x, box.max.y, box.min.z],
      [box.min.x, box.max.y, box.max.z],
      [box.max.x, box.min.y, box.min.z],
      [box.max.x, box.min.y, box.max.z],
      [box.max.x, box.max.y, box.min.z],
      [box.max.x, box.max.y, box.max.z],
    ] satisfies MeasurementPoint[]
    const localCorners = corners.map((corner) => worldToBuildingLocal(corner))
    const minY = Math.min(...localCorners.map((corner) => corner[1]))
    const maxY = Math.max(...localCorners.map((corner) => corner[1]))
    const start: MeasurementPoint = [hitPoint[0], minY, hitPoint[2]]
    const end: MeasurementPoint = [hitPoint[0], maxY, hitPoint[2]]
    return {
      start,
      end,
      measuredDistanceMeters: distanceBetweenMeasurements(start, end),
    }
  }

  if (hitPoint) {
    const xs = [box.min.x, box.max.x]
    const ys = [box.min.y, box.max.y]
    const zs = [box.min.z, box.max.z]
    const worldEdges: Array<[Vector3, Vector3]> = []
    for (const y of ys) {
      for (const z of zs)
        worldEdges.push([new Vector3(box.min.x, y, z), new Vector3(box.max.x, y, z)])
    }
    for (const x of xs) {
      for (const z of zs)
        worldEdges.push([new Vector3(x, box.min.y, z), new Vector3(x, box.max.y, z)])
    }
    for (const x of xs) {
      for (const y of ys)
        worldEdges.push([new Vector3(x, y, box.min.z), new Vector3(x, y, box.max.z)])
    }

    const segments = worldEdges.flatMap(([startWorld, endWorld]) => {
      const start = worldToBuildingLocal([startWorld.x, startWorld.y, startWorld.z])
      const end = worldToBuildingLocal([endWorld.x, endWorld.y, endWorld.z])
      const measuredDistanceMeters = distanceBetweenMeasurements(start, end)
      return measuredDistanceMeters >= 1e-4 ? [{ start, end, measuredDistanceMeters }] : []
    })
    const closest = closestSegmentToPoint(segments, hitPoint)
    if (closest) return closest
  }

  const startWorld = measureX
    ? new Vector3(box.min.x, box.min.y, center.z)
    : new Vector3(center.x, box.min.y, box.min.z)
  const endWorld = measureX
    ? new Vector3(box.max.x, box.min.y, center.z)
    : new Vector3(center.x, box.min.y, box.max.z)
  const start = worldToBuildingLocal([startWorld.x, startWorld.y, startWorld.z])
  const end = worldToBuildingLocal([endWorld.x, endWorld.y, endWorld.z])

  return { start, end, measuredDistanceMeters: length }
}

function directLengthSegmentFromNode(
  node: AnyNode,
  hitPoint: MeasurementPoint | null = null,
  hitNormal: MeasurementPoint | null = null,
): DirectLengthSegment | null {
  if (node.type === 'wall') return wallLengthSegment(node as WallNode)
  if (node.type === 'fence') return fenceLengthSegment(node as FenceNode)
  if (node.type === 'door' || node.type === 'window') return wallHostedOpeningLengthSegment(node)
  if (node.type === 'item')
    return (
      localBoxLengthSegment(node, getScaledDimensions(node as ItemNode), hitPoint) ??
      renderedBoundingBoxLengthSegment(node, hitPoint, hitNormal)
    )
  if (node.type === 'column') {
    return renderedBoundingBoxLengthSegment(node, hitPoint, hitNormal)
  }
  if (node.type === 'elevator') {
    return renderedBoundingBoxLengthSegment(node, hitPoint, hitNormal)
  }
  return renderedBoundingBoxLengthSegment(node, hitPoint, hitNormal)
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
  boundaryPoints: MeasurementPoint[]
  labelPoint: MeasurementPoint
} | null {
  if (!(node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone')) return null

  const surface = node as SlabNode | CeilingNode | ZoneNode
  const outer = polygonAreaAndCentroid(surface.polygon)
  const holes = 'holes' in surface ? surface.holes : []
  const holesArea = holes.reduce((sum, hole) => sum + polygonAreaAndCentroid(hole).area, 0)
  const labelY =
    surface.type === 'ceiling' ? surface.height : surface.type === 'slab' ? surface.elevation : 0
  const boundaryY = labelY + 0.02

  return {
    areaSquareMeters: Math.max(0, outer.area - holesArea),
    boundaryPoints: surface.polygon.map((point): MeasurementPoint => [
      point[0],
      boundaryY,
      point[1],
    ]),
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

function polygonDraftPointsWithCursor(draft: MeasurementPolygonDraft): MeasurementPoint[] {
  return draft.cursor ? [...draft.points, draft.cursor] : draft.points
}

function updatePolygonMeasurementPreview3D(): void {
  const measurement = useMeasurementTool.getState()
  const draft = measurement.polygonDraft
  if (draft?.view !== '3d') return
  const points = polygonDraftPointsWithCursor(draft)
  if (points.length < 3) {
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(null)
    return
  }

  const { areaSquareMeters, labelPoint } = polygonAreaAndLabelPointFromMeasurements(points)
  if (measurement.mode === 'area') {
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewArea({
      id: 'measurement-area-preview',
      areaSquareMeters,
      labelPoint,
      view: '3d',
    })
    return
  }

  if (measurement.mode === 'perimeter') {
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter({
      id: 'measurement-perimeter-preview',
      labelPoint,
      lengthMeters: polygonPerimeterFromMeasurements(points),
      view: '3d',
    })
  }
}

function handlePolygonGridClick3D(point: MeasurementPoint): boolean {
  const measurement = useMeasurementTool.getState()
  if (!(measurement.mode === 'area' || measurement.mode === 'perimeter')) return false
  const draft = measurement.polygonDraft
  if (draft?.view !== '3d') {
    measurement.beginPolygon('3d', point)
    return true
  }

  const first = draft.points[0]
  if (first && draft.points.length >= 3 && distanceBetweenMeasurements(first, point) < 0.25) {
    measurement.commitPolygon()
    return true
  }

  measurement.addPolygonPoint(point)
  updatePolygonMeasurementPreview3D()
  return true
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
  measurement.setPreviewArea(null)
  measurement.setPreviewPerimeter(null)
  measurement.setPreviewSegment(null)
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
  if (measurement.polygonDraft?.view === '3d') {
    measurement.updatePolygon(point)
    updatePolygonMeasurementPreview3D()
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
  measurement.setPreviewArea(null)
  measurement.setPreviewPerimeter(null)
  measurement.setPreviewSegment(null)
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
  if (handlePolygonGridClick3D(point)) return
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
        measurement.addArea('3d', area.labelPoint, area.areaSquareMeters, area.boundaryPoints)
        return
      }
    }

    if (measurement.mode === 'distance' && quickMeasure) {
      const segment = directLengthSegmentFromNode(
        event.node,
        measurementPointFromNodeEvent(event),
        surfaceNormal,
      )
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

export function handleMeasurementNodeMove3D(event: NodeEvent): void {
  event.stopPropagation()

  const rawPoint = measurementPointFromNodeEvent(event)
  const snap = resolveNodeMeasurementSnap(event, rawPoint)
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
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewSegment(null)
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
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewSegment(null)
    measurement.updateAngle(point)
    return
  }
  if (measurement.draft) {
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewSegment(null)
    measurement.update(point)
    return
  }
  if (measurement.polygonDraft?.view === '3d') {
    measurement.setPreviewSegment(null)
    measurement.updatePolygon(point)
    updatePolygonMeasurementPreview3D()
    return
  }

  if (measurement.mode === 'area') {
    const area = surfaceAreaMeasurementFromNode(event.node)
    measurement.setPreviewSegment(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewArea(
      area
        ? {
            id: 'measurement-area-preview',
            areaSquareMeters: area.areaSquareMeters,
            boundaryPoints: area.boundaryPoints,
            labelPoint: area.labelPoint,
            view: '3d',
          }
        : null,
    )
    return
  }

  if (measurement.mode === 'perimeter') {
    const perimeter = surfacePerimeterMeasurementFromNode(event.node)
    measurement.setPreviewSegment(null)
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(
      perimeter
        ? {
            id: 'measurement-perimeter-preview',
            labelPoint: perimeter.labelPoint,
            lengthMeters: perimeter.lengthMeters,
            view: '3d',
          }
        : null,
    )
    return
  }

  measurement.setPreviewArea(null)
  measurement.setPreviewPerimeter(null)
  const preview =
    measurement.mode === 'distance'
      ? directLengthSegmentFromNode(event.node, rawPoint, surfaceNormal)
      : null
  if (preview) {
    measurement.setCursor('3d', rawPoint)
    measurement.setSnapTarget(null)
  }
  measurement.setPreviewSegment(
    preview
      ? {
          id: 'measurement-preview',
          start: preview.start,
          end: preview.end,
          measuredDistanceMeters: preview.measuredDistanceMeters,
          view: '3d',
        }
      : null,
  )
}

function MeasurementCursor3D({
  point,
}: {
  point: MeasurementPoint
}) {
  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)
  const material = appearance === 'dark' ? darkDraftMeasurementMaterial : draftMeasurementMaterial

  return (
    <group position={point}>
      <mesh
        geometry={endpointHandleGeometry}
        layers={EDITOR_LAYER}
        material={material}
        renderOrder={1001}
        scale={MEASUREMENT_CURSOR_SIZE * 0.72}
      />
    </group>
  )
}

function MeasurementSnapTarget3D({ target }: { target: MeasurementSnapTarget }) {
  return (
    <group position={target.point}>
      <MeasurementCursor3D point={[0, 0, 0]} />
    </group>
  )
}

function selectMeasurementMaterial({
  draft,
  isDark,
  isSelected,
}: {
  draft?: boolean
  isDark: boolean
  isSelected?: boolean
}) {
  if (draft) return isDark ? darkDraftMeasurementMaterial : draftMeasurementMaterial
  if (isSelected) return isDark ? darkMeasurementMaterial : measurementMaterial
  return isDark ? darkMutedMeasurementMaterial : mutedMeasurementMaterial
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
  onSelect: (id: string, event: PointerEvent<HTMLElement>) => void
}) {
  const unit = useViewer((s) => s.unit)
  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)
  const isDark = appearance === 'dark'
  const material = selectMeasurementMaterial({
    draft: area.id.includes('preview'),
    isDark,
    isSelected,
  })

  return (
    <group>
      <AreaMeasurementBoundary3D area={area} material={material} />
      <Html
        center
        position={area.labelPoint}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <MeasurementValueLabel
          isSelected={isSelected}
          onPointerDown={(event) => onSelect(area.id, event)}
        >
          {formatAreaMeasurement(area.areaSquareMeters, unit, { precision: displayPrecision })}
        </MeasurementValueLabel>
      </Html>
    </group>
  )
}

function AreaMeasurementBoundary3D({
  area,
  material,
}: {
  area: MeasurementArea
  material: MeshBasicNodeMaterial
}) {
  const points = area.boundaryPoints
  if (!points || points.length < 3) return null

  return (
    <group>
      {points.map((point, index) => {
        const next = points[(index + 1) % points.length]
        if (!next) return null
        return (
          <MeasurementBar3D
            end={new Vector3(...next)}
            key={`${area.id}-boundary-${index}`}
            material={material}
            start={new Vector3(...point)}
            width={MEASUREMENT_LINE_WIDTH * 1.35}
          />
        )
      })}
    </group>
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
  onSelect: (id: string, event: PointerEvent<HTMLElement>) => void
  perimeter: MeasurementPerimeter
}) {
  const unit = useViewer((s) => s.unit)

  return (
    <Html
      center
      position={perimeter.labelPoint}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[100, 0]}
    >
      <MeasurementValueLabel
        isSelected={isSelected}
        onPointerDown={(event) => onSelect(perimeter.id, event)}
      >
        {`P ${formatLinearMeasurement(perimeter.lengthMeters, unit, { precision: displayPrecision })}`}
      </MeasurementValueLabel>
    </Html>
  )
}

function MeasurementValueLabel({
  children,
  isSelected = true,
  onPointerDown,
}: {
  children: ReactNode
  isSelected?: boolean
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <DimensionPillShell
      className="transition-opacity"
      onPointerDown={onPointerDown}
      style={{
        cursor: onPointerDown ? 'pointer' : undefined,
        opacity: isSelected ? 1 : 0.45,
        pointerEvents: onPointerDown ? 'auto' : 'none',
      }}
    >
      <span className={DIMENSION_PILL_PRIMARY_CLASS_NAME}>{children}</span>
    </DimensionPillShell>
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

export function getMeasurementAngleLayout3D(angle: MeasurementAngle) {
  const first = new Vector3(...angle.first)
  const vertex = new Vector3(...angle.vertex)
  const second = new Vector3(...angle.second)
  const firstDirection = first.clone().sub(vertex)
  const secondDirection = second.clone().sub(vertex)
  const firstLength = firstDirection.length()
  const secondLength = secondDirection.length()
  if (firstLength < 1e-4 || secondLength < 1e-4) return null

  firstDirection.normalize()
  secondDirection.normalize()
  const radians = firstDirection.angleTo(secondDirection)
  if (radians < 1e-4) return null

  const normal = firstDirection.clone().cross(secondDirection)
  if (normal.lengthSq() < 1e-8) return null
  normal.normalize()

  const radius = Math.max(
    MEASUREMENT_ANGLE_ARC_MIN_RADIUS,
    Math.min(MEASUREMENT_ANGLE_ARC_MAX_RADIUS, firstLength * 0.35, secondLength * 0.35),
  )
  const sampleCount = Math.max(8, Math.ceil((radians / Math.PI) * MEASUREMENT_ANGLE_ARC_SEGMENTS))
  const points = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const t = index / sampleCount
    return firstDirection
      .clone()
      .applyAxisAngle(normal, radians * t)
      .multiplyScalar(radius)
      .add(vertex)
  })
  const arcSegments = points.slice(1).map((point, index) => ({
    end: point,
    start: points[index]!,
  }))
  const arcRadials = [
    { end: points[0]!, start: vertex },
    { end: points[points.length - 1]!, start: vertex },
  ]
  const labelDirection = firstDirection.clone().applyAxisAngle(normal, radians / 2)

  return {
    arcRadials,
    arcSegments,
    labelPosition: vertex.clone().add(labelDirection.multiplyScalar(radius + 0.24)),
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
  onSelect?: (id: string, event: PointerEvent<HTMLElement>) => void
  segment: Pick<MeasurementSegment, 'id' | 'start' | 'end' | 'measuredDistanceMeters'>
  showLabel?: boolean
}) {
  const unit = useViewer((s) => s.unit)
  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)
  const isDark = appearance === 'dark'
  const distance =
    segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end)
  const lineLayout = useMemo(() => measurementLineLayout3D(segment), [segment])

  if (distance < 1e-4) return null

  const material = selectMeasurementMaterial({ draft, isDark, isSelected })

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
        <Html
          center
          position={labelPosition ?? lineLayout.labelPosition}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[100, 0]}
        >
          <MeasurementValueLabel
            isSelected={isSelected}
            onPointerDown={onSelect && !draft ? (event) => onSelect(segment.id, event) : undefined}
          >
            {formatLinearMeasurement(distance, unit, { precision: displayPrecision })}
          </MeasurementValueLabel>
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
  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)
  const isDark = appearance === 'dark'
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
              geometry={endpointHandleGeometry}
              layers={EDITOR_LAYER}
              material={selectMeasurementMaterial({
                draft: activeHandle,
                isDark,
                isSelected: true,
              })}
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
  onSelect?: (id: string, event: PointerEvent<HTMLElement>) => void
}) {
  const angleLayout = useMemo(() => getMeasurementAngleLayout3D(angle), [angle])
  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)
  const isDark = appearance === 'dark'
  const material = selectMeasurementMaterial({ draft, isDark, isSelected })

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
      {angleLayout?.arcSegments.map((segment, index) => (
        <MeasurementBar3D
          end={segment.end}
          key={`${angle.id}-arc-${index}`}
          material={material}
          start={segment.start}
          width={MEASUREMENT_LINE_WIDTH * 1.35}
        />
      ))}
      {angleLayout?.arcRadials.map((segment, index) => (
        <MeasurementBar3D
          end={segment.end}
          key={`${angle.id}-arc-radial-${index}`}
          material={material}
          start={segment.start}
          width={MEASUREMENT_LINE_WIDTH * 1.35}
        />
      ))}
      {angleLayout ? (
        <Html
          center
          position={angleLayout.labelPosition}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[100, 0]}
        >
          <MeasurementValueLabel
            isSelected={isSelected}
            onPointerDown={onSelect && !draft ? (event) => onSelect(angle.id, event) : undefined}
          >
            {formatAngleMeasurement(
              angleBetweenMeasurements(angle.first, angle.vertex, angle.second),
              { precision: displayPrecision },
            )}
          </MeasurementValueLabel>
        </Html>
      ) : null}
    </group>
  )
}

export function MeasurementTool() {
  const canvas = useThree((state) => state.gl.domElement)
  const segments = useMeasurementTool((state) => state.segments)
  const areas = useMeasurementTool((state) => state.areas)
  const perimeters = useMeasurementTool((state) => state.perimeters)
  const angles = useMeasurementTool((state) => state.angles)
  const draft = useMeasurementTool((state) => state.draft)
  const polygonDraft = useMeasurementTool((state) => state.polygonDraft)
  const previewArea = useMeasurementTool((state) => state.previewArea)
  const previewPerimeter = useMeasurementTool((state) => state.previewPerimeter)
  const previewSegment = useMeasurementTool((state) => state.previewSegment)
  const angleDraft = useMeasurementTool((state) => state.angleDraft)
  const cursor = useMeasurementTool((state) => state.cursor)
  const snapTarget = useMeasurementTool((state) => state.snapTarget)
  const displayPrecision = useMeasurementTool((state) => state.displayPrecision)
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
      handleMeasurementNodeMove3D(event)
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
        !measurement.draggingSegmentEndpoint &&
        !measurement.polygonDraft &&
        !measurement.previewArea &&
        !measurement.previewPerimeter &&
        !measurement.previewSegment &&
        !measurement.snapTarget
      )
        return
      markToolCancelConsumed()
      measurement.cancelDraft()
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

  const handleSelectMeasurement = (id: string, event: PointerEvent<HTMLElement>) => {
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
    ? segments.find((segment) => segment.id === selectedId)
    : null
  const segmentLabelPositions = useMemo(() => {
    const layouts = staggerMeasurementLabelLayouts3D(
      segments.map((segment) => measurementLineLayout3D(segment)),
    )
    return new Map(layouts.map((layout) => [layout.id, layout.labelPosition]))
  }, [segments])
  const polygonDraftSegments =
    polygonDraft?.view === '3d'
      ? polygonDraftPointsWithCursor(polygonDraft).flatMap((point, index, points) => {
          const next = points[index + 1] ?? (points.length >= 3 ? points[0] : null)
          return next
            ? [
                {
                  id: `measurement-polygon-draft-${index}`,
                  start: point,
                  end: next,
                },
              ]
            : []
        })
      : []

  return (
    <>
      {segments.map((segment) => (
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
      {!draft && previewSegment?.view === '3d' ? (
        <MeasurementLine3D displayPrecision={displayPrecision} draft segment={previewSegment} />
      ) : null}
      {polygonDraftSegments.map((segment) => (
        <MeasurementLine3D
          displayPrecision={displayPrecision}
          draft
          key={segment.id}
          segment={segment}
          showLabel={false}
        />
      ))}
      {areas.map((area) => (
        <MeasurementArea3D
          area={area}
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === area.id : true}
          key={area.id}
          onSelect={handleSelectMeasurement}
        />
      ))}
      {previewArea?.view === '3d' ? (
        <MeasurementArea3D
          area={previewArea}
          displayPrecision={displayPrecision}
          isSelected
          onSelect={handleSelectMeasurement}
        />
      ) : null}
      {perimeters.map((perimeter) => (
        <MeasurementPerimeter3D
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === perimeter.id : true}
          key={perimeter.id}
          onSelect={handleSelectMeasurement}
          perimeter={perimeter}
        />
      ))}
      {previewPerimeter?.view === '3d' ? (
        <MeasurementPerimeter3D
          displayPrecision={displayPrecision}
          isSelected
          onSelect={handleSelectMeasurement}
          perimeter={previewPerimeter}
        />
      ) : null}
      {angles.map((angle) => (
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
