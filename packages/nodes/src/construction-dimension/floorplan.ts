import type {
  ConstructionDimensionNode,
  FloorplanGeometry,
  FloorplanPoint,
  FloorplanStyle,
  GeometryContext,
  MeasurementPoint,
} from '@pascal-app/core'
import { constructionDimensionRequiredAnchorCount } from '@pascal-app/core'
import { resolveMeasurementAnchor } from '../measurement/resolve'
import {
  type ConstructionLengthFormatOptions,
  formatConstructionLength,
} from '../shared/construction-length'
import { buildDimensionStringGeometry } from '../shared/dimension-string'
import {
  resolveCircularConstructionDimensionLayout,
  resolveConstructionDimensionLayout,
} from './geometry'

const DEFAULT_STROKE = '#334155'
const DANGLING_STROKE = '#dc2626'
const EPSILON = 1e-6

export function buildConstructionDimensionFloorplan(
  node: ConstructionDimensionNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.visible === false) return null

  const resolved = node.anchors.map((anchor) =>
    resolveMeasurementAnchor(anchor, (id) => ctx.resolve(id)),
  )
  const points = resolved.map((anchor) => anchor.point) as MeasurementPoint[]
  if (points.length < constructionDimensionRequiredAnchorCount(node.mode)) return null

  const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
  const baseStroke = selected
    ? (ctx.viewState?.palette.selectedStroke ?? '#2563eb')
    : (ctx.viewState?.palette.measurementStroke ?? DEFAULT_STROKE)
  const dangling = resolved.some((anchor) => anchor.dangling)
  const stroke = dangling ? DANGLING_STROKE : baseStroke
  const unit = ctx.viewState?.unit ?? 'metric'
  const editable =
    ctx.viewState?.selected === true &&
    !(
      typeof node.metadata === 'object' &&
      node.metadata !== null &&
      !Array.isArray(node.metadata) &&
      node.metadata.drawingCoordinationLocked === true
    )

  switch (node.mode) {
    case 'linear':
    case 'chord':
      return buildLinearOrChord(node, points, stroke, dangling, unit, editable)
    case 'radius':
      return buildRadius(node, points, stroke, dangling, unit, editable)
    case 'diameter':
      return buildDiameter(node, points, stroke, dangling, unit, editable)
    case 'center-mark':
      return buildCenterMarkOnly(points, stroke, editable)
    case 'arc-length':
      return buildArcLength(node, points, stroke, dangling, unit, editable)
    case 'angular':
      return buildAngular(node, points, stroke, dangling, editable)
    case 'coordinate':
      return buildCoordinate(node, points, stroke, dangling, unit, editable)
  }
}

function buildLinearOrChord(
  node: ConstructionDimensionNode,
  points: MeasurementPoint[],
  stroke: string,
  dangling: boolean,
  unit: 'metric' | 'imperial',
  editable: boolean,
): FloorplanGeometry {
  const layout = resolveConstructionDimensionLayout(node, points)
  const children: FloorplanGeometry[] = []
  const dimensionSegments = layout.segments.map((segment) => {
    const baseText = `${node.mode === 'chord' ? 'CH ' : ''}${formatConstructionLength(segment.value, unit, 'editor', lengthFormatOptions(node))}`
    return {
      witnessStart: segment.witnessStart,
      witnessEnd: segment.witnessEnd,
      dimensionStart: segment.dimensionStart,
      dimensionEnd: segment.dimensionEnd,
      text: notation(node, baseText, dangling),
    }
  })
  children.push(
    buildDimensionStringGeometry({
      segments: dimensionSegments,
      offsetNormal: layout.normal,
      offsetDistance: 0,
      extensionStartGap: node.extensionStartGap,
      extensionOvershoot: node.extensionOvershoot,
      terminator: node.terminator,
      textPosition: node.textPosition,
      stroke,
    }),
    ...layout.segments.map((segment) => hitLine(segment.dimensionStart, segment.dimensionEnd)),
  )
  if (editable)
    children.push(...witnessHandles(layout.witnessPoints), baselineHandle(layout.midpoint))
  return { kind: 'group', children }
}

