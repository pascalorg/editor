import type {
  BlockNode,
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext,
} from '@pascal-app/core'
import { readFloorplanContext } from '@pascal-app/editor'

/**
 * The plan cut: a floor plan is the storey sliced 4 ft above the floor and
 * looked at from above. A block standing wholly ABOVE that line — the
 * roof's fascia and rake boards, a gable ornament, a dormer, a ceiling fan —
 * is overhead trim: it is not on the plan (otherwise the generated fascia
 * blocks, one per roof segment, filled the roof footprint plus its overhang
 * over every room and the floor plan was illegible). Level-local metres.
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
  const onPaper = ctx ? readFloorplanContext(ctx).purpose === 'document' : false
  const overhead = isOverheadBlock(node)
  // Overhead trim is not on the printed plan at all.
  if (onPaper && overhead) return null
  const transform = { translate: [node.position[0], node.position[2]] as [number, number], rotate: -node.rotation }
  if (overhead) {
    // In the editor: a faint dashed outline says "something above you" and
    // stays clickable through an invisible fill — never a wash over the rooms.
    return {
      kind: 'group',
      transform,
      children: [
        {
          kind: 'polygon',
          points,
          fill: selected ? '#fed7aa' : '#000000',
          fillOpacity: selected ? 0.35 : 0,
          stroke: selected ? (ctx?.viewState?.palette?.selectedStroke ?? '#f97316') : '#94a3b8',
          strokeWidth: selected ? 0.03 : 0.012,
          strokeDasharray: '0.12 0.08',
          pointerEvents: 'all',
        },
      ],
    }
  }
  return {
    kind: 'group',
    transform,
    children: [
      {
        kind: 'polygon',
        points,
        // on paper a floor-standing block is an outline in plan ink, like a wall
        fill: onPaper ? 'none' : selected ? '#fed7aa' : '#cbd5e1',
        fillOpacity: onPaper ? 1 : selected ? 0.55 : 0.72,
        stroke: onPaper
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
