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
  type SlabNode,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { type PointerEvent, useEffect, useMemo } from 'react'
import { markToolCancelConsumed } from '../../hooks/use-keyboard'
import { getRotatedRectanglePolygon } from '../../lib/floorplan/geometry'
import { getItemFloorplanTransform } from '../../lib/floorplan/items'
import {
  collectCommittedMeasurementSnapGeometry,
  collectPlanMeasurementSnapGeometry,
  mergeMeasurementSnapGeometry,
  polygonAreaAndCentroid,
  resolvePlanMeasurementConstraint,
  resolvePlanMeasurementSnap,
} from '../../lib/measurement-snapping'
import {
  angleBetweenMeasurements,
  formatAngleMeasurement,
  formatAreaMeasurement,
  formatLinearMeasurement,
  type LinearUnit,
} from '../../lib/measurements'
import { useFloorplanDraftPreview } from '../../store/use-floorplan-draft-preview'
import useInteractionScope from '../../store/use-interaction-scope'
import {
  axisLockedMeasurementPoint,
  distanceBetweenMeasurements,
  isDraggingMeasurementEndpoint,
  type MeasurementAngle,
  type MeasurementArea,
  type MeasurementDisplayPrecision,
  type MeasurementPerimeter,
  type MeasurementPoint,
  type MeasurementPolygonDraft,
  type MeasurementSegment,
  type MeasurementSegmentEndpoint,
  type MeasurementSnapTarget,
  polygonAreaAndLabelPointFromMeasurements,
  polygonPerimeterFromMeasurements,
  useMeasurementTool,
} from '../../store/use-measurement-tool'
import { useFloorplanRender } from './floorplan-render-context'
import {
  FloorplanMeasurementPillLabel,
  FloorplanMeasurementsLayer,
  getFloorplanMeasurementPillMetrics,
  type LinearMeasurementOverlay,
} from './renderers/floorplan-measurements-layer'

type FloorplanMeasurementToolLayerProps = {
  active: boolean
  palette: {
    measurementStroke: string
  }
  sceneRotationDeg: number
  unit: LinearUnit
}

const FLOORPLAN_MEASUREMENT_SNAP_RADIUS = 0.25
const FLOORPLAN_ENDPOINT_HANDLE_RADIUS_PX = 5.5
const FLOORPLAN_ENDPOINT_HANDLE_ACTIVE_RADIUS_PX = 7
const FLOORPLAN_ENDPOINT_HANDLE_HIT_RADIUS_PX = 16
const FLOORPLAN_SNAP_MARKER_RADIUS_PX = 7
const FLOORPLAN_LABEL_COLLISION_CELL = 0.35
const FLOORPLAN_LABEL_STAGGER_STEP = 0.22
const FLOORPLAN_MEASUREMENT_LABEL_LINE_GAP_PX = 4
const FLOORPLAN_MEASUREMENT_COLOR = '#8b5cf6'
const FLOORPLAN_DEGENERATE_MEASUREMENT_MARKER_LENGTH = 0.32
const FLOORPLAN_ANGLE_ARC_MIN_RADIUS = 0.2
const FLOORPLAN_ANGLE_ARC_MAX_RADIUS = 0.7
const FLOORPLAN_ANGLE_ARC_SEGMENTS = 32
const FLOORPLAN_ANGLE_WEDGE_FILL = 'rgba(139, 92, 246, 0.14)'

export function getFloorplanEndpointHandleMetrics(unitsPerPixel: number, activeHandle: boolean) {
  return {
    handleRadius:
      unitsPerPixel *
      (activeHandle
        ? FLOORPLAN_ENDPOINT_HANDLE_ACTIVE_RADIUS_PX
        : FLOORPLAN_ENDPOINT_HANDLE_RADIUS_PX),
    hitRadius: unitsPerPixel * FLOORPLAN_ENDPOINT_HANDLE_HIT_RADIUS_PX,
  }
}

function getFloorplanSnapMarkerMetrics(unitsPerPixel: number) {
  const marker = unitsPerPixel * FLOORPLAN_SNAP_MARKER_RADIUS_PX * 2
  return {
    markerHalf: marker / 2,
    markerStroke: 1.3,
  }
}

export function getFloorplanMeasurementColor() {
  return FLOORPLAN_MEASUREMENT_COLOR
}

function isFloorplanEvent(event: GridEvent): boolean {
  const target = event.nativeEvent?.target
  return !(target instanceof HTMLCanvasElement)
}

function pointFromGridEvent(event: GridEvent): MeasurementPoint {
  return [...event.localPosition] as MeasurementPoint
}

function setMeasurementCursorPoint(point: MeasurementPoint | null): void {
  useFloorplanDraftPreview.getState().setCursorPoint(point ? [point[0], point[2]] : null)
}

type DirectLengthSegment = {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
}

function distancePlanPointToSegmentSq(
  point: MeasurementPoint,
  start: MeasurementPoint,
  end: MeasurementPoint,
): number {
  const px = point[0]
  const pz = point[2]
  const sx = start[0]
  const sz = start[2]
  const dx = end[0] - sx
  const dz = end[2] - sz
  const lengthSq = dx * dx + dz * dz
  if (lengthSq < 1e-8) {
    const ox = px - sx
    const oz = pz - sz
    return ox * ox + oz * oz
  }
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (pz - sz) * dz) / lengthSq))
  const cx = sx + dx * t
  const cz = sz + dz * t
  const ox = px - cx
  const oz = pz - cz
  return ox * ox + oz * oz
}

function closestPlanSegmentToPoint(
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
    const closestDistanceSq = distancePlanPointToSegmentSq(point, closest.start, closest.end)
    const segmentDistanceSq = distancePlanPointToSegmentSq(point, segment.start, segment.end)
    if (Math.abs(segmentDistanceSq - closestDistanceSq) < 1e-8) {
      return segment.measuredDistanceMeters > closest.measuredDistanceMeters ? segment : closest
    }
    return segmentDistanceSq < closestDistanceSq ? segment : closest
  })
}

