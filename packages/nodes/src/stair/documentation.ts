import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  type Point2D,
  resolveStairTotalRise,
  type StairNode,
  useScene,
} from '@pascal-app/core'
import type {
  FloorplanStairArrowEntry,
  FloorplanStairEntry,
  FloorplanStairSegmentEntry,
} from '@pascal-app/editor'
import { floorplanGeometryMetadata, readFloorplanContext } from '@pascal-app/editor'
import {
  type ConstructionLengthProfile,
  type ConstructionMetricNotation,
  formatConstructionLength,
} from '../shared/construction-length'

const ANNOTATION_OFFSET = 0.28
const ANNOTATION_FONT_SIZE = 0.125
const DIRECTION_FONT_SIZE = 0.16
const BREAK_POSITION = 0.68
const BREAK_ZIGZAG = 0.07
const MIN_ARROW_HEAD = 0.14
const MAX_ARROW_HEAD = 0.24

export type StairPlanDirection = 'up' | 'down'

export function resolveStairPlanDirection(
  stair: StairNode,
  activeLevelId: string | null | undefined,
): StairPlanDirection {
  if (
    activeLevelId &&
    stair.toLevelId &&
    stair.toLevelId !== stair.fromLevelId &&
    activeLevelId === stair.toLevelId
  ) {
    return 'down'
  }
  return 'up'
}

export function resolveStraightStairDirectionArrow(
  entry: FloorplanStairEntry,
  direction: StairPlanDirection,
): FloorplanStairArrowEntry | null {
  const arrow = entry.arrow
  if (!arrow || direction === 'up') return arrow
  const polyline = [...arrow.polyline].reverse()
  const tip = polyline[polyline.length - 1]
  const tail = polyline[polyline.length - 2]
  if (!(tip && tail)) return null

  const bodyLength = distance(tail, tip)
  if (bodyLength <= Number.EPSILON) return null
  const headLength = clamp(bodyLength * 0.72, MIN_ARROW_HEAD, MAX_ARROW_HEAD)
  const directionX = (tip.x - tail.x) / bodyLength
  const directionY = (tip.y - tail.y) / bodyLength
  const base = {
    x: tip.x - directionX * headLength,
    y: tip.y - directionY * headLength,
  }
  const halfWidth = headLength * 0.34
  return {
    polyline,
    head: [
      tip,
      { x: base.x - directionY * halfWidth, y: base.y + directionX * halfWidth },
      { x: base.x + directionY * halfWidth, y: base.y - directionX * halfWidth },
    ],
  }
}

export function stairPlanBreakStep(stepCount: number): number {
  return Math.max(1, Math.ceil(Math.max(1, Math.round(stepCount)) * BREAK_POSITION))
}

export function buildStairDocumentation(
  stair: StairNode,
  entry: FloorplanStairEntry,
  ctx: GeometryContext,
): FloorplanGeometry[] {
  const activeLevelId = ctx.parent?.type === 'level' ? ctx.parent.id : stair.parentId
  const direction = resolveStairPlanDirection(stair, activeLevelId)
  const unit = ctx.viewState?.unit ?? 'metric'
  const floorplanContext = readFloorplanContext(ctx)
  const profile: ConstructionLengthProfile =
    floorplanContext.purpose === 'document' ? 'document' : 'editor'
  const metricNotation = floorplanContext.metricNotation
  const stroke = ctx.viewState?.palette.measurementStroke ?? '#334155'
  return stair.stairType === 'straight'
    ? buildStraightDocumentation(stair, entry, direction, unit, profile, metricNotation, stroke)
    : buildCurvedDocumentation(stair, direction, unit, profile, metricNotation, stroke)
}

