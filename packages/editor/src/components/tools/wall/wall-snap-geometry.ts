// Pure geometry for "magnetic" wall-draft snapping — no store / viewer / React
// deps, so it's unit-testable in isolation. Coordinates are XZ plan points
// (building-local meters). `wall-drafting.ts` layers grid/angle snapping and
// scene access on top of these primitives.

import {
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  type WallNode,
} from '@pascal-app/core'

export type WallPlanPoint = [number, number]

/** Which kind of existing-geometry snap produced a drafted point. */
export type WallDraftSnapKind = 'endpoint' | 'midpoint' | 'intersection' | 'wall'

export type WallSnapRadii = Partial<Record<WallDraftSnapKind, number>>

export type WallDraftSnapResult = {
  point: WallPlanPoint
  /**
   * Set when `point` locked onto existing wall geometry (a corner, midpoint,
   * crossing, or wall body) rather than a plain grid/angle position. This is
   * the "magnetic" snap the beacon visualises; `null` for grid/angle-only.
   */
  snap: WallDraftSnapKind | null
  /**
   * Walls whose geometry produced the snap. Kept separate from `snap` so a
   * caller can use geometry for XZ alignment while independently deciding
   * whether the target is allowed to transfer its construction plane.
   */
  targetWallIds: string[]
  /**
   * Where the geometry came from. `'cad'` means an imported reference drawing
   * rather than anything in the model — the beacon colours it differently, and
   * it never carries `targetWallIds`, so nothing downstream can mistake a
   * traced line for a wall to join or split.
   */
  source?: 'wall' | 'cad'
  /** True when the point lies outside the site's buildable area. */
  violation?: boolean
}

export const WALL_JOIN_SNAP_RADIUS = 0.35
// Tight capture radius for the connectivity snap that runs in NON-magnetic modes
// (grid / off / angles). Joining an existing wall is treated as connectivity —
// separate from the 'lines' magnetic alignment — so a room can still close in
// those modes: within this distance of a wall the endpoint sticks onto it (and
// the beacon shows); beyond it, positioning is left to the mode. Kept small so
// only the last few cm near a wall stick, well above the room-detection junction
// tolerance so a captured endpoint always registers as connected.
export const WALL_CONNECT_SNAP_RADIUS = 0.05
// Generous radius for snapping to an *existing* wall's endpoint while
// drafting. Larger than `WALL_JOIN_SNAP_RADIUS` because endpoint snap
// is the strongest user intent (closing a polygon, attaching to a
// corner) and the cursor never lands pixel-perfect on a corner.
export const WALL_ENDPOINT_SNAP_RADIUS = 0.7
// Discrete "special point" snaps taken from the raw cursor (like the
// endpoint snap) but slightly tighter — a corner is the strongest intent,
// a midpoint / crossing is the next tier down.
export const WALL_MIDPOINT_SNAP_RADIUS = 0.5
export const WALL_INTERSECTION_SNAP_RADIUS = 0.5

/**
 * Which part of a wall the drafted line represents.
 *
 * `center` is how walls have always been drawn: the line is the centreline and
 * the body grows equally on both sides. The other two put the line on a face
 * instead, which is what tracing a CAD drawing needs — the drawing shows wall
 * *faces*, so a centreline-drawn wall over a traced face lands half a
 * thickness out.
 *
 * `left` / `right` are relative to the direction of drawing, the same
 * convention CAD tools use for wall justification. Which one is "inside"
 * depends on which way round you draw the room, so the draft ghost shows the
 * offset live rather than asking anyone to reason about it.
 */
export type WallAlignment = 'center' | 'left' | 'right'

export const WALL_ALIGNMENTS: WallAlignment[] = ['center', 'left', 'right']

export function nextWallAlignment(alignment: WallAlignment): WallAlignment {
  return WALL_ALIGNMENTS[(WALL_ALIGNMENTS.indexOf(alignment) + 1) % WALL_ALIGNMENTS.length]!
}

/**
 * Shift a drafted line sideways so the wall body lands on the chosen side.
 *
 * The wall itself is unchanged by this — it is still an ordinary centreline
 * wall afterwards, which is what keeps mitering, openings, footprints and
 * every other consumer of `start`/`end` working untouched. All that moves is
 * where the centreline is put at commit time.
 */
export function offsetWallLineForAlignment(
  start: WallPlanPoint,
  end: WallPlanPoint,
  thickness: number,
  alignment: WallAlignment,
): [WallPlanPoint, WallPlanPoint] {
  if (alignment === 'center' || !(thickness > 0)) return [start, end]

  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return [start, end]

  // Left of the direction of travel, in plan. `z` runs down the screen in plan
  // view, so the left-hand normal is (dz, −dx) — the other sign would label
  // each option as its opposite.
  const half = (thickness / 2) * (alignment === 'left' ? 1 : -1)
  const nx = (dz / length) * half
  const nz = (-dx / length) * half

  return [
    [start[0] + nx, start[1] + nz],
    [end[0] + nx, end[1] + nz],
  ]
}