function rectangleLengthSegment(
  polygon: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  depth: number,
  cursorPoint: MeasurementPoint | null = null,
): DirectLengthSegment | null {
  if (polygon.length < 4) return null
  const segments: DirectLengthSegment[] = []
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!(start && end)) continue
    segments.push({
      start: [start.x, 0, start.y],
      end: [end.x, 0, end.y],
      measuredDistanceMeters: index % 2 === 0 ? width : depth,
    })
  }
  return closestPlanSegmentToPoint(segments, cursorPoint)
}

function itemLengthSegment(
  node: ItemNode,
  cursorPoint: MeasurementPoint | null,
): DirectLengthSegment | null {
  const sceneNodes = useScene.getState().nodes
  const transform = getItemFloorplanTransform(node, new Map(Object.entries(sceneNodes)), new Map())
  if (!transform) return null

  const [width, , depth] = getScaledDimensions(node)
  const polygon = getRotatedRectanglePolygon(transform.position, width, depth, transform.rotation)
  return rectangleLengthSegment(polygon, width, depth, cursorPoint)
}

function columnLengthSegment(
  node: ColumnNode,
  cursorPoint: MeasurementPoint | null,
): DirectLengthSegment | null {
  const polygon = getRotatedRectanglePolygon(
    { x: node.position[0], y: node.position[2] },
    node.width,
    node.depth,
    node.rotation,
  )
  return rectangleLengthSegment(polygon, node.width, node.depth, cursorPoint)
}

function elevatorLengthSegment(
  node: ElevatorNode,
  cursorPoint: MeasurementPoint | null,
): DirectLengthSegment | null {
  const width = node.shaftWidth ?? node.width
  const depth = node.shaftDepth ?? node.depth
  const polygon = getRotatedRectanglePolygon(
    { x: node.position[0], y: node.position[2] },
    width,
    depth,
    node.rotation,
  )
  return rectangleLengthSegment(polygon, width, depth, cursorPoint)
}

function nodeRotationY(node: AnyNode): number {
  const rotation = 'rotation' in node ? node.rotation : 0
  if (typeof rotation === 'number') return rotation
  if (Array.isArray(rotation) && typeof rotation[1] === 'number') return rotation[1]
  return 0
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
  const width = 'width' in node && typeof node.width === 'number' ? node.width : 0
  if (width < 1e-4) return null

  const dirX = dx / hostLength
  const dirZ = dz / hostLength
  const centerX = host.start[0] + dirX * positionAlongWall
  const centerZ = host.start[1] + dirZ * positionAlongWall
  const halfWidth = width / 2

  return {
    start: [centerX - dirX * halfWidth, 0, centerZ - dirZ * halfWidth],
    end: [centerX + dirX * halfWidth, 0, centerZ + dirZ * halfWidth],
    measuredDistanceMeters: width,
  }
}

function numericNodeProperty(node: AnyNode, key: string): number | null {
  const value = (node as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 1e-4 ? value : null
}

function genericPlanBoxDimensions(node: AnyNode): readonly [number, number] | null {
  if (node.type === 'solar-panel') {
    const rows = numericNodeProperty(node, 'rows')
    const columns = numericNodeProperty(node, 'columns')
    const panelWidth = numericNodeProperty(node, 'panelWidth')
    const panelHeight = numericNodeProperty(node, 'panelHeight')
    if (!(rows && columns && panelWidth && panelHeight)) return null
    const gapX = numericNodeProperty(node, 'gapX') ?? 0
    const gapY = numericNodeProperty(node, 'gapY') ?? 0
    return [
      columns * panelWidth + Math.max(0, columns - 1) * gapX,
      rows * panelHeight + Math.max(0, rows - 1) * gapY,
    ]
  }

  const width = numericNodeProperty(node, 'width') ?? numericNodeProperty(node, 'length')
  const depth =
    numericNodeProperty(node, 'depth') ??
    numericNodeProperty(node, 'height') ??
    numericNodeProperty(node, 'size')
  return width && depth ? [width, depth] : null
}

function genericPlanBoxLengthSegment(
  node: AnyNode,
  cursorPoint: MeasurementPoint | null,
): DirectLengthSegment | null {
  if (!('position' in node) || !Array.isArray(node.position)) return null
  const dimensions = genericPlanBoxDimensions(node)
  if (!dimensions) return null
  const [width, depth] = dimensions

  const polygon = getRotatedRectanglePolygon(
    { x: node.position[0], y: node.position[2] },
    width,
    depth,
    nodeRotationY(node),
  )
  return rectangleLengthSegment(polygon, width, depth, cursorPoint)
}

function resolveFloorplanMeasurementSnap(point: MeasurementPoint): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  return resolvePlanMeasurementSnap(
    point,
    mergeMeasurementSnapGeometry(
      collectPlanMeasurementSnapGeometry(Object.values(useScene.getState().nodes)),
      collectCommittedMeasurementSnapGeometry(useMeasurementTool.getState().segments),
    ),
    {
      enabledSnapKinds: useMeasurementTool.getState().enabledSnapKinds,
      radiusMeters: FLOORPLAN_MEASUREMENT_SNAP_RADIUS,
      view: '2d',
    },
  )
}

function resolveFloorplanMeasurementConstraint(
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
      radiusMeters: FLOORPLAN_MEASUREMENT_SNAP_RADIUS,
      view: '2d',
    },
  )
}

function surfaceAreaMeasurement(node: SlabNode | CeilingNode | ZoneNode): {
  areaSquareMeters: number
  boundaryPoints: MeasurementPoint[]
  labelPoint: MeasurementPoint
} {
  const outer = polygonAreaAndCentroid(node.polygon)
  const holes = 'holes' in node ? node.holes : []
  const holesArea = holes.reduce((sum, hole) => sum + polygonAreaAndCentroid(hole).area, 0)

  return {
    areaSquareMeters: Math.max(0, outer.area - holesArea),
    boundaryPoints: node.polygon.map((point): MeasurementPoint => [point[0], 0, point[1]]),
    labelPoint: [outer.centroid.x, 0, outer.centroid.y],
  }
}

function polygonPerimeter(polygon: ReadonlyArray<readonly [number, number]>): number {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1])
  }, 0)
}

