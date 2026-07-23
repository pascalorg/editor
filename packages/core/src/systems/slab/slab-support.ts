import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import type { SlabNode, WallNode } from '../../schema'
import { getWallCurveFrameAt, isCurvedWall } from '../wall/wall-curve'
import { DEFAULT_WALL_THICKNESS } from '../wall/wall-footprint'
import { MIN_WALL_HEIGHT } from '../wall/wall-top'

export type SlabElevationClamp = {
  elevation: number
  clamped: boolean
}

/**
 * Clamp-never-ask upper bound for a slab's elevation. A plane-bound wall
 * (no stored `height`) keeps its top at the storey plane, so a slab that
 * rises past `storeyHeight - MIN_WALL_HEIGHT` while electing as that
 * wall's base would squeeze the wall body below its minimum (and at the
 * plane, to nothing). Walls with explicit heights don't constrain — their
 * top rides the elected base, not the plane. Negative proposals (the
 * drag-through-zero path that commits the `recessed` intent) pass
 * through untouched: this is a purely numeric upper bound.
 *
 * The election runs against `levelSlabs` with `proposedElevation`
 * substituted into `slab`, so a slab that would only WIN the election at
 * the proposed elevation still clamps, and a slab out-elected by a
 * sibling doesn't. Pure.
 */
export function clampSlabElevationForWalls(
  proposedElevation: number,
  slab: SlabNode,
  levelWalls: WallNode[],
  levelSlabs: readonly SlabNode[],
  storeyHeight: number,
): SlabElevationClamp {
  const bound = storeyHeight - MIN_WALL_HEIGHT
  if (proposedElevation <= bound) return { elevation: proposedElevation, clamped: false }
  if (slab.polygon.length < 3) return { elevation: proposedElevation, clamped: false }

  const substituted = levelSlabs.some((candidate) => candidate.id === slab.id)
    ? levelSlabs.map((candidate) =>
        candidate.id === slab.id ? { ...candidate, elevation: proposedElevation } : candidate,
      )
    : [...levelSlabs, { ...slab, elevation: proposedElevation }]

  for (const wall of levelWalls) {
    if (wall.height != null) continue
    const wallLike: WallOverlapInput = {
      start: wall.start,
      end: wall.end,
      curveOffset: wall.curveOffset,
      thickness: wall.thickness,
    }
    // Cheap pre-filter: a wall that never reaches the slab's footprint
    // can't elect it, whatever the election says about sibling slabs.
    if (!wallOverlapsPolygon(wallLike, slab.polygon)) continue
    const support = computeWallSlabSupport(wallLike, substituted, levelWalls)
    if (Math.abs(support.elevation - proposedElevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON) {
      return { elevation: bound, clamped: true }
    }
  }

  return { elevation: proposedElevation, clamped: false }
}

/**
 * Static upper bound for a slab-elevation drag: probe the election with
 * the slab raised above every sibling and the storey plane. If any
 * plane-bound wall would elect it there, the drag may not pass
 * `storeyHeight - MIN_WALL_HEIGHT`; otherwise it is unbounded above.
 */
export function getSlabElevationUpperBound(
  slab: SlabNode,
  levelWalls: WallNode[],
  levelSlabs: readonly SlabNode[],
  storeyHeight: number,
): number {
  const probe =
    Math.max(storeyHeight, ...levelSlabs.map((candidate) => candidate.elevation ?? 0.05)) + 1
  return clampSlabElevationForWalls(probe, slab, levelWalls, levelSlabs, storeyHeight).clamped
    ? storeyHeight - MIN_WALL_HEIGHT
    : Number.POSITIVE_INFINITY
}

/**
 * Point-in-polygon test using ray casting algorithm.
 */
export function pointInPolygon(px: number, pz: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]![0],
      zi = polygon[i]![1]
    const xj = polygon[j]![0],
      zj = polygon[j]![1]

    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function pointSegmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-18) return Math.hypot(px - ax, pz - az)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared))
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

// Ray-cast pointInPolygon is unreliable for points exactly on the polygon
// boundary: the answer flips depending on which side of the polygon the edge
// is on. Interval classification below therefore treats "within this distance
// of the boundary" as inside explicitly, so walls sitting exactly on a slab
// edge (the common case — auto-slab polygons derive from wall centerlines)
// classify identically on every side of the slab.
const ON_BOUNDARY_EPSILON = 1e-4

