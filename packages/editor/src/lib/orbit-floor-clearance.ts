type Vec3 = { x: number; y: number; z: number }

/** The lowest an orbiting camera sits above the active level's floor. */
export const ORBIT_FLOOR_CLEARANCE = 0.45

/**
 * How high above the active level's floor the orbit's pivot rests when the
 * editor aims it at the ground (level switch, panning, framing, focusing a
 * floor or room): about standing eye height, so zoomed all the way in the
 * camera looks around the room the way a walkthrough does.
 */
export const ORBIT_TARGET_HEIGHT = 1.1

const DEGREE = Math.PI / 180

/** The steepest an orbit camera looks: straight down is 0, straight up π. */
export const MAX_ORBIT_POLAR_ANGLE = Math.PI - 0.05

/**
 * Past the point where the camera reached the floor clearance, the view
 * pitches up this many times faster than the orbit drag: about 80° more drag
 * takes it from level to straight up.
 */
export const LOOK_UP_PITCH_GAIN = 1.1

/**
 * The look-up push: every this many degrees of drag past the clearance, the
 * camera's horizontal distance to its target halves. Over the ~80° it takes
 * to look straight up, the camera closes about two thirds of the way in.
 */
export const LOOK_UP_PUSH_HALF_ANGLE = 55 * DEGREE

/**
 * How far the orbit has tilted past the point where its camera reaches
 * `minY` (radians, negative while it is still above). Zero exactly when the
 * orbit camera sits at `minY`.
 */
export function orbitAngleBelowFloor(position: Vec3, target: Vec3, minY: number): number {
  const horizontal = Math.hypot(position.x - target.x, position.z - target.z)
  const height = position.y - target.y
  const distance = Math.hypot(horizontal, height)
  if (distance < 1e-9) return 0
  const polar = Math.atan2(horizontal, height)
  const contactPolar = Math.acos(Math.max(-1, Math.min(1, (minY - target.y) / distance)))
  return polar - contactPolar
}

/**
 * Where to draw an orbit camera so it never drops below `minY`. Above it the
 * orbit pose stands. An orbit that would take it lower keeps the camera on
 * `minY`, pitches the view up `LOOK_UP_PITCH_GAIN` times faster than the
 * drag (stopping at straight up), and pushes the camera gently toward its
 * target at the `LOOK_UP_PUSH_HALF_ANGLE` rate. A pure function of the orbit
 * state, so orbiting back up returns the exact orbit pose.
 *
 * Writes the drawn position into `out` and returns the drawn polar angle.
 */
export function orbitCameraAboveFloor(
  out: Vec3,
  position: Vec3,
  target: Vec3,
  minY: number,
): number {
  const dx = position.x - target.x
  const dz = position.z - target.z
  const horizontal = Math.hypot(dx, dz)
  const height = position.y - target.y
  if (!(position.y < minY)) {
    out.x = position.x
    out.y = position.y
    out.z = position.z
    return Math.atan2(horizontal, height)
  }

  const rise = minY - target.y
  const distance = Math.hypot(horizontal, height)
  const contactRadius = Math.sqrt(Math.max(0, distance * distance - rise * rise))
  const below = Math.max(0, orbitAngleBelowFloor(position, target, minY))
  const contactPolar = Math.atan2(horizontal, height) - below
  // Nothing moves once the view looks straight up.
  const pastContact = Math.min(below, (MAX_ORBIT_POLAR_ANGLE - contactPolar) / LOOK_UP_PITCH_GAIN)
  const reach = contactRadius * 0.5 ** (pastContact / LOOK_UP_PUSH_HALF_ANGLE)
  const scale = horizontal > 1e-9 ? reach / horizontal : 0
  out.x = target.x + dx * scale
  out.y = minY
  out.z = target.z + dz * scale
  return contactPolar + pastContact * LOOK_UP_PITCH_GAIN
}

// How quickly the floor limit follows a change in the floor under the camera
// (stepping over a raised platform's edge): about this many seconds per e-fold.
const FLOOR_GLIDE_SECONDS = 0.12

/**
 * The lowest the camera may sit: the clearance above the floor surface under
 * it, or above the level's own floor when there is none (outside, no terrain).
 */
export function floorLimitAt(surfaceTop: number | null, levelFloorY: number): number {
  return (surfaceTop ?? levelFloorY) + ORBIT_FLOOR_CLEARANCE
}

/** Eases a floor limit toward `target` over `delta` seconds, so it never pops. */
export function glideFloorLimit(current: number | null, target: number, delta: number): number {
  if (current === null || !(delta > 0)) return current ?? target
  return target + (current - target) * Math.exp(-delta / FLOOR_GLIDE_SECONDS)
}
