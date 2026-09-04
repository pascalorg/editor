import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import type { ArticraftAssetNode } from './schema'

const FILL = '#fb8b63'
const STROKE = '#8a3b23'

export function buildArticraftFloorplan(
  node: ArticraftAssetNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = node.dimensions[0] * node.scale
  const depth = node.dimensions[2] * node.scale
  if (width <= 0 || depth <= 0) return null

  const [cx, , cz] = node.position
  const yaw = node.rotation[1] ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const point = (x: number, z: number): FloorplanPoint => [
    cx + x * cos + z * sin,
    cz - x * sin + z * cos,
  ]
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const points: FloorplanPoint[] = [
    point(-halfWidth, -halfDepth),
    point(halfWidth, -halfDepth),
    point(halfWidth, halfDepth),
    point(-halfWidth, halfDepth),
  ]
  const selected = Boolean(ctx.viewState?.selected || ctx.viewState?.highlighted)
  const stroke = selected ? (ctx.viewState?.palette?.selectedStroke ?? '#3b82f6') : STROKE
  const spineStart = point(-halfWidth * 0.58, 0)
  const spineEnd = point(halfWidth * 0.58, 0)

  return {
    kind: 'group',
    children: [
      {
        kind: 'polygon',
        points,
        fill: FILL,
        stroke,
        strokeWidth: selected ? 0.035 : 0.018,
        opacity: 0.48,
      },
      {
        kind: 'line',
        x1: spineStart[0],
        y1: spineStart[1],
        x2: spineEnd[0],
        y2: spineEnd[1],
        stroke,
        strokeWidth: 1.2,
        vectorEffect: 'non-scaling-stroke',
        opacity: 0.72,
      },
      {
        kind: 'circle',
        cx,
        cy: cz,
        r: Math.min(width, depth) * 0.12,
        fill: node.joints.some((joint) => joint.type !== 'fixed') ? FILL : stroke,
        stroke,
        strokeWidth: 1,
        vectorEffect: 'non-scaling-stroke',
        opacity: 0.9,
      },
    ],
  }
}
