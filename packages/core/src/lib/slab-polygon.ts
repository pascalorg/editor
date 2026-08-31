import type { GeometryContext } from '../registry/types'
import type { AnyNodeId, SlabNode, WallNode } from '../schema'
import { isCurvedWall, sampleWallCenterline } from '../systems/wall/wall-curve'
import { getWallThickness } from '../systems/wall/wall-footprint'

/**
 * Render-time slab polygon rules.
 *
 * Slab nodes store the wall-centerline polygon (auto slabs) or the drawn
 * polygon (manual slabs) — render offsets are NEVER stored in node data.
 * At geometry build time each polygon edge is SPLIT at the clipped span
 * boundaries of every overlapping candidate (sibling slab edges and wall
 * centerlines in the adoption band) and each sub-edge is classified
 * independently — a single stored edge can be backed differently along
 * its span (two rooms offset diagonally share a wall only where they
 * overlap, so one room's edge is interior beside the sibling and its own
 * facade elsewhere). Each sub-edge is PROJECTED onto an absolute target
 * line:
 *
 *  - INTERIOR — a sibling slab has a collinear, overlapping edge across
 *    it (directly, or across the same wall's footprint band). Projected
 *    EXACTLY onto a shared line so both neighbours emit the same seam
 *    and tile with no gap or overlap. Equal-height rooms partition the
 *    real wall band at its centerline. At an unequal-height boundary, the
 *    higher slab carries the full band to the lower room's wall face and
 *    the lower slab terminates at that same plane. This closes the step
 *    below the raised wall without lowering the wall or exposing a pocket.
 *    Without a wall, the target is the midline between the stored edges.
 *    The coincident vertical seam faces carry opposite outward
 *    normals and every slab material is front-side, so at most one face
 *    renders per view — no z-fighting.
 *  - WALL-BACKED — no slab neighbour across the edge, but the sub-edge
 *    lies inside a wall's footprint band (lateral distance from the
 *    centerline within half-thickness + adoption tolerance). Projected
 *    to the wall's OUTER face line so the slab reaches flush with the
 *    facade regardless of where the stored edge sits inside the band —
 *    this self-heals legacy data stored at wall faces or with old baked
 *    render offsets.
 *  - FREE — no neighbour, no wall. Rendered exactly as drawn.
 *
 * The whole machinery exists to make ROOM FLOORS tile with the walls
 * standing on them, so it only applies to GROUNDED slabs (underside on
 * the level plane) and recessed pools. A floating deck keeps its drawn
 * polygon exactly — it must not grow into a wall it happens to float
 * beside — and is symmetrically ignored as a seam target by its
 * grounded siblings.
 *
 * Sub-edges of one edge with different projections are joined by a
 * perpendicular STEP connector at the breakpoint. Breakpoints sit on
 * candidate span boundaries — wall junctions — so the step's vertical
 * face lands inside the crossing wall's footprint and stays hidden
 * under the wall body.
 */

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
 * Minimum sub-edge length (m) when splitting an edge at candidate span
 * boundaries. Breakpoints closer than this to the previous one or to an
 * edge endpoint are dropped, so slivers never survive into the ring.
 */
const MIN_SUBEDGE_LENGTH = 0.05
/**
 * Two candidate walls whose centerlines sit within this lateral
 * difference count as equally near; the larger span overlap wins
 * (collinear runs of different-thickness walls along one edge).
 * Otherwise the nearest centerline wins (parallel close walls).
 */
const WALL_LATERAL_TIE_EPSILON = 0.02
const CURVED_WALL_SAMPLE_SEGMENTS = 32
const SLAB_SEAM_ELEVATION_EPSILON = 1e-4
const DEFAULT_SLAB_ELEVATION = 0.05
const DEFAULT_SLAB_THICKNESS = 0.05
/**
 * A non-recessed slab whose underside (`elevation − thickness`) rises
 * above the level plane by more than this is a floating deck: it keeps
 * its drawn polygon (no wall adoption, no seam projection) and grounded
 * siblings don't seam toward it.
 */
const GROUNDED_SLAB_UNDERSIDE_EPSILON = 0.01
/** Prevent near-parallel offset lines from producing unbounded corner spikes. */
const MAX_CORNER_MITER_RATIO = 10

/**
 * Floating deck test — see the module header. Recessed pools are never
 * floating: their negative elevation encodes depth, not placement.
 */
