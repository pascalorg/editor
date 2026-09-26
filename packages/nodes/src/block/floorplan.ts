import type {
  BlockNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
} from '@pascal-app/core'
import { readFloorplanContext } from '@pascal-app/editor'

/**
 * The plan cut: a floor plan is the storey sliced 4 ft above the floor and
 * looked at from above. A block standing wholly ABOVE that line — fascia and
 * rake boards, a gable ornament, a dormer, a ceiling fan — is overhead trim a
 * drafted sheet leaves off (otherwise blocks modelled as roof trim filled the
 * roof footprint plus its overhang over every room). Level-local metres.
 */
export const PLAN_CUT_HEIGHT = 1.2

function cross(origin: FloorplanPoint, a: FloorplanPoint, b: FloorplanPoint) {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])
}

function convexHull(points: FloorplanPoint[]): FloorplanPoint[] {
  const unique = [...new Map(points.map((point) => [`${point[0]}:${point[1]}`, point])).values()]
  if (unique.length <= 3) return unique
  unique.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const lower: FloorplanPoint[] = []
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: FloorplanPoint[] = []
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** True when the block's lowest vertex stands above the plan cut. */
export function isOverheadBlock(node: Pick<BlockNode, 'position' | 'topology'>): boolean {
  let minY = Number.POSITIVE_INFINITY
  for (const vertex of node.topology.vertices) minY = Math.min(minY, vertex.position[1])
  if (!Number.isFinite(minY)) return false
  return node.position[1] + minY > PLAN_CUT_HEIGHT
}

export function buildBlockFloorplan(
  node: BlockNode,
  ctx?: GeometryContext,
): FloorplanGeometry | null {
  const points = convexHull(
    node.topology.vertices.map((vertex) => [vertex.position[0], vertex.position[2]]),
  )
  if (points.length < 3) return null
  const selected = ctx?.viewState?.selected ?? false
  const drafting = ctx ? readFloorplanContext(ctx).drafting : false
  // Overhead trim is not on a drafted sheet at all.
  if (drafting && isOverheadBlock(node)) return null
  return {
    kind: 'group',
    transform: { translate: [node.position[0], node.position[2]], rotate: -node.rotation },
    children: [
      {
        kind: 'polygon',
        points,
        // on a sheet a floor-standing block is an outline in plan ink, like a wall
        fill: drafting ? 'none' : selected ? '#fed7aa' : '#cbd5e1',
        fillOpacity: drafting ? 1 : selected ? 0.55 : 0.72,
        stroke: drafting
          ? '#111827'
          : selected
            ? (ctx?.viewState?.palette?.selectedStroke ?? '#f97316')
            : '#475569',
        strokeWidth: selected ? 0.03 : 0.018,
        pointerEvents: 'all',
      },
    ],
  }
}
