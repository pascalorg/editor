'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GeometryContext,
  type GridEvent,
  type MeasurementDefinitionArea,
  type MeasurementDefinitionDirectLength,
  type MeasurementDefinitionPerimeter,
  type MeasurementDefinitionSnapGeometry,
  type NodeEvent,
  nodeRegistry,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef } from 'react'
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  type Group,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
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
  type LinearUnit,
} from '../../../lib/measurements'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
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
const MEASUREMENT_PERIMETER_BOUNDARY_WIDTH = MEASUREMENT_LINE_WIDTH * 0.75
const MEASUREMENT_END_TICK = 0.28
const MEASUREMENT_LABEL_LIFT = 0.08
const MEASUREMENT_CURSOR_SIZE = 0.18
const MEASUREMENT_CURSOR_WIDTH = 0.018
const MEASUREMENT_SNAP_COLOR = 0xff_ff_ff
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
const MEASUREMENT_IGNORED_NODE_TYPES = new Set(['site'])
type MeasurementAppearance = 'dark' | 'light'

const dashGeometry = new BoxGeometry(1, 1, 1)
const endpointHandleGeometry = new SphereGeometry(0.5, 24, 16)
const endpointHandleHexGeometry = new CircleGeometry(0.5, 6)
const endpointHandleHexRingGeometry = new RingGeometry(0.5, 0.62, 6)
const snapTargetRingGeometry = new TorusGeometry(0.5, 0.02, 8, 36)
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
const snapTargetRingMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_SNAP_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.68,
  toneMapped: false,
  transparent: true,
})
const snapTargetLineMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_SNAP_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: 0.5,
  toneMapped: false,
  transparent: true,
})

function measurableNodeKinds(): string[] {
  return Array.from(nodeRegistry.entries()).flatMap(([kind, def]) =>
    !MEASUREMENT_IGNORED_NODE_TYPES.has(kind) &&
    (def.measurement ||
      def.floorplan ||
      def.renderer ||
      def.geometry ||
      def.capabilities.selectable)
      ? [kind]
      : [],
  )
}

function isIgnoredMeasurementNode(node: AnyNode): boolean {
  return MEASUREMENT_IGNORED_NODE_TYPES.has(node.type)
}

function clearTransientMeasurementHover() {
  const measurement = useMeasurementTool.getState()
  measurement.setCursor('3d', null)
  measurement.setSnapTarget(null)
  measurement.setPreviewArea(null)
  measurement.setPreviewPerimeter(null)
  measurement.setPreviewSegment(null)
}

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

function worldToBuildingLocal(
  point: [number, number, number],
  buildingId: AnyNodeId | null,
): MeasurementPoint {
  const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
  const local = buildingMesh
    ? buildingMesh.worldToLocal(new Vector3(...point))
    : new Vector3(...point)
  return [local.x, local.y, local.z]
}

function measurementPointFromNodeEvent(
  event: NodeEvent,
  buildingId: AnyNodeId | null,
): MeasurementPoint {
  return worldToBuildingLocal(event.position, buildingId)
}

function measurementNormalFromNodeEvent(
  event: NodeEvent,
  buildingId: AnyNodeId | null,
): MeasurementPoint | null {
  if (!event.normal) return null
  const localNormal = new Vector3(...event.normal).normalize()
  if (localNormal.lengthSq() < 1e-8) return null

  const worldOrigin = event.object.localToWorld(new Vector3(0, 0, 0))
  const worldNormalPoint = event.object.localToWorld(localNormal.clone())
  const localOrigin = worldToBuildingLocal(
    [worldOrigin.x, worldOrigin.y, worldOrigin.z],
    buildingId,
  )
  const localNormalPoint = worldToBuildingLocal(
    [worldNormalPoint.x, worldNormalPoint.y, worldNormalPoint.z],
    buildingId,
  )
  const normal = new Vector3(
    localNormalPoint[0] - localOrigin[0],
    localNormalPoint[1] - localOrigin[1],
    localNormalPoint[2] - localOrigin[2],
  ).normalize()
  if (normal.lengthSq() < 1e-8) return null
  return [normal.x, normal.y, normal.z]
}

function measurementGeometryContextForNode(node: AnyNode): GeometryContext {
  const nodes = useScene.getState().nodes
  const childIds = (node as { children?: readonly AnyNodeId[] }).children ?? []
  return {
    children: childIds.flatMap((id: AnyNodeId) => {
      const child = nodes[id as AnyNodeId]
      return child ? [child] : []
    }),
    parent: node.parentId ? (nodes[node.parentId as AnyNodeId] ?? null) : null,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    siblings: node.parentId
      ? Object.values(nodes).filter(
          (candidate) => candidate.parentId === node.parentId && candidate.id !== node.id,
        )
      : [],
  }
}

function registryMeasurementForNode(node: AnyNode) {
  return nodeRegistry.get(node.type)?.measurement
}