export function distanceSquared(a: WallPlanPoint, b: WallPlanPoint): number {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

export function projectPointOntoWall(point: WallPlanPoint, wall: WallNode): WallPlanPoint | null {
  const [x1, z1] = wall.start
  const [x2, z2] = wall.end
  const dx = x2 - x1
  const dz = z2 - z1
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) {
    return null
  }

  const t = ((point[0] - x1) * dx + (point[1] - z1) * dz) / lengthSquared
  if (t <= 0 || t >= 1) {
    return null
  }

  return [x1 + dx * t, z1 + dz * t]
}

/** How far past an endpoint an extension stays offerable, in metres. */
export const WALL_EXTENSION_MAX_REACH = 8

/**
 * Snap to the imaginary continuation of an existing wall — the line it would
 * trace if it kept going past its endpoint.
 *
 * The alignment guides cover the same intent only for X- and Z-aligned
 * geometry (`AlignmentGuideAxis` is `'x' | 'z'`), so a diagonal wall has
 * nothing holding a new segment collinear with it. This fills exactly that gap
 * and nothing else: `t` outside `[0, 1]` is what makes it an *extension*, and
 * the wall body inside that range is already `findWallSnapTarget`'s job, so the
 * two never compete for the same cursor position.
 *
 * Bounded by `WALL_EXTENSION_MAX_REACH` — a line continues forever, but an
 * inference that reaches across the whole site stops being a hint and starts
 * capturing points the user never aimed at.
 */
export function findWallExtensionSnap(
  point: WallPlanPoint,
  walls: WallNode[],
  options?: { ignoreWallIds?: string[]; radius?: number; maxReach?: number },
): { point: WallPlanPoint; wallId: WallNode['id'] } | null {
  const ignoreWallIds = new Set(options?.ignoreWallIds ?? [])
  const radiusSquared = (options?.radius ?? WALL_JOIN_SNAP_RADIUS) ** 2
  const maxReach = options?.maxReach ?? WALL_EXTENSION_MAX_REACH
  let best: { point: WallPlanPoint; wallId: WallNode['id'] } | null = null
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignoreWallIds.has(wall.id)) continue
    // A curved wall has no single line to continue.
    if (isCurvedWall(wall)) continue

    const [x1, z1] = wall.start
    const [x2, z2] = wall.end
    const dx = x2 - x1
    const dz = z2 - z1
    const lengthSquared = dx * dx + dz * dz
    if (lengthSquared < 1e-9) continue

    const t = ((point[0] - x1) * dx + (point[1] - z1) * dz) / lengthSquared
    // Inside the segment is the body's business, not the extension's.
    if (t > 0 && t < 1) continue

    const projected: WallPlanPoint = [x1 + dx * t, z1 + dz * t]
    const beyond =
      t <= 0 ? distanceSquared(projected, wall.start) : distanceSquared(projected, wall.end)
    if (beyond > maxReach * maxReach) continue

    const candidateDistanceSquared = distanceSquared(point, projected)
    if (
      candidateDistanceSquared > radiusSquared ||
      candidateDistanceSquared >= bestDistanceSquared
    ) {
      continue
    }
    best = { point: projected, wallId: wall.id }
    bestDistanceSquared = candidateDistanceSquared
  }

  return best
}

export function findWallSnapTarget(
  point: WallPlanPoint,
  walls: WallNode[],
  options?: { ignoreWallIds?: string[]; radius?: number },
): WallPlanPoint | null {
  const ignoreWallIds = new Set(options?.ignoreWallIds ?? [])
  const radiusSquared = (options?.radius ?? WALL_JOIN_SNAP_RADIUS) ** 2
  let bestTarget: WallPlanPoint | null = null
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignoreWallIds.has(wall.id)) {
      continue
    }

    const candidates: Array<WallPlanPoint | null> = [wall.start, wall.end]

    if (isCurvedWall(wall)) {
      const sampleCount = Math.max(8, Math.ceil(getWallCurveLength(wall) / 0.3))
      for (let index = 0; index <= sampleCount; index += 1) {
        const frame = getWallCurveFrameAt(wall, index / sampleCount)
        candidates.push([frame.point.x, frame.point.y])
      }
    } else {
      candidates.push(projectPointOntoWall(point, wall))
    }
    for (const candidate of candidates) {
      if (!candidate) {
        continue
      }

      const candidateDistanceSquared = distanceSquared(point, candidate)
      if (
        candidateDistanceSquared > radiusSquared ||
        candidateDistanceSquared >= bestDistanceSquared
      ) {
        continue
      }

      bestTarget = candidate
      bestDistanceSquared = candidateDistanceSquared
    }
  }

  return bestTarget
}

