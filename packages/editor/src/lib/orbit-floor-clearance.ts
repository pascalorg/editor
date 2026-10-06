type Vec3 = { x: number; y: number; z: number }

/**
 * The lowest an orbiting camera sits above the active level's floor: about a
 * seated eye height, so looking up clears tables and counters, and below the
 * 1.6 m a Spielberg camera stands at.
 */
export const ORBIT_FLOOR_CLEARANCE = 1.2

// How hard a grounded camera is pushed toward its target, per metre it would
// have sunk below `minY`, relative to the orbit distance. Scaled by the
// distance so the same tilt brings a near and a far camera equally far in.
const FORWARD_PUSH = 2

/**
 * Where to put an orbit camera so it never drops below `minY`. Above it the
 * orbit pose stands. Below it the camera rests at `minY` and slides toward
 * the target the deeper the orbit dips, keeping the orbit's view direction —
 * tilting past the horizon looks up at the ceiling from inside the room
 * instead of from under the slab. A pure function of the orbit state, so
 * orbiting back up returns the exact orbit pose.
 *
 * Writes the presented position into `out`; returns whether the floor moved it.
 */
export function orbitCameraAboveFloor(
  out: Vec3,
  position: Vec3,
  target: Vec3,
  minY: number,
): boolean {
  const sink = minY - position.y
  if (!(sink > 0)) {
    out.x = position.x
    out.y = position.y
    out.z = position.z
    return false
  }

  const distance = Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z)
  const keep = distance / (distance + FORWARD_PUSH * sink)
  out.x = target.x + (position.x - target.x) * keep
  out.y = minY
  out.z = target.z + (position.z - target.z) * keep
  return true
}
