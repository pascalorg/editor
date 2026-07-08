'use client'

import {
  type AnyNodeId,
  type CeilingNode,
  type ColumnNode,
  type ElevatorNode,
  emitter,
  type FenceNode,
  type GridEvent,
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  getScaledDimensions,
  getWallCurveFrameAt,
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
  angleBetweenMeasurements,
  formatAngleMeasurement,
  formatAreaMeasurement,
  formatLinearMeasurement,
  type LinearUnit,
} from '../../lib/measurements'
import { useFloorplanDraftPreview } from '../../store/use-floorplan-draft-preview'
import useInteractionScope from '../../store/use-interaction-scope'
import {
  distanceBetweenMeasurements,
  type MeasurementAngle,
  type MeasurementArea,
  type MeasurementPerimeter,
  type MeasurementPoint,
  type MeasurementSegment,
  useMeasurementTool,
} from '../../store/use-measurement-tool'
import {
  FloorplanMeasurementsLayer,
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
const FLOORPLAN_AREA_LABEL_FONT_SIZE = 0.18
const FLOORPLAN_ANGLE_LABEL_FONT_SIZE = 0.16

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

function squaredPlanDistance(a: MeasurementPoint, b: MeasurementPoint): number {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return dx * dx + dz * dz
}

function wallMeasurementAnchors(node: WallNode): MeasurementPoint[] {
  const midpoint = getWallCurveFrameAt(node, 0.5).point
  return [
    [node.start[0], 0, node.start[1]],
    [midpoint.x, 0, midpoint.y],
    [node.end[0], 0, node.end[1]],
  ]
}

function fenceMeasurementAnchors(node: FenceNode): MeasurementPoint[] {
  const midpoint = getFenceCenterlineFrameAt(node, 0.5).point
  const pathAnchors = node.path?.map((point) => [point[0], 0, point[1]] as MeasurementPoint) ?? []
  return [
    [node.start[0], 0, node.start[1]],
    ...pathAnchors,
    [midpoint.x, 0, midpoint.y],
    [node.end[0], 0, node.end[1]],
  ]
}

function surfaceMeasurementAnchors(node: SlabNode | CeilingNode | ZoneNode): MeasurementPoint[] {
  const centroid = polygonAreaAndCentroid(node.polygon).centroid
  const edgeMidpoints = node.polygon.map((point, index) => {
    const next = node.polygon[(index + 1) % node.polygon.length] ?? point
    return [(point[0] + next[0]) / 2, 0, (point[1] + next[1]) / 2] as MeasurementPoint
  })
  return [
    ...node.polygon.map((point) => [point[0], 0, point[1]] as MeasurementPoint),
    ...edgeMidpoints,
    [centroid.x, 0, centroid.y],
  ]
}

function rectangleMeasurementAnchors(
  polygon: ReadonlyArray<{ x: number; y: number }>,
): MeasurementPoint[] {
  if (polygon.length === 0) return []
  const centroid = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  }
  const edgeMidpoints = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point
    return [(point.x + next.x) / 2, 0, (point.y + next.y) / 2] as MeasurementPoint
  })

  return [
    ...polygon.map((point) => [point.x, 0, point.y] as MeasurementPoint),
    ...edgeMidpoints,
    [centroid.x, 0, centroid.y],
  ]
}

function itemMeasurementAnchors(node: ItemNode): MeasurementPoint[] {
  const sceneNodes = useScene.getState().nodes
  const transform = getItemFloorplanTransform(node, new Map(Object.entries(sceneNodes)), new Map())
  if (!transform) return []

  const [width, , depth] = getScaledDimensions(node)
  const polygon = getRotatedRectanglePolygon(transform.position, width, depth, transform.rotation)
  return rectangleMeasurementAnchors(polygon)
}

function columnMeasurementAnchors(node: ColumnNode): MeasurementPoint[] {
  const polygon = getRotatedRectanglePolygon(
    { x: node.position[0], y: node.position[2] },
    node.width,
    node.depth,
    node.rotation,
  )
  return rectangleMeasurementAnchors(polygon)
}

