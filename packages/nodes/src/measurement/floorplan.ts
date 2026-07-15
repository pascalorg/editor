import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type FloorplanStyle,
  type GeometryContext,
  type MeasurementNode,
  type MeasurementPoint,
  measurementAngle,
  measurementArea,
  measurementDistance,
  measurementPerimeter,
  measurementPrismVolume,
} from '@pascal-app/core'
import {
  formatAngleRadians,
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  measurementPolygonLabelAnchor,
  measurementPresentationColor,
} from '@pascal-app/editor'
import { resolveMeasurementNode } from './resolve'

const projectPoint = (point: MeasurementPoint): FloorplanPoint => [point[0], point[2]]

const add = (point: MeasurementPoint, offset: MeasurementPoint): MeasurementPoint => [
  point[0] + offset[0],
  point[1] + offset[1],
  point[2] + offset[2],
]

const lineStyle = (stroke: string): FloorplanStyle => ({
  stroke,
  strokeWidth: 2,
  vectorEffect: 'non-scaling-stroke',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

export function buildMeasurementFloorplan(
  node: MeasurementNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.visible === false) return null

  const unit = ctx.viewState?.unit ?? 'metric'
  const resolved = resolveMeasurementNode(node, (id) => ctx.resolve(id))
  const measurement = resolved.payload
  const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke = measurementPresentationColor(resolved.dangling.length > 0, Boolean(selected))
  const style = lineStyle(stroke)
  const statusPrefix = resolved.dangling.length > 0 ? 'Unlinked · ' : ''

  if (measurement.kind === 'distance') {
    const [start, end] = measurement.points
    const [x1, y1] = projectPoint(start)
    const [x2, y2] = projectPoint(end)
    const collapsedHitTarget: FloorplanGeometry[] =
      Math.hypot(x2 - x1, y2 - y1) <= 1e-9
        ? [
            {
              kind: 'circle',
              cx: x1,
              cy: y1,
              r: 0.1,
              fill: 'transparent',
              pointerEvents: 'all',
              cursor: 'pointer',
            },
          ]
        : []

    return {
      kind: 'group',
      children: [
        { kind: 'line', x1, y1, x2, y2, ...style },
        { kind: 'hit-line', x1, y1, x2, y2, strokeWidthPx: 12 },
        ...collapsedHitTarget,
        {
          kind: 'circle',
          cx: x1,
          cy: y1,
          r: 0.045,
          fill: stroke,
          pointerEvents: 'none',
        },
        {
          kind: 'circle',
          cx: x2,
          cy: y2,
          r: 0.045,
          fill: stroke,
          pointerEvents: 'none',
        },
        {
          kind: 'dimension-label',
          appearance: 'outlined',
          cx: (x1 + x2) / 2,
          cy: (y1 + y2) / 2,
          text: `${statusPrefix}${formatLinearMeasurement(measurementDistance(start, end), unit)}`,
          angle: Math.atan2(y2 - y1, x2 - x1),
          offsetPx: 14,
        },
      ],
    }
  }

  if (measurement.kind === 'angle') {
    const [start, vertex, end] = measurement.points
    return {
      kind: 'group',
      children: [
        {
          kind: 'polyline',
          points: [projectPoint(start), projectPoint(vertex), projectPoint(end)],
          ...style,
        },
        {
          kind: 'dimension-label',
          appearance: 'outlined',
          cx: vertex[0],
          cy: vertex[2],
          text: `${statusPrefix}${formatAngleRadians(measurementAngle(start, vertex, end))}`,
          angle: 0,
          offsetPx: 16,
          screenUpright: true,
        },
      ],
    }
  }

  if (measurement.kind === 'area' || measurement.kind === 'perimeter') {
    const centroid = measurementPolygonLabelAnchor(measurement.base) ?? measurement.base[0]!
    const label =
      measurement.kind === 'area'
        ? `A ${formatAreaLabel(measurementArea(measurement.base), unit)}`
        : `P ${formatLinearMeasurement(measurementPerimeter(measurement.base), unit)}`

    return {
      kind: 'group',
      children: [
        {
          kind: 'polygon',
          points: measurement.base.map(projectPoint),
          fill: stroke,
          fillOpacity: measurement.kind === 'area' ? 0.08 : 0,
          pointerEvents: 'all',
          ...style,
        },
        {
          kind: 'dimension-label',
          appearance: 'outlined',
          cx: centroid[0],
          cy: centroid[2],
          text: `${statusPrefix}${label}`,
          angle: 0,
          screenUpright: true,
        },
      ],
    }
  }

  const volume = measurement
  const top = volume.base.map((point) => add(point, volume.extrusion))
  const baseCentroid = measurementPolygonLabelAnchor(volume.base) ?? volume.base[0]!
  const labelPoint = add(baseCentroid, [
    volume.extrusion[0] / 2,
    volume.extrusion[1] / 2,
    volume.extrusion[2] / 2,
  ])
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: volume.base.map(projectPoint),
      fill: stroke,
      fillOpacity: 0.05,
      pointerEvents: 'all',
      ...style,
    },
    {
      kind: 'polygon',
      points: top.map(projectPoint),
      fill: 'none',
      ...style,
    },
  ]

  for (let index = 0; index < volume.base.length; index++) {
    const [x1, y1] = projectPoint(volume.base[index]!)
    const [x2, y2] = projectPoint(top[index]!)
    children.push({ kind: 'line', x1, y1, x2, y2, ...style })
  }

  children.push({
    kind: 'dimension-label',
    appearance: 'outlined',
    cx: labelPoint[0],
    cy: labelPoint[2],
    text: `${statusPrefix}V ${formatVolumeLabel(measurementPrismVolume(volume.base, volume.extrusion), unit)}`,
    angle: 0,
    screenUpright: true,
  })

  return { kind: 'group', children }
}