function definitionPoint(point: readonly [number, number, number]): MeasurementPoint {
  return [...point] as MeasurementPoint
}

function directLengthFromDefinition(
  node: AnyNode,
  buildingId: AnyNodeId | null,
  hitPoint: MeasurementPoint | null,
  hitNormal: MeasurementPoint | null,
): DirectLengthSegment | null {
  const directLength = registryMeasurementForNode(node)?.directLength?.(
    node as never,
    measurementGeometryContextForNode(node),
    hitPoint,
    hitNormal,
  ) as MeasurementDefinitionDirectLength | null | undefined
  if (!directLength) return null
  return alignVerticalDefinitionLengthToRenderedBase(node, buildingId, {
    start: definitionPoint(directLength.start),
    end: definitionPoint(directLength.end),
    measuredDistanceMeters: directLength.measuredDistanceMeters,
  })
}

function areaFromDefinition(node: AnyNode): MeasurementDefinitionArea | null {
  return (
    (registryMeasurementForNode(node)?.area?.(
      node as never,
      measurementGeometryContextForNode(node),
    ) as MeasurementDefinitionArea | null | undefined) ?? null
  )
}

function perimeterFromDefinition(node: AnyNode): MeasurementDefinitionPerimeter | null {
  return (
    (registryMeasurementForNode(node)?.perimeter?.(
      node as never,
      measurementGeometryContextForNode(node),
    ) as MeasurementDefinitionPerimeter | null | undefined) ?? null
  )
}

function perimeterBoundaryPointsFromDefinition3D(
  node: AnyNode,
  perimeter: MeasurementDefinitionPerimeter,
): MeasurementPoint[] {
  const boundaryPoints =
    (perimeter.boundaryPoints?.length ?? 0) >= 3
      ? perimeter.boundaryPoints
      : areaFromDefinition(node)?.boundaryPoints
  return (boundaryPoints ?? []).map(definitionPoint)
}

function snapAnchorsFromDefinition(node: AnyNode): MeasurementSnapAnchor[] {
  const geometry = registryMeasurementForNode(node)?.snapGeometry?.(
    node as never,
    measurementGeometryContextForNode(node),
  ) as MeasurementDefinitionSnapGeometry | null | undefined
  return (geometry?.anchors ?? []).map((anchor) => ({
    ...anchor,
    point: definitionPoint(anchor.point),
    targetLine: anchor.targetLine
      ? {
          end: definitionPoint(anchor.targetLine.end),
          start: definitionPoint(anchor.targetLine.start),
        }
      : undefined,
  }))
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

type DirectLengthSegment = {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
}

function alignVerticalDefinitionLengthToRenderedBase(
  node: AnyNode,
  buildingId: AnyNodeId | null,
  segment: DirectLengthSegment,
): DirectLengthSegment {
  const dx = segment.end[0] - segment.start[0]
  const dz = segment.end[2] - segment.start[2]
  if (Math.hypot(dx, dz) > 1e-6) return segment

  const object = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!object) return segment

  const geometry = (object as { geometry?: unknown }).geometry
  let localBaseY = 0
  if (geometry instanceof BufferGeometry) {
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    localBaseY = geometry.boundingBox?.min.y ?? 0
  }

  const baseWorld = object.localToWorld(new Vector3(0, localBaseY, 0))
  const renderedBaseY = worldToBuildingLocal([baseWorld.x, baseWorld.y, baseWorld.z], buildingId)[1]
  const segmentBaseY = Math.min(segment.start[1], segment.end[1])
  const offsetY = renderedBaseY - segmentBaseY
  if (Math.abs(offsetY) < 1e-6) return segment

  return {
    ...segment,
    start: [segment.start[0], segment.start[1] + offsetY, segment.start[2]],
    end: [segment.end[0], segment.end[1] + offsetY, segment.end[2]],
  }
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

function projectPointToMeasurementSegment(
  point: MeasurementPoint,
  start: MeasurementPoint,
  end: MeasurementPoint,
): MeasurementPoint | null {
  const sx = start[0]
  const sy = start[1]
  const sz = start[2]
  const dx = end[0] - sx
  const dy = end[1] - sy
  const dz = end[2] - sz
  const lengthSq = dx * dx + dy * dy + dz * dz
  if (lengthSq < 1e-8) return null
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - sx) * dx + (point[1] - sy) * dy + (point[2] - sz) * dz) / lengthSq),
  )
  return [sx + dx * t, sy + dy * t, sz + dz * t]
}

