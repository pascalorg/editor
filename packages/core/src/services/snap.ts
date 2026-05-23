/**
 * Pure snap math — no React, no R3F, no scene access.
 *
 * Phase 1 ships the kind-agnostic snappers (grid + angle). Wall-specific
 * snapping (snap-to-endpoint, snap-along-T) currently lives in
 * `editor/src/components/tools/wall/wall-drafting.ts` and stays there until
 * Phase 3, when the wall migration ports it here behind a `wallSnap` namespace.
 *
 * The functions here are stable contract — Phase 3 only adds, never removes.
 */

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

/** Default planar grid spacing in meters. Matches the editor's wall tool. */
export const DEFAULT_GRID_STEP = 0.25

/** Default angle-snap step — π/12 = 15°. Wall tools also use π/4 (45°). */
export const DEFAULT_ANGLE_STEP = Math.PI / 12

// ─── Grid snap ────────────────────────────────────────────────────────

/** Snaps a single scalar to the nearest multiple of `step`. */
export function snapScalar(value: number, step: number = DEFAULT_GRID_STEP): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** Snaps a 2D point to a regular planar grid. */
export function snapPointToGrid(point: Vec2, step: number = DEFAULT_GRID_STEP): Vec2 {
  return [snapScalar(point[0], step), snapScalar(point[1], step)]
}

/** Snaps a 3D point to a regular grid in the X/Z plane, preserving Y. */
export function snapVec3ToGrid(point: Vec3, step: number = DEFAULT_GRID_STEP): Vec3 {
  return [snapScalar(point[0], step), point[1], snapScalar(point[2], step)]
}

// ─── Angle snap ───────────────────────────────────────────────────────

/**
 * Snaps a cursor point to the nearest angle multiple of `angleStep` (radians)
 * measured from `from`, preserving distance. Useful for axis/diagonal-locked
 * placement and wall draft endpoint locking.
 *
 * After the angle snap, the result is grid-snapped if `gridStep` is provided
 * — keeps endpoints landing on grid intersections.
 */
export function snapPointToAngle(
  from: Vec2,
  cursor: Vec2,
  angleStep: number = DEFAULT_ANGLE_STEP,
  gridStep?: number,
): Vec2 {
  const dx = cursor[0] - from[0]
  const dz = cursor[1] - from[1]
  const angle = Math.atan2(dz, dx)
  const snappedAngle = Math.round(angle / angleStep) * angleStep
  const distance = Math.hypot(dx, dz)
  const projected: Vec2 = [
    from[0] + Math.cos(snappedAngle) * distance,
    from[1] + Math.sin(snappedAngle) * distance,
  ]
  return gridStep == null ? projected : snapPointToGrid(projected, gridStep)
}

/**
 * Snaps an angle (in radians) to the nearest entry in `snapAngles` (also in
 * radians). Returns the original angle if no entry is within `toleranceRad`.
 */
export function snapAngleToList(
  angle: number,
  snapAngles: readonly number[],
  toleranceRad: number = Math.PI / 36, // 5°
): number {
  let best: number | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const target of snapAngles) {
    // wrap delta to [-π, π]
    let delta = ((angle - target) % (Math.PI * 2)) + Math.PI * 3
    delta = (delta % (Math.PI * 2)) - Math.PI
    const abs = Math.abs(delta)
    if (abs < bestDelta && abs <= toleranceRad) {
      bestDelta = abs
      best = target
    }
  }
  return best ?? angle
}

// ─── Top-level SnapServices facade ────────────────────────────────────

/**
 * Stable surface that `DragAction.snap` callbacks receive. Phase 1 ships
 * `grid` and `angle`. Phase 3 adds a `wall` namespace populated by wall
 * migration. Plugin authors should target this facade rather than importing
 * the individual functions, so future Phase contributions become visible
 * without code changes.
 */
export type SnapServices = {
  grid: {
    snap: (point: Vec2, step?: number) => Vec2
    snapVec3: (point: Vec3, step?: number) => Vec3
    snapScalar: (value: number, step?: number) => number
  }
  angle: {
    snapTo: (from: Vec2, cursor: Vec2, angleStep?: number, gridStep?: number) => Vec2
    snapToList: (angle: number, list: readonly number[], toleranceRad?: number) => number
  }
}

export const snapServices: SnapServices = {
  grid: {
    snap: snapPointToGrid,
    snapVec3: snapVec3ToGrid,
    snapScalar,
  },
  angle: {
    snapTo: snapPointToAngle,
    snapToList: snapAngleToList,
  },
}