function isFloatingSlab(slab: SlabNode): boolean {
  if (slab.recessed) return false
  const elevation = slab.elevation ?? DEFAULT_SLAB_ELEVATION
  const thickness = slab.thickness ?? DEFAULT_SLAB_THICKNESS
  return elevation - thickness > GROUNDED_SLAB_UNDERSIDE_EPSILON
}

export type SlabPolygonContext = {
  /** Walls on the slab's level. */
  walls: WallNode[]
  /** Other slabs on the same level — the slab itself must be excluded. */
  siblingSlabs: SlabNode[]
}

/** [ax, az, bx, bz] segment in plan space. */
type Segment = [number, number, number, number]

/** A sibling slab edge and the direction of its polygon interior. */
type NeighborSegment = {
  segment: Segment
  elevation: number
  /** Unit normal pointing into the sibling polygon at this edge. */
  inwardX: number
  inwardZ: number
}

function polygonWindingSign(polygon: Array<[number, number]>): 1 | -1 {
  let area2 = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length
    area2 += polygon[index]![0] * polygon[next]![1] - polygon[next]![0] * polygon[index]![1]
  }
  return area2 >= 0 ? 1 : -1
}

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
  if (polygon.length < 3 || isFloatingSlab(slabNode)) {
    return polygon.map(([x, z]) => [x, z] as [number, number])
  }

  const subSpans = computeEdgeSubSpans(
    polygon,
    slabNode.elevation ?? DEFAULT_SLAB_ELEVATION,
    context,
  )
  if (subSpans.every((spans) => spans.length === 1 && spans[0]!.offset === 0)) {
    return polygon.map(([x, z]) => [x, z] as [number, number])
  }

  return offsetPolygonPerEdge(polygon, subSpans)
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
  /** Clipped span start along the edge axis (param from the edge start). */
  start: number
  /** Clipped span end along the edge axis (param from the edge start). */
  end: number
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
  return { overlap, lateral: latP + (latQ - latP) * u, start: low, end: high }
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

/**
 * A contiguous run of one polygon edge sharing a single classification.
 * `start`/`end` are arc-length params from the edge start; `offset` is
 * along the edge's outward normal (negative insets). `key` names the
 * classification + target so same-target neighbours re-fuse.
 */
type EdgeSubSpan = {
  start: number
  end: number
  offset: number
  key: string
}

/**
 * Split every polygon edge at candidate span boundaries and classify
 * each sub-span independently. Returns one non-empty span list per
 * edge, covering [0, edgeLength] without gaps.
 */