function surfacePerimeterMeasurement(node: SlabNode | CeilingNode | ZoneNode): {
  labelPoint: MeasurementPoint
  lengthMeters: number
} {
  const outer = polygonAreaAndCentroid(node.polygon)
  const holes = 'holes' in node ? node.holes : []
  const holesLength = holes.reduce((sum, hole) => sum + polygonPerimeter(hole), 0)

  return {
    labelPoint: [outer.centroid.x, 0, outer.centroid.y],
    lengthMeters: polygonPerimeter(node.polygon) + holesLength,
  }
}

function toOverlay(
  segment: Pick<MeasurementSegment, 'id' | 'start' | 'end' | 'measuredDistanceMeters'>,
  unit: LinearUnit,
  selectedId: string | null,
  displayPrecision: MeasurementDisplayPrecision,
  unitsPerPixel: number,
): LinearMeasurementOverlay | null {
  const start = { x: segment.start[0], y: segment.start[2] }
  const end = { x: segment.end[0], y: segment.end[2] }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const label = formatLinearMeasurement(
    segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end),
    unit,
    { precision: displayPrecision },
  )
  if (length < 1e-4) {
    if (
      (segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end)) <
      1e-4
    )
      return null
    const half = FLOORPLAN_DEGENERATE_MEASUREMENT_MARKER_LENGTH / 2
    const labelX = (start.x + end.x) / 2
    const labelY = (start.y + end.y) / 2
    return {
      id: segment.id,
      label,
      labelX,
      labelY: labelY - 0.18,
      labelAngleDeg: 0,
      dimensionLineStart: {
        x1: labelX - half,
        y1: labelY,
        x2: labelX,
        y2: labelY,
      },
      dimensionLineEnd: {
        x1: labelX,
        y1: labelY,
        x2: labelX + half,
        y2: labelY,
      },
      extensionStart: { x1: labelX - half, y1: labelY, x2: labelX - half, y2: labelY },
      extensionEnd: { x1: labelX + half, y1: labelY, x2: labelX + half, y2: labelY },
      dimensionPathStart: null,
      dimensionPathEnd: null,
      showTicks: false,
      isSelected: selectedId ? selectedId === segment.id : true,
      dashedExtensions: false,
    }
  }

  const normal = { x: -dy / length, y: dx / length }
  const offset = 0.24
  const dimensionStart = { x: start.x + normal.x * offset, y: start.y + normal.y * offset }
  const dimensionEnd = { x: end.x + normal.x * offset, y: end.y + normal.y * offset }
  const labelMetrics = getFloorplanMeasurementPillMetrics(label, unitsPerPixel)
  const labelClearance =
    labelMetrics.height / 2 + unitsPerPixel * FLOORPLAN_MEASUREMENT_LABEL_LINE_GAP_PX
  const mid = {
    x: (dimensionStart.x + dimensionEnd.x) / 2,
    y: (dimensionStart.y + dimensionEnd.y) / 2,
  }

  return {
    id: segment.id,
    label,
    labelX: mid.x + normal.x * labelClearance,
    labelY: mid.y + normal.y * labelClearance,
    labelAngleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    dimensionLineStart: {
      x1: dimensionStart.x,
      y1: dimensionStart.y,
      x2: mid.x,
      y2: mid.y,
    },
    dimensionLineEnd: {
      x1: mid.x,
      y1: mid.y,
      x2: dimensionEnd.x,
      y2: dimensionEnd.y,
    },
    extensionStart: { x1: start.x, y1: start.y, x2: dimensionStart.x, y2: dimensionStart.y },
    extensionEnd: { x1: end.x, y1: end.y, x2: dimensionEnd.x, y2: dimensionEnd.y },
    dimensionPathStart: null,
    dimensionPathEnd: null,
    showTicks: true,
    isSelected: selectedId ? selectedId === segment.id : true,
    dashedExtensions: false,
  }
}

function hasFloorplanSegmentProjection(
  segment: Pick<MeasurementSegment, 'start' | 'end' | 'measuredDistanceMeters'>,
) {
  return Math.hypot(segment.end[0] - segment.start[0], segment.end[2] - segment.start[2]) >= 1e-4
}

export function staggerFloorplanMeasurementLabels(
  overlays: LinearMeasurementOverlay[],
): LinearMeasurementOverlay[] {
  const seen = new Map<string, number>()
  return overlays.map((overlay) => {
    const key = `${Math.round(overlay.labelX / FLOORPLAN_LABEL_COLLISION_CELL)}:${Math.round(
      overlay.labelY / FLOORPLAN_LABEL_COLLISION_CELL,
    )}`
    const index = seen.get(key) ?? 0
    seen.set(key, index + 1)
    if (index === 0) return overlay

    const radians = (overlay.labelAngleDeg * Math.PI) / 180
    const normal = { x: -Math.sin(radians), y: Math.cos(radians) }
    const direction = index % 2 === 0 ? -1 : 1
    const magnitude = Math.ceil(index / 2) * FLOORPLAN_LABEL_STAGGER_STEP
    return {
      ...overlay,
      labelX: overlay.labelX + normal.x * direction * magnitude,
      labelY: overlay.labelY + normal.y * direction * magnitude,
    }
  })
}

function nodeEndpointSegment(node: WallNode | FenceNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} {
  return {
    start: [node.start[0], 0, node.start[1]],
    end: [node.end[0], 0, node.end[1]],
    measuredDistanceMeters:
      node.type === 'wall' ? getWallCurveLength(node) : getFenceCenterlineLength(node),
  }
}

function directLengthSegmentFromNode(
  node: AnyNode,
  cursorPoint: MeasurementPoint | null = null,
): DirectLengthSegment | null {
  if (node.type === 'wall' || node.type === 'fence') return nodeEndpointSegment(node)
  if (node.type === 'door' || node.type === 'window') return wallHostedOpeningLengthSegment(node)
  if (node.type === 'item') return itemLengthSegment(node, cursorPoint)
  if (node.type === 'column') return columnLengthSegment(node, cursorPoint)
  if (node.type === 'elevator') return elevatorLengthSegment(node, cursorPoint)
  return genericPlanBoxLengthSegment(node, cursorPoint)
}

type FloorplanMeasurableNode = AnyNode

