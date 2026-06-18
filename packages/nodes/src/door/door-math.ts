import type { WallNode } from '@pascal-app/core'

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
  const wallAngle = Math.atan2(
    wallNode.end[1] - wallNode.start[1],
    wallNode.end[0] - wallNode.start[0],
  )
  return [
    wallNode.start[0] + localX * Math.cos(wallAngle),
    slabElevation + localY + levelYOffset,
    wallNode.start[1] + localX * Math.sin(wallAngle),
  ]
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
  const dx = wallNode.end[0] - wallNode.start[0]
  const dz = wallNode.end[1] - wallNode.start[1]
  const wallLength = Math.sqrt(dx * dx + dz * dz)

  const clampedX = Math.max(width / 2, Math.min(wallLength - width / 2, localX))
  const clampedY = height / 2 // Doors always sit at floor level
  return { clampedX, clampedY }
}

// Wall-child overlap is shared by door + window placement (one source of
// truth in `shared/wall-attach-target.ts`). Re-exported here so existing
// `./door-math` importers don't change.
export { hasWallChildOverlap } from '../shared/wall-attach-target'