function buildRadius(
  node: ConstructionDimensionNode,
  points: MeasurementPoint[],
  stroke: string,
  dangling: boolean,
  unit: 'metric' | 'imperial',
  editable: boolean,
): FloorplanGeometry | null {
  const layout = resolveCircularConstructionDimensionLayout('radius', points)
  if (!layout) return null
  const labelPoint: FloorplanPoint = node.baseline.origin
  const children: FloorplanGeometry[] = [
    styledPolyline([layout.center, layout.start, labelPoint], stroke),
    ...openArrow(layout.start, layout.center, stroke),
    labelGeometry(
      labelPoint,
      notation(
        node,
        `R ${formatConstructionLength(layout.radius, unit, 'editor', lengthFormatOptions(node))}`,
        dangling,
      ),
      angle(layout.start, labelPoint),
    ),
  ]
  if (node.showCenterMark) children.push(...centerMark(layout.center, layout.radius, stroke))
  if (editable) children.push(...anchorHandles(points), baselineHandle(labelPoint))
  return { kind: 'group', children }
}

function buildDiameter(
  node: ConstructionDimensionNode,
  points: MeasurementPoint[],
  stroke: string,
  dangling: boolean,
  unit: 'metric' | 'imperial',
  editable: boolean,
): FloorplanGeometry | null {
  const layout = resolveCircularConstructionDimensionLayout('diameter', points)
  if (!layout?.end) return null
  const direction = normalized(layout.start, layout.end)
  if (!direction) return null
  const normal: FloorplanPoint = [-direction[1], direction[0]]
  const children: FloorplanGeometry[] = [
    dimensionGeometry(
      node,
      layout.start,
      layout.end,
      layout.start,
      layout.end,
      normal,
      notation(
        node,
        `Ø ${formatConstructionLength(layout.radius * 2, unit, 'editor', lengthFormatOptions(node))}`,
        dangling,
      ),
      stroke,
    ),
    hitLine(layout.start, layout.end),
  ]
  if (node.showCenterMark) children.push(...centerMark(layout.center, layout.radius, stroke))
  if (editable) children.push(...anchorHandles(points))
  return { kind: 'group', children }
}

function buildCenterMarkOnly(
  points: MeasurementPoint[],
  stroke: string,
  editable: boolean,
): FloorplanGeometry | null {
  const layout = resolveCircularConstructionDimensionLayout('center-mark', points)
  if (!layout) return null
  const children: FloorplanGeometry[] = centerMark(layout.center, layout.radius, stroke, true)
  if (editable) children.push(...anchorHandles(points))
  return {
    kind: 'group',
    children,
  }
}

function buildArcLength(
  node: ConstructionDimensionNode,
  points: MeasurementPoint[],
  stroke: string,
  dangling: boolean,
  unit: 'metric' | 'imperial',
  editable: boolean,
): FloorplanGeometry | null {
  const layout = resolveCircularConstructionDimensionLayout('arc-length', points)
  if (!(layout?.end && Math.abs(layout.sweep) > EPSILON)) return null
  const projectedEnd = arcPoint(layout.center, layout.radius, layout.endAngle)
  const midAngle = layout.startAngle + layout.sweep / 2
  const arcMid = arcPoint(layout.center, layout.radius, midAngle)
  const labelPoint: FloorplanPoint = node.baseline.origin
  const children: FloorplanGeometry[] = [
    arcGeometry(layout.center, layout.radius, layout.startAngle, layout.sweep, stroke),
    styledLine(layout.center, layout.start, stroke, '0.08 0.08'),
    styledLine(layout.center, projectedEnd, stroke, '0.08 0.08'),
    styledLine(arcMid, labelPoint, stroke, '0.08 0.08'),
    ...openArrow(
      layout.start,
      arcPoint(layout.center, layout.radius, layout.startAngle + layout.sweep * 0.08),
      stroke,
    ),
    ...openArrow(
      projectedEnd,
      arcPoint(layout.center, layout.radius, layout.endAngle - layout.sweep * 0.08),
      stroke,
    ),
    labelGeometry(
      labelPoint,
      notation(
        node,
        `ARC ${formatConstructionLength(layout.arcLength, unit, 'editor', lengthFormatOptions(node))}`,
        dangling,
      ),
      0,
      true,
    ),
  ]
  if (node.showCenterMark) children.push(...centerMark(layout.center, layout.radius, stroke))
  if (editable) children.push(...anchorHandles(points), baselineHandle(labelPoint))
  return { kind: 'group', children }
}

