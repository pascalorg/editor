'use client'

import {
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
  type MeasurementSegment,
  type MeasurementSegmentEndpoint,
  type MeasurementSnapTarget,
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
const FLOORPLAN_ENDPOINT_HANDLE_RADIUS = 0.08
const FLOORPLAN_ENDPOINT_HANDLE_HIT_RADIUS = 0.18
const FLOORPLAN_LABEL_COLLISION_CELL = 0.35
const FLOORPLAN_LABEL_STAGGER_STEP = 0.22

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

function resolveFloorplanMeasurementSnap(point: MeasurementPoint): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  return resolvePlanMeasurementSnap(
    point,
    mergeMeasurementSnapGeometry(
      collectPlanMeasurementSnapGeometry(Object.values(useScene.getState().nodes)),
      collectCommittedMeasurementSnapGeometry(useMeasurementTool.getState().segments, '2d'),
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
      collectCommittedMeasurementSnapGeometry(useMeasurementTool.getState().segments, '2d'),
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
  displayPrecision: MeasurementDisplayPrecision,
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
      { precision: displayPrecision },
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
  options: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
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
      useMeasurementTool.getState().addArea('2d', area.labelPoint, area.areaSquareMeters)
      return true
    }
  }

  if (measurementMode !== 'distance') return false
  if (!quickMeasure) return false
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
  displayPrecision,
  isSelected,
  onPointerDown,
  palette,
  sceneRotationDeg,
}: {
  angle: MeasurementAngle
  displayPrecision: MeasurementDisplayPrecision
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
        {formatAngleMeasurement(angleBetweenMeasurements(angle.first, angle.vertex, angle.second), {
          precision: displayPrecision,
        })}
      </text>
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
}: {
  area: MeasurementArea
  displayPrecision: MeasurementDisplayPrecision
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
        {formatAreaMeasurement(area.areaSquareMeters, unit, { precision: displayPrecision })}
      </text>
    </g>
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
}: {
  displayPrecision: MeasurementDisplayPrecision
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
        {`P ${formatLinearMeasurement(perimeter.lengthMeters, unit, { precision: displayPrecision })}`}
      </text>
    </g>
  )
}

