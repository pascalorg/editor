import { floorConstructionLift, liftedManualSlab } from '../../lib/floor-construction-lift'
import { floorRoomFaces, roomPolygonKey } from '../../lib/floor-room-faces'
import { area, intersection, type MultiPolygon, union } from '../../lib/polygon-boolean'
import {
  getRenderableSlabPolygon,
  prepareSlabPolygonContext,
  scopeSlabPolygonContext,
} from '../../lib/slab-polygon'
import { levelBaseElevationAt } from '../../lib/terrain-support-query'
import type { AnyNode, SeparatorNode, SlabNode, WallNode, ZoneNode } from '../../schema'
import { getWallCurveFrameAt, isCurvedWall } from '../wall/wall-curve'
import { DEFAULT_WALL_HEIGHT, DEFAULT_WALL_THICKNESS } from '../wall/wall-footprint'
import {
  getWallFaceOffsets,
  type WallFaceOffsets,
  type WallJustification,
} from '../wall/wall-frame'
import { MIN_WALL_HEIGHT, wallFollowsStorey } from '../wall/wall-top'
import {
  getSlabElevationAtPoint,
  getSlabMaxElevation,
  getSlabSlopePlane,
  hasSlabSlope,
} from './slab-slope'

export type SlabElevationClamp = {
  elevation: number
  clamped: boolean
}

/**
 * Clamp-never-ask upper bound for a slab's elevation. A plane-bound wall
 * (no stored `height`, or height equal to the authored storey) keeps its
 * top at the storey plane, so a slab that
 * rises past `storeyHeight - MIN_WALL_HEIGHT` while electing as that
 * wall's base would squeeze the wall body below its minimum (and at the
 * plane, to nothing). Walls with other explicit heights don't constrain —
 * their body height stays fixed above the elected base. Negative proposals (the
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
  nodes?: Readonly<Record<string, AnyNode>>,
): SlabElevationClamp {
  const rise = getSlabSlopePlane(slab).rise
  const flatBound = storeyHeight - MIN_WALL_HEIGHT
  if (proposedElevation <= flatBound - rise) return { elevation: proposedElevation, clamped: false }
  if (slab.polygon.length < 3) return { elevation: proposedElevation, clamped: false }

  // Probed below the storey plane: a wall electing the slab there elects it at
  // any height above, whereas a slab past the storey plane reads as resting on
  // the wall — the state this clamp exists to prevent. Capping against
  // `storeyHeight - MIN_WALL_HEIGHT / 2` (instead of subtracting `rise`) keeps
  // steep sloped slabs from dropping below flat sibling slabs during the probe.
  const probed = Math.min(proposedElevation, storeyHeight - MIN_WALL_HEIGHT / 2)
  const substituted = levelSlabs.some((candidate) => candidate.id === slab.id)
    ? levelSlabs.map((candidate) =>
        candidate.id === slab.id ? { ...slab, elevation: probed } : candidate,
      )
    : [...levelSlabs, { ...slab, elevation: probed }]
  const hasBasePlate = Boolean(nodes && substituted.some((s) => s.plateRole === 'base'))
  const effectiveProbed =
    hasBasePlate && nodes
      ? liftedManualSlab(nodes, { ...slab, elevation: probed }).elevation
      : probed

  let tightestBound = Number.POSITIVE_INFINITY
  for (const wall of levelWalls) {
    if (!wallFollowsStorey(wall, storeyHeight)) continue
    const wallLike: WallOverlapInput = {
      start: wall.start,
      end: wall.end,
      curveOffset: wall.curveOffset,
      thickness: wall.thickness,
      justification: wall.justification,
    }
    // Cheap pre-filter: a wall that never reaches the slab's footprint
    // can't elect it, whatever the election says about sibling slabs.
    if (!wallOverlapsPolygon(wallLike, slab.polygon)) continue
    const support = computeWallSlabSupport(
      wallLike,
      substituted,
      levelWalls,
      undefined,
      undefined,
      0,
      nodes,
    )
    if (
      support.electedSlabId === slab.id ||
      Math.abs(support.elevation - effectiveProbed) <= WALL_SLAB_ELEVATION_POOL_EPSILON
    ) {
      // Subtract only the rise actually reached along this overlapping wall
      // (so a wall meeting only the low end of a long ramp does not over-clamp).
      const wallLocalRise =
        rise > 0 ? Math.max(0, Math.min(rise, support.elevation - effectiveProbed)) : 0
      const wallBound = flatBound - wallLocalRise
      if (wallBound < tightestBound) tightestBound = wallBound
    }
  }

  if (Number.isFinite(tightestBound) && proposedElevation > tightestBound) {
    return { elevation: tightestBound, clamped: true }
  }

  return { elevation: proposedElevation, clamped: false }
}

/**
 * Static upper bound for a slab-elevation drag: probe the election with
 * the slab raised above every sibling and the storey plane. If any
 * plane-bound wall would elect it there, the drag may not pass
 * `storeyHeight - MIN_WALL_HEIGHT - maxWallLocalRise`; otherwise unbounded.
 */