export function handleFloorplanMeasurementNodeClick2D(
  node: FloorplanMeasurableNode,
  options: {
    altKey?: boolean
    ctrlKey?: boolean
    cursorPoint?: MeasurementPoint | null
    metaKey?: boolean
    shiftKey?: boolean
  } = {},
): boolean {
  const measurementMode = useMeasurementTool.getState().mode
  const quickMeasure = Boolean(options.altKey || options.ctrlKey || options.metaKey)
  if (options.shiftKey || measurementMode === 'angle') return false

  if (node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone') {
    if (quickMeasure || measurementMode === 'perimeter') {
      const perimeter = surfacePerimeterMeasurement(node)
      useMeasurementTool.getState().addPerimeter('2d', perimeter.labelPoint, perimeter.lengthMeters)
      return true
    }
    if (measurementMode === 'area') {
      const area = surfaceAreaMeasurement(node)
      useMeasurementTool
        .getState()
        .addArea('2d', area.labelPoint, area.areaSquareMeters, area.boundaryPoints)
      return true
    }
  }

  if (measurementMode !== 'distance') return false
  if (!quickMeasure) return false
  const segment = directLengthSegmentFromNode(node, options.cursorPoint ?? null)
  if (!segment) return false
  useMeasurementTool
    .getState()
    .addSegment('2d', segment.start, segment.end, segment.measuredDistanceMeters)
  return true
}