function buildStraightDocumentation(
  stair: StairNode,
  entry: FloorplanStairEntry,
  direction: StairPlanDirection,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): FloorplanGeometry[] {
  const geometries: FloorplanGeometry[] = []
  const arrow = resolveStraightStairDirectionArrow(entry, direction)
  const arrowStart = arrow?.polyline[0]
  const arrowNext = arrow?.polyline[1]
  if (arrowStart && arrowNext) {
    const arrowDirection = normalizedDirection(arrowStart, arrowNext)
    const labelPoint = arrowDirection
      ? {
          x: arrowStart.x - arrowDirection.y * 0.18,
          y: arrowStart.y + arrowDirection.x * 0.18,
        }
      : arrowStart
    geometries.push(
      annotationText(labelPoint, direction === 'up' ? 'UP' : 'DN', DIRECTION_FONT_SIZE, stroke),
    )
  }

  let railNotePlaced = false
  for (const segmentEntry of entry.segments) {
    if (segmentEntry.segment.segmentType !== 'stair') continue
    const frame = segmentFrame(segmentEntry)
    if (!frame) continue
    const segment = segmentEntry.segment
    const riserCount = Math.max(1, Math.round(segment.stepCount))
    const riserHeight = segment.height / riserCount
    const treadDepth = segment.length / riserCount
    const rightAnchor = {
      x: frame.rightMid.x + frame.widthDirection.x * ANNOTATION_OFFSET,
      y: frame.rightMid.y + frame.widthDirection.y * ANNOTATION_OFFSET,
    }
    geometries.push(
      annotationText(
        rightAnchor,
        `${riserCount} R @ ${formatConstructionLength(riserHeight, unit, profile, { metricNotation })} · T ${formatConstructionLength(treadDepth, unit, profile, { metricNotation })} · CLR W ${formatConstructionLength(segment.width, unit, profile, { metricNotation })}`,
        ANNOTATION_FONT_SIZE,
        stroke,
      ),
      buildStraightBreakLine(segmentEntry, stroke),
    )

    if (!railNotePlaced && stair.railingMode !== 'none') {
      const leftAnchor = {
        x: frame.leftMid.x - frame.widthDirection.x * ANNOTATION_OFFSET,
        y: frame.leftMid.y - frame.widthDirection.y * ANNOTATION_OFFSET,
      }
      geometries.push(
        annotationText(
          leftAnchor,
          `RAIL ${stair.railingMode.toLocaleUpperCase()} @ ${formatConstructionLength(stair.railingHeight, unit, profile, { metricNotation })}`,
          ANNOTATION_FONT_SIZE,
          stroke,
        ),
      )
      railNotePlaced = true
    }
  }
  return geometries
}

function buildCurvedDocumentation(
  stair: StairNode,
  direction: StairPlanDirection,
  unit: 'metric' | 'imperial',
  profile: ConstructionLengthProfile,
  metricNotation: ConstructionMetricNotation,
  stroke: string,
): FloorplanGeometry[] {
  const stairType = stair.stairType === 'spiral' ? 'spiral' : 'curved'
  const stepCount = Math.max(stairType === 'spiral' ? 6 : 4, Math.round(stair.stepCount))
  const sweep = normalizedSweep(stair)
  const startAngle = -stair.rotation - sweep / 2
  const endAngle = startAngle + sweep
  const innerRadius = Math.max(stairType === 'spiral' ? 0.05 : 0.2, stair.innerRadius)
  const outerRadius = innerRadius + stair.width
  const walkingRadius = innerRadius + stair.width / 2
  const riserHeight = resolveStairTotalRise(stair, useScene.getState().nodes) / stepCount
  const treadDepth = (Math.abs(sweep) * walkingRadius) / stepCount
  const center = { x: stair.position[0], y: stair.position[2] }
  const noteAngle = (startAngle + endAngle) / 2
  const notePoint = arcPoint(center, outerRadius + ANNOTATION_OFFSET, noteAngle)
  const directionAngle = direction === 'up' ? startAngle + sweep * 0.18 : endAngle - sweep * 0.18
  const directionPoint = arcPoint(center, walkingRadius, directionAngle)
  const breakAngle = startAngle + sweep * BREAK_POSITION
  const geometries: FloorplanGeometry[] = [
    annotationText(
      notePoint,
      `${stepCount} R @ ${formatConstructionLength(riserHeight, unit, profile, { metricNotation })} · T(CL) ${formatConstructionLength(treadDepth, unit, profile, { metricNotation })} · CLR W ${formatConstructionLength(stair.width, unit, profile, { metricNotation })}`,
      ANNOTATION_FONT_SIZE,
      stroke,
    ),
    annotationText(directionPoint, direction === 'up' ? 'UP' : 'DN', DIRECTION_FONT_SIZE, stroke),
    buildCurvedBreakLine(center, innerRadius, outerRadius, breakAngle, stroke),
  ]
  if (stair.railingMode !== 'none') {
    geometries.push(
      annotationText(
        arcPoint(center, outerRadius + ANNOTATION_OFFSET * 2, noteAngle),
        `RAIL ${stair.railingMode.toLocaleUpperCase()} @ ${formatConstructionLength(stair.railingHeight, unit, profile, { metricNotation })}`,
        ANNOTATION_FONT_SIZE,
        stroke,
      ),
    )
  }
  return geometries
}