export function pointOnPolygonBoundary(
  px: number,
  pz: number,
  polygon: Array<[number, number]>,
): boolean {
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const [ax, az] = polygon[i]!
    const [bx, bz] = polygon[(i + 1) % n]!
    if (pointSegmentDistance(px, pz, ax, az, bx, bz) <= ON_BOUNDARY_EPSILON) return true
  }
  return false
}

/** Sub-interval along a segment or polyline: [start, end] in length units. */
type LengthInterval = [number, number]

function mergeIntervals(intervals: LengthInterval[]): LengthInterval[] {
  if (intervals.length <= 1) return intervals
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const merged: LengthInterval[] = [[sorted[0]![0], sorted[0]![1]]]
  for (let i = 1; i < sorted.length; i++) {
    const [intervalStart, intervalEnd] = sorted[i]!
    const last = merged[merged.length - 1]!
    if (intervalStart <= last[1] + 1e-9) {
      last[1] = Math.max(last[1], intervalEnd)
    } else {
      merged.push([intervalStart, intervalEnd])
    }
  }
  return merged
}

/** Total length of a merged (sorted, disjoint) interval list. */
function intervalsLength(intervals: readonly LengthInterval[]): number {
  let total = 0
  for (const [intervalStart, intervalEnd] of intervals) total += intervalEnd - intervalStart
  return total
}

/** `base` minus `cut`. Both inputs may be unsorted; the result is merged. */
function subtractIntervals(base: LengthInterval[], cut: LengthInterval[]): LengthInterval[] {
  if (base.length === 0 || cut.length === 0) return mergeIntervals(base)
  const cuts = mergeIntervals(cut)
  const result: LengthInterval[] = []
  for (const [baseStart, baseEnd] of mergeIntervals(base)) {
    let cursor = baseStart
    for (const [cutStart, cutEnd] of cuts) {
      if (cutEnd <= cursor) continue
      if (cutStart >= baseEnd) break
      if (cutStart > cursor) result.push([cursor, cutStart])
      cursor = cutEnd
      if (cursor >= baseEnd) break
    }
    if (cursor < baseEnd) result.push([cursor, baseEnd])
  }
  return result
}

/**
 * Sub-intervals of segment (ax,az)→(bx,bz) that lie inside the polygon (and,
 * when `includeBoundary`, on its boundary), as [t0, t1] fractions of the
 * segment. The segment is split at every crossing with a polygon edge and
 * each sub-interval is classified by its midpoint, so no test point ever
 * sits on a crossing.
 */
function segmentInsideIntervals(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  polygon: Array<[number, number]>,
  includeBoundary: boolean,
): LengthInterval[] {
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return []

  const ts = [0, 1]
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const [px, pz] = polygon[i]!
    const [qx, qz] = polygon[(i + 1) % n]!
    const ex = qx - px
    const ez = qz - pz
    const denom = dx * ez - dz * ex
    if (Math.abs(denom) < 1e-12) continue // parallel/collinear — nothing to split at
    const t = ((px - ax) * ez - (pz - az) * ex) / denom
    const s = ((px - ax) * dz - (pz - az) * dx) / denom
    if (t > 0 && t < 1 && s >= -1e-9 && s <= 1 + 1e-9) ts.push(t)
  }
  ts.sort((a, b) => a - b)

  const inside: LengthInterval[] = []
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i - 1]!
    const t1 = ts[i]!
    if (t1 - t0 < 1e-9) continue
    const tm = (t0 + t1) / 2
    const mx = ax + dx * tm
    const mz = az + dz * tm
    const midpointInside = pointOnPolygonBoundary(mx, mz, polygon)
      ? includeBoundary
      : pointInPolygon(mx, mz, polygon)
    if (midpointInside) inside.push([t0, t1])
  }
  return inside
}

function polylineLength(points: Array<{ x: number; y: number }>): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  }
  return total
}

/**
 * Inside sub-intervals of a polyline against a polygon, in cumulative
 * arc-length units from the polyline start (merged, disjoint). Boundary
 * contact counts as inside for slab support (walls sit exactly on slab
 * edges — see ON_BOUNDARY_EPSILON above); hole callers pass
 * `includeBoundary: false` so a wall running along a stairwell hole's
 * rim keeps the rim's support.
 */
