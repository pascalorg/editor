import {
  getCurtainWallConfig,
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
 * Converts wall-local (X along wall, Y = height above wall base) to world XYZ.
 */
export function wallLocalToWorld(
  wallNode: WallNode,
  localX: number,
  localY: number,
  levelYOffset = 0,
  slabElevation = 0,
): [number, number, number] {
  const wallLength = getWallCurveLength(wallNode)
  const frame = getWallCurveFrameAt(wallNode, wallLength > 1e-6 ? localX / wallLength : 0)
  return [frame.point.x, slabElevation + localY + levelYOffset, frame.point.y]
}

/**
 * Clamps door center X so it stays fully within wall bounds.
 * Y is always height/2 — doors sit at floor level.
 */
export function clampToWall(
  wallNode: WallNode,
  localX: number,
  width: number,
  height: number,
): { clampedX: number; clampedY: number } {
  const wallLength = getWallCurveLength(wallNode)
  const margin = wallNode.wallType === 'curtain' ? getCurtainWallConfig(wallNode).perimeterWidth : 0

  const clampedX = Math.max(margin + width / 2, Math.min(wallLength - margin - width / 2, localX))
  const clampedY = height / 2 // Doors always sit at floor level
  return { clampedX, clampedY }
}

// Wall-child overlap is shared by door + window placement (one source of
// truth in `shared/wall-attach-target.ts`). Re-exported here so existing
// `./door-math` importers don't change.
export { hasWallChildOverlap } from '../shared/wall-attach-target'