function buildStraightBreakLine(
  segmentEntry: FloorplanStairSegmentEntry,
  stroke: string,
): FloorplanGeometry {
  const [backLeft, backRight, frontRight, frontLeft] = segmentEntry.innerPolygon
  if (!(backLeft && backRight && frontRight && frontLeft)) {
    return { kind: 'group', children: [] }
  }
  const left = interpolate(backLeft, frontLeft, BREAK_POSITION)
  const right = interpolate(backRight, frontRight, BREAK_POSITION)
  const travel = normalizedDirection(backLeft, frontLeft) ?? { x: 0, y: 1 }
  return {
    kind: 'polyline',
    points: [
      toTuple(left),
      offset(interpolate(left, right, 0.42), travel, BREAK_ZIGZAG),
      offset(interpolate(left, right, 0.5), travel, -BREAK_ZIGZAG),
      offset(interpolate(left, right, 0.58), travel, BREAK_ZIGZAG),
      toTuple(right),
    ],
    fill: 'none',
    stroke,
    strokeWidth: 1.5,
    vectorEffect: 'non-scaling-stroke',
    metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
  }
}

function buildCurvedBreakLine(
  center: Point2D,
  innerRadius: number,
  outerRadius: number,
  angle: number,
  stroke: string,
): FloorplanGeometry {
  const radial = { x: Math.cos(angle), y: Math.sin(angle) }
  const tangent = { x: -radial.y, y: radial.x }
  const pointAt = (t: number, tangentOffset = 0): FloorplanPoint => {
    const radius = innerRadius + (outerRadius - innerRadius) * t
    return [
      center.x + radial.x * radius + tangent.x * tangentOffset,
      center.y + radial.y * radius + tangent.y * tangentOffset,
    ]
  }
  return {
    kind: 'polyline',
    points: [
      pointAt(0),
      pointAt(0.42, BREAK_ZIGZAG),
      pointAt(0.5, -BREAK_ZIGZAG),
      pointAt(0.58, BREAK_ZIGZAG),
      pointAt(1),
    ],
    fill: 'none',
    stroke,
    strokeWidth: 1.5,
    vectorEffect: 'non-scaling-stroke',
    metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
  }
}

function annotationText(
  point: Point2D,
  text: string,
  fontSize: number,
  fill: string,
): FloorplanGeometry {
  return {
    kind: 'text',
    x: point.x,
    y: point.y,
    text,
    fontSize,
    fill,
    stroke: '#ffffff',
    strokeWidth: fontSize * 0.22,
    paintOrder: 'stroke',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontWeight: 650,
    textAnchor: 'middle',
    dominantBaseline: 'central',
    upright: true,
    metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
  }
}

function segmentFrame(segmentEntry: FloorplanStairSegmentEntry) {
  const [backLeft, backRight, frontRight, frontLeft] = segmentEntry.polygon
  if (!(backLeft && backRight && frontRight && frontLeft)) return null
  const widthDirection = normalizedDirection(backLeft, backRight)
  if (!widthDirection) return null
  return {
    widthDirection,
    leftMid: interpolate(backLeft, frontLeft, 0.5),
    rightMid: interpolate(backRight, frontRight, 0.5),
  }
}

function normalizedSweep(stair: StairNode): number {
  const defaultSweep = stair.stairType === 'spiral' ? Math.PI * 2 : Math.PI / 2
  const sweep = stair.sweepAngle ?? defaultSweep
  if (Math.abs(sweep) < Math.PI * 2) return sweep
  return Math.sign(sweep || 1) * (Math.PI * 2 - 0.001)
}

function arcPoint(center: Point2D, radius: number, angle: number): Point2D {
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
}

function normalizedDirection(start: Point2D, end: Point2D): Point2D | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  return length <= Number.EPSILON ? null : { x: dx / length, y: dy / length }
}

function interpolate(start: Point2D, end: Point2D, t: number): Point2D {
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
}

function offset(point: Point2D, direction: Point2D, amount: number): FloorplanPoint {
  return [point.x + direction.x * amount, point.y + direction.y * amount]
}

function toTuple(point: Point2D): FloorplanPoint {
  return [point.x, point.y]
}

function distance(first: Point2D, second: Point2D): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