export function previewFloorplanMeasurementNode2D(
  node: FloorplanMeasurableNode,
  cursorPoint: MeasurementPoint | null = null,
): boolean {
  const measurement = useMeasurementTool.getState()
  if (
    measurement.draft ||
    measurement.angleDraft ||
    measurement.draggingSegmentEndpoint ||
    measurement.polygonDraft
  ) {
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewSegment(null)
    return false
  }
  if (measurement.mode === 'area') {
    if (!(node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone')) {
      measurement.setPreviewArea(null)
      return false
    }
    const area = surfaceAreaMeasurement(node)
    measurement.setPreviewSegment(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewArea({
      id: 'measurement-area-preview',
      areaSquareMeters: area.areaSquareMeters,
      boundaryPoints: area.boundaryPoints,
      labelPoint: area.labelPoint,
      view: '2d',
    })
    return true
  }

  if (measurement.mode === 'perimeter') {
    if (!(node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone')) {
      measurement.setPreviewPerimeter(null)
      return false
    }
    const perimeter = surfacePerimeterMeasurement(node)
    measurement.setPreviewSegment(null)
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter({
      id: 'measurement-perimeter-preview',
      labelPoint: perimeter.labelPoint,
      lengthMeters: perimeter.lengthMeters,
      view: '2d',
    })
    return true
  }

  if (measurement.mode !== 'distance') {
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewSegment(null)
    return false
  }

  const segment = directLengthSegmentFromNode(node, cursorPoint)
  if (!segment) {
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter(null)
    measurement.setPreviewSegment(null)
    return false
  }
  measurement.setPreviewArea(null)
  measurement.setPreviewPerimeter(null)
  measurement.setSnapTarget(null)
  if (cursorPoint) measurement.setCursor('2d', cursorPoint)
  measurement.setPreviewSegment({
    id: 'measurement-preview',
    start: segment.start,
    end: segment.end,
    measuredDistanceMeters: segment.measuredDistanceMeters,
    view: '2d',
  })
  return true
}

function normalizeAngleDelta(delta: number): number {
  let normalized = delta
  while (normalized <= -Math.PI) normalized += Math.PI * 2
  while (normalized > Math.PI) normalized -= Math.PI * 2
  return normalized
}

export function getFloorplanAngleMeasurementLayout(angle: MeasurementAngle) {
  const vertex = { x: angle.vertex[0], y: angle.vertex[2] }
  const first = { x: angle.first[0], y: angle.first[2] }
  const second = { x: angle.second[0], y: angle.second[2] }
  const firstVector = { x: first.x - vertex.x, y: first.y - vertex.y }
  const secondVector = { x: second.x - vertex.x, y: second.y - vertex.y }
  const firstLength = Math.hypot(firstVector.x, firstVector.y)
  const secondLength = Math.hypot(secondVector.x, secondVector.y)
  if (firstLength < 1e-4 || secondLength < 1e-4) return null

  const startAngle = Math.atan2(firstVector.y, firstVector.x)
  const delta = normalizeAngleDelta(Math.atan2(secondVector.y, secondVector.x) - startAngle)
  if (Math.abs(delta) < 1e-4) return null

  const radius = Math.max(
    FLOORPLAN_ANGLE_ARC_MIN_RADIUS,
    Math.min(FLOORPLAN_ANGLE_ARC_MAX_RADIUS, firstLength * 0.35, secondLength * 0.35),
  )
  const sampleCount = Math.max(
    8,
    Math.ceil((Math.abs(delta) / Math.PI) * FLOORPLAN_ANGLE_ARC_SEGMENTS),
  )
  const points = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const t = index / sampleCount
    const a = startAngle + delta * t
    return {
      x: vertex.x + Math.cos(a) * radius,
      y: vertex.y + Math.sin(a) * radius,
    }
  })
  const wedgePath = [
    `M ${vertex.x} ${vertex.y}`,
    ...points.map((point) => `L ${point.x} ${point.y}`),
    'Z',
  ].join(' ')
  const arcPath = [
    `M ${points[0]?.x ?? vertex.x} ${points[0]?.y ?? vertex.y}`,
    ...points.slice(1).map((point) => `L ${point.x} ${point.y}`),
  ].join(' ')
  const labelAngle = startAngle + delta / 2
  const labelRadius = radius + 0.22

  return {
    arcPath,
    arcRadials: [
      { x1: vertex.x, x2: points[0]!.x, y1: vertex.y, y2: points[0]!.y },
      {
        x1: vertex.x,
        x2: points[points.length - 1]!.x,
        y1: vertex.y,
        y2: points[points.length - 1]!.y,
      },
    ],
    first,
    label: {
      x: vertex.x + Math.cos(labelAngle) * labelRadius,
      y: vertex.y + Math.sin(labelAngle) * labelRadius,
    },
    second,
    vertex,
    wedgePath,
  }
}

function MeasurementPillLabel2D({
  isSelected,
  label,
  rotationDeg,
  unitsPerPixel,
  x,
  y,
}: {
  isSelected: boolean
  label: string
  rotationDeg: number
  unitsPerPixel: number
  x: number
  y: number
}) {
  return (
    <FloorplanMeasurementPillLabel
      isSelected={isSelected}
      label={label}
      rotationDeg={rotationDeg}
      unitsPerPixel={unitsPerPixel}
      x={x}
      y={y}
    />
  )
}

function AngleMeasurementLabel({
  angle,
  displayPrecision,
  isSelected,
  onPointerDown,
  palette,
  sceneRotationDeg,
  unitsPerPixel,
}: {
  angle: MeasurementAngle
  displayPrecision: MeasurementDisplayPrecision
  isSelected: boolean
  onPointerDown: (id: string, event: PointerEvent<SVGGElement>) => void
  palette: FloorplanMeasurementToolLayerProps['palette']
  sceneRotationDeg: number
  unitsPerPixel: number
}) {
  const layout = getFloorplanAngleMeasurementLayout(angle)
  if (!layout) return null

  const labelText = formatAngleMeasurement(
    angleBetweenMeasurements(angle.first, angle.vertex, angle.second),
    {
      precision: displayPrecision,
    },
  )
  const strokeOpacity = isSelected ? 0.95 : 0.38

  return (
    <g
      className="floorplan-measurement-tool"
      onPointerDown={(event) => onPointerDown(angle.id, event)}
      pointerEvents="auto"
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      <line
        stroke={palette.measurementStroke}
        strokeLinecap="round"
        strokeOpacity={strokeOpacity}
        strokeWidth={1.35}
        vectorEffect="non-scaling-stroke"
        x1={layout.vertex.x}
        x2={layout.first.x}
        y1={layout.vertex.y}
        y2={layout.first.y}
      />
      <line
        stroke={palette.measurementStroke}
        strokeLinecap="round"
        strokeOpacity={strokeOpacity}
        strokeWidth={1.35}
        vectorEffect="non-scaling-stroke"
        x1={layout.vertex.x}
        x2={layout.second.x}
        y1={layout.vertex.y}
        y2={layout.second.y}
      />
      <path d={layout.wedgePath} fill={FLOORPLAN_ANGLE_WEDGE_FILL} stroke="none" />
      {layout.arcRadials.map((radial, index) => (
        <line
          key={`${angle.id}-arc-radial-${index}`}
          stroke={palette.measurementStroke}
          strokeLinecap="round"
          strokeOpacity={strokeOpacity}
          strokeWidth={1.8}
          vectorEffect="non-scaling-stroke"
          x1={radial.x1}
          x2={radial.x2}
          y1={radial.y1}
          y2={radial.y2}
        />
      ))}
      <path
        d={layout.arcPath}
        fill="none"
        stroke={palette.measurementStroke}
        strokeLinecap="round"
        strokeOpacity={strokeOpacity}
        strokeWidth={1.8}
        vectorEffect="non-scaling-stroke"
      />
      <MeasurementPillLabel2D
        isSelected={isSelected}
        label={labelText}
        rotationDeg={-sceneRotationDeg}
        unitsPerPixel={unitsPerPixel}
        x={layout.label.x}
        y={layout.label.y}
      />
    </g>
  )
}

function AreaMeasurementLabel({
  area,
  displayPrecision,
  isSelected,
  onPointerDown,
  palette,
  sceneRotationDeg,
  unit,
  unitsPerPixel,
}: {
  area: MeasurementArea
  displayPrecision: MeasurementDisplayPrecision
  isSelected: boolean
  onPointerDown: (id: string, event: PointerEvent<SVGGElement>) => void
  palette: FloorplanMeasurementToolLayerProps['palette']
  sceneRotationDeg: number
  unit: LinearUnit
  unitsPerPixel: number
}) {
  const label = formatAreaMeasurement(area.areaSquareMeters, unit, { precision: displayPrecision })
  const boundaryPoints = area.boundaryPoints

  return (
    <g
      className="floorplan-measurement-tool"
      onPointerDown={(event) => onPointerDown(area.id, event)}
      pointerEvents="auto"
      style={{ cursor: 'pointer', opacity: isSelected ? 1 : 0.4, userSelect: 'none' }}
    >
      {boundaryPoints && boundaryPoints.length >= 3 ? (
        <AreaMeasurementBoundary2D
          isSelected={isSelected}
          points={boundaryPoints}
          stroke={palette.measurementStroke}
        />
      ) : null}
      <MeasurementPillLabel2D
        isSelected={isSelected}
        label={label}
        rotationDeg={-sceneRotationDeg}
        unitsPerPixel={unitsPerPixel}
        x={area.labelPoint[0]}
        y={area.labelPoint[2]}
      />
    </g>
  )
}

function AreaMeasurementBoundary2D({
  isSelected,
  points,
  stroke,
}: {
  isSelected: boolean
  points: MeasurementPoint[]
  stroke: string
}) {
  const polygonPoints = points.map((point) => `${point[0]},${point[2]}`).join(' ')

  return (
    <polygon
      fill="none"
      points={polygonPoints}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={isSelected ? 0.95 : 0.55}
      strokeWidth={1.35}
      vectorEffect="non-scaling-stroke"
    />
  )
}

function PerimeterMeasurementLabel({
  displayPrecision,
  isSelected,
  onPointerDown,
  palette,
  perimeter,
  sceneRotationDeg,
  unit,
  unitsPerPixel,
}: {
  displayPrecision: MeasurementDisplayPrecision
  isSelected: boolean
  onPointerDown: (id: string, event: PointerEvent<SVGGElement>) => void
  palette: FloorplanMeasurementToolLayerProps['palette']
  perimeter: MeasurementPerimeter
  sceneRotationDeg: number
  unit: LinearUnit
  unitsPerPixel: number
}) {
  const label = `P ${formatLinearMeasurement(perimeter.lengthMeters, unit, {
    precision: displayPrecision,
  })}`

  return (
    <g
      className="floorplan-measurement-tool"
      onPointerDown={(event) => onPointerDown(perimeter.id, event)}
      pointerEvents="auto"
      style={{ cursor: 'pointer', opacity: isSelected ? 1 : 0.4, userSelect: 'none' }}
    >
      <MeasurementPillLabel2D
        isSelected={isSelected}
        label={label}
        rotationDeg={-sceneRotationDeg}
        unitsPerPixel={unitsPerPixel}
        x={perimeter.labelPoint[0]}
        y={perimeter.labelPoint[2] + unitsPerPixel * 12}
      />
    </g>
  )
}

function PolygonDraftOutline2D({
  draft,
  palette,
}: {
  draft: MeasurementPolygonDraft
  palette: FloorplanMeasurementToolLayerProps['palette']
}) {
  const points = polygonDraftPointsWithCursor(draft)
  if (points.length < 2) return null

  return (
    <g className="floorplan-measurement-polygon-draft" pointerEvents="none">
      {points.flatMap((point, index) => {
        const next = points[index + 1] ?? (points.length >= 3 ? points[0] : null)
        return next
          ? [
              <line
                key={`${index}-${point[0]}-${point[2]}`}
                stroke={palette.measurementStroke}
                strokeLinecap="round"
                strokeOpacity={0.95}
                strokeWidth={1.35}
                vectorEffect="non-scaling-stroke"
                x1={point[0]}
                x2={next[0]}
                y1={point[2]}
                y2={next[2]}
              />,
            ]
          : []
      })}
    </g>
  )
}

function FloorplanSnapTargetMarker({
  target,
  unitsPerPixel,
}: {
  target: MeasurementSnapTarget
  unitsPerPixel: number
}) {
  const x = target.point[0]
  const y = target.point[2]
  const { markerHalf, markerStroke } = getFloorplanSnapMarkerMetrics(unitsPerPixel)

  return (
    <g className="floorplan-measurement-snap-target" pointerEvents="none">
      <circle
        cx={x}
        cy={y}
        fill="rgba(139, 92, 246, 0.16)"
        r={markerHalf * 0.72}
        stroke={FLOORPLAN_MEASUREMENT_COLOR}
        strokeWidth={markerStroke}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x} cy={y} fill={FLOORPLAN_MEASUREMENT_COLOR} r={markerHalf * 0.28} />
    </g>
  )
}