function elevatorMeasurementAnchors(node: ElevatorNode): MeasurementPoint[] {
  const polygon = getRotatedRectanglePolygon(
    { x: node.position[0], y: node.position[2] },
    node.shaftWidth ?? node.width,
    node.shaftDepth ?? node.depth,
    node.rotation,
  )
  return rectangleMeasurementAnchors(polygon)
}

function rectangleLengthSegment(
  polygon: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  depth: number,
): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  if (polygon.length < 4) return null
  const start = width >= depth ? polygon[0] : polygon[1]
  const end = width >= depth ? polygon[1] : polygon[2]
  if (!(start && end)) return null

  return {
    start: [start.x, 0, start.y],
    end: [end.x, 0, end.y],
    measuredDistanceMeters: Math.max(width, depth),
  }
}

function itemLengthSegment(node: ItemNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  const sceneNodes = useScene.getState().nodes
  const transform = getItemFloorplanTransform(node, new Map(Object.entries(sceneNodes)), new Map())
  if (!transform) return null

  const [width, , depth] = getScaledDimensions(node)
  const polygon = getRotatedRectanglePolygon(transform.position, width, depth, transform.rotation)
  return rectangleLengthSegment(polygon, width, depth)
}

function columnLengthSegment(node: ColumnNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  const polygon = getRotatedRectanglePolygon(
    { x: node.position[0], y: node.position[2] },
    node.width,
    node.depth,
    node.rotation,
  )
  return rectangleLengthSegment(polygon, node.width, node.depth)
}

function elevatorLengthSegment(node: ElevatorNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  const width = node.shaftWidth ?? node.width
  const depth = node.shaftDepth ?? node.depth
  const polygon = getRotatedRectanglePolygon(
    { x: node.position[0], y: node.position[2] },
    width,
    depth,
    node.rotation,
  )
  return rectangleLengthSegment(polygon, width, depth)
}

function resolveFloorplanMeasurementSnap(point: MeasurementPoint): MeasurementPoint {
  const maxDistanceSq = FLOORPLAN_MEASUREMENT_SNAP_RADIUS * FLOORPLAN_MEASUREMENT_SNAP_RADIUS
  let closest: MeasurementPoint | null = null
  let closestDistanceSq = maxDistanceSq

  for (const node of Object.values(useScene.getState().nodes)) {
    const anchors =
      node.type === 'wall'
        ? wallMeasurementAnchors(node)
        : node.type === 'fence'
          ? fenceMeasurementAnchors(node)
          : node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone'
            ? surfaceMeasurementAnchors(node)
            : node.type === 'item'
              ? itemMeasurementAnchors(node)
              : node.type === 'column'
                ? columnMeasurementAnchors(node)
                : node.type === 'elevator'
                  ? elevatorMeasurementAnchors(node)
                  : null
    if (!anchors) continue

    for (const anchor of anchors) {
      const distanceSq = squaredPlanDistance(point, anchor)
      if (distanceSq <= closestDistanceSq) {
        closest = anchor
        closestDistanceSq = distanceSq
      }
    }
  }

  return closest ?? point
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

function surfaceAreaMeasurement(node: SlabNode | CeilingNode | ZoneNode): {
  areaSquareMeters: number
  labelPoint: MeasurementPoint
} {
  const outer = polygonAreaAndCentroid(node.polygon)
  const holes = 'holes' in node ? node.holes : []
  const holesArea = holes.reduce((sum, hole) => sum + polygonAreaAndCentroid(hole).area, 0)

  return {
    areaSquareMeters: Math.max(0, outer.area - holesArea),
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
): LinearMeasurementOverlay | null {
  const start = { x: segment.start[0], y: segment.start[2] }
  const end = { x: segment.end[0], y: segment.end[2] }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-4) return null

  const normal = { x: -dy / length, y: dx / length }
  const offset = 0.24
  const dimensionStart = { x: start.x + normal.x * offset, y: start.y + normal.y * offset }
  const dimensionEnd = { x: end.x + normal.x * offset, y: end.y + normal.y * offset }
  const mid = {
    x: (dimensionStart.x + dimensionEnd.x) / 2,
    y: (dimensionStart.y + dimensionEnd.y) / 2,
  }

  return {
    id: segment.id,
    label: formatLinearMeasurement(
      segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end),
      unit,
    ),
    labelX: mid.x,
    labelY: mid.y,
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
  node: WallNode | FenceNode | ItemNode | ColumnNode | ElevatorNode,
): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  if (node.type === 'wall' || node.type === 'fence') return nodeEndpointSegment(node)
  if (node.type === 'item') return itemLengthSegment(node)
  if (node.type === 'column') return columnLengthSegment(node)
  if (node.type === 'elevator') return elevatorLengthSegment(node)
  return null
}

