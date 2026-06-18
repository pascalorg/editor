import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getMaterialPresetByRef,
  getMaterialSolidColorByRef,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallSurfacePolygon,
  resolveMaterial,
} from '@pascal-app/core'
import type { RoadNode } from './schema'

function formatLengthMetric(meters: number): string {
  return `${Number.parseFloat(meters.toFixed(2))}m`
}

function getRoadPolygon(node: RoadNode): FloorplanPoint[] | null {
  const length = getWallCurveLength(node)
  if (length < 0.001) return null
  return getWallSurfacePolygon({ ...node, thickness: node.width }, 32).map((point) => [
    point.x,
    point.y,
  ])
}

function getRoadFloorplanFill(node: RoadNode): string {
  const solidColor = getMaterialSolidColorByRef(node.materialPreset)
  if (solidColor) return solidColor
  const materialPreset = getMaterialPresetByRef(node.materialPreset)
  if (materialPreset) return materialPreset.mapProperties.color
  if (node.material) return resolveMaterial(node.material).color
  return node.asphaltColor
}

export function buildRoadFloorplan(node: RoadNode, ctx: GeometryContext): FloorplanGeometry | null {
  const polygon = getRoadPolygon(node)
  const length = getWallCurveLength(node)
  if (!polygon) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const isHovered = view?.hovered ?? false
  const isActive = isSelected || isHighlighted
  const stroke =
    isActive && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : '#111827'

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: polygon,
      fill: getRoadFloorplanFill(node),
      stroke,
      strokeWidth: isActive ? 0.045 : 0.025,
      opacity: 0.92,
    },
  ]

  if (node.showLaneMarkings && node.laneCount > 1) {
    const laneWidth = node.width / node.laneCount
    for (let laneIndex = 1; laneIndex < node.laneCount; laneIndex += 1) {
      const offset = -node.width / 2 + laneWidth * laneIndex
      const points = Array.from({ length: 33 }, (_, index) => {
        const frame = getWallCurveFrameAt(node, index / 32)
        return [
          frame.point.x + frame.normal.x * offset,
          frame.point.y + frame.normal.y * offset,
        ] as FloorplanPoint
      })
      children.push({
        kind: 'polyline',
        points,
        stroke: node.markingColor,
        strokeWidth: 2,
        strokeDasharray: '8 8',
        strokeLinecap: 'round',
        vectorEffect: 'non-scaling-stroke',
        opacity: 0.9,
      })
    }
  }

  children.push({
    kind: 'hit-line',
    x1: node.start[0],
    y1: node.start[1],
    x2: node.end[0],
    y2: node.end[1],
    strokeWidthPx: 24,
    cursor: 'pointer',
  })

  if (isSelected && length >= 0.1) {
    const mid = getWallCurveFrameAt(node, 0.5)
    children.push({
      kind: 'dimension-label',
      cx: mid.point.x,
      cy: mid.point.y,
      text: formatLengthMetric(length),
      angle: Math.atan2(mid.tangent.y, mid.tangent.x),
    })
  }

  return { kind: 'group', children }
}