function floorplanPointFromClientPoint(clientX: number, clientY: number): MeasurementPoint | null {
  const scene = document.querySelector('[data-floorplan-scene]') as
    | (Element & {
        getScreenCTM?: () => DOMMatrix | null
        ownerSVGElement?: SVGSVGElement | null
      })
    | null
  const svg = scene?.ownerSVGElement
  const ctm = scene?.getScreenCTM?.()
  if (!(svg && ctm)) return null

  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const local = point.matrixTransform(ctm.inverse())
  return [local.x, 0, local.y]
}

function handleFloorplanMeasurementGeometryClick(event: MouseEvent): boolean {
  const target = event.target instanceof Element ? event.target : null
  const entry = target?.closest('[data-node-id]')
  const nodeId = entry?.getAttribute('data-node-id')
  if (!nodeId) return false

  const node = useScene.getState().nodes[nodeId as AnyNodeId]
  if (!node) return false

  return handleFloorplanMeasurementNodeClick2D(node, {
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    cursorPoint: floorplanPointFromClientPoint(event.clientX, event.clientY),
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  })
}

function handleFloorplanMeasurementGeometryMove(event: globalThis.PointerEvent): boolean {
  const target = event.target instanceof Element ? event.target : null
  const entry = target?.closest('[data-node-id]')
  const nodeId = entry?.getAttribute('data-node-id')
  if (!nodeId) {
    const measurement = useMeasurementTool.getState()
    if (
      measurement.previewArea?.view === '2d' ||
      measurement.previewPerimeter?.view === '2d' ||
      measurement.previewSegment?.view === '2d'
    ) {
      measurement.setPreviewArea(null)
      measurement.setPreviewPerimeter(null)
      measurement.setPreviewSegment(null)
    }
    return false
  }

  const node = useScene.getState().nodes[nodeId as AnyNodeId]
  if (!node) {
    const measurement = useMeasurementTool.getState()
    if (
      measurement.previewArea?.view === '2d' ||
      measurement.previewPerimeter?.view === '2d' ||
      measurement.previewSegment?.view === '2d'
    ) {
      measurement.setPreviewArea(null)
      measurement.setPreviewPerimeter(null)
      measurement.setPreviewSegment(null)
    }
    return false
  }

  return previewFloorplanMeasurementNode2D(
    node,
    floorplanPointFromClientPoint(event.clientX, event.clientY),
  )
}

function resolveFloorplanEditablePoint(event: GridEvent): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  const measurement = useMeasurementTool.getState()
  const snap = resolveFloorplanMeasurementSnap(pointFromGridEvent(event))
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
      ? resolveFloorplanMeasurementConstraint(anchor, snap.point)
      : null
  const point =
    event.nativeEvent.shiftKey && anchor
      ? axisLockedMeasurementPoint(anchor, snap.point, '2d')
      : (constrained?.point ?? snap.point)

  return {
    point,
    target: event.nativeEvent.shiftKey ? null : (constrained?.target ?? snap.target),
  }
}

function polygonDraftPointsWithCursor(draft: MeasurementPolygonDraft): MeasurementPoint[] {
  return draft.cursor ? [...draft.points, draft.cursor] : draft.points
}

function updatePolygonMeasurementPreview2D(): void {
  const measurement = useMeasurementTool.getState()
  const draft = measurement.polygonDraft
  if (draft?.view !== '2d') return
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
      view: '2d',
    })
    return
  }

  if (measurement.mode === 'perimeter') {
    measurement.setPreviewArea(null)
    measurement.setPreviewPerimeter({
      id: 'measurement-perimeter-preview',
      labelPoint,
      lengthMeters: polygonPerimeterFromMeasurements(points),
      view: '2d',
    })
  }
}

function handlePolygonGridClick2D(point: MeasurementPoint): boolean {
  const measurement = useMeasurementTool.getState()
  if (!(measurement.mode === 'area' || measurement.mode === 'perimeter')) return false
  const draft = measurement.polygonDraft
  if (draft?.view !== '2d') {
    measurement.beginPolygon('2d', point)
    return true
  }

  const first = draft.points[0]
  if (first && draft.points.length >= 3 && distanceBetweenMeasurements(first, point) < 0.25) {
    measurement.commitPolygon()
    return true
  }

  measurement.addPolygonPoint(point)
  updatePolygonMeasurementPreview2D()
  return true
}