function snapTargetFromPreviewSegment3D(
  point: MeasurementPoint,
  segment: DirectLengthSegment,
): MeasurementSnapTarget | null {
  const projected = projectPointToMeasurementSegment(point, segment.start, segment.end)
  if (!projected) return null
  return {
    kind: 'edge',
    label: 'Preview edge',
    point: projected,
    targetLine: {
      end: segment.end,
      start: segment.start,
    },
    view: '3d',
  }
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

function snapGeometryLengthSegmentFromNode(
  node: AnyNode,
  hitPoint: MeasurementPoint | null,
): DirectLengthSegment | null {
  if (!hitPoint) return null
  const geometry = registryMeasurementForNode(node)?.snapGeometry?.(
    node as never,
    measurementGeometryContextForNode(node),
  ) as MeasurementDefinitionSnapGeometry | null | undefined
  const segments = (geometry?.segments ?? []).flatMap((segment) => {
    const start = definitionPoint(segment.start)
    const end = definitionPoint(segment.end)
    const measuredDistanceMeters = distanceBetweenMeasurements(start, end)
    return measuredDistanceMeters >= 1e-4 ? [{ start, end, measuredDistanceMeters }] : []
  })
  return closestSegmentToPoint(segments, hitPoint)
}

function renderedBoundingBoxLengthSegment(
  node: AnyNode,
  buildingId: AnyNodeId | null,
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
    const localCorners = corners.map((corner) => worldToBuildingLocal(corner, buildingId))
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
      const start = worldToBuildingLocal([startWorld.x, startWorld.y, startWorld.z], buildingId)
      const end = worldToBuildingLocal([endWorld.x, endWorld.y, endWorld.z], buildingId)
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
  const start = worldToBuildingLocal([startWorld.x, startWorld.y, startWorld.z], buildingId)
  const end = worldToBuildingLocal([endWorld.x, endWorld.y, endWorld.z], buildingId)

  return { start, end, measuredDistanceMeters: length }
}

function directLengthSegmentFromNode(
  node: AnyNode,
  buildingId: AnyNodeId | null,
  hitPoint: MeasurementPoint | null = null,
  hitNormal: MeasurementPoint | null = null,
): DirectLengthSegment | null {
  const contributed = directLengthFromDefinition(node, buildingId, hitPoint, hitNormal)
  if (contributed) return contributed
  const snapSegment = snapGeometryLengthSegmentFromNode(node, hitPoint)
  if (snapSegment) return snapSegment
  return renderedBoundingBoxLengthSegment(node, buildingId, hitPoint, hitNormal)
}

function surfaceAreaMeasurementFromNode(node: AnyNode): {
  areaSquareMeters: number
  boundaryPoints: MeasurementPoint[]
  labelPoint: MeasurementPoint
} | null {
  const area = areaFromDefinition(node)
  if (!area) return null
  return {
    areaSquareMeters: area.areaSquareMeters,
    boundaryPoints: (area.boundaryPoints ?? []).map(definitionPoint),
    labelPoint: definitionPoint(area.labelPoint),
  }
}

function surfacePerimeterMeasurementFromNode(node: AnyNode): {
  boundaryPoints: MeasurementPoint[]
  labelPoint: MeasurementPoint
  lengthMeters: number
} | null {
  const perimeter = perimeterFromDefinition(node)
  if (!perimeter) return null
  return {
    boundaryPoints: perimeterBoundaryPointsFromDefinition3D(node, perimeter),
    labelPoint: definitionPoint(perimeter.labelPoint),
    lengthMeters: perimeter.lengthMeters,
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
  buildingId: AnyNodeId | null,
): MeasurementPoint {
  const worldPoint = object.localToWorld(point.clone())
  return worldToBuildingLocal([worldPoint.x, worldPoint.y, worldPoint.z], buildingId)
}

function isBufferGeometry(value: unknown): value is BufferGeometry {
  return value instanceof BufferGeometry
}

type MeshSnapCandidate = {
  kind: 'center' | 'edge' | 'vertex'
  label: string
  localPoint: Vector3
  localTargetLine?: {
    end: Vector3
    start: Vector3
  }
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
      ? [
          {
            kind: 'edge' as const,
            label: 'Mesh edge',
            localPoint: projection,
            localTargetLine: { end, start },
            priority: 2,
          },
        ]
      : []
  })
  const faceCenter = vertices[0]
    .clone()
    .add(vertices[1])
    .add(vertices[2])
    .multiplyScalar(1 / 3)

  return [
    ...vertices.map((localPoint, index) => ({
      kind: 'vertex' as const,
      label: 'Mesh vertex',
      localPoint,
      localTargetLine: { start: localPoint, end: vertices[(index + 1) % vertices.length]! },
      priority: 0,
    })),
    { kind: 'center' as const, label: 'Face center', localPoint: faceCenter, priority: 1 },
    ...edges,
  ]
}

function boundingBoxMeasurementAnchors(
  node: AnyNode,
  buildingId: AnyNodeId | null,
): MeasurementSnapAnchor[] {
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
    point: worldToBuildingLocal([point.x, point.y, point.z], buildingId),
  }))
}

