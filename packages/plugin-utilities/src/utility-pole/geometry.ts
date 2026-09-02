/**
 * Pole hardware dimensions, in ONE place.
 *
 * These numbers were duplicated between the 3D renderer (`renderer.tsx`) and
 * the line tool (`tool-support.ts`), which is exactly how a drop ends up
 * attached somewhere the crossarm is not. Every consumer now reads them from
 * here: the renderer draws the crossarm at `POLE_CROSSARM_DROP` below the
 * top, and `resolveLineEndpoints` attaches a span at the insulator pin on
 * that same crossarm.
 *
 * PROVENANCE, marked rather than implied:
 *   - 2.44 m (8 ft) is the common distribution crossarm length;
 *   - the 0.6 m drop and the 0.2 m pin inset are DRAWING dimensions chosen so
 *     the arm reads correctly at domestic scale. Neither is read from ANSI
 *     O5.1 (which is a pole circumference/class table, not a framing table)
 *     nor from a utility construction standard. They are unverified.
 */

/** Crossarm length, metres. 8 ft. */
export const POLE_CROSSARM_LENGTH = 2.44
/** Crossarm section (square), metres. */
export const POLE_CROSSARM_SECTION = 0.09
/** How far the crossarm sits below the pole top, metres. */
export const POLE_CROSSARM_DROP = 0.6
/** Inset of the outer insulator pins from the crossarm ends, metres. */
export const POLE_INSULATOR_INSET = 0.2

/**
 * Plan unit vector along the crossarm for a pole yaw, in SITE axes
 * (x east, z south).
 *
 * The 3D scene rotates a local point about +Y as
 *   world.x = px + lx·cos + lz·sin
 *   world.z = pz − lx·sin + lz·cos
 * (`site-frame.ts` documents why that sign convention is the ground truth
 * here), so the crossarm's local +X axis maps to `(cos yaw, −sin yaw)`.
 */
export function crossarmAxis(yaw: number): [number, number] {
  return [Math.cos(yaw), -Math.sin(yaw)]
}

/** Distance from the pole centre out to an end insulator pin, metres. */
export const crossarmPinOffset = (): number => POLE_CROSSARM_LENGTH / 2 - POLE_INSULATOR_INSET
