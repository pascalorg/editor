import {
  getWallBodyCenterOffset,
  getWallCurveFrameAt,
  getWallCurveLength,
  type WallNode,
} from '@pascal-app/core'

/**
 * Keep the door handle at the same relative height when the door is resized:
 * scale it by the height ratio, then clamp to the panel's slider bounds
 * [0.5, height - 0.1] so it never lands outside the (possibly shrunk) door.
 * Used by both the height-resize arrow and the panel's Height slider so the
 * handle tracks the door whichever way it's resized.
 */
export function scaleHandleHeight(
  handleHeight: number,
  oldHeight: number,
  newHeight: number,
): number {
  const ratio = oldHeight > 0 ? newHeight / oldHeight : 1
  return Math.min(Math.max(handleHeight * ratio, 0.5), Math.max(0.5, newHeight - 0.1))
}

/**
 * Converts wall-local (X along wall, Y = height above wall base, Z = offset
 * from the wall centre plane along its normal) to world XYZ.
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

/** Door centre on its wall: the shared rule in core (`clampDoorToWall`). */
export { clampDoorToWall as clampToWall } from '@pascal-app/core/building'

// Wall-child overlap is shared by door + window placement (one source of
// truth in `shared/wall-attach-target.ts`). Re-exported here so existing
// `./door-math` importers don't change.
export { hasWallChildOverlap } from '../shared/wall-attach-target'