function buildAngular(
  node: ConstructionDimensionNode,
  points: MeasurementPoint[],
  stroke: string,
  dangling: boolean,
  editable: boolean,
): FloorplanGeometry | null {
  const layout = resolveCircularConstructionDimensionLayout('angular', points)
  if (!(layout?.end && Math.abs(layout.sweep) > EPSILON)) return null
  const endRadius = distance(layout.center, layout.end)
  const maximumRadius = Math.max(0.25, Math.min(layout.radius, endRadius) * 0.9)
  const requestedRadius = distance(layout.center, node.baseline.origin)
  const arcRadius = Math.min(maximumRadius, Math.max(0.25, requestedRadius))
  const midAngle = layout.startAngle + layout.sweep / 2
  const labelPoint = arcPoint(layout.center, arcRadius, midAngle)
  const startRayEnd = arcPoint(
    layout.center,
    Math.max(layout.radius, arcRadius + 0.12),
    layout.startAngle,
  )
  const endRayEnd = arcPoint(layout.center, Math.max(endRadius, arcRadius + 0.12), layout.endAngle)
  const degrees = (Math.abs(layout.sweep) * 180) / Math.PI
  const children: FloorplanGeometry[] = [
    styledLine(layout.center, startRayEnd, stroke),
    styledLine(layout.center, endRayEnd, stroke),
    arcGeometry(layout.center, arcRadius, layout.startAngle, layout.sweep, stroke),
    labelGeometry(labelPoint, notation(node, `∠ ${formatDegrees(degrees)}`, dangling), 0, true),
  ]
  if (node.showCenterMark) children.push(...centerMark(layout.center, arcRadius, stroke))
  if (editable) children.push(...anchorHandles(points), baselineHandle(node.baseline.origin))
  return { kind: 'group', children }
}

function buildCoordinate(
  node: ConstructionDimensionNode,
  points: MeasurementPoint[],
  stroke: string,
  dangling: boolean,
  unit: 'metric' | 'imperial',
  editable: boolean,
): FloorplanGeometry | null {
  const datum: FloorplanPoint = [points[0]![0], points[0]![2]]
  const features = points.slice(1).map((point): FloorplanPoint => [point[0], point[2]])
  if (features.length === 0) return null
  const children: FloorplanGeometry[] = [...centerMark(datum, 0.4, stroke, true)]
  features.forEach((feature, index) => {
    const dx = feature[0] - datum[0]
    const dy = feature[1] - datum[1]
    const label = notation(
      node,
      `P${index + 1} · X ${formatConstructionLength(dx, unit, 'editor', lengthFormatOptions(node))} · Y ${formatConstructionLength(dy, unit, 'editor', lengthFormatOptions(node))}`,
      dangling,
      false,
    )
    children.push(
      styledLine(datum, feature, stroke, '0.08 0.08'),
      labelGeometry(feature, label, 0, true, 10),
      ...centerMark(feature, 0.3, stroke, true),
    )
  })
  if (editable) children.push(...anchorHandles(points))
  return { kind: 'group', children }
}

function lengthFormatOptions(node: ConstructionDimensionNode): ConstructionLengthFormatOptions {
  return {
    imperialPrecision: node.imperialPrecision,
    metricNotation: node.metricNotation,
  }
}

function notation(
  node: ConstructionDimensionNode,
  base: string,
  dangling: boolean,
  includeFeatureCount = true,
): string {
  const repeated = includeFeatureCount && node.featureCount > 1 ? `${node.featureCount} x ` : ''
  const content = node.textOverride ?? `${repeated}${base}`
  const decorated = `${node.prefix}${content}${node.suffix}`
  const referenced = node.reference
    ? node.referenceStyle === 'suffix'
      ? `${decorated} REF`
      : `(${decorated})`
    : decorated
  return dangling ? `UNLINKED · ${referenced}` : referenced
}

function dimensionGeometry(
  node: ConstructionDimensionNode,
  start: FloorplanPoint,
  end: FloorplanPoint,
  dimensionStart: FloorplanPoint,
  dimensionEnd: FloorplanPoint,
  offsetNormal: FloorplanPoint,
  text: string,
  stroke: string,
): FloorplanGeometry {
  return {
    kind: 'dimension',
    start,
    end,
    dimensionStart,
    dimensionEnd,
    offsetNormal,
    offsetDistance: 0,
    extensionStartGap: node.extensionStartGap,
    extensionOvershoot: node.extensionOvershoot,
    terminator: node.terminator,
    textPosition: node.textPosition,
    text,
    stroke,
  }
}

function arcGeometry(
  center: FloorplanPoint,
  radius: number,
  startAngle: number,
  sweep: number,
  stroke: string,
): FloorplanGeometry {
  const start = arcPoint(center, radius, startAngle)
  const end = arcPoint(center, radius, startAngle + sweep)
  return {
    kind: 'path',
    d: `M ${start[0]} ${start[1]} A ${radius} ${radius} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep >= 0 ? 1 : 0} ${end[0]} ${end[1]}`,
    ...lineStyle(stroke),
  }
}