function nodeMeasurementAnchors(
  node: AnyNode,
  buildingId: AnyNodeId | null,
): MeasurementSnapAnchor[] {
  return [...snapAnchorsFromDefinition(node), ...boundingBoxMeasurementAnchors(node, buildingId)]
}

function resolveNodeMeasurementSnap(
  event: NodeEvent,
  point: MeasurementPoint,
  buildingId: AnyNodeId | null,
): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  const anchors = [
    ...meshSnapCandidatesFromEvent(event).map((candidate) => ({
      kind: candidate.kind,
      label: candidate.label,
      point: measurementPointFromObjectLocalPoint(event.object, candidate.localPoint, buildingId),
      priority: candidate.priority,
      targetLine: candidate.localTargetLine
        ? {
            end: measurementPointFromObjectLocalPoint(
              event.object,
              candidate.localTargetLine.end,
              buildingId,
            ),
            start: measurementPointFromObjectLocalPoint(
              event.object,
              candidate.localTargetLine.start,
              buildingId,
            ),
          }
        : undefined,
    })),
    ...nodeMeasurementAnchors(event.node, buildingId).map((anchor) => ({
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
          targetLine: closest.targetLine,
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
  const constrained = anchor ? resolveGridMeasurementConstraint3D(anchor, snap.point) : null
  const point = constrained?.point ?? snap.point

  return {
    point,
    target: constrained?.target ?? snap.target,
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
      boundaryPoints: points,
      labelPoint,
      view: '3d',
    })
    return
  }

  if (measurement.mode === 'perimeter') {
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter({
      id: 'measurement-perimeter-preview',
      boundaryPoints: points,
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
    measurement.draft?.view === '3d'
      ? resolveGridMeasurementConstraint3D(measurement.draft.start, snap.point)
      : null
  const point = constrained?.point ?? snap.point
  measurement.setSnapTarget(constrained?.target ?? snap.target)
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
  if (measurement.consumeSuppressedPlacementClick()) return
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
    measurement.draft?.view === '3d'
      ? resolveGridMeasurementConstraint3D(measurement.draft.start, snap.point)
      : null
  const point = constrained?.point ?? snap.point
  const target = constrained?.target ?? snap.target
  measurement.setSnapTarget(target)
  measurement.setCursor('3d', point)
  if (measurement.mode === 'angle' || measurement.angleDraft) {
    if (measurement.angleDraft) {
      measurement.commitAngle(point)
    } else {
      measurement.beginAngle('3d', point, target?.targetLine ?? null)
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

export function handleMeasurementNodeClick3D(
  event: NodeEvent,
  buildingId: AnyNodeId | null = null,
): void {
  if (useMeasurementTool.getState().consumeSuppressedPlacementClick()) {
    event.stopPropagation()
    return
  }
  if (isIgnoredMeasurementNode(event.node)) {
    clearTransientMeasurementHover()
    return
  }

  event.stopPropagation()

  const measurement = useMeasurementTool.getState()
  const rawPoint = measurementPointFromNodeEvent(event, buildingId)
  const snap = resolveNodeMeasurementSnap(event, rawPoint, buildingId)
  const surfaceNormal = measurementNormalFromNodeEvent(event, buildingId)
  const point = snap.point
  const quickMeasure = Boolean(
    event.nativeEvent.altKey || event.nativeEvent.ctrlKey || event.nativeEvent.metaKey,
  )
  measurement.setCursor('3d', point)
  measurement.setSnapTarget(snap.target)
  if (measurement.draggingSegmentEndpoint) {
    measurement.updateSegmentEndpoint(
      measurement.draggingSegmentEndpoint.id,
      measurement.draggingSegmentEndpoint.endpoint,
      point,
    )
    measurement.endSegmentEndpointDrag()
    return
  }
  if (measurement.mode === 'angle' || measurement.angleDraft) {
    if (measurement.angleDraft) {
      measurement.commitAngle(point)
    } else {
      measurement.beginAngle('3d', point, snap.target?.targetLine ?? null)
    }
    return
  }

  if (!measurement.draft) {
    if (quickMeasure || measurement.mode === 'perimeter') {
      const perimeter = surfacePerimeterMeasurementFromNode(event.node)
      if (perimeter) {
        measurement.addPerimeter(
          '3d',
          perimeter.labelPoint,
          perimeter.lengthMeters,
          perimeter.boundaryPoints,
        )
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
      const segment = directLengthSegmentFromNode(event.node, buildingId, rawPoint, surfaceNormal)
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

export function handleMeasurementNodeMove3D(
  event: NodeEvent,
  buildingId: AnyNodeId | null = null,
): void {
  if (isIgnoredMeasurementNode(event.node)) {
    clearTransientMeasurementHover()
    return
  }

  event.stopPropagation()

  const rawPoint = measurementPointFromNodeEvent(event, buildingId)
  const snap = resolveNodeMeasurementSnap(event, rawPoint, buildingId)
  const measurement = useMeasurementTool.getState()
  const surfaceNormal = measurementNormalFromNodeEvent(event, buildingId)
  const snappedPoint = snap.point
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
    measurement.setSnapTarget(snap.target)
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewSegment(null)
    return
  }
  measurement.setCursor('3d', point)
  measurement.setSnapTarget(
    surfaceDistance
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
            boundaryPoints: perimeter.boundaryPoints,
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
      ? directLengthSegmentFromNode(event.node, buildingId, rawPoint, surfaceNormal)
      : null
  const previewTarget = preview ? snapTargetFromPreviewSegment3D(rawPoint, preview) : null
  if (previewTarget && !snap.target) {
    measurement.setCursor('3d', previewTarget.point)
    measurement.setSnapTarget(previewTarget)
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
  appearance,
  point,
}: {
  appearance: MeasurementAppearance
  point: MeasurementPoint
}) {
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

function MeasurementSnapTarget3D({
  appearance,
  target,
}: {
  appearance: MeasurementAppearance
  target: MeasurementSnapTarget
}) {
  const dotMaterial =
    appearance === 'dark' ? darkDraftMeasurementMaterial : draftMeasurementMaterial
  const kind = target.kind ?? 'vertex'
  const targetLine = target.guideLine ?? target.targetLine
  const targetLineHighlight = targetLine
    ? measurementSnapLineHighlight3D(targetLine, target.point, kind === 'guide' ? 1.6 : 0.9)
    : null
  const tick =
    targetLineHighlight && kind === 'edge'
      ? measurementSnapEdgeTick3D(targetLineHighlight, MEASUREMENT_CURSOR_SIZE * 0.82)
      : null
  const ringScale =
    kind === 'grid'
      ? MEASUREMENT_CURSOR_SIZE * 1.14
      : kind === 'measurement'
        ? MEASUREMENT_CURSOR_SIZE * 1.62
        : MEASUREMENT_CURSOR_SIZE * 1.48

  return (
    <group>
      {targetLineHighlight ? (
        <MeasurementBar3D
          end={new Vector3(...targetLineHighlight.end)}
          material={snapTargetLineMaterial}
          start={new Vector3(...targetLineHighlight.start)}
          width={MEASUREMENT_LINE_WIDTH * (kind === 'guide' ? 0.34 : 0.42)}
        />
      ) : null}
      {tick ? (
        <MeasurementBar3D
          end={new Vector3(...tick.end)}
          material={snapTargetLineMaterial}
          start={new Vector3(...tick.start)}
          width={MEASUREMENT_LINE_WIDTH * 0.34}
        />
      ) : null}
      <group position={target.point}>
        {kind === 'measurement' ? (
          <mesh
            geometry={snapTargetRingGeometry}
            layers={EDITOR_LAYER}
            material={snapTargetRingMaterial}
            renderOrder={1001}
            rotation={[Math.PI / 2, 0, 0]}
            scale={MEASUREMENT_CURSOR_SIZE * 1.84}
          />
        ) : null}
        <mesh
          geometry={snapTargetRingGeometry}
          layers={EDITOR_LAYER}
          material={snapTargetRingMaterial}
          renderOrder={1002}
          rotation={[Math.PI / 2, 0, 0]}
          scale={ringScale}
        />
        <mesh
          geometry={endpointHandleGeometry}
          layers={EDITOR_LAYER}
          material={dotMaterial}
          renderOrder={1003}
          scale={MEASUREMENT_CURSOR_SIZE * 0.46}
        />
      </group>
    </group>
  )
}

function measurementSnapLineHighlight3D(
  line: { end: MeasurementPoint; start: MeasurementPoint },
  point: MeasurementPoint,
  maxLength: number,
): { end: MeasurementPoint; start: MeasurementPoint } | null {
  const direction = new Vector3(
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
    line.end[2] - line.start[2],
  )
  const length = direction.length()
  if (length < 1e-6) return null
  const half = Math.min(length, maxLength) / 2
  direction.normalize()
  const center = new Vector3(...point)
  const start = center.clone().add(direction.clone().multiplyScalar(-half))
  const end = center.clone().add(direction.clone().multiplyScalar(half))
  return {
    start: [start.x, start.y, start.z],
    end: [end.x, end.y, end.z],
  }
}

function measurementSnapEdgeTick3D(
  line: { end: MeasurementPoint; start: MeasurementPoint },
  halfLength: number,
): { end: MeasurementPoint; start: MeasurementPoint } | null {
  const direction = new Vector3(
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
    line.end[2] - line.start[2],
  )
  if (direction.lengthSq() < 1e-8) return null
  direction.normalize()
  const normal = new Vector3(0, 1, 0).cross(direction)
  if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0)
  normal.normalize()
  const center = new Vector3(
    (line.start[0] + line.end[0]) / 2,
    (line.start[1] + line.end[1]) / 2,
    (line.start[2] + line.end[2]) / 2,
  )
  const start = center.clone().add(normal.clone().multiplyScalar(-halfLength))
  const end = center.clone().add(normal.clone().multiplyScalar(halfLength))
  return {
    start: [start.x, start.y, start.z],
    end: [end.x, end.y, end.z],
  }
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
  appearance,
  area,
  displayPrecision,
  isSelected,
  onSelect,
  unit,
}: {
  appearance: MeasurementAppearance
  area: MeasurementArea
  displayPrecision: ReturnType<typeof useMeasurementTool.getState>['displayPrecision']
  isSelected: boolean
  onSelect: (id: string, event: PointerEvent<HTMLElement>) => void
  unit: LinearUnit
}) {
  const isDark = appearance === 'dark'
  const material = selectMeasurementMaterial({
    draft: area.id.includes('preview'),
    isDark,
    isSelected,
  })

  return (
    <group>
      <MeasurementBoundary3D
        id={area.id}
        material={material}
        points={area.boundaryPoints}
        width={MEASUREMENT_LINE_WIDTH * 1.35}
      />
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

function MeasurementBoundary3D({
  extendBy = 0,
  id,
  material,
  points,
  width,
}: {
  extendBy?: number
  id: string
  material: MeshBasicNodeMaterial
  points?: MeasurementPoint[]
  width: number
}) {
  if (!points || points.length < 3) return null

  return (
    <group>
      {points.map((point, index) => {
        const next = points[(index + 1) % points.length]
        if (!next) return null
        const segment = extendedMeasurementBoundarySegment(point, next, extendBy)
        return (
          <MeasurementBar3D
            end={new Vector3(...segment.end)}
            key={`${id}-boundary-${index}`}
            material={material}
            start={new Vector3(...segment.start)}
            width={width}
          />
        )
      })}
    </group>
  )
}

function extendedMeasurementBoundarySegment(
  start: MeasurementPoint,
  end: MeasurementPoint,
  extendBy: number,
): { end: MeasurementPoint; start: MeasurementPoint } {
  if (extendBy <= 1e-6) return { end, start }
  const direction = new Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2])
  if (direction.lengthSq() < 1e-8) return { end, start }
  direction.normalize().multiplyScalar(extendBy)
  return {
    start: [start[0] - direction.x, start[1] - direction.y, start[2] - direction.z],
    end: [end[0] + direction.x, end[1] + direction.y, end[2] + direction.z],
  }
}

function MeasurementPerimeter3D({
  appearance,
  displayPrecision,
  isSelected,
  onSelect,
  perimeter,
  unit,
}: {
  appearance: MeasurementAppearance
  displayPrecision: ReturnType<typeof useMeasurementTool.getState>['displayPrecision']
  isSelected: boolean
  onSelect: (id: string, event: PointerEvent<HTMLElement>) => void
  perimeter: MeasurementPerimeter
  unit: LinearUnit
}) {
  const isDark = appearance === 'dark'
  const material = selectMeasurementMaterial({
    draft: perimeter.id.includes('preview'),
    isDark,
    isSelected,
  })
  const boundaryPoints = perimeter.boundaryPoints

  return (
    <group>
      <MeasurementBoundary3D
        extendBy={MEASUREMENT_PERIMETER_BOUNDARY_WIDTH / 2}
        id={perimeter.id}
        material={material}
        points={boundaryPoints}
        width={MEASUREMENT_PERIMETER_BOUNDARY_WIDTH}
      />
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
    </group>
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
  const radius = Math.max(
    MEASUREMENT_ANGLE_ARC_MIN_RADIUS,
    Math.min(MEASUREMENT_ANGLE_ARC_MAX_RADIUS, firstLength * 0.35, secondLength * 0.35),
  )
  if (radians < 1e-4) {
    return {
      arcRadials: [],
      arcSegments: [],
      labelPosition: vertex
        .clone()
        .add(firstDirection.clone().multiplyScalar(radius + 0.24))
        .add(new Vector3(0, 0.18, 0)),
    }
  }

  const normal = firstDirection.clone().cross(secondDirection)
  if (normal.lengthSq() < 1e-8) return null
  normal.normalize()

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
  appearance,
  displayPrecision,
  draft = false,
  isSelected = true,
  labelPosition,
  onSelect,
  segment,
  showLabel = true,
  unit,
}: {
  appearance: MeasurementAppearance
  displayPrecision: ReturnType<typeof useMeasurementTool.getState>['displayPrecision']
  draft?: boolean
  isSelected?: boolean
  labelPosition?: Vector3
  onSelect?: (id: string, event: PointerEvent<HTMLElement>) => void
  segment: Pick<MeasurementSegment, 'id' | 'start' | 'end' | 'measuredDistanceMeters'>
  showLabel?: boolean
  unit: LinearUnit
}) {
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
  appearance,
  draggingEndpoint,
  segment,
}: {
  appearance: MeasurementAppearance
  draggingEndpoint: ReturnType<typeof useMeasurementTool.getState>['draggingSegmentEndpoint']
  segment: Pick<MeasurementSegment, 'end' | 'id' | 'start'>
}) {
  const isDark = appearance === 'dark'
  const handles: Array<{ endpoint: MeasurementSegmentEndpoint; point: MeasurementPoint }> = [
    { endpoint: 'start', point: segment.start },
    { endpoint: 'end', point: segment.end },
  ]
  const material = selectMeasurementMaterial({ draft: false, isDark, isSelected: true })
  const activeMaterial = selectMeasurementMaterial({ draft: true, isDark, isSelected: true })

  return (
    <group>
      {handles.map(({ endpoint, point }) => {
        const activeHandle = isDraggingMeasurementEndpoint(draggingEndpoint, segment.id, endpoint)
        return (
          <MeasurementEndpointHandle3D
            active={activeHandle}
            endpoint={endpoint}
            key={endpoint}
            material={activeHandle ? activeMaterial : material}
            point={point}
            segmentId={segment.id}
          />
        )
      })}
    </group>
  )
}

function MeasurementEndpointHandle3D({
  active,
  endpoint,
  material,
  point,
  segmentId,
}: {
  active: boolean
  endpoint: MeasurementSegmentEndpoint
  material: MeshBasicNodeMaterial
  point: MeasurementPoint
  segmentId: string
}) {
  const { camera } = useThree()
  const billboardRef = useRef<Group>(null)
  const parentWorldQuaternionRef = useRef(new Quaternion())
  const handleSize = active
    ? MEASUREMENT_ENDPOINT_HANDLE_SIZE * 1.35
    : MEASUREMENT_ENDPOINT_HANDLE_SIZE
  const ringSize = handleSize * 1.16

  useFrame(() => {
    const billboard = billboardRef.current
    if (!billboard) return
    const parent = billboard.parent
    if (parent) {
      parent.getWorldQuaternion(parentWorldQuaternionRef.current)
      billboard.quaternion
        .copy(parentWorldQuaternionRef.current.invert())
        .multiply(camera.quaternion)
      return
    }
    billboard.quaternion.copy(camera.quaternion)
  })

  return (
    <group position={point}>
      <mesh
        geometry={dashGeometry}
        layers={EDITOR_LAYER}
        material={endpointHandleHitMaterial}
        onPointerDown={(event) => {
          event.stopPropagation()
          useMeasurementTool.getState().startSegmentEndpointDrag(segmentId, endpoint)
        }}
        renderOrder={1003}
        scale={[
          MEASUREMENT_ENDPOINT_HANDLE_HIT_SIZE,
          MEASUREMENT_ENDPOINT_HANDLE_HIT_SIZE,
          MEASUREMENT_ENDPOINT_HANDLE_HIT_SIZE,
        ]}
      />
      <group ref={billboardRef}>
        <mesh
          geometry={endpointHandleHexRingGeometry}
          layers={EDITOR_LAYER}
          material={material}
          renderOrder={1002}
          scale={[ringSize, ringSize, ringSize]}
        />
        <mesh
          geometry={endpointHandleHexGeometry}
          layers={EDITOR_LAYER}
          material={material}
          renderOrder={1003}
          scale={[handleSize, handleSize, handleSize]}
        />
      </group>
    </group>
  )
}

function MeasurementAngle3D({
  appearance,
  angle,
  displayPrecision,
  draft = false,
  isSelected,
  onSelect,
  unit,
}: {
  appearance: MeasurementAppearance
  angle: MeasurementAngle
  displayPrecision: ReturnType<typeof useMeasurementTool.getState>['displayPrecision']
  draft?: boolean
  isSelected: boolean
  onSelect?: (id: string, event: PointerEvent<HTMLElement>) => void
  unit: LinearUnit
}) {
  const angleLayout = useMemo(() => getMeasurementAngleLayout3D(angle), [angle])
  const isDark = appearance === 'dark'
  const material = selectMeasurementMaterial({ draft, isDark, isSelected })

  return (
    <group>
      <MeasurementLine3D
        appearance={appearance}
        displayPrecision={displayPrecision}
        draft={draft}
        isSelected={isSelected}
        segment={{ id: `${angle.id}-a`, start: angle.vertex, end: angle.first }}
        showLabel={false}
        unit={unit}
      />
      <MeasurementLine3D
        appearance={appearance}
        displayPrecision={displayPrecision}
        draft={draft}
        isSelected={isSelected}
        segment={{ id: `${angle.id}-b`, start: angle.vertex, end: angle.second }}
        showLabel={false}
        unit={unit}
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

export function MeasurementTool({
  appearance,
  buildingId,
  unit,
}: {
  appearance: MeasurementAppearance
  buildingId: AnyNodeId | null
  unit: LinearUnit
}) {
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
    const kinds = measurableNodeKinds()
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
      const measurement = useMeasurementTool.getState()
      if (!measurement.draggingSegmentEndpoint) return
      measurement.endSegmentEndpointDrag({ suppressNextClick: true })
    }

    const handleNodeMove = (event: NodeEvent) => {
      if (isIgnoredMeasurementNode(event.node)) {
        handleMeasurementNodeMove3D(event, buildingId)
        return
      }
      noteSurfaceEvent()
      handleMeasurementNodeMove3D(event, buildingId)
    }

    const handleNodeClick = (event: NodeEvent) => {
      if (isIgnoredMeasurementNode(event.node)) {
        handleMeasurementNodeClick3D(event, buildingId)
        return
      }
      noteSurfaceEvent()
      handleMeasurementNodeClick3D(event, buildingId)
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
    for (const kind of kinds) {
      emitter.on(`${kind}:move` as never, handleNodeMove as never)
      emitter.on(`${kind}:click` as never, handleNodeClick as never)
    }
    return () => {
      emitter.off('grid:move', handleMove)
      emitter.off('grid:click', handleClick)
      emitter.off('tool:cancel', handleCancel)
      window.removeEventListener('pointerup', handlePointerUp, true)
      for (const kind of kinds) {
        emitter.off(`${kind}:move` as never, handleNodeMove as never)
        emitter.off(`${kind}:click` as never, handleNodeClick as never)
      }
    }
  }, [buildingId, canvas])

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
  const selectedSegment = selectedId ? segments.find((segment) => segment.id === selectedId) : null
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
          appearance={appearance}
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === segment.id : true}
          key={segment.id}
          labelPosition={segmentLabelPositions.get(segment.id)}
          onSelect={handleSelectMeasurement}
          segment={segment}
          unit={unit}
        />
      ))}
      {draft?.view === '3d' && draft.end ? (
        <MeasurementLine3D
          appearance={appearance}
          displayPrecision={displayPrecision}
          draft
          segment={{ id: 'measurement-draft', start: draft.start, end: draft.end }}
          unit={unit}
        />
      ) : null}
      {!draft && previewSegment?.view === '3d' ? (
        <MeasurementLine3D
          appearance={appearance}
          displayPrecision={displayPrecision}
          draft
          segment={previewSegment}
          unit={unit}
        />
      ) : null}
      {polygonDraftSegments.map((segment) => (
        <MeasurementLine3D
          appearance={appearance}
          displayPrecision={displayPrecision}
          draft
          key={segment.id}
          segment={segment}
          showLabel={false}
          unit={unit}
        />
      ))}
      {areas.map((area) => (
        <MeasurementArea3D
          appearance={appearance}
          area={area}
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === area.id : true}
          key={area.id}
          onSelect={handleSelectMeasurement}
          unit={unit}
        />
      ))}
      {previewArea?.view === '3d' ? (
        <MeasurementArea3D
          appearance={appearance}
          area={previewArea}
          displayPrecision={displayPrecision}
          isSelected
          onSelect={handleSelectMeasurement}
          unit={unit}
        />
      ) : null}
      {perimeters.map((perimeter) => (
        <MeasurementPerimeter3D
          appearance={appearance}
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === perimeter.id : true}
          key={perimeter.id}
          onSelect={handleSelectMeasurement}
          perimeter={perimeter}
          unit={unit}
        />
      ))}
      {previewPerimeter?.view === '3d' ? (
        <MeasurementPerimeter3D
          appearance={appearance}
          displayPrecision={displayPrecision}
          isSelected
          onSelect={handleSelectMeasurement}
          perimeter={previewPerimeter}
          unit={unit}
        />
      ) : null}
      {angles.map((angle) => (
        <MeasurementAngle3D
          appearance={appearance}
          angle={angle}
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === angle.id : true}
          key={angle.id}
          onSelect={handleSelectMeasurement}
          unit={unit}
        />
      ))}
      {draftAngle ? (
        <MeasurementAngle3D
          appearance={appearance}
          angle={draftAngle}
          displayPrecision={displayPrecision}
          draft
          isSelected
          unit={unit}
        />
      ) : null}
      {snapTarget?.view === '3d' ? (
        <MeasurementSnapTarget3D appearance={appearance} target={snapTarget} />
      ) : null}
      {selectedSegment ? (
        <MeasurementEndpointHandles3D
          appearance={appearance}
          draggingEndpoint={draggingSegmentEndpoint}
          segment={selectedSegment}
        />
      ) : null}
      {cursor?.view === '3d' ? (
        <MeasurementCursor3D appearance={appearance} point={cursor.point} />
      ) : null}
    </>
  )
}
