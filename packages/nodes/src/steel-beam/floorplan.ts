import {
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallSurfacePolygon,
} from '@pascal-app/core'
import type { SteelBeamNode } from './schema'

function polygon(node: SteelBeamNode): FloorplanPoint[] | null {
  if (getWallCurveLength(node) < 0.001) return null
  return getWallSurfacePolygon({ ...node, thickness: node.width }, 24).map((point) => [
    point.x,
    point.y,
  ])
}

export function buildSteelBeamFloorplan(
  node: SteelBeamNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const points = polygon(node)
  if (!points) return null
  const active = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke = active && ctx.viewState?.palette ? ctx.viewState.palette.selectedStroke : '#475569'
  const length = getWallCurveLength(node)
  const mid = getWallCurveFrameAt(node, 0.5)

  return {
    kind: 'group',
    children: [
      {
        kind: 'polygon',
        points,
        fill: '#cbd5e1',
        stroke,
        strokeWidth: active ? 0.045 : 0.025,
        opacity: 0.85,
      },
      {
        kind: 'polyline',
        points: Array.from({ length: 25 }, (_, index) => {
          const frame = getWallCurveFrameAt(node, index / 24)
          return [frame.point.x, frame.point.y] as FloorplanPoint
        }),
        stroke: '#334155',
        strokeWidth: 2,
        vectorEffect: 'non-scaling-stroke',
      },
      {
        kind: 'hit-line',
        x1: node.start[0],
        y1: node.start[1],
        x2: node.end[0],
        y2: node.end[1],
        strokeWidthPx: 24,
        cursor: 'pointer',
      },
      ...(active && length >= 0.1
        ? [
            {
              kind: 'dimension-label' as const,
              cx: mid.point.x,
              cy: mid.point.y,
              text: `${length.toFixed(1)}m`,
              angle: Math.atan2(mid.tangent.y, mid.tangent.x),
            },
          ]
        : []),
    ],
  }
}