function styledLine(
  start: FloorplanPoint,
  end: FloorplanPoint,
  stroke: string,
  strokeDasharray?: string,
): FloorplanGeometry {
  return {
    kind: 'line',
    x1: start[0],
    y1: start[1],
    x2: end[0],
    y2: end[1],
    ...lineStyle(stroke, strokeDasharray),
  }
}

function styledPolyline(points: FloorplanPoint[], stroke: string): FloorplanGeometry {
  return { kind: 'polyline', points, fill: 'none', ...lineStyle(stroke) }
}

function lineStyle(stroke: string, strokeDasharray?: string): FloorplanStyle {
  return {
    fill: 'none',
    stroke,
    strokeWidth: 0.9,
    strokeDasharray,
    vectorEffect: 'non-scaling-stroke',
    strokeLinecap: 'butt',
    strokeLinejoin: 'miter',
  }
}

function labelGeometry(
  point: FloorplanPoint,
  text: string,
  labelAngle: number,
  screenUpright = false,
  offsetPx = 0,
): FloorplanGeometry {
  return {
    kind: 'dimension-label',
    cx: point[0],
    cy: point[1],
    text,
    angle: labelAngle,
    screenUpright,
    offsetPx,
    appearance: 'outlined',
  }
}

function centerMark(
  center: FloorplanPoint,
  radius: number,
  stroke: string,
  force = false,
): FloorplanGeometry[] {
  if (!force && radius <= EPSILON) return []
  const half = Math.min(0.22, Math.max(0.1, radius * 0.18))
  const gap = Math.min(0.045, half * 0.3)
  return [
    styledLine([center[0] - half, center[1]], [center[0] - gap, center[1]], stroke),
    styledLine([center[0] + gap, center[1]], [center[0] + half, center[1]], stroke),
    styledLine([center[0], center[1] - half], [center[0], center[1] - gap], stroke),
    styledLine([center[0], center[1] + gap], [center[0], center[1] + half], stroke),
  ]
}

function openArrow(
  tip: FloorplanPoint,
  toward: FloorplanPoint,
  stroke: string,
): FloorplanGeometry[] {
  const direction = normalized(tip, toward)
  if (!direction) return []
  const length = 0.15
  const halfWidth = 0.055
  const base: FloorplanPoint = [tip[0] + direction[0] * length, tip[1] + direction[1] * length]
  const normal: FloorplanPoint = [-direction[1], direction[0]]
  return [
    styledLine(tip, [base[0] + normal[0] * halfWidth, base[1] + normal[1] * halfWidth], stroke),
    styledLine(tip, [base[0] - normal[0] * halfWidth, base[1] - normal[1] * halfWidth], stroke),
  ]
}

function baselineHandle(point: FloorplanPoint): FloorplanGeometry {
  return {
    kind: 'endpoint-handle',
    point,
    state: 'idle',
    variant: 'curve',
    affordance: 'move-construction-dimension-baseline',
    payload: null,
  }
}

function anchorHandles(points: readonly MeasurementPoint[]): FloorplanGeometry[] {
  return witnessHandles(points.map((point): FloorplanPoint => [point[0], point[2]]))
}

function witnessHandles(points: readonly FloorplanPoint[]): FloorplanGeometry[] {
  return points.map((point, witnessIndex) => ({
    kind: 'endpoint-handle',
    point,
    state: 'idle',
    affordance: 'move-construction-dimension-witness',
    payload: { witnessIndex },
  }))
}

function hitLine(start: FloorplanPoint, end: FloorplanPoint): FloorplanGeometry {
  return {
    kind: 'hit-line',
    x1: start[0],
    y1: start[1],
    x2: end[0],
    y2: end[1],
    strokeWidthPx: 12,
  }
}

function arcPoint(center: FloorplanPoint, radius: number, pointAngle: number): FloorplanPoint {
  return [center[0] + Math.cos(pointAngle) * radius, center[1] + Math.sin(pointAngle) * radius]
}

function normalized(start: FloorplanPoint, end: FloorplanPoint): FloorplanPoint | null {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const magnitude = Math.hypot(dx, dy)
  return magnitude <= EPSILON ? null : [dx / magnitude, dy / magnitude]
}

function distance(first: FloorplanPoint, second: FloorplanPoint): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function angle(first: FloorplanPoint, second: FloorplanPoint): number {
  return Math.atan2(second[1] - first[1], second[0] - first[0])
}

function formatDegrees(value: number): string {
  return `${Number.parseFloat(value.toFixed(value < 10 ? 1 : 0))}°`
}