/**
 * Wall ids that contain an already-resolved snap point.
 *
 * This is provenance, not another snap pass: the tolerance only absorbs float
 * drift around a point the snap pipeline already chose.
 */
export function wallIdsAtSnapPoint(
  point: WallPlanPoint,
  walls: WallNode[],
  ignoreWallIds?: string[],
  tolerance = 1e-6,
): string[] {
  const ignored = new Set(ignoreWallIds ?? [])
  const toleranceSquared = tolerance * tolerance
  const ids: string[] = []

  for (const wall of walls) {
    if (ignored.has(wall.id)) continue
    if (
      distanceSquared(point, wall.start) <= toleranceSquared ||
      distanceSquared(point, wall.end) <= toleranceSquared
    ) {
      ids.push(wall.id)
      continue
    }

    if (isCurvedWall(wall)) {
      const sampleCount = Math.max(8, Math.ceil(getWallCurveLength(wall) / 0.3))
      for (let index = 1; index < sampleCount; index += 1) {
        const frame = getWallCurveFrameAt(wall, index / sampleCount)
        if (distanceSquared(point, [frame.point.x, frame.point.y]) <= toleranceSquared) {
          ids.push(wall.id)
          break
        }
      }
      continue
    }

    const projected = projectPointOntoWall(point, wall)
    if (projected && distanceSquared(point, projected) <= toleranceSquared) {
      ids.push(wall.id)
    }
  }

  return ids
}

/**
 * Endpoint-only snap from the *raw* cursor (no grid pre-snap), with a
 * generous radius. Use this before `findWallSnapTarget` so the strong
 * "attach to an existing wall corner" intent isn't accidentally pushed
 * out of range by an interim grid snap that moved the cursor away from
 * the endpoint.
 */
export function findWallEndpointFromRaw(
  point: WallPlanPoint,
  walls: WallNode[],
  ignoreWallIds?: string[],
  radius = WALL_ENDPOINT_SNAP_RADIUS,
): WallPlanPoint | null {
  const ignored = new Set(ignoreWallIds ?? [])
  const radiusSquared = radius ** 2
  let best: WallPlanPoint | null = null
  let bestDistSq = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignored.has(wall.id)) continue
    for (const corner of [wall.start, wall.end] as WallPlanPoint[]) {
      const d = distanceSquared(point, corner)
      if (d <= radiusSquared && d < bestDistSq) {
        best = corner
        bestDistSq = d
      }
    }
  }
  return best
}

/** Midpoint of a wall — curve midpoint for curved walls, segment midpoint otherwise. */
function wallMidpoint(wall: WallNode): WallPlanPoint {
  if (isCurvedWall(wall)) {
    const frame = getWallCurveFrameAt(wall, 0.5)
    return [frame.point.x, frame.point.y]
  }
  return [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
}

/** Nearest wall midpoint to the raw cursor, within `WALL_MIDPOINT_SNAP_RADIUS`. */
export function findWallMidpointFromRaw(
  point: WallPlanPoint,
  walls: WallNode[],
  ignoreWallIds?: string[],
  radius = WALL_MIDPOINT_SNAP_RADIUS,
): WallPlanPoint | null {
  const ignored = new Set(ignoreWallIds ?? [])
  const radiusSquared = radius ** 2
  let best: WallPlanPoint | null = null
  let bestDistSq = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    if (ignored.has(wall.id)) continue
    const mid = wallMidpoint(wall)
    const d = distanceSquared(point, mid)
    if (d <= radiusSquared && d < bestDistSq) {
      best = mid
      bestDistSq = d
    }
  }
  return best
}

/** Crossing point of two straight segments, or null if they don't intersect within both. */
function segmentIntersection(
  a1: WallPlanPoint,
  a2: WallPlanPoint,
  b1: WallPlanPoint,
  b2: WallPlanPoint,
): WallPlanPoint | null {
  const rx = a2[0] - a1[0]
  const rz = a2[1] - a1[1]
  const sx = b2[0] - b1[0]
  const sz = b2[1] - b1[1]
  const denom = rx * sz - rz * sx
  if (Math.abs(denom) < 1e-9) return null // parallel / collinear

  const qpx = b1[0] - a1[0]
  const qpz = b1[1] - a1[1]
  const t = (qpx * sz - qpz * sx) / denom
  const u = (qpx * rz - qpz * rx) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null

  return [a1[0] + t * rx, a1[1] + t * rz]
}

/**
 * Nearest point where two existing straight walls cross, within
 * `WALL_INTERSECTION_SNAP_RADIUS`. Curved walls are skipped. O(n²) over the
 * level's walls — fine at editor scale.
 */