export function getSlabElevationUpperBound(
  slab: SlabNode,
  levelWalls: WallNode[],
  levelSlabs: readonly SlabNode[],
  storeyHeight: number,
  nodes?: Readonly<Record<string, AnyNode>>,
): number {
  const probe =
    Math.max(storeyHeight, ...levelSlabs.map((candidate) => getSlabMaxElevation(candidate))) + 1
  const result = clampSlabElevationForWalls(
    probe,
    slab,
    levelWalls,
    levelSlabs,
    storeyHeight,
    nodes,
  )
  return result.clamped ? result.elevation : Number.POSITIVE_INFINITY
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

function polylinePointAt(
  points: Array<{ x: number; y: number }>,
  distance: number,
): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1 || distance <= 0) return points[0]!
  let remaining = distance
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    if (segLen < 1e-12) continue
    if (remaining <= segLen) {
      const t = remaining / segLen
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    remaining -= segLen
  }
  return points[points.length - 1]!
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
  justification?: WallJustification
  supportOffset?: number
  /** Authored body height; absent for a plane-bound wall (its top is the storey plane). */
  height?: number
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
  wall: WallOverlapInput,
): Array<Array<{ x: number; y: number }>> {
  const wallLike = { start, end, curveOffset }
  const { a, b } = getWallFaceOffsets({
    ...wall,
    thickness: Math.max(wall.thickness ?? DEFAULT_WALL_THICKNESS, 0),
  })
  if (curveOffset !== 0 && isCurvedWall(wallLike)) {
    const count = 16
    const center: Array<{ x: number; y: number }> = []
    const left: Array<{ x: number; y: number }> = []
    const right: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= count; i++) {
      const frame = getWallCurveFrameAt(wallLike, i / count)
      center.push(frame.point)
      left.push({
        x: frame.point.x + frame.normal.x * a,
        y: frame.point.y + frame.normal.y * a,
      })
      right.push({
        x: frame.point.x - frame.normal.x * -b,
        y: frame.point.y - frame.normal.y * -b,
      })
    }
    return a - b > 0 ? [center, left, right] : [center]
  }

  const center = [
    { x: start[0], y: start[1] },
    { x: end[0], y: end[1] },
  ]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const len = Math.hypot(dx, dz)
  if (len < 1e-10 || a - b <= 0) return [center]
  const nx = (-dz / len) * a
  const nz = (dx / len) * a
  const rx = (-dz / len) * -b
  const rz = (dx / len) * -b
  return [
    center,
    [
      { x: start[0] + nx, y: start[1] + nz },
      { x: end[0] + nx, y: end[1] + nz },
    ],
    [
      { x: start[0] - rx, y: start[1] - rz },
      { x: end[0] - rx, y: end[1] - rz },
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
  let justification: WallJustification | undefined
  if (Array.isArray(startOrWall)) {
    start = startOrWall as [number, number]
    end = endOrPolygon as [number, number]
    polygon = polygonArg as Array<[number, number]>
  } else {
    start = startOrWall.start
    end = startOrWall.end
    curveOffset = startOrWall.curveOffset ?? 0
    thickness = startOrWall.thickness ?? DEFAULT_WALL_THICKNESS
    justification = startOrWall.justification
    polygon = endOrPolygon as Array<[number, number]>
  }
  return wallOverlapsSlabFootprint({ start, end, curveOffset, thickness, justification }, polygon)
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
  const { start, end, curveOffset = 0 } = wallLike

  const polylines = wallTestPolylines(start, end, curveOffset, wallLike)
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
 * Auto plates use their zones' reference footprints from `nodes` before this
 * adoption step; their full stored wall coverage must not own both wall faces.
 * Pass the scene snapshot when querying plates.
 *
 * Same-elevation slabs pool their coverage. `elevation` is elected from
 * the wall's carrying profile: per arc segment, the highest support on
 * each face, then the min across supported faces — so a slab that only
 * brushes one face (e.g. an elevated deck adjacent along the outer face)
 * never lifts the wall origin. The highest carrying elevation covering
 * at least `WALL_SLAB_SUPPORT_MAJORITY` of the wall wins, or the
 * best-covered carrying elevation when none reaches majority.
 * `baseElevation` only fills down
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
  /** Room-facing bottoms; independent of the hosted-child support datum. */
  faceDatum: { a: WallSlabSupportSegment[]; b: WallSlabSupportSegment[] }
  faceBottom: { a: WallSlabSupportSegment[]; b: WallSlabSupportSegment[] }
}

export type WallSlabSupportSegment = {
  start: number
  end: number
  elevation: number
  /** Terrain runs interpolate linearly; omitted for flat room/support spans. */
  endElevation?: number
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
 *
 * `levelBase` is what "no slab supports this here" evaluates to — the
 * sculpted ground under the wall (`levelBaseElevationAt`), or 0 for a level
 * with no terrain under it. A caller-resolved scalar rather than a terrain
 * lookup in here, so this stays pure and the sample stays at the wall's own
 * XZ. It substitutes for every place this function used to write a literal
 * `0`, and nowhere else: a slab that supports the wall's faces still wins
 * outright, so a slab pad on a hillside keeps its wall at the pad's
 * elevation instead of being overruled by the ground around it. The one
 * clamp — center-only support, where the old code already clamped a
 * recessed slab up to `0` so a wall over a pool didn't sink — generalizes to
 * "never below the ground", which is the same rule with the ground no longer
 * assumed flat.
 *
 * `baseAt` optionally supplies the live level-base sampler for geometry face
 * profiles. The spatial grid keeps it stable until its support inputs change;
 * pure callers default to persisted terrain from `nodes`.
 */
// A rendered slab polygon depends only on the slab set and the level's walls,
// never on the wall being tested — but a per-frame pass asks for support once
// per wall, so the identical polygons were rebuilt for every wall on the level
// (and each rebuild scans all of `levelWalls`). Keyed on array identity: the
// caller derives those arrays once and only rebuilds them when the scene or a
// live preview changes, so a hit means the inputs are the same objects.
let polygonMemoSlabs: readonly SlabNode[] | null = null
let polygonMemoWalls: readonly WallNode[] | null = null
let polygonMemoNodes: Readonly<Record<string, AnyNode>> | undefined
const polygonSets = new Map<
  string,
  {
    polygons: Map<string, MultiPolygon>
    slabs: SlabNode[]
    prepared: ReturnType<typeof prepareSlabPolygonContext>
  }
>()
let polygonMemo = new Map<string, MultiPolygon>()
let supportSlabs: SlabNode[] = []
let preparedPolygons: ReturnType<typeof prepareSlabPolygonContext>

function renderedSlabPolygon(
  slab: SlabNode,
  slabs: readonly SlabNode[],
  levelWalls: WallNode[],
  nodes?: Readonly<Record<string, AnyNode>>,
): MultiPolygon {
  if (polygonMemoSlabs !== slabs || polygonMemoWalls !== levelWalls || polygonMemoNodes !== nodes) {
    polygonMemoSlabs = slabs
    polygonMemoWalls = levelWalls
    polygonMemoNodes = nodes
    const signature = JSON.stringify([
      slabs,
      levelWalls.map((wall) => [
        wall.id,
        wall.start,
        wall.end,
        wall.curveOffset,
        wall.thickness,
        wall.justification,
      ]),
      slabs.flatMap((slab) =>
        slab.boundary === 'auto' && !slab.plateRole
          ? (slab.zoneIds ?? []).map((id) => {
              const zone = nodes?.[id]
              return zone?.type === 'zone' ? [id, zone.polygon, zone.holes] : id
            })
          : [],
      ),
    ])
    const hit = polygonSets.get(signature)
    if (hit) {
      polygonMemo = hit.polygons
      supportSlabs = hit.slabs
      preparedPolygons = hit.prepared
    } else {
      polygonMemo = new Map()
      supportSlabs = slabs.flatMap((source) => {
        if (
          source.support === 'open' ||
          source.plateRole === 'platform' ||
          source.plateRole === 'sunken'
        )
          return []
        if (source.plateRole === 'base') return [source]
        const zones =
          source.boundary === 'auto'
            ? (source.zoneIds ?? []).flatMap((id) => {
                const zone = nodes?.[id]
                return zone?.type === 'zone'
                  ? [{ outer: zone.polygon, holes: zone.holes ?? [] }]
                  : []
              })
            : []
        if (!zones.length) return [source]
        return intersection({ outer: source.polygon, holes: source.holes ?? [] }, union(zones)).map(
          (part) => ({
            ...source,
            boundary: undefined,
            polygon: part.outer,
            holes: part.holes,
          }),
        )
      })
      preparedPolygons = prepareSlabPolygonContext({
        walls: levelWalls,
        siblingSlabs: supportSlabs,
      })
      if (polygonSets.size >= 64) polygonSets.delete(polygonSets.keys().next().value!)
      polygonSets.set(signature, {
        polygons: polygonMemo,
        slabs: supportSlabs,
        prepared: preparedPolygons,
      })
    }
  }
  const cached = polygonMemo.get(slab.id)
  if (cached) return cached
  if (slab.plateRole === 'base') {
    const polygon = [{ outer: slab.polygon, holes: slab.holes ?? [] }]
    polygonMemo.set(slab.id, polygon)
    return polygon
  }
  // Keep the pre-plate face/seam election. Full wall coverage belongs to rendering.
  const polygons = supportSlabs
    .filter((source) => source.id === slab.id)
    .map((source) => ({
      outer: getRenderableSlabPolygon(source, scopeSlabPolygonContext(source, preparedPolygons)),
      holes: source.holes ?? [],
    }))
  polygonMemo.set(slab.id, polygons)
  return polygons
}

function appendBaseSegment(
  segments: WallSlabSupportSegment[],
  start: number,
  end: number,
  elevation: number,
) {
  const previous = segments.at(-1)
  if (
    previous &&
    previous.endElevation === undefined &&
    Math.abs(previous.elevation - elevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON
  )
    previous.end = end
  else segments.push({ start, end, elevation })
}

function appendSlopedBaseSegment(
  segments: WallSlabSupportSegment[],
  start: number,
  end: number,
  elevation: number,
  endElevation: number,
) {
  if (end - start < 1e-7) return
  if (Math.abs(elevation - endElevation) <= 1e-6) {
    appendBaseSegment(segments, start, end, (elevation + endElevation) / 2)
    return
  }
  const previous = segments.at(-1)
  if (
    previous?.endElevation !== undefined &&
    Math.abs(previous.end - start) <= 1e-7 &&
    Math.abs(previous.endElevation - elevation) <= 1e-6 &&
    Math.abs(
      (previous.endElevation - previous.elevation) / (previous.end - previous.start) -
        (endElevation - elevation) / (end - start),
    ) <= 1e-5
  ) {
    previous.end = end
    previous.endElevation = endElevation
  } else {
    segments.push({ start, end, elevation, endElevation })
  }
}

type RoomFaceBases = Record<'a' | 'b', Array<WallSlabSupportSegment & { thickness: number }>>

type SupportMemo = {
  slabs: readonly SlabNode[]
  nodes: Readonly<Record<string, AnyNode>> | undefined
  results: Map<string, WallSlabSupport>
  terrainResults?: { revision: object; results: Map<string, WallSlabSupport> }
  baseAt?: (x: number, z: number) => number
  roomBases?: Map<string, RoomFaceBases>
}
const supportMemo = new WeakMap<WallNode[], SupportMemo>()

function roomFaceBases(
  slabs: readonly SlabNode[],
  walls: WallNode[],
  nodes: Readonly<Record<string, AnyNode>> | undefined,
  memo: SupportMemo,
) {
  if (memo.roomBases) return memo.roomBases
  const result = new Map<string, RoomFaceBases>()
  memo.roomBases = result
  if (!nodes || !walls.length) return result
  const levels = new Set(walls.map((wall) => wall.parentId))
  const zones = Object.values(nodes).filter(
    (node): node is ZoneNode =>
      node.type === 'zone' &&
      node.spaceRole === 'room' &&
      node.floor?.support !== 'open' &&
      levels.has(node.parentId),
  )
  if (!zones.length) return result
  const separators = Object.values(nodes).filter(
    (node): node is SeparatorNode => node.type === 'separator' && levels.has(node.parentId),
  )
  const exactZones = new Map(
    [...zones]
      .sort((a, b) => b.id.localeCompare(a.id))
      .map((zone) => [roomPolygonKey(zone.polygon, zone.holes), zone]),
  )
  const zoneBounds = new Map(
    zones.map((zone) => [zone.id, polygonBounds([{ outer: zone.polygon, holes: [] }])]),
  )
  for (const room of floorRoomFaces([...walls, ...separators])) {
    const polygon = { outer: room.referencePolygon, holes: room.holes }
    const bounds = polygonBounds([polygon])
    const zone =
      exactZones.get(roomPolygonKey(room.referencePolygon, room.holes)) ??
      zones
        .filter((zone) => {
          const other = zoneBounds.get(zone.id)!
          return (
            bounds.minX < other.maxX &&
            other.minX < bounds.maxX &&
            bounds.minZ < other.maxZ &&
            other.minZ < bounds.maxZ
          )
        })
        .map((zone) => ({
          zone,
          overlap: area(intersection(polygon, { outer: zone.polygon, holes: zone.holes ?? [] })),
        }))
        .filter(({ overlap }) => overlap > 1e-6)
        .sort((a, b) => b.overlap - a.overlap || a.zone.id.localeCompare(b.zone.id))[0]?.zone
    if (!zone) continue
    const plate =
      slabs.find(
        (slab) =>
          slab.boundary === 'auto' && slab.plateRole !== 'base' && slab.zoneIds?.includes(zone.id),
      ) ?? slabs.find((slab) => slab.plateRole === 'base' && slab.zoneIds?.includes(zone.id))
    const elevation = plate
      ? plate.plateRole
        ? (zone.floor?.elevation ?? plate.elevation)
        : plate.elevation
      : undefined
    if (elevation === undefined || zone.hasFloor === false) continue
    for (const span of room.spans) {
      const wall = walls.find((wall) => wall.id === span.boundaryId)
      if (!wall) continue
      // Topology stations are chord parameters; support profiles use arc parameters.
      const station = (t: number) => {
        if (!isCurvedWall(wall) || t <= 0 || t >= 1) return t
        const dx = wall.end[0] - wall.start[0],
          dz = wall.end[1] - wall.start[1]
        let low = 0,
          high = 1
        for (let i = 0; i < 40; i++) {
          const mid = (low + high) / 2,
            point = getWallCurveFrameAt(wall, mid).point
          if (
            ((point.x - wall.start[0]) * dx + (point.y - wall.start[1]) * dz) /
              (dx * dx + dz * dz) <
            t
          )
            low = mid
          else high = mid
        }
        return (low + high) / 2
      }
      const bases = result.get(wall.id) ?? { a: [], b: [] }
      bases[span.face].push({
        start: station(span.t0),
        end: station(span.t1),
        elevation,
        thickness: plate?.thickness ?? 0.05,
      })
      result.set(wall.id, bases)
    }
  }
  return result
}

export function computeWallSlabSupport(
  wallLike: WallOverlapInput,
  slabs: readonly SlabNode[],
  levelWalls: WallNode[],
  preferredSlabId?: string | null,
  maxElevation?: number | null,
  levelBase = 0,
  nodes?: Readonly<Record<string, AnyNode>>,
  baseAt?: (x: number, z: number) => number,
  terrainRevision?: object,
): WallSlabSupport {
  let memo = supportMemo.get(levelWalls)
  if (!memo || memo.slabs !== slabs || memo.nodes !== nodes || memo.baseAt !== baseAt) {
    memo = { slabs, nodes, baseAt, results: new Map() }
    supportMemo.set(levelWalls, memo)
  }
  const key = JSON.stringify([
    wallLike.start,
    wallLike.end,
    wallLike.curveOffset,
    wallLike.thickness,
    wallLike.justification,
    wallLike.supportOffset,
    wallLike.height,
    preferredSlabId,
    maxElevation,
    levelBase,
  ])
  if (terrainRevision && memo.terrainResults?.revision !== terrainRevision)
    memo.terrainResults = { revision: terrainRevision, results: new Map() }
  const results = terrainRevision ? memo.terrainResults!.results : memo.results
  const cached = results.get(key)
  if (cached) return cached
  let support = computeWallSlabSupportUncached(
    memo,
    wallLike,
    slabs,
    levelWalls,
    preferredSlabId,
    maxElevation,
    levelBase,
    nodes,
  )
  const groundWall =
    preferredSlabId === 'ground' && nodes && slabs.some((slab) => slab.plateRole === 'base')
      ? levelWalls.find(
          (wall) =>
            wall.start[0] === wallLike.start[0] &&
            wall.start[1] === wallLike.start[1] &&
            wall.end[0] === wallLike.end[0] &&
            wall.end[1] === wallLike.end[1],
        )
      : undefined
  const offset =
    (wallLike.supportOffset ?? 0) + (groundWall ? floorConstructionLift(nodes!, groundWall) : 0)
  if (offset || preferredSlabId === 'ground') {
    const raw = support
    const ground = preferredSlabId === 'ground'
    const elevation = (ground ? levelBase : raw.elevation) + offset
    const shift = (segments: readonly WallSlabSupportSegment[]) =>
      segments.map((run) => ({
        ...run,
        elevation: run.elevation + offset,
        ...(run.endElevation === undefined ? {} : { endElevation: run.endElevation + offset }),
      }))
    const baseSegments = ground ? [{ start: 0, end: 1, elevation }] : shift(raw.baseSegments)
    const wall = levelWalls.find(
      (wall) =>
        wall.start[0] === wallLike.start[0] &&
        wall.start[1] === wallLike.start[1] &&
        wall.end[0] === wallLike.end[0] &&
        wall.end[1] === wallLike.end[1],
    )
    const rooms =
      wall && slabs.some((slab) => slab.plateRole === 'base')
        ? roomFaceBases(slabs, levelWalls, nodes, memo).get(wall.id)
        : undefined
    const datum = (face: 'a' | 'b') =>
      raw.faceDatum[face].map((run) => {
        const room = rooms?.[face].find(
          (room) =>
            room.start <= (run.start + run.end) / 2 && room.end >= (run.start + run.end) / 2,
        )
        return room
          ? { ...run, elevation: room.elevation, endElevation: undefined }
          : ground
            ? { ...run, elevation, endElevation: undefined }
            : shift([run])[0]!
      })
    const faceDatum = { a: datum('a'), b: datum('b') }
    support = {
      elevation,
      electedSlabId: ground ? null : raw.electedSlabId,
      baseElevation: Math.min(
        ...baseSegments.map((run) => Math.min(run.elevation, run.endElevation ?? run.elevation)),
      ),
      baseSegments,
      faceDatum,
      faceBottom: {
        a: resolveWallFaceBottom(faceDatum.a, baseSegments, elevation),
        b: resolveWallFaceBottom(faceDatum.b, baseSegments, elevation),
      },
    }
  }
  if (results.size >= 512) results.clear()
  results.set(key, support)
  return support
}

type SupportBounds = { minX: number; minZ: number; maxX: number; maxZ: number }
const supportBounds = new WeakMap<MultiPolygon, SupportBounds>()
function polygonBounds(polygon: MultiPolygon): SupportBounds {
  const cached = supportBounds.get(polygon)
  if (cached) return cached
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity }
  for (const part of polygon)
    for (const [x, z] of part.outer) {
      bounds.minX = Math.min(bounds.minX, x)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.minZ = Math.min(bounds.minZ, z)
      bounds.maxZ = Math.max(bounds.maxZ, z)
    }
  supportBounds.set(polygon, bounds)
  return bounds
}

/** A cap may run this far past the wall's faces and ends and still be its cap. */
const WALL_CAP_SLACK = 0.05

/** Whether every corner of the footprint lies on the wall body: between its faces, within its length. */
function footprintOnWallBody(
  polygon: MultiPolygon,
  center: Array<{ x: number; y: number }>,
  offsets: WallFaceOffsets,
): boolean {
  const onBody = ([px, pz]: [number, number]) => {
    let nearest = Number.POSITIVE_INFINITY
    let fits = false
    for (let i = 1; i < center.length; i++) {
      const s = center[i - 1]!,
        e = center[i]!
      const dx = e.x - s.x,
        dz = e.y - s.y
      const length = Math.hypot(dx, dz)
      if (length < 1e-9) continue
      const along = ((px - s.x) * dx + (pz - s.y) * dz) / length
      const across = ((px - s.x) * -dz + (pz - s.y) * dx) / length
      const distance = Math.hypot(
        Math.max(0, -along, along - length),
        Math.max(0, across - offsets.a, offsets.b - across),
      )
      if (distance < nearest) {
        nearest = distance
        fits = distance <= WALL_CAP_SLACK
      }
    }
    return fits
  }
  return polygon.every((part) => [part.outer, ...part.holes].every((ring) => ring.every(onBody)))
}

/**
 * Level-local Y of the wall's top when it stands at `base`: an authored height
 * above it, else the storey plane of the level the walls belong to, else the
 * legacy default (a level deriving its first height has no plane yet).
 */
function resolveWallTopAbove(
  base: number,
  wallLike: WallOverlapInput,
  levelWalls: readonly WallNode[],
  nodes?: Readonly<Record<string, AnyNode>>,
): number {
  const height =
    wallLike.height ??
    levelWalls.find(
      (wall) =>
        wall.start[0] === wallLike.start[0] &&
        wall.start[1] === wallLike.start[1] &&
        wall.end[0] === wallLike.end[0] &&
        wall.end[1] === wallLike.end[1],
    )?.height
  if (height !== undefined) return base + height
  const level = nodes?.[levelWalls[0]?.parentId ?? '']
  return level?.type === 'level' && level.height !== undefined
    ? level.height
    : base + DEFAULT_WALL_HEIGHT
}

function computeWallSlabSupportUncached(
  memo: SupportMemo,
  wallLike: WallOverlapInput,
  slabs: readonly SlabNode[],
  levelWalls: WallNode[],
  preferredSlabId?: string | null,
  maxElevation?: number | null,
  levelBase = 0,
  nodes?: Readonly<Record<string, AnyNode>>,
): WallSlabSupport {
  const { start, end, curveOffset = 0 } = wallLike
  const polylines = wallTestPolylines(start, end, curveOffset, wallLike)
  const polylineLengths = polylines.map(polylineLength)
  const wallLength = polylineLengths[0]!
  if (wallLength < 1e-9) {
    return {
      elevation: levelBase,
      electedSlabId: null,
      baseElevation: levelBase,
      baseSegments: [],
      faceDatum: { a: [], b: [] },
      faceBottom: { a: [], b: [] },
    }
  }

  const points = polylines.flat()
  const band = {
    minX: Math.min(...points.map((point) => point.x)) - ON_BOUNDARY_EPSILON,
    maxX: Math.max(...points.map((point) => point.x)) + ON_BOUNDARY_EPSILON,
    minZ: Math.min(...points.map((point) => point.y)) - ON_BOUNDARY_EPSILON,
    maxZ: Math.max(...points.map((point) => point.y)) + ON_BOUNDARY_EPSILON,
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

  type Candidate = {
    slab: SlabNode
    effectiveSlab: SlabNode
    elevation: number
    perPolyline: LengthInterval[][]
    polygon: MultiPolygon
  }
  const hasBasePlate = Boolean(nodes && slabs.some((s) => s.plateRole === 'base'))
  const candidates: Candidate[] = []
  for (const slab of slabs) {
    if (
      slab.support === 'open' ||
      ((slab.plateRole === 'platform' || slab.plateRole === 'sunken') &&
        slab.id !== preferredSlabId) ||
      slab.polygon.length < 3
    )
      continue
    const renderedPolygon = renderedSlabPolygon(slab, slabs, levelWalls, nodes)
    const bounds = polygonBounds(renderedPolygon)
    if (
      bounds.minX > band.maxX ||
      bounds.maxX < band.minX ||
      bounds.minZ > band.maxZ ||
      bounds.maxZ < band.minZ
    )
      continue

    let supported = 0
    const perPolyline = polylines.map((line) => {
      const intervals = mergeIntervals(
        renderedPolygon.flatMap(({ outer, holes }) => {
          let covered = polylineInsideIntervals(line, outer)
          for (const hole of holes) {
            if (hole.length >= 3)
              covered = subtractIntervals(covered, polylineInsideIntervals(line, hole, false))
          }
          return covered
        }),
      )
      supported = Math.max(supported, intervalsLength(intervals))
      return intervals
    })
    if (supported < minSupport) continue

    const effectiveSlab = hasBasePlate && nodes ? liftedManualSlab(nodes, slab) : slab
    const elevation = effectiveSlab.elevation ?? 0.05
    candidates.push({ slab, effectiveSlab, elevation, perPolyline, polygon: renderedPolygon })
  }

  // A slab lying on the wall body with its underside at the wall's own top is
  // a cap the wall carries (an importer's 12 mm "wall caps"), never a support.
  // The top is measured from the lowest candidate, since the base being
  // elected cannot decide it. A floor or terrace reaching past the wall keeps
  // carrying it however short the wall, and an explicit host is the user's choice.
  const floor = Math.min(levelBase, ...candidates.map((candidate) => candidate.elevation))
  const wallTop = resolveWallTopAbove(floor, wallLike, levelWalls, nodes)
  const offsets = getWallFaceOffsets({
    ...wallLike,
    thickness: Math.max(wallLike.thickness ?? DEFAULT_WALL_THICKNESS, 0),
  })
  const activeCandidates = candidates.filter(
    ({ slab, elevation, polygon }) =>
      slab.id === preferredSlabId ||
      !(
        elevation - slab.thickness >= wallTop - 1e-6 &&
        footprintOnWallBody(polygon, polylines[0]!, offsets)
      ),
  )

  const faceDatum: WallSlabSupport['faceDatum'] = { a: [], b: [] }
  const baseSegments: WallSlabSupportSegment[] = []
  let elevation = levelBase
  let electedSlabId: string | null = null

  if (activeCandidates.some((candidate) => hasSlabSlope(candidate.effectiveSlab))) {
    // Sloped-slab path: sample slab plane elevations directly along wall
    // polylines and emit sloped `WallSlabSupportSegment` runs (`endElevation`)
    // so walls sitting on or crossing a ramp follow the slab surface cleanly.
    const normCandidates = activeCandidates.map((candidate) => ({
      ...candidate,
      sloped: hasSlabSlope(candidate.effectiveSlab),
      normIntervals: candidate.perPolyline.map((intervals, polylineIndex) => {
        const lineLength = polylineLengths[polylineIndex]!
        if (lineLength < 1e-9) return [] as LengthInterval[]
        return intervals.map(
          ([intervalStart, intervalEnd]) =>
            [intervalStart / lineLength, intervalEnd / lineLength] as LengthInterval,
        )
      }),
    }))

    const rawCuts = [0, 1]
    for (const candidate of normCandidates) {
      for (const intervals of candidate.normIntervals) {
        for (const [s, e] of intervals) rawCuts.push(s, e)
      }
    }
    // Include interior vertices of curved wall polylines so each sub-interval
    // is linear in plan space.
    for (let pi = 0; pi < polylines.length; pi++) {
      const pts = polylines[pi]!
      const total = polylineLengths[pi]!
      if (pts.length <= 2 || total < 1e-9) continue
      let acc = 0
      for (let i = 1; i < pts.length - 1; i++) {
        acc += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
        rawCuts.push(acc / total)
      }
    }
    rawCuts.sort((a, b) => a - b)
    const coarseCuts = rawCuts.filter((v, i) => i === 0 || v - rawCuts[i - 1]! > 1e-7)

    const coversAt = (candidate: (typeof normCandidates)[number], pi: number, t: number) =>
      candidate.normIntervals[pi]?.some(([s, e]) => t >= s - 1e-7 && t <= e + 1e-7) ?? false

    const elevAt = (candidate: (typeof normCandidates)[number], pi: number, t: number) => {
      if (!candidate.sloped) return candidate.elevation
      const pt = polylinePointAt(polylines[pi]!, t * polylineLengths[pi]!)
      return getSlabElevationAtPoint(candidate.effectiveSlab, pt.x, pt.y)
    }

    const linearCrossing = (
      a: number,
      b: number,
      a0: number,
      a1: number,
      b0: number,
      b1: number,
    ) => {
      const denom = a1 - a0 - (b1 - b0)
      if (Math.abs(denom) < 1e-9) return null
      const frac = (b0 - a0) / denom
      if (frac <= 1e-6 || frac >= 1 - 1e-6) return null
      return a + (b - a) * frac
    }

    type SlabCarry = { slabId: string; length: number; maxElevation: number }
    const slabCarry = new Map<string, SlabCarry>()
    const recordCarry = (slabId: string, length: number, maxElev: number) => {
      const existing = slabCarry.get(slabId)
      if (existing) {
        existing.length += length
        existing.maxElevation = Math.max(existing.maxElevation, maxElev)
      } else {
        slabCarry.set(slabId, { slabId, length, maxElevation: maxElev })
      }
    }

    let prefMaxElev = Number.NEGATIVE_INFINITY
    let prefFound = false

    const pickHighest = (
      pool: typeof normCandidates,
      pi: number,
      u: number,
      v: number,
      mid: number,
    ): { slabId: string; e0: number; e1: number } | null => {
      let best: { slabId: string; e0: number; e1: number; midElev: number } | null = null
      for (const c of pool) {
        if (!coversAt(c, pi, mid)) continue
        const midElev = elevAt(c, pi, mid)
        if (
          !best ||
          midElev > best.midElev + 1e-9 ||
          (Math.abs(midElev - best.midElev) <= 1e-9 && c.slab.id < best.slabId)
        ) {
          best = { slabId: c.slab.id, e0: elevAt(c, pi, u), e1: elevAt(c, pi, v), midElev }
        }
      }
      return best ? { slabId: best.slabId, e0: best.e0, e1: best.e1 } : null
    }

    for (let idx = 1; idx < coarseCuts.length; idx++) {
      const segA = coarseCuts[idx - 1]!
      const segB = coarseCuts[idx]!
      if (segB - segA < 1e-7) continue
      const segMid = (segA + segB) / 2

      // Sub-split at any pairwise height crossing between active candidates or levelBase.
      const subCuts = [segA, segB]
      const activeByPoly = polylines.map((_, pi) =>
        normCandidates.filter((c) => coversAt(c, pi, segMid)),
      )
      for (let pi = 0; pi < polylines.length; pi++) {
        const list = activeByPoly[pi]!
        const lines = list.map((c) => [elevAt(c, pi, segA), elevAt(c, pi, segB)] as const)
        for (let i = 0; i < lines.length; i++) {
          const [a0, a1] = lines[i]!
          const cutBase = linearCrossing(segA, segB, a0, a1, levelBase, levelBase)
          if (cutBase !== null) subCuts.push(cutBase)
          if (maxElevation != null) {
            const cutCap = linearCrossing(segA, segB, a0, a1, maxElevation, maxElevation)
            if (cutCap !== null) subCuts.push(cutCap)
          }
          for (let j = i + 1; j < lines.length; j++) {
            const [b0, b1] = lines[j]!
            const cut = linearCrossing(segA, segB, a0, a1, b0, b1)
            if (cut !== null) subCuts.push(cut)
          }
        }
      }
      if (polylines.length >= 3) {
        for (const l of activeByPoly[1]!) {
          const l0 = elevAt(l, 1, segA)
          const l1 = elevAt(l, 1, segB)
          for (const r of activeByPoly[2]!) {
            const r0 = elevAt(r, 2, segA)
            const r1 = elevAt(r, 2, segB)
            const cut = linearCrossing(segA, segB, l0, l1, r0, r1)
            if (cut !== null) subCuts.push(cut)
          }
        }
      }
      subCuts.sort((a, b) => a - b)
      const microCuts = subCuts.filter((v, i) => i === 0 || v - subCuts[i - 1]! > 1e-7)

      for (let m = 1; m < microCuts.length; m++) {
        const u = microCuts[m - 1]!
        const v = microCuts[m]!
        if (v - u < 1e-7) continue
        const mid = (u + v) / 2

        const center = pickHighest(normCandidates, 0, u, v, mid)
        const left = polylines.length >= 3 ? pickHighest(normCandidates, 1, u, v, mid) : null
        const right = polylines.length >= 3 ? pickHighest(normCandidates, 2, u, v, mid) : null

        let segE0: number
        let segE1: number
        let segWinner: string | null = null
        if (left && right) {
          const leftMid = (left.e0 + left.e1) / 2
          const rightMid = (right.e0 + right.e1) / 2
          if (leftMid <= rightMid) {
            segE0 = left.e0
            segE1 = left.e1
            segWinner = left.slabId
          } else {
            segE0 = right.e0
            segE1 = right.e1
            segWinner = right.slabId
          }
        } else if (left) {
          segE0 = left.e0
          segE1 = left.e1
          segWinner = left.slabId
        } else if (right) {
          segE0 = right.e0
          segE1 = right.e1
          segWinner = right.slabId
        } else if (center) {
          segE0 = Math.max(center.e0, levelBase)
          segE1 = Math.max(center.e1, levelBase)
          segWinner = center.slabId
        } else {
          segE0 = levelBase
          segE1 = levelBase
        }

        appendSlopedBaseSegment(faceDatum.a, u, v, left ? left.e0 : segE0, left ? left.e1 : segE1)
        appendSlopedBaseSegment(
          faceDatum.b,
          u,
          v,
          right ? right.e0 : segE0,
          right ? right.e1 : segE1,
        )
        appendSlopedBaseSegment(baseSegments, u, v, segE0, segE1)

        if (preferredSlabId != null) {
          const pref = normCandidates.find((c) => c.slab.id === preferredSlabId)
          if (pref) {
            for (let pi = 0; pi < polylines.length; pi++) {
              if (coversAt(pref, pi, mid)) {
                prefFound = true
                prefMaxElev = Math.max(prefMaxElev, elevAt(pref, pi, u), elevAt(pref, pi, v))
              }
            }
          }
        }

        const electPool =
          maxElevation == null
            ? normCandidates
            : normCandidates.filter((c) => {
                for (let pi = 0; pi < polylines.length; pi++) {
                  if (
                    coversAt(c, pi, mid) &&
                    elevAt(c, pi, mid) <= maxElevation + SUPPORT_ELEVATION_EPSILON
                  ) {
                    return true
                  }
                }
                return false
              })

        if (electPool === normCandidates) {
          if (segWinner) recordCarry(segWinner, v - u, Math.max(segE0, segE1))
        } else {
          const eCenter = pickHighest(electPool, 0, u, v, mid)
          const eLeft = polylines.length >= 3 ? pickHighest(electPool, 1, u, v, mid) : null
          const eRight = polylines.length >= 3 ? pickHighest(electPool, 2, u, v, mid) : null
          if (eLeft && eRight) {
            const pick = (eLeft.e0 + eLeft.e1) / 2 <= (eRight.e0 + eRight.e1) / 2 ? eLeft : eRight
            recordCarry(pick.slabId, v - u, Math.max(pick.e0, pick.e1))
          } else if (eLeft) {
            recordCarry(eLeft.slabId, v - u, Math.max(eLeft.e0, eLeft.e1))
          } else if (eRight) {
            recordCarry(eRight.slabId, v - u, Math.max(eRight.e0, eRight.e1))
          } else if (eCenter) {
            recordCarry(eCenter.slabId, v - u, Math.max(eCenter.e0, eCenter.e1, levelBase))
          }
        }
      }
    }

    if (prefFound && preferredSlabId != null) {
      electedSlabId = preferredSlabId
      elevation = prefMaxElev
    } else {
      let majority: SlabCarry | null = null
      let best: SlabCarry | null = null
      for (const carry of slabCarry.values()) {
        if (carry.length >= WALL_SLAB_SUPPORT_MAJORITY - 1e-6) {
          if (!majority || carry.maxElevation > majority.maxElevation) majority = carry
        }
        if (
          !best ||
          carry.length > best.length + 1e-6 ||
          (Math.abs(carry.length - best.length) <= 1e-6 && carry.maxElevation > best.maxElevation)
        ) {
          best = carry
        }
      }
      const winner = majority ?? best
      if (winner) {
        electedSlabId = winner.slabId
        elevation = winner.maxElevation
      } else {
        electedSlabId = null
        elevation = levelBase
      }
    }
  } else {
    for (const { slab, elevation: candElevation, perPolyline } of activeCandidates) {
      if (preferredSlabId != null && slab.id === preferredSlabId) {
        preferredElevation = candElevation
        preferredElectedSlabId = slab.id
      }
      let group = groups.find(
        (candidate) =>
          Math.abs(candidate.elevation - candElevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON,
      )
      if (!group) {
        group = { elevation: candElevation, slabIds: [], perPolyline: polylines.map(() => []) }
        groups.push(group)
      }
      group.slabIds.push(slab.id)
      for (let i = 0; i < perPolyline.length; i++) {
        group.perPolyline[i]!.push(...perPolyline[i]!)
      }
    }

    type EvaluatedGroup = ElevationGroup & {
      mergedPerPolyline: LengthInterval[][]
    }
    const evaluatedGroups: EvaluatedGroup[] = groups.map((group) => ({
      ...group,
      mergedPerPolyline: group.perPolyline.map(mergeIntervals),
    }))

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

    const highestAt = (groupList: typeof normalizedByGroup, polylineIndex: number, t: number) => {
      let highest = Number.NEGATIVE_INFINITY
      for (const group of groupList) {
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

    // The pointer cap filters the ELECTION's carrying profile, not the base
    // profile: with a deck capped away, the floor that also carries the wall
    // must still win (geometry fill-down stays uncapped).
    const electableNormalizedGroups =
      maxElevation == null
        ? normalizedByGroup
        : normalizedByGroup.filter(
            (group) => group.elevation <= maxElevation + SUPPORT_ELEVATION_EPSILON,
          )

    type CarryCandidate = { elevation: number; length: number }
    const carryCandidates: CarryCandidate[] = []
    const accumulateCarry = (candElevation: number, length: number) => {
      let candidate = carryCandidates.find(
        (existing) =>
          Math.abs(existing.elevation - candElevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON,
      )
      if (!candidate) {
        candidate = { elevation: candElevation, length: 0 }
        carryCandidates.push(candidate)
      }
      candidate.length += length
    }
    for (let index = 1; index < uniqueBreakpoints.length; index++) {
      const segStart = uniqueBreakpoints[index - 1]!
      const segEnd = uniqueBreakpoints[index]!
      if (segEnd - segStart < 1e-7) continue
      const midpoint = (segStart + segEnd) / 2
      const centerElevation = highestAt(normalizedByGroup, 0, midpoint)
      const leftElevation =
        polylines.length >= 3 ? highestAt(normalizedByGroup, 1, midpoint) : Number.NEGATIVE_INFINITY
      const rightElevation =
        polylines.length >= 3 ? highestAt(normalizedByGroup, 2, midpoint) : Number.NEGATIVE_INFINITY
      const faceElevations = [leftElevation, rightElevation].filter(Number.isFinite)
      const segmentElevation =
        faceElevations.length > 0
          ? Math.min(...faceElevations)
          : Math.max(centerElevation, levelBase)

      for (const [face, value] of [
        ['a', leftElevation],
        ['b', rightElevation],
      ] as const) {
        appendBaseSegment(
          faceDatum[face],
          segStart,
          segEnd,
          Number.isFinite(value) ? value : segmentElevation,
        )
      }

      if (electableNormalizedGroups === normalizedByGroup) {
        if (faceElevations.length > 0 || Number.isFinite(centerElevation)) {
          accumulateCarry(segmentElevation, segEnd - segStart)
        }
      } else {
        const electCenter = highestAt(electableNormalizedGroups, 0, midpoint)
        const electLeft =
          polylines.length >= 3
            ? highestAt(electableNormalizedGroups, 1, midpoint)
            : Number.NEGATIVE_INFINITY
        const electRight =
          polylines.length >= 3
            ? highestAt(electableNormalizedGroups, 2, midpoint)
            : Number.NEGATIVE_INFINITY
        const electFaces = [electLeft, electRight].filter(Number.isFinite)
        if (electFaces.length > 0 || Number.isFinite(electCenter)) {
          accumulateCarry(
            electFaces.length > 0 ? Math.min(...electFaces) : Math.max(electCenter, levelBase),
            segEnd - segStart,
          )
        }
      }

      const previous = baseSegments[baseSegments.length - 1]
      if (
        previous &&
        Math.abs(previous.elevation - segmentElevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON
      ) {
        previous.end = segEnd
      } else {
        baseSegments.push({ start: segStart, end: segEnd, elevation: segmentElevation })
      }
    }

    let majorityElevation = Number.NEGATIVE_INFINITY
    let bestElevation = Number.NEGATIVE_INFINITY
    let bestCoverage = -1
    for (const candidate of carryCandidates) {
      if (candidate.length >= WALL_SLAB_SUPPORT_MAJORITY - 1e-6) {
        majorityElevation = Math.max(majorityElevation, candidate.elevation)
      }
      if (
        candidate.length > bestCoverage + 1e-6 ||
        (Math.abs(candidate.length - bestCoverage) <= 1e-6 && candidate.elevation > bestElevation)
      ) {
        bestCoverage = candidate.length
        bestElevation = candidate.elevation
      }
    }

    elevation =
      preferredElevation === null
        ? majorityElevation === Number.NEGATIVE_INFINITY
          ? bestElevation === Number.NEGATIVE_INFINITY
            ? levelBase
            : bestElevation
          : majorityElevation
        : preferredElevation
    electedSlabId =
      preferredElectedSlabId ??
      evaluatedGroups
        .filter(
          (group) =>
            maxElevation == null || group.elevation <= maxElevation + SUPPORT_ELEVATION_EPSILON,
        )
        .find((group) => Math.abs(group.elevation - elevation) <= WALL_SLAB_ELEVATION_POOL_EPSILON)
        ?.slabIds.slice()
        .sort()[0] ??
      null
  }

  if (baseSegments.length === 0) baseSegments.push({ start: 0, end: 1, elevation })
  const baseElevation = Math.min(
    ...baseSegments.map((segment) =>
      Math.min(segment.elevation, segment.endElevation ?? segment.elevation),
    ),
  )
  let resolvedFaceDatum: WallSlabSupport['faceDatum'] | undefined
  const resolveFaceDatum = () => {
    const wall = levelWalls.find(
      (candidate) =>
        candidate.start[0] === start[0] &&
        candidate.start[1] === start[1] &&
        candidate.end[0] === end[0] &&
        candidate.end[1] === end[1] &&
        (candidate.curveOffset ?? 0) === curveOffset &&
        candidate.justification === wallLike.justification,
    )
    const roomBases = wall ? roomFaceBases(slabs, levelWalls, nodes, memo).get(wall.id) : undefined
    if (roomBases)
      for (const face of ['a', 'b'] as const) {
        const spans = roomBases[face]
        const cuts = [
          ...new Set([
            0,
            1,
            ...faceDatum[face].flatMap((segment) => [segment.start, segment.end]),
            ...spans.flatMap((segment) => [segment.start, segment.end]),
            ...roomBases[face === 'a' ? 'b' : 'a'].flatMap((segment) => [
              segment.start,
              segment.end,
            ]),
          ]),
        ].sort((a, b) => a - b)
        const result: WallSlabSupportSegment[] = []
        for (let i = 1; i < cuts.length; i++) {
          const start = cuts[i - 1]!,
            end = cuts[i]!,
            mid = (start + end) / 2
          const room = spans.find((span) => span.start <= mid && mid < span.end)
          const elected = faceDatum[face].find((span) => span.start <= mid && mid < span.end)
          if (!elected) continue
          const opposite = roomBases[face === 'a' ? 'b' : 'a'].find(
            (span) => span.start <= mid && mid < span.end,
          )
          const groundAt = (t: number) => {
            const frame = getWallCurveFrameAt(wall!, t)
            const offset = getWallFaceOffsets(wall!)[face]
            const x = frame.point.x + frame.normal.x * offset
            const z = frame.point.y + frame.normal.y * offset
            if (memo.baseAt) return memo.baseAt(x, z)
            return nodes && wall!.parentId && nodes[wall!.parentId]
              ? levelBaseElevationAt(nodes, wall!.parentId, x, z)
              : levelBase
          }
          // Raised and sunken rooms never carry their exterior face with them.
          // A flush floor follows depressed terrain only when explicitly opted in.
          const count = Math.max(1, Math.ceil(((end - start) * wallLength) / 0.25))
          const ground =
            !slabs.some((slab) => slab.plateRole === 'base') &&
            !room &&
            opposite &&
            (opposite.elevation - opposite.thickness > 1e-4 || opposite.elevation < -1e-4)
              ? Array.from({ length: count + 1 }, (_, i) =>
                  groundAt(start + ((end - start) * i) / count),
                )
              : []
          if (ground.length) {
            for (let j = 0; j < count; j++) {
              const from = start + ((end - start) * j) / count
              const to = start + ((end - start) * (j + 1)) / count
              const elevation = ground[j]!,
                endElevation = ground[j + 1]!
              if (Math.abs(elevation - endElevation) < 1e-6)
                appendBaseSegment(result, from, to, elevation)
              else {
                const previous = result.at(-1)
                if (
                  previous?.endElevation !== undefined &&
                  Math.abs(previous.endElevation - elevation) < 1e-6 &&
                  Math.abs(
                    (previous.endElevation - previous.elevation) / (previous.end - previous.start) -
                      (endElevation - elevation) / (to - from),
                  ) < 1e-6
                ) {
                  previous.end = to
                  previous.endElevation = endElevation
                } else result.push({ start: from, end: to, elevation, endElevation })
              }
            }
          } else if (!room && elected.endElevation !== undefined) {
            const span = elected.end - elected.start
            const interp = (t: number) =>
              span > 1e-9
                ? elected.elevation +
                  ((t - elected.start) / span) * (elected.endElevation! - elected.elevation)
                : elected.elevation
            appendSlopedBaseSegment(result, start, end, interp(start), interp(end))
          } else
            appendBaseSegment(
              result,
              start,
              end,
              slabs.some((slab) => slab.plateRole === 'base')
                ? (room?.elevation ?? elected.elevation)
                : Math.min(room?.elevation ?? elected.elevation, elected.elevation),
            )
        }
        faceDatum[face] = result
      }
    return faceDatum
  }
  let faceBottom: WallSlabSupport['faceBottom'] | undefined
  const datum = () => (resolvedFaceDatum ??= resolveFaceDatum())
  const bottom = (segments: WallSlabSupportSegment[]) =>
    resolveWallFaceBottom(segments, baseSegments, elevation)
  return Object.defineProperties(
    { elevation, electedSlabId, baseElevation, baseSegments },
    {
      faceDatum: { get: datum },
      faceBottom: { get: () => (faceBottom ??= { a: bottom(datum().a), b: bottom(datum().b) }) },
    },
  ) as WallSlabSupport
}

export function computeWallSlabElevation(
  wallLike: WallOverlapInput,
  slabs: readonly SlabNode[],
  levelWalls: WallNode[],
  nodes?: Readonly<Record<string, AnyNode>>,
): number {
  return computeWallSlabSupport(wallLike, slabs, levelWalls, undefined, undefined, 0, nodes)
    .elevation
}

export function resolveWallFaceBottom(
  datums: readonly WallSlabSupportSegment[],
  support: readonly WallSlabSupportSegment[],
  fallback: number,
): WallSlabSupportSegment[] {
  const at = (run: WallSlabSupportSegment, t: number) =>
    run.elevation +
    ((t - run.start) / (run.end - run.start)) *
      ((run.endElevation ?? run.elevation) - run.elevation)
  const cuts = [...new Set([...datums, ...support].flatMap((run) => [run.start, run.end]))].sort(
    (a, b) => a - b,
  )
  const result: WallSlabSupportSegment[] = []
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1]!,
      end = cuts[i]!,
      mid = (start + end) / 2
    const datum = datums.find((run) => run.start <= mid && run.end >= mid)
    if (!datum) continue
    const carrier = support.find((run) => run.start <= mid && run.end >= mid)
    const d0 = at(datum, start),
      d1 = at(datum, end),
      w0 = carrier ? at(carrier, start) : fallback,
      w1 = carrier ? at(carrier, end) : fallback
    const crossing =
      (d0 - w0) * (d1 - w1) < 0
        ? start + ((end - start) * (w0 - d0)) / (d1 - d0 - w1 + w0)
        : undefined
    const pieces = crossing === undefined ? [start, end] : [start, crossing, end]
    for (let j = 1; j < pieces.length; j++) {
      const from = pieces[j - 1]!,
        to = pieces[j]!
      const height = (t: number) => Math.min(at(datum, t), carrier ? at(carrier, t) : fallback)
      const elevation = height(from),
        endElevation = height(to)
      result.push({
        start: from,
        end: to,
        elevation,
        ...(Math.abs(elevation - endElevation) < 1e-9 ? {} : { endElevation }),
      })
    }
  }
  return result
}