type FloorplanMeasurableNode =
  | WallNode
  | FenceNode
  | SlabNode
  | CeilingNode
  | ZoneNode
  | ItemNode
  | ColumnNode
  | ElevatorNode

export function handleFloorplanMeasurementNodeClick2D(
  node: FloorplanMeasurableNode,
  options: { altKey?: boolean; shiftKey?: boolean } = {},
): boolean {
  const measurementMode = useMeasurementTool.getState().mode
  if (options.shiftKey || measurementMode === 'angle') return false

  if (node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone') {
    if (options.altKey || measurementMode === 'perimeter') {
      const perimeter = surfacePerimeterMeasurement(node)
      useMeasurementTool.getState().addPerimeter('2d', perimeter.labelPoint, perimeter.lengthMeters)
      return true
    }
    if (measurementMode === 'area') {
      const area = surfaceAreaMeasurement(node)
      useMeasurementTool.getState().addArea('2d', area.labelPoint, area.areaSquareMeters)
      return true
    }
  }

  if (measurementMode !== 'distance') return false
  if (!options.altKey) return false
  if (
    !(
      node.type === 'wall' ||
      node.type === 'fence' ||
      node.type === 'item' ||
      node.type === 'column' ||
      node.type === 'elevator'
    )
  )
    return false
  const segment = directLengthSegmentFromNode(node)
  if (!segment) return false
  useMeasurementTool
    .getState()
    .addSegment('2d', segment.start, segment.end, segment.measuredDistanceMeters)
  return true
}

function normalizeAngleDelta(delta: number): number {
  let normalized = delta
  while (normalized <= -Math.PI) normalized += Math.PI * 2
  while (normalized > Math.PI) normalized -= Math.PI * 2
  return normalized
}

function AngleMeasurementLabel({
  angle,
  isSelected,
  onPointerDown,
  palette,
  sceneRotationDeg,
}: {
  angle: MeasurementAngle
  isSelected: boolean
  onPointerDown: (id: string, event: PointerEvent<SVGGElement>) => void
  palette: FloorplanMeasurementToolLayerProps['palette']
  sceneRotationDeg: number
}) {
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
  const radius = Math.max(0.2, Math.min(0.7, firstLength * 0.35, secondLength * 0.35))
  const endAngle = startAngle + delta
  const arcStart = {
    x: vertex.x + Math.cos(startAngle) * radius,
    y: vertex.y + Math.sin(startAngle) * radius,
  }
  const arcEnd = {
    x: vertex.x + Math.cos(endAngle) * radius,
    y: vertex.y + Math.sin(endAngle) * radius,
  }
  const labelAngle = startAngle + delta / 2
  const labelRadius = radius + 0.22
  const label = {
    x: vertex.x + Math.cos(labelAngle) * labelRadius,
    y: vertex.y + Math.sin(labelAngle) * labelRadius,
  }
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
        x1={vertex.x}
        x2={first.x}
        y1={vertex.y}
        y2={first.y}
      />
      <line
        stroke={palette.measurementStroke}
        strokeLinecap="round"
        strokeOpacity={strokeOpacity}
        strokeWidth={1.35}
        vectorEffect="non-scaling-stroke"
        x1={vertex.x}
        x2={second.x}
        y1={vertex.y}
        y2={second.y}
      />
      <path
        d={`M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 0 ${delta >= 0 ? 1 : 0} ${arcEnd.x} ${arcEnd.y}`}
        fill="none"
        stroke={palette.measurementStroke}
        strokeLinecap="round"
        strokeOpacity={strokeOpacity}
        strokeWidth={1.35}
        vectorEffect="non-scaling-stroke"
      />
      <text
        dominantBaseline="central"
        fill={palette.measurementStroke}
        fillOpacity={isSelected ? 0.98 : 0.4}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        fontSize={FLOORPLAN_ANGLE_LABEL_FONT_SIZE}
        fontWeight="700"
        textAnchor="middle"
        transform={`rotate(${-sceneRotationDeg} ${label.x} ${label.y})`}
        x={label.x}
        y={label.y}
      >
        {formatAngleMeasurement(angleBetweenMeasurements(angle.first, angle.vertex, angle.second))}
      </text>
    </g>
  )
}

