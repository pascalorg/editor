import type { GeometryContext } from '../registry/types'
import type { AnyNodeId, SlabNode, WallNode } from '../schema'
import { isCurvedWall, sampleWallCenterline } from '../systems/wall/wall-curve'
import { getWallThickness } from '../systems/wall/wall-footprint'

/**
 * Render-time slab polygon rules.
 *
 * Slab nodes store the wall-centerline polygon (auto slabs) or the drawn
 * polygon (manual slabs) — render offsets are NEVER stored in node data.
 * At geometry build time each polygon edge is classified against the
 * slab's level context and offset along its outward normal:
 *
 *  - INTERIOR — a sibling slab has a collinear, overlapping edge across
 *    it. Inset by a small relief so adjacent slabs tile with a hidden gap
 *    under the shared wall instead of overlapping or z-fighting.
 *  - EXTERIOR-ON-WALL — no slab neighbour, but the edge lies on a wall
 *    centerline. Outset by half of THAT wall's thickness so the slab
 *    reaches flush with the facade.
 *  - FREE — no neighbour, no wall. Rendered exactly as drawn.
 */

/** Relief inset applied to edges shared with a sibling slab. */
const INTERIOR_EDGE_INSET = 0.02
/** Lateral distance within which a sibling slab edge counts as "across" an edge. */
const SLAB_NEIGHBOR_LATERAL_TOLERANCE = 0.05
/**
 * Lateral distance within which an edge counts as lying on a wall
 * centerline. Auto slab polygons are simplified with a 0.08 tolerance when
 * planned (`AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE`), so an edge can sit up
 * to ~8cm off the sampled centerline of a curved wall.
 */
const WALL_LATERAL_TOLERANCE = 0.1
/** Minimum collinear overlap (m) before a candidate drives the classification. */
const MIN_CLASSIFYING_OVERLAP = 0.05
const CURVED_WALL_SAMPLE_SEGMENTS = 32

export type SlabPolygonContext = {
  /** Walls on the slab's level. */
  walls: WallNode[]
  /** Other slabs on the same level — the slab itself must be excluded. */
  siblingSlabs: SlabNode[]
}

/** [ax, az, bx, bz] segment in plan space. */
type Segment = [number, number, number, number]

/**
 * Derive a {@link SlabPolygonContext} from a registry `GeometryContext`:
 * sibling slabs come from `ctx.siblings` (same kind, same parent, self
 * excluded) and walls from the parent level's children.
 */
export function slabPolygonContextFromGeometry(
  ctx: GeometryContext | undefined,
): SlabPolygonContext {
  if (!ctx) return { walls: [], siblingSlabs: [] }

  const siblingSlabs = ctx.siblings.filter(
    (node): node is SlabNode => node.type === 'slab',
  ) as SlabNode[]

  const walls: WallNode[] = []
  const parentChildIds = (ctx.parent as { children?: AnyNodeId[] } | null)?.children
  if (Array.isArray(parentChildIds)) {
    for (const childId of parentChildIds) {
      const child = ctx.resolve(childId)
      if ((child as { type?: string } | undefined)?.type === 'wall') {
        walls.push(child as WallNode)
      }
    }
  }

  return { walls, siblingSlabs }
}

export function getRenderableSlabPolygon(
  slabNode: SlabNode,
  context: SlabPolygonContext,
): Array<[number, number]> {
  const polygon = slabNode.polygon
  if (polygon.length < 3) {
    return polygon.map(([x, z]) => [x, z] as [number, number])
  }

  const offsets = computeEdgeOffsets(polygon, context)
  if (offsets.every((amount) => amount === 0)) {
    return polygon.map(([x, z]) => [x, z] as [number, number])
  }

  return offsetPolygonPerEdge(polygon, offsets)
}

/**
 * Overlap (in metres, along the edge axis) between the edge starting at
 * `(ax, az)` with normalized direction `(dirX, dirZ)` and the candidate
 * segment `(px, pz) → (qx, qz)`, counting only when the candidate is
 * collinear with the edge within `lateralTolerance`. Testing the candidate
 * endpoints against the edge's infinite line (not the edge span) is what
 * lets a T-junction sub-segment match its longer host edge.
 */
function collinearOverlapLength(
  ax: number,
  az: number,
  dirX: number,
  dirZ: number,
  edgeLength: number,
  px: number,
  pz: number,
  qx: number,
  qz: number,
  lateralTolerance: number,
): number {
  const relPX = px - ax
  const relPZ = pz - az
  if (Math.abs(relPX * dirZ - relPZ * dirX) > lateralTolerance) return 0
  const relQX = qx - ax
  const relQZ = qz - az
  if (Math.abs(relQX * dirZ - relQZ * dirX) > lateralTolerance) return 0

  const t0 = relPX * dirX + relPZ * dirZ
  const t1 = relQX * dirX + relQZ * dirZ
  const low = Math.max(Math.min(t0, t1), 0)
  const high = Math.min(Math.max(t0, t1), edgeLength)
  return Math.max(0, high - low)
}

