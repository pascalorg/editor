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
 * slab's level context and PROJECTED onto an absolute target line:
 *
 *  - INTERIOR — a sibling slab has a collinear, overlapping edge across
 *    it (directly, or across the same wall's footprint band). Projected
 *    to the shared line (wall centerline when a wall backs the edge,
 *    the midline between the two stored edges otherwise) minus a small
 *    relief so adjacent slabs tile with a hidden gap under the shared
 *    wall instead of overlapping or z-fighting.
 *  - WALL-BACKED — no slab neighbour, but the edge lies inside a wall's
 *    footprint band (lateral distance from the centerline within
 *    half-thickness + adoption tolerance). Projected to the wall's OUTER
 *    face line so the slab reaches flush with the facade regardless of
 *    where the stored edge sits inside the band — this self-heals legacy
 *    data stored at wall faces or with old baked render offsets.
 *  - FREE — no neighbour, no wall. Rendered exactly as drawn.
 */

/** Relief inset applied to edges shared with a sibling slab. */
const INTERIOR_EDGE_INSET = 0.02
/** Lateral distance within which a sibling slab edge counts as directly "across" an edge. */
const SLAB_NEIGHBOR_LATERAL_TOLERANCE = 0.05
/**
 * Extra lateral tolerance beyond a wall's half-thickness for band
 * adoption. 0.06 keeps every previously-adopted edge adopted (the old
 * fixed 0.1 tolerance equals half-thickness + 0.05 for the thinnest
 * 0.1 walls, and auto slab polygons simplified with a 0.08 tolerance on
 * curved walls stay inside half + 0.06), while giving hand-adjusted
 * edges ~6cm of slack on either side of the wall faces.
 */
const WALL_ADOPTION_TOLERANCE = 0.06
/** Minimum collinear overlap (m) before a candidate drives the classification. */
const MIN_CLASSIFYING_OVERLAP = 0.05
/**
 * Two candidate walls whose centerlines sit within this lateral
 * difference count as equally near; the larger span overlap wins
 * (collinear runs of different-thickness walls along one edge).
 * Otherwise the nearest centerline wins (parallel close walls).
 */
const WALL_LATERAL_TIE_EPSILON = 0.02
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

type SegmentMatch = {
  /** Overlap (m) between the candidate and the edge span, along the edge axis. */
  overlap: number
  /**
   * Signed lateral distance of the candidate from the edge's infinite
   * line, measured at the middle of the clipped span, along the edge's
   * left normal `n = (dirZ, -dirX)`.
   */
  lateral: number
}

/**
 * Clip the candidate segment `(px, pz) → (qx, qz)` against the span of
 * the edge starting at `(ax, az)` with normalized direction
 * `(dirX, dirZ)`, counting only when the candidate is collinear with
 * the edge within `lateralTolerance` (both candidate endpoints within
 * that distance of the edge's infinite line — testing against the
 * infinite line, not the edge span, is what lets a T-junction
 * sub-segment match its longer host edge).
 */
function clipCollinearSegment(
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
): SegmentMatch | null {
  const relPX = px - ax
  const relPZ = pz - az
  const latP = relPX * dirZ - relPZ * dirX
  if (Math.abs(latP) > lateralTolerance) return null
  const relQX = qx - ax
  const relQZ = qz - az
  const latQ = relQX * dirZ - relQZ * dirX
  if (Math.abs(latQ) > lateralTolerance) return null

  const t0 = relPX * dirX + relPZ * dirZ
  const t1 = relQX * dirX + relQZ * dirZ
  const low = Math.max(Math.min(t0, t1), 0)
  const high = Math.min(Math.max(t0, t1), edgeLength)
  const overlap = high - low
  if (overlap <= 0) return null

  const tMid = (low + high) / 2
  const u = Math.abs(t1 - t0) < 1e-12 ? 0.5 : (tMid - t0) / (t1 - t0)
  return { overlap, lateral: latP + (latQ - latP) * u }
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

type WallCandidate = {
  wall: WallNode
  segments: Segment[]
  halfThickness: number
}

type WallBandMatch = {
  wall: WallNode
  halfThickness: number
  /** Total collinear overlap (m) of the wall centerline with the edge span. */
  overlap: number
  /**
   * Overlap-weighted mean signed lateral distance of the wall
   * centerline from the edge line, along `n = (dirZ, -dirX)`.
   */
  lateral: number
}

/**
 * Best wall whose footprint band contains the edge: the centerline is
 * collinear within half-thickness + {@link WALL_ADOPTION_TOLERANCE} and
 * span-overlaps the edge by at least `requiredOverlap`. Nearest
 * centerline wins; near-ties fall back to the larger overlap.
 */
function matchEdgeWallBand(
  ax: number,
  az: number,
  dirX: number,
  dirZ: number,
  edgeLength: number,
  requiredOverlap: number,
  candidates: readonly WallCandidate[],
): WallBandMatch | null {
  let best: WallBandMatch | null = null
  for (const candidate of candidates) {
    const tolerance = candidate.halfThickness + WALL_ADOPTION_TOLERANCE
    let overlap = 0
    let weightedLateral = 0
    for (const [px, pz, qx, qz] of candidate.segments) {
      const match = clipCollinearSegment(ax, az, dirX, dirZ, edgeLength, px, pz, qx, qz, tolerance)
      if (!match) continue
      overlap += match.overlap
      weightedLateral += match.lateral * match.overlap
    }
    if (overlap < requiredOverlap) continue

    const lateral = weightedLateral / overlap
    if (!best) {
      best = { wall: candidate.wall, halfThickness: candidate.halfThickness, overlap, lateral }
      continue
    }
    const bestAbs = Math.abs(best.lateral)
    const thisAbs = Math.abs(lateral)
    const nearTie = Math.abs(thisAbs - bestAbs) <= WALL_LATERAL_TIE_EPSILON
    if (nearTie ? overlap > best.overlap : thisAbs < bestAbs) {
      best = { wall: candidate.wall, halfThickness: candidate.halfThickness, overlap, lateral }
    }
  }
  return best
}

export type SlabEdgeWallBandSnap = {
  wallId: WallNode['id']
  /** The candidate edge translated perpendicular onto the wall centerline. */
  edge: [[number, number], [number, number]]
}

/**
 * Reshape-snap counterpart of the render band rule: when the edge
 * `a → b` lies inside a wall's footprint band, return the edge
 * translated onto that wall's CENTERLINE — the canonical stored
 * position (matching what auto slabs store); the render rule then
 * places it at the face. `maxLateral` optionally tightens the stick
 * distance (non-magnetic modes keep only a connect-radius stick).
 */
export function snapSlabEdgeToWallBand(
  a: [number, number],
  b: [number, number],
  walls: readonly WallNode[],
  options?: { maxLateral?: number },
): SlabEdgeWallBandSnap | null {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const edgeLength = Math.hypot(dx, dz)
  if (edgeLength < 1e-9) return null
  const dirX = dx / edgeLength
  const dirZ = dz / edgeLength
  const requiredOverlap = Math.min(MIN_CLASSIFYING_OVERLAP, edgeLength * 0.5)

  const candidates: WallCandidate[] = walls.map((wall) => ({
    wall,
    segments: wallCenterlineSegments(wall),
    halfThickness: getWallThickness(wall) / 2,
  }))

  const match = matchEdgeWallBand(a[0], a[1], dirX, dirZ, edgeLength, requiredOverlap, candidates)
  if (!match) return null
  if (options?.maxLateral !== undefined && Math.abs(match.lateral) > options.maxLateral) return null

  const nx = dirZ * match.lateral
  const nz = -dirX * match.lateral
  return {
    wallId: match.wall.id,
    edge: [
      [a[0] + nx, a[1] + nz],
      [b[0] + nx, b[1] + nz],
    ],
  }
}

/** Per-edge offset amounts (positive = outward) for `polygon`'s edges. */
function computeEdgeOffsets(
  polygon: Array<[number, number]>,
  context: SlabPolygonContext,
): number[] {
  const n = polygon.length
  const offsets = new Array<number>(n).fill(0)

  // Winding sign: the outward normal of an edge with direction `dir` is
  // `s * (dirZ, -dirX)`, so a target lateral `L` measured along
  // `(dirZ, -dirX)` is `s * L` along the outward normal.
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area2 += polygon[i]![0] * polygon[j]![1] - polygon[j]![0] * polygon[i]![1]
  }
  const s = area2 >= 0 ? 1 : -1

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

  const wallCandidates: WallCandidate[] = context.walls.map((wall) => ({
    wall,
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

    const wallMatch = matchEdgeWallBand(
      a[0],
      a[1],
      dirX,
      dirZ,
      edgeLength,
      requiredOverlap,
      wallCandidates,
    )

    // Direct neighbour: a sibling edge collinear within the tight
    // tolerance regardless of any wall (slabs butted against each other).
    let directOverlap = 0
    let directWeightedLateral = 0
    for (const [px, pz, qx, qz] of neighborSegments) {
      const match = clipCollinearSegment(
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
      if (!match) continue
      directOverlap += match.overlap
      directWeightedLateral += match.lateral * match.overlap
    }

    let interiorLateral: number | null = null
    if (directOverlap >= requiredOverlap) {
      interiorLateral = wallMatch ? wallMatch.lateral : directWeightedLateral / directOverlap / 2
    } else if (wallMatch) {
      // Rooms across a shared wall: legacy face-aligned polygons sit a
      // full thickness apart — far beyond the direct tolerance — but
      // both edges live inside the same wall band. Both sides must
      // classify interior, otherwise each would project to the opposite
      // outer face and overlap under the wall.
      const bandTolerance = wallMatch.halfThickness + WALL_ADOPTION_TOLERANCE
      const looseTolerance = Math.abs(wallMatch.lateral) + bandTolerance
      let bandOverlap = 0
      for (const [px, pz, qx, qz] of neighborSegments) {
        const match = clipCollinearSegment(
          a[0],
          a[1],
          dirX,
          dirZ,
          edgeLength,
          px,
          pz,
          qx,
          qz,
          looseTolerance,
        )
        if (!match) continue
        if (Math.abs(match.lateral - wallMatch.lateral) > bandTolerance) continue
        bandOverlap += match.overlap
      }
      if (bandOverlap >= requiredOverlap) {
        interiorLateral = wallMatch.lateral
      }
    }

    if (interiorLateral !== null) {
      offsets[index] = s * interiorLateral - INTERIOR_EDGE_INSET
    } else if (wallMatch) {
      offsets[index] = s * wallMatch.lateral + wallMatch.halfThickness
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