function computeEdgeSubSpans(
  polygon: Array<[number, number]>,
  selfElevation: number,
  context: SlabPolygonContext,
): EdgeSubSpan[][] {
  const n = polygon.length

  // Winding sign: the outward normal of an edge with direction `dir` is
  // `s * (dirZ, -dirX)`, so a target lateral `L` measured along
  // `(dirZ, -dirX)` is `s * L` along the outward normal.
  const s = polygonWindingSign(polygon)

  const neighborSegments: NeighborSegment[] = []
  for (const sibling of context.siblingSlabs) {
    // A floating deck keeps its drawn polygon, so it can't be a seam
    // partner: projecting toward it would move this slab's edge while the
    // deck's stays put (asymmetric seam), and the higher/lower band rules
    // only describe room floors meeting under a wall.
    if (isFloatingSlab(sibling)) continue
    const siblingPolygon = sibling.polygon
    if (siblingPolygon.length < 2) continue
    const elevation = sibling.elevation ?? DEFAULT_SLAB_ELEVATION
    const siblingWinding = polygonWindingSign(siblingPolygon)
    for (let index = 0; index < siblingPolygon.length; index += 1) {
      const from = siblingPolygon[index]!
      const to = siblingPolygon[(index + 1) % siblingPolygon.length]!
      const dx = to[0] - from[0]
      const dz = to[1] - from[1]
      const length = Math.hypot(dx, dz)
      if (length < 1e-9) continue
      neighborSegments.push({
        segment: [from[0], from[1], to[0], to[1]],
        elevation,
        inwardX: (-siblingWinding * dz) / length,
        inwardZ: (siblingWinding * dx) / length,
      })
    }
  }

  const wallCandidates: WallCandidate[] = context.walls.map((wall) => ({
    wall,
    segments: wallCenterlineSegments(wall),
    halfThickness: getWallThickness(wall) / 2,
  }))

  // Sibling breakpoints also matter for legacy face-aligned polygons up
  // to a full wall band away from the edge (the band-sibling interior
  // rule in classifySpan), so clip them with the widest band reach any
  // level wall allows. Over-collection is harmless — same-target
  // neighbours re-fuse after classification.
  let siblingBreakTolerance = SLAB_NEIGHBOR_LATERAL_TOLERANCE
  for (const candidate of wallCandidates) {
    siblingBreakTolerance = Math.max(
      siblingBreakTolerance,
      2 * (candidate.halfThickness + WALL_ADOPTION_TOLERANCE),
    )
  }

  const subSpans: EdgeSubSpan[][] = []
  for (let index = 0; index < n; index += 1) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % n]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const edgeLength = Math.hypot(dx, dz)
    if (edgeLength < 1e-9) {
      subSpans.push([{ start: 0, end: edgeLength, offset: 0, key: 'free' }])
      continue
    }
    const dirX = dx / edgeLength
    const dirZ = dz / edgeLength

    const rawBreakpoints: number[] = []
    for (const candidate of wallCandidates) {
      const tolerance = candidate.halfThickness + WALL_ADOPTION_TOLERANCE
      for (const [px, pz, qx, qz] of candidate.segments) {
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
          tolerance,
        )
        if (match) rawBreakpoints.push(match.start, match.end)
      }
    }
    const inwardX = -s * dirZ
    const inwardZ = s * dirX
    for (const {
      segment: [px, pz, qx, qz],
      inwardX: siblingInwardX,
      inwardZ: siblingInwardZ,
    } of neighborSegments) {
      // Coincident/stacked slabs have their interiors on the same side of
      // the edge. Only an edge whose sibling interior is across this edge
      // can form a room-to-room seam.
      if (inwardX * siblingInwardX + inwardZ * siblingInwardZ >= -0.5) continue
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
        siblingBreakTolerance,
      )
      if (match) rawBreakpoints.push(match.start, match.end)
    }
    rawBreakpoints.sort((left, right) => left - right)

    const breakpoints: number[] = []
    let previous = 0
    for (const t of rawBreakpoints) {
      if (t - previous < MIN_SUBEDGE_LENGTH) continue
      // Sorted ascending — every later breakpoint is even closer to the end.
      if (edgeLength - t < MIN_SUBEDGE_LENGTH) break
      breakpoints.push(t)
      previous = t
    }

    const bounds = [0, ...breakpoints, edgeLength]
    const spans: EdgeSubSpan[] = []
    for (let k = 0; k + 1 < bounds.length; k += 1) {
      spans.push(
        classifySpan(
          a,
          dirX,
          dirZ,
          bounds[k]!,
          bounds[k + 1]!,
          s,
          selfElevation,
          wallCandidates,
          neighborSegments,
        ),
      )
    }

    // Re-fuse same-target neighbours, reclassifying over the fused span:
    // curved-wall sampling collapses back to one span per contiguous
    // band, and an edge fully backed by one target reproduces the
    // whole-edge projection exactly.
    let fused = true
    while (fused && spans.length > 1) {
      fused = false
      for (let k = 0; k + 1 < spans.length; k += 1) {
        if (spans[k]!.key !== spans[k + 1]!.key) continue
        const merged = classifySpan(
          a,
          dirX,
          dirZ,
          spans[k]!.start,
          spans[k + 1]!.end,
          s,
          selfElevation,
          wallCandidates,
          neighborSegments,
        )
        spans.splice(k, 2, merged)
        fused = true
        break
      }
    }

    subSpans.push(spans)
  }

  return subSpans
}

/**
 * Classify one span of the edge `a + t·dir`, `t ∈ [start, end]`, with
 * the whole-edge rules: direct sibling wins, sibling across the same
 * wall band forces interior, otherwise the matched wall's outer face,
 * otherwise free. Interior spans backed by a wall project onto the
 * wall centerline at equal heights. At unequal heights both slabs target
 * the lower room's wall face, giving the higher slab the full band.
 */