function wallCenterlineSegments(wall: WallNode): Segment[] {
  if (!isCurvedWall(wall)) {
    return [[wall.start[0], wall.start[1], wall.end[0], wall.end[1]]]
  }

  const points = sampleWallCenterline(wall, CURVED_WALL_SAMPLE_SEGMENTS)
  const segments: Segment[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!
    const to = points[index + 1]!
    segments.push([from.x, from.y, to.x, to.y])
  }
  return segments
}

/** Per-edge offset amounts (positive = outward) for `polygon`'s edges. */
function computeEdgeOffsets(
  polygon: Array<[number, number]>,
  context: SlabPolygonContext,
): number[] {
  const n = polygon.length
  const offsets = new Array<number>(n).fill(0)

  const neighborSegments: Segment[] = []
  for (const sibling of context.siblingSlabs) {
    const siblingPolygon = sibling.polygon
    if (siblingPolygon.length < 2) continue
    for (let index = 0; index < siblingPolygon.length; index += 1) {
      const from = siblingPolygon[index]!
      const to = siblingPolygon[(index + 1) % siblingPolygon.length]!
      neighborSegments.push([from[0], from[1], to[0], to[1]])
    }
  }

  const wallCandidates = context.walls.map((wall) => ({
    segments: wallCenterlineSegments(wall),
    halfThickness: getWallThickness(wall) / 2,
  }))

  for (let index = 0; index < n; index += 1) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % n]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const edgeLength = Math.hypot(dx, dz)
    if (edgeLength < 1e-9) continue
    const dirX = dx / edgeLength
    const dirZ = dz / edgeLength
    // Short edges still need classification — require at most half their span.
    const requiredOverlap = Math.min(MIN_CLASSIFYING_OVERLAP, edgeLength * 0.5)

    let neighborOverlap = 0
    for (const [px, pz, qx, qz] of neighborSegments) {
      neighborOverlap += collinearOverlapLength(
        a[0],
        a[1],
        dirX,
        dirZ,
        edgeLength,
        px,
        pz,
        qx,
        qz,
        SLAB_NEIGHBOR_LATERAL_TOLERANCE,
      )
      if (neighborOverlap >= requiredOverlap) break
    }
    if (neighborOverlap >= requiredOverlap) {
      offsets[index] = -INTERIOR_EDGE_INSET
      continue
    }

    // Collinear runs of different-thickness walls along one edge: the wall
    // with the largest overlap wins the whole edge (v1 majority rule).
    let bestWallOverlap = 0
    let bestHalfThickness = 0
    for (const candidate of wallCandidates) {
      let overlap = 0
      for (const [px, pz, qx, qz] of candidate.segments) {
        overlap += collinearOverlapLength(
          a[0],
          a[1],
          dirX,
          dirZ,
          edgeLength,
          px,
          pz,
          qx,
          qz,
          WALL_LATERAL_TOLERANCE,
        )
      }
      if (overlap > bestWallOverlap) {
        bestWallOverlap = overlap
        bestHalfThickness = candidate.halfThickness
      }
    }
    if (bestWallOverlap >= requiredOverlap) {
      offsets[index] = bestHalfThickness
    }
  }

  return offsets
}

/**
 * Offset each polygon edge along its outward normal by its own amount
 * (negative insets), then intersect consecutive offset edge-lines to
 * rebuild the vertices.
 */
function offsetPolygonPerEdge(
  polygon: Array<[number, number]>,
  amounts: number[],
): Array<[number, number]> {
  const n = polygon.length
  if (n < 3) return polygon.map(([x, z]) => [x, z] as [number, number])

  // Determine winding via signed area
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area2 += polygon[i]![0] * polygon[j]![1] - polygon[j]![0] * polygon[i]![1]
  }
  const s = area2 >= 0 ? 1 : -1

  // Offset each edge outward by its amount
  const offEdges: Array<[number, number, number, number]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = polygon[j]![0] - polygon[i]![0]
    const dz = polygon[j]![1] - polygon[i]![1]
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len < 1e-9) {
      offEdges.push([polygon[i]![0], polygon[i]![1], dx, dz])
      continue
    }
    const amount = amounts[i] ?? 0
    const nx = ((s * dz) / len) * amount
    const nz = ((s * -dx) / len) * amount
    offEdges.push([polygon[i]![0] + nx, polygon[i]![1] + nz, dx, dz])
  }

  // Intersect consecutive offset edges to get new vertices
  const result: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const [ax, az, adx, adz] = offEdges[i]!
    const [bx, bz, bdx, bdz] = offEdges[j]!
    const denom = adx * bdz - adz * bdx
    if (Math.abs(denom) < 1e-9) {
      // Parallel edges have no unique intersection. Emit both offset
      // endpoints — collinear edges with different offsets need the step
      // between them.
      const endAx = ax + adx
      const endAz = az + adz
      result.push([endAx, endAz])
      if (Math.hypot(bx - endAx, bz - endAz) > 1e-9) {
        result.push([bx, bz])
      }
    } else {
      const t = ((bx - ax) * bdz - (bz - az) * bdx) / denom
      result.push([ax + t * adx, az + t * adz])
    }
  }

  return result
}
