/**
 * How fast you walk in walkthrough, derived from how big the building is.
 *
 * The speeds used to be two literals written inline in the JSX — twice, once in
 * each controller. Two metres per second is a comfortable pace in a house and
 * an ordeal in a warehouse: crossing a 120 m aisle took a full minute, and the
 * only way to make it bearable was to hold the run key the whole way.
 *
 * Scaling by the square root of the scene radius, not by the radius itself, is
 * the whole design. Linear scaling turns a 30 000 m² shed into a place where
 * you fly past the rack you were aiming for and cannot stop on it; the point of
 * a walkthrough is to look at things at human height, so the pace has to grow
 * more slowly than the building does.
 */

/** A house-sized scene's pace. These are the numbers walkthrough has always used. */
export const BASE_WALK_SPEED = 2
export const BASE_RUN_SPEED = 5

/**
 * Crouched speeds, deliberately NOT scaled.
 *
 * Crouching is a precision move — getting under a conveyor, through a gap
 * between racks. Speeding it up in a big scene would defeat the reason anyone
 * crouches.
 */
export const CROUCH_WALK_SPEED = 1
export const CROUCH_RUN_SPEED = 1.4

/**
 * Scene radius (metres) at or below which the multiplier is exactly 1.
 *
 * A 30 m house sits inside a ~16 m radius, so it keeps today's feel exactly.
 * That was a constraint on this change, not a preference — the fix is for large
 * buildings and must be invisible in small ones.
 */
export const REFERENCE_SCENE_RADIUS_M = 20

/**
 * Ceiling on the automatic multiplier.
 *
 * At 2.5 the 200 × 150 m case walks at 5 m/s and runs at 12.5 m/s. Past that,
 * the collision-and-float controller starts skipping thin obstacles between
 * frames, which reads as walking through a wall.
 */
export const MAX_SPEED_SCALE = 2.5

export interface WalkthroughSpeedPreferences {
  /** Derive a multiplier from scene size. Off means the manual one is the whole answer. */
  autoScale: boolean
  /** User's own multiplier, applied on top. 1 = leave it alone. */
  multiplier: number
}

export interface WalkthroughSpeeds {
  walk: number
  run: number
}

/**
 * Scene-size multiplier, floored at 1 and capped at {@link MAX_SPEED_SCALE}.
 *
 * The floor is not symmetry with the cap: it means no scene can ever be made
 * SLOWER than it is today. A shrinking multiplier would be a behaviour change
 * nobody asked for, in scenes where nobody complained.
 *
 * A null, non-finite or non-positive radius yields 1. That is the same lesson
 * `lights.tsx` records about its shadow sphere — one node with a NaN transform
 * poisons a union box, and a NaN speed here would freeze the player in place
 * with no error to explain it.
 */
export function resolveSpeedScale(sceneRadiusM: number | null): number {
  if (sceneRadiusM === null || !Number.isFinite(sceneRadiusM) || sceneRadiusM <= 0) return 1

  const scale = Math.sqrt(sceneRadiusM / REFERENCE_SCENE_RADIUS_M)
  return Math.min(MAX_SPEED_SCALE, Math.max(1, scale))
}

/**
 * The pair both controllers ask for. Crouching wins over every multiplier.
 */
export function resolveWalkthroughSpeeds(
  sceneRadiusM: number | null,
  preferences: WalkthroughSpeedPreferences,
  crouched: boolean,
): WalkthroughSpeeds {
  if (crouched) return { walk: CROUCH_WALK_SPEED, run: CROUCH_RUN_SPEED }

  const automatic = preferences.autoScale ? resolveSpeedScale(sceneRadiusM) : 1
  const manual =
    Number.isFinite(preferences.multiplier) && preferences.multiplier > 0
      ? preferences.multiplier
      : 1
  const scale = automatic * manual

  return { walk: BASE_WALK_SPEED * scale, run: BASE_RUN_SPEED * scale }
}
