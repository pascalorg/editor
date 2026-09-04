import type { AnyNode, AnyNodeId, WallNode } from '@pascal-app/core'
import {
  readHostWallCeiling,
  toWallCeilingSceneReader,
  type WallCeilingSceneReader,
} from '../shared/wall-opening-ceiling'

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
  sceneOrNodes: WallCeilingSceneReader | Readonly<Record<AnyNodeId, AnyNode>>,
): { clampedX: number; clampedY: number; fits: boolean } {
  const dx = wallNode.end[0] - wallNode.start[0]
  const dz = wallNode.end[1] - wallNode.start[1]
  const wallLength = Math.hypot(dx, dz)

  const minX = width / 2
  const maxX = wallLength - width / 2
  const clampedY = height / 2 // Doors always sit at floor level

  if (width > wallLength) {
    return { clampedX: wallLength / 2, clampedY, fits: false }
  }

  const scene = toWallCeilingSceneReader(sceneOrNodes)
  const startCeiling = readHostWallCeiling(wallNode.id, scene, 0)
  const endCeiling = readHostWallCeiling(wallNode.id, scene, wallLength)
  const slope = (endCeiling - startCeiling) / wallLength

  let fitMinX = minX
  let fitMaxX = maxX

  if (Math.abs(slope) < 1e-6) {
    if (startCeiling < height - 1e-4) {
      return { clampedX: Math.max(minX, Math.min(maxX, localX)), clampedY, fits: false }
    }
  } else if (slope > 0) {
    // Upward slope: lowest point is the left edge (x - width/2)
    const minCenterForHeight = (height - startCeiling) / slope + width / 2
    fitMinX = Math.max(minX, minCenterForHeight)
  } else {
    // Downward slope: lowest point is the right edge (x + width/2)
    const maxCenterForHeight = (height - startCeiling) / slope - width / 2
    fitMaxX = Math.min(maxX, maxCenterForHeight)
  }

  if (fitMinX > fitMaxX + 1e-4) {
    return { clampedX: Math.max(minX, Math.min(maxX, localX)), clampedY, fits: false }
  }

  const clampedX = Math.max(fitMinX, Math.min(fitMaxX, localX))
  return { clampedX, clampedY, fits: true }
}

// Wall-child overlap is shared by door + window placement (one source of
// truth in `shared/wall-attach-target.ts`). Re-exported here so existing
// `./door-math` importers don't change.
export { hasWallChildOverlap } from '../shared/wall-attach-target'
