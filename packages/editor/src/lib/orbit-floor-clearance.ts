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

/**
 * The dive under the ground: with the ground on Auto the orbit's eye may leave the ground for the
 * earth under any building, down to a floor this far under the lowest ground, or this far under
 * the deepest thing drawn (a basement's footing), whichever is deeper.
 */
export const DIVE_DEPTH = 3
export const DIVE_MARGIN = 1

const DEGREE = Math.PI / 180

/** The floor of the dive, world Y: the eye's clearance over it is {@link ORBIT_FLOOR_CLEARANCE}. */
export function diveFloorY(lowestGroundY: number, deepestDrawnY: number | null): number {
  const underGround = lowestGroundY - DIVE_DEPTH
  return deepestDrawnY === null ? underGround : Math.min(underGround, deepestDrawnY - DIVE_MARGIN)
}

/**
 * The lowest the orbit's eye may sit: the clearance over the selected level's floor, or over the
 * dive's floor when the person may dive and it lies deeper (`diveFloor` null: no dive). Selecting a
 * level never lifts the limit above the dive floor, so a dive works from any storey.
 */
export function orbitFloorMinY(levelFloorY: number, diveFloor: number | null): number {
  return Math.min(levelFloorY, diveFloor ?? levelFloorY) + ORBIT_FLOOR_CLEARANCE
}

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

/**
 * How far over the ground the overview's eye stays when the pivot goes down to a deep level: the
 * ground is a medium, the eye above it sees the level through the hole and the dive is the
 * person's own act, so picking a level four storeys under grade does not sink the eye with it.
 */
export const OVERVIEW_GROUND_CLEARANCE = 2

/**
 * The height an overview eye is kept at when its pivot moves to another level: `movedEyeY` as the
 * move leaves it (the eye following the pivot down), unless that would sink the eye under the
 * ground (the eye was above it, `wasUnder` false): then the eye stays where it was, over the ground
 * (at least {@link OVERVIEW_GROUND_CLEARANCE} over it), and looks down at the new pivot. An eye
 * already under the ground (the person dived) goes where the move puts it.
 */
export function overviewEyeY(
  movedEyeY: number,
  previousEyeY: number,
  groundY: number,
  wasUnder: boolean,
): number {
  const lowest = groundY + OVERVIEW_GROUND_CLEARANCE
  if (wasUnder || movedEyeY >= lowest) return movedEyeY
  return Math.max(previousEyeY, lowest)
}
