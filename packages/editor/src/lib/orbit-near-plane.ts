/** The viewer's near plane (`viewerCameraClipping`), kept while the eye stands back. */
export const ORBIT_NEAR = 0.3
/** How close the near plane comes in when the eye does: a casing seen from an inch off. */
export const CLOSE_UP_NEAR = 0.01

/**
 * The near plane for an orbit `distance` from its target: a tenth of it, between `CLOSE_UP_NEAR`
 * and the viewer's own, so zooming in on a window's trim never clips it while the eye standing
 * back keeps the depth precision it had.
 */
export function orbitNearPlane(distance: number): number {
  return Math.min(ORBIT_NEAR, Math.max(CLOSE_UP_NEAR, distance * 0.1))
}