function polylineInsideIntervals(
  points: Array<{ x: number; y: number }>,
  polygon: Array<[number, number]>,
  includeBoundary = true,
): LengthInterval[] {
  const intervals: LengthInterval[] = []
  let offset = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y)
    if (segmentLength < 1e-9) continue
    for (const [t0, t1] of segmentInsideIntervals(a.x, a.y, b.x, b.y, polygon, includeBoundary)) {
      intervals.push([offset + t0 * segmentLength, offset + t1 * segmentLength])
    }
    offset += segmentLength
  }
  return mergeIntervals(intervals)
}

export type WallOverlapInput = {
  start: [number, number]
  end: [number, number]
  curveOffset?: number
  thickness?: number
}

// Minimum length of wall that must lie on/inside a slab polygon before the
// wall counts as overlapping it. Point contact (a perpendicular wall butting
// into a room's edge) clips to ~zero length and never reaches this, so such
// walls don't follow the slab's elevation.
const WALL_SLAB_MIN_OVERLAP = 0.05

/**
 * Centerline of the wall plus its two face lines (centerline offset by
 * ±halfThickness). The face lines catch walls whose centerline sits on or
 * just outside the slab boundary but whose body reaches onto the slab —
 * e.g. slab polygons drawn to the room's interior faces.
 */
function wallTestPolylines(
  start: [number, number],
  end: [number, number],
  curveOffset: number,
  halfThickness: number,
): Array<Array<{ x: number; y: number }>> {
  const wallLike = { start, end, curveOffset }
  if (curveOffset !== 0 && isCurvedWall(wallLike)) {
    const count = 16
    const center: Array<{ x: number; y: number }> = []
    const left: Array<{ x: number; y: number }> = []
    const right: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= count; i++) {
      const frame = getWallCurveFrameAt(wallLike, i / count)
      center.push(frame.point)
      left.push({
        x: frame.point.x + frame.normal.x * halfThickness,
        y: frame.point.y + frame.normal.y * halfThickness,
      })
      right.push({
        x: frame.point.x - frame.normal.x * halfThickness,
        y: frame.point.y - frame.normal.y * halfThickness,
      })
    }
    return halfThickness > 0 ? [center, left, right] : [center]
  }

  const center = [
    { x: start[0], y: start[1] },
    { x: end[0], y: end[1] },
  ]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const len = Math.hypot(dx, dz)
  if (len < 1e-10 || halfThickness <= 0) return [center]
  const nx = (-dz / len) * halfThickness
  const nz = (dx / len) * halfThickness
  return [
    center,
    [
      { x: start[0] + nx, y: start[1] + nz },
      { x: end[0] + nx, y: end[1] + nz },
    ],
    [
      { x: start[0] - nx, y: start[1] - nz },
      { x: end[0] - nx, y: end[1] - nz },
    ],
  ]
}

/**
 * Test whether a wall overlaps a slab polygon along a segment of its length.
 *
 * The wall's centerline and both face lines are clipped against the polygon;
 * the wall overlaps when the longest clipped inside-or-on-boundary length
 * exceeds a threshold (5cm, halved for very short walls). Because interval
 * midpoints classify "on the boundary" as inside explicitly (never by
 * ray-cast tie-breaking), a wall sitting exactly on a slab edge resolves
 * identically on every side of the slab.
 *
 * A wall that only touches the polygon at a point — a perpendicular wall
 * butting into a room's edge, or a corner-to-corner touch — clips to ~zero
 * length and does NOT overlap.
 */
export function wallOverlapsPolygon(
  startOrWall: [number, number] | WallOverlapInput,
  endOrPolygon: [number, number] | Array<[number, number]>,
  polygonArg?: Array<[number, number]>,
): boolean {
  // Two call shapes:
  //   wallOverlapsPolygon(wallLike, polygon) — preferred; curve-aware
  //   wallOverlapsPolygon(start, end, polygon) — legacy chord-only
  let start: [number, number]
  let end: [number, number]
  let polygon: Array<[number, number]>
  let curveOffset = 0
  let thickness = DEFAULT_WALL_THICKNESS
  if (Array.isArray(startOrWall)) {
    start = startOrWall as [number, number]
    end = endOrPolygon as [number, number]
    polygon = polygonArg as Array<[number, number]>
  } else {
    start = startOrWall.start
    end = startOrWall.end
    curveOffset = startOrWall.curveOffset ?? 0
    thickness = startOrWall.thickness ?? DEFAULT_WALL_THICKNESS
    polygon = endOrPolygon as Array<[number, number]>
  }
  return wallOverlapsSlabFootprint({ start, end, curveOffset, thickness }, polygon)
}