function AreaMeasurementLabel({
  area,
  isSelected,
  onPointerDown,
  palette,
  sceneRotationDeg,
  unit,
}: {
  area: MeasurementArea
  isSelected: boolean
  onPointerDown: (id: string, event: PointerEvent<SVGGElement>) => void
  palette: FloorplanMeasurementToolLayerProps['palette']
  sceneRotationDeg: number
  unit: LinearUnit
}) {
  return (
    <g
      className="floorplan-measurement-tool"
      onPointerDown={(event) => onPointerDown(area.id, event)}
      pointerEvents="auto"
      style={{ cursor: 'pointer', opacity: isSelected ? 1 : 0.4, userSelect: 'none' }}
    >
      <text
        dominantBaseline="central"
        fill={palette.measurementStroke}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        fontSize={FLOORPLAN_AREA_LABEL_FONT_SIZE}
        fontWeight="700"
        textAnchor="middle"
        transform={`rotate(${-sceneRotationDeg} ${area.labelPoint[0]} ${area.labelPoint[2]})`}
        x={area.labelPoint[0]}
        y={area.labelPoint[2]}
      >
        {formatAreaMeasurement(area.areaSquareMeters, unit)}
      </text>
    </g>
  )
}

function PerimeterMeasurementLabel({
  isSelected,
  onPointerDown,
  palette,
  perimeter,
  sceneRotationDeg,
  unit,
}: {
  isSelected: boolean
  onPointerDown: (id: string, event: PointerEvent<SVGGElement>) => void
  palette: FloorplanMeasurementToolLayerProps['palette']
  perimeter: MeasurementPerimeter
  sceneRotationDeg: number
  unit: LinearUnit
}) {
  return (
    <g
      className="floorplan-measurement-tool"
      onPointerDown={(event) => onPointerDown(perimeter.id, event)}
      pointerEvents="auto"
      style={{ cursor: 'pointer', opacity: isSelected ? 1 : 0.4, userSelect: 'none' }}
    >
      <text
        dominantBaseline="central"
        fill={palette.measurementStroke}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        fontSize={FLOORPLAN_AREA_LABEL_FONT_SIZE}
        fontWeight="700"
        textAnchor="middle"
        transform={`rotate(${-sceneRotationDeg} ${perimeter.labelPoint[0]} ${perimeter.labelPoint[2]}) translate(0, 0.2)`}
        x={perimeter.labelPoint[0]}
        y={perimeter.labelPoint[2]}
      >
        {`P ${formatLinearMeasurement(perimeter.lengthMeters, unit)}`}
      </text>
    </g>
  )
}

function handleFloorplanMeasurementGeometryClick(event: MouseEvent): boolean {
  const target = event.target instanceof Element ? event.target : null
  const entry = target?.closest('[data-node-id]')
  const nodeId = entry?.getAttribute('data-node-id')
  if (!nodeId) return false

  const node = useScene.getState().nodes[nodeId as AnyNodeId]
  if (
    !(
      node?.type === 'wall' ||
      node?.type === 'fence' ||
      node?.type === 'slab' ||
      node?.type === 'ceiling' ||
      node?.type === 'zone' ||
      node?.type === 'item' ||
      node?.type === 'column' ||
      node?.type === 'elevator'
    )
  )
    return false

  return handleFloorplanMeasurementNodeClick2D(node, {
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  })
}

export function handleFloorplanMeasurementGridMove(event: GridEvent): void {
  if (!isFloorplanEvent(event)) return
  const point = resolveFloorplanMeasurementSnap(pointFromGridEvent(event))
  setMeasurementCursorPoint(point)
  const measurement = useMeasurementTool.getState()
  if (measurement.angleDraft) {
    measurement.updateAngle(point)
    return
  }
  if (!measurement.draft) return
  measurement.update(point)
}

