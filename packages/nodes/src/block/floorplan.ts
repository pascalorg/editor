import {
  type BlockNode,
  type BlockTopology,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getBlockFaceNormal,
  pointInPolygon2D,
  unionPolygons,
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

const VERTICAL_FACE_MAX_NORMAL_Y = 1e-3

function cross(origin: FloorplanPoint, a: FloorplanPoint, b: FloorplanPoint) {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])
}

function convexHull(points: FloorplanPoint[]): [number, number][] {
  const unique = [...new Map(points.map((point) => [`${point[0]}:${point[1]}`, point])).values()]
  if (unique.length <= 3) return unique as [number, number][]
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
  return [...lower.slice(0, -1), ...upper.slice(0, -1)] as [number, number][]
}

const planRingsByTopology = new WeakMap<BlockTopology, [number, number][][]>()

/**
 * The block's plan footprint: the union of every non-vertical face projected
 * onto the level, so L-shapes keep their notch, rings keep their opening and
 * separate parts stay apart. A topology without faces falls back to the
 * convex hull of its vertices. Cached per topology: selection and hover
 * rebuild the plan without re-running the union.
 */
function blockPlanRings(topology: BlockTopology): [number, number][][] {
  const cached = planRingsByTopology.get(topology)
  if (cached) return cached
  const vertexById = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const projected: [number, number][][] = []
  for (const face of topology.faces) {
    const normal = getBlockFaceNormal(topology, face, vertexById)
    if (!normal || Math.abs(normal[1]) <= VERTICAL_FACE_MAX_NORMAL_Y) continue
    const ring = face.vertexIds.flatMap((id) => {
      const position = vertexById.get(id)
      return position ? [[position[0], position[2]] as [number, number]] : []
    })
    if (ring.length === face.vertexIds.length) projected.push(ring)
  }
  let rings = unionPolygons(projected)
  if (rings.length === 0 && topology.faces.length === 0) {
    const hull = convexHull(topology.vertices.map((v) => [v.position[0], v.position[2]]))
    rings = hull.length >= 3 ? [hull] : []
  }
  planRingsByTopology.set(topology, rings)
  return rings
}

/** A ring inside another is a hole (or an island in one): draw all rings as one evenodd path. */
function hasNestedRing(rings: [number, number][][]): boolean {
  return rings.some((ring, index) =>
    rings.some(
      (other, otherIndex) =>
        otherIndex !== index && pointInPolygon2D(ring[0]!, other, { includeBoundary: false }),
    ),
  )
}

function ringPath(rings: readonly (readonly FloorplanPoint[])[]): string {
  return rings.map((ring) => `M${ring.map(([x, y]) => `${x} ${y}`).join('L')}Z`).join('')
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
  const rings = blockPlanRings(node.topology)
  if (rings.length === 0) return null
  const selected = ctx?.viewState?.selected ?? false
  const drafting = ctx ? readFloorplanContext(ctx).drafting : false
  // Overhead trim is not on a drafted sheet at all.
  if (drafting && isOverheadBlock(node)) return null
  const style = {
    // on a sheet a floor-standing block is an outline in plan ink, like a wall
    fill: drafting ? 'none' : selected ? '#fed7aa' : '#cbd5e1',
    fillOpacity: drafting ? 1 : selected ? 0.55 : 0.72,
    stroke: drafting
      ? '#111827'
      : selected
        ? (ctx?.viewState?.palette?.selectedStroke ?? '#f97316')
        : '#475569',
    strokeWidth: selected ? 0.03 : 0.018,
    pointerEvents: 'all' as const,
  }
  return {
    kind: 'group',
    transform: { translate: [node.position[0], node.position[2]], rotate: -node.rotation },
    children: hasNestedRing(rings)
      ? [{ kind: 'path', d: ringPath(rings), fillRule: 'evenodd', ...style }]
      : rings.map((points) => ({ kind: 'polygon', points, ...style })),
  }
}