/**
 * {@link wallOverlapsPolygon} with the slab's stored holes subtracted from
 * the covered length: a wall whose band only reaches the polygon inside a
 * hole does not overlap. Hole boundaries keep coverage (rim convention —
 * see {@link computeWallSlabSupport}). Polygon boundary contact counts as
 * covered, so a wall sitting exactly on a slab edge resolves identically
 * on every side of the slab. Pure.
 */
export function wallOverlapsSlabFootprint(
  wallLike: WallOverlapInput,
  polygon: Array<[number, number]>,
  holes?: ReadonlyArray<Array<[number, number]>>,
): boolean {
  const { start, end, curveOffset = 0, thickness = DEFAULT_WALL_THICKNESS } = wallLike
  const halfThickness = Math.max(thickness / 2, 0)

  const polylines = wallTestPolylines(start, end, curveOffset, halfThickness)
  const centerLength = polylineLength(polylines[0]!)
  if (centerLength < 1e-9) return false

  let overlap = 0
  for (const line of polylines) {
    let intervals = polylineInsideIntervals(line, polygon)
    for (const hole of holes ?? []) {
      if (intervals.length === 0) break
      if (hole.length < 3) continue
      intervals = subtractIntervals(intervals, polylineInsideIntervals(line, hole, false))
    }
    overlap = Math.max(overlap, intervalsLength(intervals))
  }
  const threshold = Math.max(1e-3, Math.min(WALL_SLAB_MIN_OVERLAP, centerLength * 0.5))
  return overlap >= threshold
}

/**
 * Tolerance for the pointer-decided support cap: a slab still counts as
 * "the surface you're pointing at (or below)" when its walking surface is
 * within this many meters ABOVE the pointed elevation. Absorbs elevation
 * noise between the ray hit and slab tops without letting a deck hanging
 * clearly above the hit point capture the election. Defined here (rather
 * than in the spatial-grid manager, which re-exports it) so the wall
 * election below can honour the same cap without an import cycle.
 */
export const SUPPORT_ELEVATION_EPSILON = 0.05

// A slab elevation must support at least this fraction of the wall's
// length before it can dictate the wall's base. Below majority, a raised
// slab reaching one endpoint would hoist the whole wall off the floor
// that actually carries it.
const WALL_SLAB_SUPPORT_MAJORITY = 0.5

// Slabs whose elevations differ by less than this pool their support:
// a wall shared between two rooms' slabs is covered roughly half by
// each, and must still follow their common elevation.
const WALL_SLAB_ELEVATION_POOL_EPSILON = 1e-4

/**
 * Base elevation for a wall, decided by which slabs actually SUPPORT it.
 *
 * Support is measured as covered length: the wall's centerline and face
 * lines are clipped against each slab's RENDERED footprint
 * (`getRenderableSlabPolygon` with the level walls + siblings, not the
 * stored polygon — legacy polygons stored at wall faces or with old
 * baked offsets fall short of the wall body, but their band-adopted
 * rendered edge reaches the wall's outer face) minus the slab's stored
 * holes (holes are data, never render-offset). A slab supporting less
 * than `WALL_SLAB_MIN_OVERLAP` of the wall is ignored entirely (point
 * contact, endpoint grazes).
 *
 * Same-elevation slabs pool their coverage. `elevation` preserves the
 * existing wall-relative origin: the highest elevation covering at
 * least `WALL_SLAB_SUPPORT_MAJORITY` of the wall, or the best-covered
 * elevation when none reaches majority. `baseElevation` only fills down
 * where a lower support remains exposed on a wall face after higher,
 * overlapping support is accounted for. Coincident floor/platform slabs
 * therefore keep the wall on the platform, while slabs on opposite wall
 * sides bridge correctly. A slab touching only one endpoint never enters
 * either result. Pure;
 * exported for tests.
 */
export type WallSlabSupport = {
  /** Existing wall-relative floor elevation used by hosted children and wall height. */
  elevation: number
  /** Slab whose elevation won the election, or null when the wall has no support. */
  electedSlabId: string | null
  /** Lowest exposed adjacent support; wall geometry fills down to this elevation. */
  baseElevation: number
  /** Piecewise bottom elevation along the wall centerline, in normalized arc-length units. */
  baseSegments: WallSlabSupportSegment[]
}