export function handleFloorplanMeasurementGridClick(event: GridEvent): void {
  if (!isFloorplanEvent(event)) return
  const point = resolveFloorplanMeasurementSnap(pointFromGridEvent(event))
  const measurement = useMeasurementTool.getState()
  if (event.nativeEvent.shiftKey || measurement.mode === 'angle' || measurement.angleDraft) {
    if (measurement.angleDraft) {
      measurement.commitAngle(point)
    } else {
      measurement.beginAngle('2d', point)
    }
    return
  }
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
  const segments = useMeasurementTool((state) => state.segments)
  const areas = useMeasurementTool((state) => state.areas)
  const perimeters = useMeasurementTool((state) => state.perimeters)
  const angles = useMeasurementTool((state) => state.angles)
  const draft = useMeasurementTool((state) => state.draft)
  const angleDraft = useMeasurementTool((state) => state.angleDraft)
  const selectedId = useMeasurementTool((state) => state.selectedId)

  useEffect(() => {
    if (!active) return

    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'measurement' })

    const handleCancel = () => {
      const measurement = useMeasurementTool.getState()
      if (
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
      setMeasurementCursorPoint(null)
    }
    const handleGeometryClick = (event: MouseEvent) => {
      if (!handleFloorplanMeasurementGeometryClick(event)) return
      event.preventDefault()
      event.stopPropagation()
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

    window.addEventListener('click', handleGeometryClick, true)
    window.addEventListener('keydown', handleKeyDown, true)
    emitter.on('grid:move', handleFloorplanMeasurementGridMove)
    emitter.on('grid:click', handleFloorplanMeasurementGridClick)
    emitter.on('tool:cancel', handleCancel)
    return () => {
      window.removeEventListener('click', handleGeometryClick, true)
      window.removeEventListener('keydown', handleKeyDown, true)
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
    return [
      ...segments.filter((segment) => segment.view === '2d'),
      ...(draft?.view === '2d' && draft.end
        ? [{ id: 'measurement-draft', start: draft.start, end: draft.end }]
        : []),
    ]
      .map((segment) => toOverlay(segment, unit, selectedId))
      .filter((measurement): measurement is NonNullable<typeof measurement> => measurement !== null)
  }, [active, draft, segments, selectedId, unit])

  const areaMeasurements = active ? areas.filter((area) => area.view === '2d') : []
  const perimeterMeasurements = active
    ? perimeters.filter((perimeter) => perimeter.view === '2d')
    : []
  const angleMeasurements = active ? angles.filter((angle) => angle.view === '2d') : []
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

  if (!active) return null

  return (
    <>
      {measurements.length > 0 ? (
        <FloorplanMeasurementsLayer
          className="floorplan-measurement-tool"
          measurements={measurements}
          onMeasurementPointerDown={handleMeasurementPointerDown}
          palette={palette}
          sceneRotationDeg={sceneRotationDeg}
        />
      ) : null}
      {areaMeasurements.map((area) => (
        <AreaMeasurementLabel
          area={area}
          isSelected={selectedId ? selectedId === area.id : true}
          key={area.id}
          onPointerDown={handleMeasurementPointerDown}
          palette={palette}
          sceneRotationDeg={sceneRotationDeg}
          unit={unit}
        />
      ))}
      {perimeterMeasurements.map((perimeter) => (
        <PerimeterMeasurementLabel
          isSelected={selectedId ? selectedId === perimeter.id : true}
          key={perimeter.id}
          onPointerDown={handleMeasurementPointerDown}
          palette={palette}
          perimeter={perimeter}
          sceneRotationDeg={sceneRotationDeg}
          unit={unit}
        />
      ))}
      {angleMeasurements.map((angle) => (
        <AngleMeasurementLabel
          angle={angle}
          isSelected={selectedId ? selectedId === angle.id : true}
          key={angle.id}
          onPointerDown={handleMeasurementPointerDown}
          palette={palette}
          sceneRotationDeg={sceneRotationDeg}
        />
      ))}
      {draftAngle ? (
        <AngleMeasurementLabel
          angle={draftAngle}
          isSelected
          onPointerDown={handleMeasurementPointerDown}
          palette={palette}
          sceneRotationDeg={sceneRotationDeg}
        />
      ) : null}
    </>
  )
}
