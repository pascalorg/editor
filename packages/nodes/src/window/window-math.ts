import {
  getWallBodyCenterOffset,
  getWallCurveFrameAt,
  getWallCurveLength,
  type WallNode,
} from '@pascal-app/core'

/**
 * Default sill height (metres from the floor to the BOTTOM of a window) for a
 * fresh window that has no wall-face height yet — the off-wall ghost and the
 * floor-cursor placement use it so a new window floats slightly above the
 * ground rather than sitting on it. The committed Y is the window's CENTRE, so
 * callers add `height / 2`. An existing window keeps its own sill.
 */
export const DEFAULT_WINDOW_SILL_M = 0.5

/**
 * Converts wall-local (X along wall, Y = height above wall base, Z = offset
 * from the wall centre plane along its normal) to world XYZ.
 * Wall XZ uses level-local coordinates (levels only offset in Y, not XZ).
 * Pass levelYOffset (the level group's current world Y) and slabElevation (the
 * wall mesh's Y within the level group) so the cursor lands at the correct world
 * height — matching how WallSystem positions the wall mesh at slabElevation.
 */
export function wallLocalToWorld(
  wallNode: WallNode,
  localX: number,
  localY: number,
  levelYOffset = 0,
  slabElevation = 0,
  localZ = 0,
): [number, number, number] {
  const wallLength = getWallCurveLength(wallNode)
  const frame = getWallCurveFrameAt(wallNode, wallLength > 1e-6 ? localX / wallLength : 0)
  // `localZ` is measured from the body's centre plane, which a justified wall
  // sets off its reference line.
  const across = getWallBodyCenterOffset(wallNode) + localZ
  return [
    frame.point.x + frame.normal.x * across,
    slabElevation + localY + levelYOffset,
    frame.point.y + frame.normal.y * across,
  ]
}

/** Window centre on its wall and under its ceiling: the shared rule in core (`clampWindowToWall`). */
export { clampWindowToWall as clampToWall } from '@pascal-app/core/building'

/**
 * Wall-child overlap is shared by door + window placement (one source of
 * truth in `shared/wall-attach-target.ts`). Re-exported here so existing
 * `./window-math` importers don't change.
 */
export { hasWallChildOverlap } from '../shared/wall-attach-target'
