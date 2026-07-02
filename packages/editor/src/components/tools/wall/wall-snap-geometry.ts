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
  if (endpoint) return { point: endpoint, snap: 'endpoint' }

  const midpoint = findWallMidpointFromRaw(point, walls, ignoreWallIds, radii?.midpoint)
  const intersection = findWallIntersectionFromRaw(point, walls, ignoreWallIds, radii?.intersection)
  return nearestCandidate(point, [
    midpoint && { point: midpoint, snap: 'midpoint' },
    intersection && { point: intersection, snap: 'intersection' },
  ])
}