export function handleFloorplanMeasurementGridMove(event: GridEvent): void {
  if (!isFloorplanEvent(event)) return
  const measurement = useMeasurementTool.getState()
  measurement.setPreviewArea(null)
  measurement.setPreviewPerimeter(null)
  measurement.setPreviewSegment(null)
  if (measurement.draggingSegmentEndpoint) {
    const resolved = resolveFloorplanEditablePoint(event)
    measurement.updateSegmentEndpoint(
      measurement.draggingSegmentEndpoint.id,
      measurement.draggingSegmentEndpoint.endpoint,
      resolved.point,
    )
    measurement.setSnapTarget(resolved.target)
    setMeasurementCursorPoint(resolved.point)
    return
  }
  const snap = resolveFloorplanMeasurementSnap(pointFromGridEvent(event))
  const isAxisLocked = event.nativeEvent.shiftKey && measurement.draft?.view === '2d'
  const constrained =
    !isAxisLocked && measurement.draft?.view === '2d'
      ? resolveFloorplanMeasurementConstraint(measurement.draft.start, snap.point)
      : null
  const point =
    isAxisLocked && measurement.draft
      ? axisLockedMeasurementPoint(measurement.draft.start, snap.point, '2d')
      : (constrained?.point ?? snap.point)
  measurement.setSnapTarget(isAxisLocked ? null : (constrained?.target ?? snap.target))
  setMeasurementCursorPoint(point)
  if (measurement.angleDraft) {
    measurement.updateAngle(point)
    return
  }
  if (measurement.polygonDraft?.view === '2d') {
    measurement.updatePolygon(point)
    updatePolygonMeasurementPreview2D()
    return
  }
  if (!measurement.draft) return
  measurement.update(point)
}

export function handleFloorplanMeasurementGridClick(event: GridEvent): void {
  if (!isFloorplanEvent(event)) return
  const measurement = useMeasurementTool.getState()
  measurement.setPreviewArea(null)
  measurement.setPreviewPerimeter(null)
  measurement.setPreviewSegment(null)
  if (measurement.draggingSegmentEndpoint) {
    const resolved = resolveFloorplanEditablePoint(event)
    measurement.updateSegmentEndpoint(
      measurement.draggingSegmentEndpoint.id,
      measurement.draggingSegmentEndpoint.endpoint,
      resolved.point,
    )
    measurement.setSnapTarget(resolved.target)
    setMeasurementCursorPoint(resolved.point)
    measurement.endSegmentEndpointDrag()
    return
  }
  const snap = resolveFloorplanMeasurementSnap(pointFromGridEvent(event))
  const isAxisLocked = event.nativeEvent.shiftKey && measurement.draft?.view === '2d'
  const constrained =
    !isAxisLocked && measurement.draft?.view === '2d'
      ? resolveFloorplanMeasurementConstraint(measurement.draft.start, snap.point)
      : null
  const point =
    isAxisLocked && measurement.draft
      ? axisLockedMeasurementPoint(measurement.draft.start, snap.point, '2d')
      : (constrained?.point ?? snap.point)
  measurement.setSnapTarget(isAxisLocked ? null : (constrained?.target ?? snap.target))
  if (event.nativeEvent.shiftKey && measurement.draft?.view === '2d') {
    measurement.commit(point)
    return
  }
  if (event.nativeEvent.shiftKey || measurement.mode === 'angle' || measurement.angleDraft) {
    if (measurement.angleDraft) {
      measurement.commitAngle(point)
    } else {
      measurement.beginAngle('2d', point)
    }
    return
  }
  if (handlePolygonGridClick2D(point)) return
  if (measurement.mode !== 'distance') return
  if (measurement.draft) {
    measurement.commit(point)
  } else {
    measurement.begin('2d', point)
  }
}