export type WallSlabSupportSegment = {
  start: number
  end: number
  elevation: number
}

/**
 * `preferredSlabId` is a persisted support host (`wall.supportSlabId`):
 * while that slab is still in the candidate set (still overlaps the wall
 * band with enough covered length), the elected `elevation` is pinned to
 * it instead of the majority/best-coverage election. `baseSegments` /
 * `baseElevation` (fill-down) still derive from ALL supporting slabs
 * unchanged. A preferred slab that no longer qualifies is silently
 * ignored — deliberately never cleared here, so the host resumes if the
 * slab's polygon returns (only slab deletion strips the stored field).
 *
 * `maxElevation` is the pointer-decided support cap (level-local Y, same
 * semantics as the item election): when set, elevation groups whose
 * walking surface sits above `maxElevation + SUPPORT_ELEVATION_EPSILON`
 * are excluded from the majority/best election — a deck hanging above the
 * surface the cursor ray actually hit never captures the elected base.
 * `baseSegments` / `baseElevation` stay uncapped (geometry fill-down), and
 * an explicit `preferredSlabId` still wins over the cap.
 */
export function computeWallSlabSupport(
  wallLike: WallOverlapInput,
  slabs: readonly SlabNode[],
  levelWalls: WallNode[],
  preferredSlabId?: string | null,
  maxElevation?: number | null,
): WallSlabSupport {
  const { start, end, curveOffset = 0, thickness = DEFAULT_WALL_THICKNESS } = wallLike
  const halfThickness = Math.max(thickness / 2, 0)
  const polylines = wallTestPolylines(start, end, curveOffset, halfThickness)
  const polylineLengths = polylines.map(polylineLength)
  const wallLength = polylineLengths[0]!
  if (wallLength < 1e-9) {
    return { elevation: 0, electedSlabId: null, baseElevation: 0, baseSegments: [] }
  }

  const minSupport = Math.max(1e-3, Math.min(WALL_SLAB_MIN_OVERLAP, wallLength * 0.5))

  type ElevationGroup = {
    elevation: number
    slabIds: string[]
    perPolyline: LengthInterval[][]
  }
  const groups: ElevationGroup[] = []
  let preferredElevation: number | null = null
  let preferredElectedSlabId: string | null = null

  for (const slab of slabs) {
    if (slab.polygon.length < 3) continue
    const renderedPolygon = getRenderableSlabPolygon(slab, {
      walls: levelWalls,
      siblingSlabs: slabs.filter((other) => other.id !== slab.id),
    })

    let supported = 0
    const perPolyline = polylines.map((line) => {
      let intervals = polylineInsideIntervals(line, renderedPolygon)
      for (const hole of slab.holes || []) {
        if (intervals.length === 0) break
        if (hole.length < 3) continue
        intervals = subtractIntervals(intervals, polylineInsideIntervals(line, hole, false))
      }
      supported = Math.max(supported, intervalsLength(intervals))
      return intervals
    })
    if (supported < minSupport) continue

    const elevation = slab.elevation ?? 0.05
    if (preferredSlabId != null && slab.id === preferredSlabId) {
      preferredElevation = elevation
      preferredElectedSlabId = slab.id
    }
    let group = groups.find(
      (candidate) => Math.abs(candidate.elevation - elevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON,
    )
    if (!group) {
      group = { elevation, slabIds: [], perPolyline: polylines.map(() => []) }
      groups.push(group)
    }
    group.slabIds.push(slab.id)
    for (let i = 0; i < perPolyline.length; i++) {
      group.perPolyline[i]!.push(...perPolyline[i]!)
    }
  }

  type EvaluatedGroup = ElevationGroup & {
    coverage: number
    mergedPerPolyline: LengthInterval[][]
  }
  const evaluatedGroups: EvaluatedGroup[] = groups.map((group) => {
    let coverage = 0
    const mergedPerPolyline = group.perPolyline.map(mergeIntervals)
    for (let i = 0; i < group.perPolyline.length; i++) {
      const lineLength = polylineLengths[i]!
      if (lineLength < 1e-9) continue
      coverage = Math.max(coverage, intervalsLength(mergedPerPolyline[i]!) / lineLength)
    }
    return { ...group, coverage, mergedPerPolyline }
  })

  const electableGroups =
    maxElevation == null
      ? evaluatedGroups
      : evaluatedGroups.filter(
          (group) => group.elevation <= maxElevation + SUPPORT_ELEVATION_EPSILON,
        )

  let majorityElevation = Number.NEGATIVE_INFINITY
  let bestElevation = Number.NEGATIVE_INFINITY
  let bestCoverage = -1
  for (const group of electableGroups) {
    if (group.coverage >= WALL_SLAB_SUPPORT_MAJORITY - 1e-6) {
      majorityElevation = Math.max(majorityElevation, group.elevation)
    }
    if (
      group.coverage > bestCoverage + 1e-6 ||
      (Math.abs(group.coverage - bestCoverage) <= 1e-6 && group.elevation > bestElevation)
    ) {
      bestCoverage = group.coverage
      bestElevation = group.elevation
    }
  }

  const elevation =
    preferredElevation !== null
      ? preferredElevation
      : majorityElevation !== Number.NEGATIVE_INFINITY
        ? majorityElevation
        : bestElevation === Number.NEGATIVE_INFINITY
          ? 0
          : bestElevation
  const electedSlabId =
    preferredElectedSlabId ??
    electableGroups
      .find((group) => Math.abs(group.elevation - elevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON)
      ?.slabIds.slice()
      .sort()[0] ??
    null
  const normalizedIntervals = (group: EvaluatedGroup, polylineIndex: number) => {
    const lineLength = polylineLengths[polylineIndex]!
    if (lineLength < 1e-9) return []
    return group.mergedPerPolyline[polylineIndex]!.map(
      ([intervalStart, intervalEnd]) =>
        [intervalStart / lineLength, intervalEnd / lineLength] as LengthInterval,
    )
  }

  const normalizedByGroup = evaluatedGroups.map((group) => ({
    elevation: group.elevation,
    perPolyline: group.mergedPerPolyline.map((_, index) => normalizedIntervals(group, index)),
  }))
  const breakpoints = [0, 1]
  for (const group of normalizedByGroup) {
    for (const intervals of group.perPolyline) {
      for (const [intervalStart, intervalEnd] of intervals) {
        breakpoints.push(intervalStart, intervalEnd)
      }
    }
  }
  breakpoints.sort((left, right) => left - right)
  const uniqueBreakpoints = breakpoints.filter(
    (value, index) => index === 0 || value - breakpoints[index - 1]! > 1e-7,
  )

  const highestAt = (polylineIndex: number, t: number) => {
    let highest = Number.NEGATIVE_INFINITY
    for (const group of normalizedByGroup) {
      if (
        group.perPolyline[polylineIndex]?.some(
          ([intervalStart, intervalEnd]) => t >= intervalStart - 1e-7 && t <= intervalEnd + 1e-7,
        )
      ) {
        highest = Math.max(highest, group.elevation)
      }
    }
    return highest
  }

  const baseSegments: WallSlabSupportSegment[] = []
  for (let index = 1; index < uniqueBreakpoints.length; index++) {
    const start = uniqueBreakpoints[index - 1]!
    const end = uniqueBreakpoints[index]!
    if (end - start < 1e-7) continue
    const midpoint = (start + end) / 2
    const leftElevation = polylines.length >= 3 ? highestAt(1, midpoint) : Number.NEGATIVE_INFINITY
    const rightElevation = polylines.length >= 3 ? highestAt(2, midpoint) : Number.NEGATIVE_INFINITY
    const faceElevations = [leftElevation, rightElevation].filter(Number.isFinite)
    const segmentElevation =
      faceElevations.length > 0 ? Math.min(...faceElevations) : Math.max(highestAt(0, midpoint), 0)
    const previous = baseSegments[baseSegments.length - 1]
    if (
      previous &&
      Math.abs(previous.elevation - segmentElevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON
    ) {
      previous.end = end
    } else {
      baseSegments.push({ start, end, elevation: segmentElevation })
    }
  }

  if (baseSegments.length === 0) baseSegments.push({ start: 0, end: 1, elevation })
  const baseElevation = Math.min(...baseSegments.map((segment) => segment.elevation))
  return { elevation, electedSlabId, baseElevation, baseSegments }
}

export function computeWallSlabElevation(
  wallLike: WallOverlapInput,
  slabs: readonly SlabNode[],
  levelWalls: WallNode[],
): number {
  return computeWallSlabSupport(wallLike, slabs, levelWalls).elevation
}