export function findWallIntersectionFromRaw(
  point: WallPlanPoint,
  walls: WallNode[],
  ignoreWallIds?: string[],
  radius = WALL_INTERSECTION_SNAP_RADIUS,
): WallPlanPoint | null {
  const ignored = new Set(ignoreWallIds ?? [])
  const straight = walls.filter((wall) => !ignored.has(wall.id) && !isCurvedWall(wall))
  const radiusSquared = radius ** 2
  let best: WallPlanPoint | null = null
  let bestDistSq = Number.POSITIVE_INFINITY

  for (let i = 0; i < straight.length; i += 1) {
    for (let j = i + 1; j < straight.length; j += 1) {
      const crossing = segmentIntersection(
        straight[i]!.start,
        straight[i]!.end,
        straight[j]!.start,
        straight[j]!.end,
      )
      if (!crossing) continue
      const d = distanceSquared(point, crossing)
      if (d <= radiusSquared && d < bestDistSq) {
        best = crossing
        bestDistSq = d
      }
    }
  }
  return best
}

/** Pick the candidate nearest to `point`, ignoring nulls. */
function nearestCandidate(
  point: WallPlanPoint,
  candidates: Array<WallDraftSnapResult | null | false>,
): WallDraftSnapResult | null {
  let best: WallDraftSnapResult | null = null
  let bestDistSq = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (!candidate) continue
    const d = distanceSquared(point, candidate.point)
    if (d < bestDistSq) {
      best = candidate
      bestDistSq = d
    }
  }
  return best
}

// Tolerance for "the committed endpoint actually lies on existing wall
// geometry". Commit-time resolution (corner join, connect snap, split) puts
// the endpoint exactly on the geometry, so this only needs to absorb float
// drift — it is NOT a snap radius.
export const WALL_CHAIN_JOIN_TOLERANCE = 1e-3

/**
 * True when a committed chain segment's resolved `end` lies on wall geometry
 * (an endpoint, or a straight wall's interior) of a wall outside the current
 * draft chain. The wall tools stop chaining there: a segment that tees into
 * the existing network is a termination — continuing would draft the next
 * segment on top of existing walls. `chainWallIds` excludes the chain's own
 * segments (including the just-committed one) so edge/midpoint snaps onto a
 * previous own segment don't read as a join. Curved wall interiors are
 * skipped (their endpoints still count) — resolving an end onto a curve body
 * is rare and continuing there matches the previous behaviour.
 */
export function chainEndJoinsExistingWall(
  end: WallPlanPoint,
  walls: WallNode[],
  chainWallIds: string[],
  tolerance = WALL_CHAIN_JOIN_TOLERANCE,
): boolean {
  const ignored = new Set(chainWallIds)
  const toleranceSquared = tolerance * tolerance

  for (const wall of walls) {
    if (ignored.has(wall.id)) continue

    if (
      distanceSquared(end, wall.start) <= toleranceSquared ||
      distanceSquared(end, wall.end) <= toleranceSquared
    ) {
      return true
    }

    if (isCurvedWall(wall)) continue

    const projected = projectPointOntoWall(end, wall)
    if (projected && distanceSquared(end, projected) <= toleranceSquared) {
      return true
    }
  }

  return false
}

/**
 * Discrete "special point" snap from the raw cursor, in priority order:
 *   1. corners (endpoints) — strongest intent, largest radius
 *   2. midpoints / crossings — next tier; the nearer of the two wins
 * A corner within range always wins over a midpoint/crossing. Returns null
 * when no special point is in range (caller falls back to grid/edge snap).
 */
export function findWallSpecialPointSnap(
  point: WallPlanPoint,
  walls: WallNode[],
  ignoreWallIds?: string[],
  radii?: WallSnapRadii,
): WallDraftSnapResult | null {
  const endpoint = findWallEndpointFromRaw(point, walls, ignoreWallIds, radii?.endpoint)
  if (endpoint) {
    return {
      point: endpoint,
      snap: 'endpoint',
      targetWallIds: wallIdsAtSnapPoint(endpoint, walls, ignoreWallIds),
    }
  }

  const midpoint = findWallMidpointFromRaw(point, walls, ignoreWallIds, radii?.midpoint)
  const intersection = findWallIntersectionFromRaw(point, walls, ignoreWallIds, radii?.intersection)
  return nearestCandidate(point, [
    midpoint && {
      point: midpoint,
      snap: 'midpoint',
      targetWallIds: wallIdsAtSnapPoint(midpoint, walls, ignoreWallIds),
    },
    intersection && {
      point: intersection,
      snap: 'intersection',
      targetWallIds: wallIdsAtSnapPoint(intersection, walls, ignoreWallIds),
    },
  ])
}