export function FloorplanMeasurementToolLayer({
  active,
  palette,
  sceneRotationDeg,
  unit,
}: FloorplanMeasurementToolLayerProps) {
  const renderContext = useFloorplanRender()
  const segments = useMeasurementTool((state) => state.segments)
  const areas = useMeasurementTool((state) => state.areas)
  const perimeters = useMeasurementTool((state) => state.perimeters)
  const angles = useMeasurementTool((state) => state.angles)
  const draft = useMeasurementTool((state) => state.draft)
  const polygonDraft = useMeasurementTool((state) => state.polygonDraft)
  const previewArea = useMeasurementTool((state) => state.previewArea)
  const previewPerimeter = useMeasurementTool((state) => state.previewPerimeter)
  const previewSegment = useMeasurementTool((state) => state.previewSegment)
  const snapTarget = useMeasurementTool((state) => state.snapTarget)
  const angleDraft = useMeasurementTool((state) => state.angleDraft)
  const displayPrecision = useMeasurementTool((state) => state.displayPrecision)
  const selectedId = useMeasurementTool((state) => state.selectedId)
  const draggingSegmentEndpoint = useMeasurementTool((state) => state.draggingSegmentEndpoint)
  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const measurementPalette = {
    ...palette,
    measurementStroke: FLOORPLAN_MEASUREMENT_COLOR,
  }

  useEffect(() => {
    if (!active) return

    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'measurement' })

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
      setMeasurementCursorPoint(null)
    }
    const handleGeometryClick = (event: MouseEvent) => {
      if (!handleFloorplanMeasurementGeometryClick(event)) return
      event.preventDefault()
      event.stopPropagation()
    }
    const handleGeometryMove = (event: globalThis.PointerEvent) => {
      handleFloorplanMeasurementGeometryMove(event)
    }
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
    const handlePointerUp = () => {
      useMeasurementTool.getState().endSegmentEndpointDrag()
    }

    window.addEventListener('click', handleGeometryClick, true)
    window.addEventListener('pointermove', handleGeometryMove, true)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    emitter.on('grid:move', handleFloorplanMeasurementGridMove)
    emitter.on('grid:click', handleFloorplanMeasurementGridClick)
    emitter.on('tool:cancel', handleCancel)
    return () => {
      window.removeEventListener('click', handleGeometryClick, true)
      window.removeEventListener('pointermove', handleGeometryMove, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      emitter.off('grid:move', handleFloorplanMeasurementGridMove)
      emitter.off('grid:click', handleFloorplanMeasurementGridClick)
      emitter.off('tool:cancel', handleCancel)
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'measurement')
      useMeasurementTool.getState().cancelDraft()
      setMeasurementCursorPoint(null)
    }
  }, [active])

  const measurements = useMemo(() => {
    if (!active) return []
    const overlays = [
      ...segments,
      ...(draft?.view === '2d' && draft.end
        ? [{ id: 'measurement-draft', start: draft.start, end: draft.end }]
        : []),
      ...(!draft && previewSegment?.view === '2d' ? [previewSegment] : []),
    ]
      .map((segment) => toOverlay(segment, unit, selectedId, displayPrecision, unitsPerPixel))
      .filter((measurement): measurement is NonNullable<typeof measurement> => measurement !== null)
    return staggerFloorplanMeasurementLabels(overlays)
  }, [active, displayPrecision, draft, previewSegment, segments, selectedId, unit, unitsPerPixel])

  const areaMeasurements = active
    ? [
        ...areas,
        ...(previewArea?.view === '2d' ? [previewArea] : []),
      ]
    : []
  const perimeterMeasurements = active
    ? [
        ...perimeters,
        ...(previewPerimeter?.view === '2d' ? [previewPerimeter] : []),
      ]
    : []
  const angleMeasurements = active ? angles : []
  const draftAngle =
    active && angleDraft?.view === '2d' && angleDraft.vertex && angleDraft.second
      ? {
          first: angleDraft.first,
          id: 'measurement-angle-draft',
          second: angleDraft.second,
          vertex: angleDraft.vertex,
          view: angleDraft.view,
        }
      : null
  const handleMeasurementPointerDown = (id: string, event: PointerEvent<SVGGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    useMeasurementTool.getState().selectMeasurement(id)
  }
  const handleEndpointPointerDown = (
    id: string,
    endpoint: MeasurementSegmentEndpoint,
    event: PointerEvent<SVGGElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    useMeasurementTool.getState().startSegmentEndpointDrag(id, endpoint)
  }
  const selectedSegment = selectedId
    ? segments.find(
        (segment) => segment.id === selectedId && hasFloorplanSegmentProjection(segment),
      )
    : null

  if (!active) return null

  return (
    <>
      {measurements.length > 0 ? (
        <FloorplanMeasurementsLayer
          className="floorplan-measurement-tool"
          measurements={measurements}
          onMeasurementPointerDown={handleMeasurementPointerDown}
          palette={measurementPalette}
          sceneRotationDeg={sceneRotationDeg}
        />
      ) : null}
      {polygonDraft?.view === '2d' ? (
        <PolygonDraftOutline2D draft={polygonDraft} palette={measurementPalette} />
      ) : null}
      {areaMeasurements.map((area) => (
        <AreaMeasurementLabel
          area={area}
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === area.id : true}
          key={area.id}
          onPointerDown={handleMeasurementPointerDown}
          palette={measurementPalette}
          sceneRotationDeg={sceneRotationDeg}
          unit={unit}
          unitsPerPixel={unitsPerPixel}
        />
      ))}
      {perimeterMeasurements.map((perimeter) => (
        <PerimeterMeasurementLabel
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === perimeter.id : true}
          key={perimeter.id}
          onPointerDown={handleMeasurementPointerDown}
          palette={measurementPalette}
          perimeter={perimeter}
          sceneRotationDeg={sceneRotationDeg}
          unit={unit}
          unitsPerPixel={unitsPerPixel}
        />
      ))}
      {angleMeasurements.map((angle) => (
        <AngleMeasurementLabel
          angle={angle}
          displayPrecision={displayPrecision}
          isSelected={selectedId ? selectedId === angle.id : true}
          key={angle.id}
          onPointerDown={handleMeasurementPointerDown}
          palette={measurementPalette}
          sceneRotationDeg={sceneRotationDeg}
          unitsPerPixel={unitsPerPixel}
        />
      ))}
      {draftAngle ? (
        <AngleMeasurementLabel
          angle={draftAngle}
          displayPrecision={displayPrecision}
          isSelected
          onPointerDown={handleMeasurementPointerDown}
          palette={measurementPalette}
          sceneRotationDeg={sceneRotationDeg}
          unitsPerPixel={unitsPerPixel}
        />
      ) : null}
      {snapTarget?.view === '2d' ? (
        <FloorplanSnapTargetMarker target={snapTarget} unitsPerPixel={unitsPerPixel} />
      ) : null}
      {selectedSegment ? (
        <g className="floorplan-measurement-endpoint-handles" pointerEvents="auto">
          {(['start', 'end'] as const).map((endpoint) => {
            const point = selectedSegment[endpoint]
            const activeHandle = isDraggingMeasurementEndpoint(
              draggingSegmentEndpoint,
              selectedSegment.id,
              endpoint,
            )
            const { handleRadius, hitRadius } = getFloorplanEndpointHandleMetrics(
              unitsPerPixel,
              activeHandle,
            )
            return (
              <g
                aria-label={`Drag ${endpoint} measurement endpoint`}
                className="floorplan-measurement-tool"
                key={endpoint}
                onPointerDown={(event) =>
                  handleEndpointPointerDown(selectedSegment.id, endpoint, event)
                }
                style={{ cursor: activeHandle ? 'grabbing' : 'grab' }}
              >
                <circle cx={point[0]} cy={point[2]} fill="transparent" r={hitRadius} />
                <circle
                  cx={point[0]}
                  cy={point[2]}
                  fill="rgba(139, 92, 246, 0.16)"
                  pointerEvents="none"
                  r={handleRadius * 1.85}
                  stroke={FLOORPLAN_MEASUREMENT_COLOR}
                  strokeOpacity={activeHandle ? 0.95 : 0.72}
                  strokeWidth={activeHandle ? 1.6 : 1.2}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={point[0]}
                  cy={point[2]}
                  fill="#ffffff"
                  pointerEvents="none"
                  r={handleRadius}
                  stroke={FLOORPLAN_MEASUREMENT_COLOR}
                  strokeWidth={activeHandle ? 1.7 : 1.35}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}
        </g>
      ) : null}
    </>
  )
}