function FloorplanSnapTargetMarker({
  sceneRotationDeg,
  target,
}: {
  sceneRotationDeg: number
  target: MeasurementSnapTarget
}) {
  const x = target.point[0]
  const y = target.point[2]
  const kind = target.kind ?? 'vertex'
  const glyph = (() => {
    if (kind === 'grid') {
      return (
        <rect
          fill="rgba(14, 165, 233, 0.12)"
          height={0.22}
          stroke="rgb(14, 165, 233)"
          strokeWidth={1.3}
          vectorEffect="non-scaling-stroke"
          width={0.22}
          x={x - 0.11}
          y={y - 0.11}
        />
      )
    }
    if (kind === 'intersection') {
      return (
        <>
          <line
            stroke="rgb(14, 165, 233)"
            strokeLinecap="round"
            strokeWidth={1.45}
            vectorEffect="non-scaling-stroke"
            x1={x - 0.14}
            x2={x + 0.14}
            y1={y - 0.14}
            y2={y + 0.14}
          />
          <line
            stroke="rgb(14, 165, 233)"
            strokeLinecap="round"
            strokeWidth={1.45}
            vectorEffect="non-scaling-stroke"
            x1={x - 0.14}
            x2={x + 0.14}
            y1={y + 0.14}
            y2={y - 0.14}
          />
        </>
      )
    }
    if (kind === 'edge') {
      return (
        <line
          stroke="rgb(14, 165, 233)"
          strokeLinecap="round"
          strokeWidth={1.8}
          vectorEffect="non-scaling-stroke"
          x1={x - 0.2}
          x2={x + 0.2}
          y1={y}
          y2={y}
        />
      )
    }
    if (kind === 'midpoint') {
      return (
        <path
          d={`M ${x} ${y - 0.15} L ${x + 0.15} ${y + 0.12} L ${x - 0.15} ${y + 0.12} Z`}
          fill="rgba(14, 165, 233, 0.14)"
          stroke="rgb(14, 165, 233)"
          strokeLinejoin="round"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    if (kind === 'center') {
      return (
        <>
          <circle
            cx={x}
            cy={y}
            fill="rgba(14, 165, 233, 0.14)"
            r={0.13}
            stroke="rgb(14, 165, 233)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={x} cy={y} fill="rgb(14, 165, 233)" r={0.035} />
        </>
      )
    }
    if (kind === 'guide') {
      return (
        <>
          <line
            stroke="rgb(14, 165, 233)"
            strokeDasharray="0.08 0.06"
            strokeLinecap="round"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            x1={x - 0.22}
            x2={x + 0.22}
            y1={y}
            y2={y}
          />
          <line
            stroke="rgb(14, 165, 233)"
            strokeDasharray="0.08 0.06"
            strokeLinecap="round"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            x1={x}
            x2={x}
            y1={y - 0.22}
            y2={y + 0.22}
          />
        </>
      )
    }
    if (kind === 'measurement') {
      return (
        <>
          <circle
            cx={x}
            cy={y}
            fill="rgba(14, 165, 233, 0.1)"
            r={0.14}
            stroke="rgb(14, 165, 233)"
            strokeWidth={1.15}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={x}
            cy={y}
            fill="none"
            r={0.07}
            stroke="rgb(14, 165, 233)"
            strokeWidth={1.15}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )
    }

    return (
      <path
        d={`M ${x} ${y - 0.16} L ${x + 0.16} ${y} L ${x} ${y + 0.16} L ${x - 0.16} ${y} Z`}
        fill="rgba(14, 165, 233, 0.14)"
        stroke="rgb(14, 165, 233)"
        strokeLinejoin="round"
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
      />
    )
  })()

  return (
    <g className="floorplan-measurement-snap-target" pointerEvents="none">
      {target.guideLine ? (
        <line
          stroke="rgb(14, 165, 233)"
          strokeDasharray="0.12 0.08"
          strokeLinecap="round"
          strokeOpacity={0.75}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          x1={target.guideLine.start[0]}
          x2={target.guideLine.end[0]}
          y1={target.guideLine.start[2]}
          y2={target.guideLine.end[2]}
        />
      ) : null}
      {glyph}
      <text
        dominantBaseline="central"
        fill="rgb(14, 165, 233)"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize={0.13}
        fontWeight="700"
        paintOrder="stroke"
        stroke="rgba(255, 255, 255, 0.85)"
        strokeWidth={0.035}
        textAnchor="start"
        transform={`rotate(${-sceneRotationDeg} ${x + 0.2} ${y - 0.18})`}
        x={x + 0.2}
        y={y - 0.18}
      >
        {target.label}
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
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  })
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

export function handleFloorplanMeasurementGridMove(event: GridEvent): void {
  if (!isFloorplanEvent(event)) return
  const measurement = useMeasurementTool.getState()
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
  if (!measurement.draft) return
  measurement.update(point)
}

export function handleFloorplanMeasurementGridClick(event: GridEvent): void {
  if (!isFloorplanEvent(event)) return
  const measurement = useMeasurementTool.getState()
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
  const displayPrecision = useMeasurementTool((state) => state.displayPrecision)
  const selectedId = useMeasurementTool((state) => state.selectedId)
  const snapTarget = useMeasurementTool((state) => state.snapTarget)
  const draggingSegmentEndpoint = useMeasurementTool((state) => state.draggingSegmentEndpoint)

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
    const handlePointerUp = () => {
      useMeasurementTool.getState().endSegmentEndpointDrag()
    }

    window.addEventListener('click', handleGeometryClick, true)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    emitter.on('grid:move', handleFloorplanMeasurementGridMove)
    emitter.on('grid:click', handleFloorplanMeasurementGridClick)
    emitter.on('tool:cancel', handleCancel)
    return () => {
      window.removeEventListener('click', handleGeometryClick, true)
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
      ...segments.filter((segment) => segment.view === '2d'),
      ...(draft?.view === '2d' && draft.end
        ? [{ id: 'measurement-draft', start: draft.start, end: draft.end }]
        : []),
    ]
      .map((segment) => toOverlay(segment, unit, selectedId, displayPrecision))
      .filter((measurement): measurement is NonNullable<typeof measurement> => measurement !== null)
    return staggerFloorplanMeasurementLabels(overlays)
  }, [active, displayPrecision, draft, segments, selectedId, unit])

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
    ? segments.find((segment) => segment.id === selectedId && segment.view === '2d')
    : null

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
          displayPrecision={displayPrecision}
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
          displayPrecision={displayPrecision}
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
          displayPrecision={displayPrecision}
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
          displayPrecision={displayPrecision}
          isSelected
          onPointerDown={handleMeasurementPointerDown}
          palette={palette}
          sceneRotationDeg={sceneRotationDeg}
        />
      ) : null}
      {snapTarget?.view === '2d' ? (
        <FloorplanSnapTargetMarker sceneRotationDeg={sceneRotationDeg} target={snapTarget} />
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
                <circle
                  cx={point[0]}
                  cy={point[2]}
                  fill="transparent"
                  r={FLOORPLAN_ENDPOINT_HANDLE_HIT_RADIUS}
                />
                <circle
                  cx={point[0]}
                  cy={point[2]}
                  fill={activeHandle ? 'rgb(245, 158, 11)' : 'rgb(14, 165, 233)'}
                  pointerEvents="none"
                  r={
                    activeHandle
                      ? FLOORPLAN_ENDPOINT_HANDLE_RADIUS * 1.35
                      : FLOORPLAN_ENDPOINT_HANDLE_RADIUS
                  }
                  stroke="white"
                  strokeWidth={activeHandle ? 1.8 : 1.4}
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