function classifySpan(
  a: [number, number],
  dirX: number,
  dirZ: number,
  start: number,
  end: number,
  s: number,
  selfElevation: number,
  wallCandidates: readonly WallCandidate[],
  neighborSegments: readonly NeighborSegment[],
): EdgeSubSpan {
  const sx = a[0] + dirX * start
  const sz = a[1] + dirZ * start
  const spanLength = end - start
  // Short spans still need classification — require at most half their span.
  const requiredOverlap = Math.min(MIN_CLASSIFYING_OVERLAP, spanLength * 0.5)
  const inwardX = -s * dirZ
  const inwardZ = s * dirX

  const wallMatch = matchEdgeWallBand(
    sx,
    sz,
    dirX,
    dirZ,
    spanLength,
    requiredOverlap,
    wallCandidates,
  )

  // Direct neighbour: a sibling edge collinear within the tight
  // tolerance regardless of any wall (slabs butted against each other).
  let directOverlap = 0
  let directWeightedLateral = 0
  let directSiblingElevation: number | null = null
  for (const {
    segment: [px, pz, qx, qz],
    elevation,
    inwardX: siblingInwardX,
    inwardZ: siblingInwardZ,
  } of neighborSegments) {
    if (inwardX * siblingInwardX + inwardZ * siblingInwardZ >= -0.5) continue
    const match = clipCollinearSegment(
      sx,
      sz,
      dirX,
      dirZ,
      spanLength,
      px,
      pz,
      qx,
      qz,
      SLAB_NEIGHBOR_LATERAL_TOLERANCE,
    )
    if (!match) continue
    directOverlap += match.overlap
    directWeightedLateral += match.lateral * match.overlap
    directSiblingElevation =
      directSiblingElevation === null ? elevation : Math.max(directSiblingElevation, elevation)
  }

  let interiorLateral: number | null = null
  let siblingElevation: number | null = null
  if (directOverlap >= requiredOverlap) {
    // No-wall fallback: half the mean sibling separation — the midline
    // between the two stored edges. Symmetric: the sibling measures the
    // same separation with opposite sign from its own line, so both
    // project onto the same line and the seam stays gapless.
    interiorLateral = wallMatch ? wallMatch.lateral : directWeightedLateral / directOverlap / 2
    siblingElevation = directSiblingElevation
  } else if (wallMatch) {
    // Rooms across a shared wall: legacy face-aligned polygons sit a
    // full thickness apart — far beyond the direct tolerance — but
    // both edges live inside the same wall band. Both sides must
    // classify interior, otherwise each would project to the opposite
    // outer face and overlap under the wall.
    const bandTolerance = wallMatch.halfThickness + WALL_ADOPTION_TOLERANCE
    const looseTolerance = Math.abs(wallMatch.lateral) + bandTolerance
    let bandOverlap = 0
    for (const {
      segment: [px, pz, qx, qz],
      elevation,
      inwardX: siblingInwardX,
      inwardZ: siblingInwardZ,
    } of neighborSegments) {
      if (inwardX * siblingInwardX + inwardZ * siblingInwardZ >= -0.5) continue
      const match = clipCollinearSegment(
        sx,
        sz,
        dirX,
        dirZ,
        spanLength,
        px,
        pz,
        qx,
        qz,
        looseTolerance,
      )
      if (!match) continue
      if (Math.abs(match.lateral - wallMatch.lateral) > bandTolerance) continue
      bandOverlap += match.overlap
      siblingElevation =
        siblingElevation === null ? elevation : Math.max(siblingElevation, elevation)
    }
    if (bandOverlap >= requiredOverlap) {
      interiorLateral = wallMatch.lateral
    } else {
      siblingElevation = null
    }
  }

  if (interiorLateral !== null) {
    if (wallMatch && siblingElevation !== null) {
      const elevationDelta = selfElevation - siblingElevation
      if (elevationDelta > SLAB_SEAM_ELEVATION_EPSILON) {
        return {
          start,
          end,
          offset: s * wallMatch.lateral + wallMatch.halfThickness,
          key: `interior|${wallMatch.wall.id}|higher`,
        }
      }
      if (elevationDelta < -SLAB_SEAM_ELEVATION_EPSILON) {
        return {
          start,
          end,
          offset: s * wallMatch.lateral - wallMatch.halfThickness,
          key: `interior|${wallMatch.wall.id}|lower`,
        }
      }
    }
    return {
      start,
      end,
      offset: s * interiorLateral,
      key: `interior|${wallMatch ? wallMatch.wall.id : '~'}`,
    }
  }
  if (wallMatch) {
    return {
      start,
      end,
      offset: s * wallMatch.lateral + wallMatch.halfThickness,
      key: `wall|${wallMatch.wall.id}`,
    }
  }
  return { start, end, offset: 0, key: 'free' }
}

