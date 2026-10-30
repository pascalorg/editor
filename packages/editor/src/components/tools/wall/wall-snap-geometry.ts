// Pure geometry for "magnetic" wall-draft snapping — no store / viewer / React
// deps, so it's unit-testable in isolation. Coordinates are XZ plan points
// (building-local meters). `wall-drafting.ts` layers grid/angle snapping and
// scene access on top of these primitives.

import {
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallFaceOffsets,
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

// A drafted segment closer than this to a wall's direction (sine of the angle
// between them) runs alongside it: the wall topology stacks such walls rather
// than T-joining them, so the body snap leaves them alone. Two walls meeting
// closer than this aren't a corner either.
const WALL_BODY_SNAP_MIN_SINE = 0.5

/** A straight wall's reference line as a frame, with the faces its body spans. */
type WallBodyFrame = {
  wall: WallNode
  length: number
  ux: number
  uz: number
  faces: { a: number; b: number }
  /** Offset along the wall's left normal, the side its face offsets are measured on. */
  across: (q: WallPlanPoint) => number
  /** Station along the reference line from `start`. */
  along: (q: WallPlanPoint) => number
}

function wallBodyFrame(wall: WallNode): WallBodyFrame | null {
  if (isCurvedWall(wall)) return null
  const [x1, z1] = wall.start
  const length = Math.hypot(wall.end[0] - x1, wall.end[1] - z1)
  if (length < 1e-9) return null
  const ux = (wall.end[0] - x1) / length
  const uz = (wall.end[1] - z1) / length
  return {
    wall,
    length,
    ux,
    uz,
    faces: getWallFaceOffsets(wall),
    across: (q) => (q[1] - z1) * ux - (q[0] - x1) * uz,
    along: (q) => (q[0] - x1) * ux + (q[1] - z1) * uz,
  }
}

/**
 * The corner a join at `target` on `host`'s reference line falls into: where
 * `host` meets another straight wall, at an L or a T, with `target` inside that
 * wall's drawn body. A T-join there would split `host` into a stub buried in
 * the corner block, so the end joins the junction instead. A shared end comes
 * back exactly; walls meeting at a shallow angle aren't a corner.
 */
function cornerJunctionAt(
  target: WallPlanPoint,
  host: WallBodyFrame,
  frames: WallBodyFrame[],
): WallPlanPoint | null {
  for (const other of frames) {
    if (other === host) continue
    if (Math.abs(host.ux * other.uz - host.uz * other.ux) < WALL_BODY_SNAP_MIN_SINE) continue
    const offset = other.across(target)
    if (offset < other.faces.b || offset > other.faces.a) continue
    const ends = [host.wall.start, host.wall.end, other.wall.start, other.wall.end]
    const crossing = segmentIntersection(ends[0]!, ends[1]!, ends[2]!, ends[3]!)
    if (!crossing) continue
    const sharedEnd = ends.find((end) => distanceSquared(end, crossing) <= 1e-12)
    return sharedEnd ? [sharedEnd[0], sharedEnd[1]] : crossing
  }
  return null
}

/**
 * Where a drawn wall end joins a wall it is aimed into: the point on a straight
 * wall's reference line (`start` → `end`, the line the wall topology T-joins a
 * partition end on, whatever the wall's justification) for an end inside that
 * wall's drawn body or within `margin` of either face.
 *
 * `point` is the raw cursor and `placed` its grid / angle placement; either one
 * inside a body captures, so the grid can't leave an end a fraction short of a
 * face. Given the drafted segment's `start`, the end slides along start →
 * `placed` onto the line, so a square or angle-locked segment keeps its
 * direction, and a wall the segment runs alongside (or starts on) is skipped.
 * Without a start the end drops square onto the line, keeping its position
 * along the wall. A join that lands inside a corner block, where the wall
 * meets another at an L or a T, takes the junction itself (`cornerJunctionAt`).
 * Curved walls are left to the edge snap (`findWallSnapTarget`).
 */
export function findWallBodySnapTarget(
  point: WallPlanPoint,
  walls: WallNode[],
  options?: {
    ignoreWallIds?: string[]
    placed?: WallPlanPoint
    start?: WallPlanPoint
    margin?: number
  },
): WallPlanPoint | null {
  const ignored = new Set(options?.ignoreWallIds ?? [])
  const placed = options?.placed ?? point
  const start = options?.start
  const margin = options?.margin ?? WALL_CONNECT_SNAP_RADIUS
  const frames = walls.flatMap((wall) => {
    const frame = ignored.has(wall.id) ? null : wallBodyFrame(wall)
    return frame ? [frame] : []
  })
  let best: WallPlanPoint | null = null
  let bestOutside = Number.POSITIVE_INFINITY

  for (const frame of frames) {
    const { length, ux, uz, faces, across, along } = frame
    const [x1, z1] = frame.wall.start
    const onWall = (q: WallPlanPoint) => along(q) > 0 && along(q) < length
    const outsideBody = (q: WallPlanPoint) =>
      onWall(q) ? Math.max(0, faces.b - across(q), across(q) - faces.a) : Number.POSITIVE_INFINITY
    const outside = Math.min(outsideBody(point), outsideBody(placed))
    if (outside > margin || outside >= bestOutside) continue

    let target: WallPlanPoint | null
    if (Math.abs(across(point)) <= 1e-9 && onWall(point)) {
      // Already on the line: a joined end snapped again (the plan view hands
      // the 3D tool its resolved point) stays put.
      target = [point[0], point[1]]
    } else if (start) {
      const dx = placed[0] - start[0]
      const dz = placed[1] - start[1]
      const run = Math.hypot(dx, dz)
      if (run < 1e-9 || Math.abs(dx * uz - dz * ux) / run < WALL_BODY_SNAP_MIN_SINE) continue
      const startAcross = across(start)
      const t = startAcross / (startAcross - across(placed))
      if (!(t > 1e-6)) continue
      target = [start[0] + dx * t, start[1] + dz * t]
      if (!onWall(target)) continue
    } else {
      const station = along(placed)
      if (!(station > 0 && station < length)) continue
      target = [x1 + ux * station, z1 + uz * station]
    }
    best = cornerJunctionAt(target, frame, frames) ?? target
    bestOutside = outside
  }

  return best
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