/**
 * Offset each edge's sub-spans along the edge's outward normal by their
 * own amounts (negative insets), then rebuild the ring: consecutive
 * sub-spans of one edge with different offsets are joined by a
 * perpendicular step connector at the breakpoint (both boundary points
 * share the breakpoint param), and corners between different edges
 * intersect the offset lines of the adjoining sub-spans.
 */
function offsetPolygonPerEdge(
  polygon: Array<[number, number]>,
  subSpans: EdgeSubSpan[][],
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

  type EdgeFrame = { ax: number; az: number; dx: number; dz: number; dirX: number; dirZ: number }
  const frames: EdgeFrame[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = polygon[j]![0] - polygon[i]![0]
    const dz = polygon[j]![1] - polygon[i]![1]
    const length = Math.hypot(dx, dz)
    const dirX = length < 1e-9 ? 0 : dx / length
    const dirZ = length < 1e-9 ? 0 : dz / length
    frames.push({ ax: polygon[i]![0], az: polygon[i]![1], dx, dz, dirX, dirZ })
  }

  const pointAt = (edge: number, t: number, offset: number): [number, number] => {
    const frame = frames[edge]!
    return [
      frame.ax + frame.dirX * t + s * frame.dirZ * offset,
      frame.az + frame.dirZ * t - s * frame.dirX * offset,
    ]
  }

  const result: Array<[number, number]> = []
  const push = (point: [number, number]) => {
    const previous = result[result.length - 1]
    if (previous && Math.hypot(previous[0] - point[0], previous[1] - point[1]) < 1e-9) return
    result.push(point)
  }

  for (let i = 0; i < n; i++) {
    const spans = subSpans[i]!

    // Step connectors between differently-projected sub-spans of edge i.
    // Equal offsets (different walls sharing a face line) collapse to a
    // single collinear vertex via the coincident-point guard in `push`.
    for (let k = 1; k < spans.length; k += 1) {
      push(pointAt(i, spans[k - 1]!.end, spans[k - 1]!.offset))
      push(pointAt(i, spans[k]!.start, spans[k]!.offset))
    }

    // Corner between edge i and edge j: intersect the offset lines of
    // edge i's last sub-span and edge j's first sub-span.
    const j = (i + 1) % n
    const last = spans[spans.length - 1]!
    const first = subSpans[j]![0]!
    const [ax, az] = pointAt(i, last.start, last.offset)
    const endI = pointAt(i, last.end, last.offset)
    const startJ = pointAt(j, first.start, first.offset)
    const [bx, bz] = startJ
    const frameI = frames[i]!
    const frameJ = frames[j]!
    const denom = frameI.dx * frameJ.dz - frameI.dz * frameJ.dx
    if (Math.abs(denom) < 1e-9) {
      // Parallel edges have no unique intersection. Emit both offset
      // endpoints — collinear edges with different offsets need the step
      // between them.
      push(endI)
      push(startJ)
    } else {
      const t = ((bx - ax) * frameJ.dz - (bz - az) * frameJ.dx) / denom
      const intersection: [number, number] = [ax + t * frameI.dx, az + t * frameI.dz]
      const miterReach = Math.max(
        Math.hypot(intersection[0] - endI[0], intersection[1] - endI[1]),
        Math.hypot(intersection[0] - startJ[0], intersection[1] - startJ[1]),
      )
      const offsetScale = Math.max(Math.abs(last.offset), Math.abs(first.offset), 1e-9)
      if (
        !(Number.isFinite(intersection[0]) && Number.isFinite(intersection[1])) ||
        miterReach > offsetScale * MAX_CORNER_MITER_RATIO
      ) {
        push(endI)
        push(startJ)
      } else {
        push(intersection)
      }
    }
  }

  if (result.length > 1) {
    const firstPoint = result[0]!
    const lastPoint = result[result.length - 1]!
    if (Math.hypot(firstPoint[0] - lastPoint[0], firstPoint[1] - lastPoint[1]) < 1e-9) {
      result.pop()
    }
  }

  return result
}
