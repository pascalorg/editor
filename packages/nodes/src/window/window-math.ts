import type { AnyNode, AnyNodeId, WallNode } from '@pascal-app/core'
import {
  readHostWallCeiling,
  toWallCeilingSceneReader,
  type WallCeilingSceneReader,
} from '../shared/wall-opening-ceiling'

/**
 * Default sill height (metres from the floor to the BOTTOM of a window) for a
 * fresh window that has no wall-face height yet — the off-wall ghost and the
 * floor-cursor placement use it so a new window floats slightly above the
 * ground rather than sitting on it. The committed Y is the window's CENTRE, so
 * callers add `height / 2`. An existing window keeps its own sill.
 */
export const DEFAULT_WINDOW_SILL_M = 0.5

/**
 * Converts wall-local (X along wall, Y = height above wall base) to world XYZ.
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
 * Clamps window center (localX, localY) within wall bounds.
 *
 * Y is bounded to keep the window's bottom above 0 (floor level) AND its top
 * below the wall's effective ceiling, sampled at both edges of the opening
 * span (left and right). The ceiling is the wall's RESOLVED top (storey plane
 * for plane-bound walls, stored height for explicit ones, minus the elected
 * slab base) — `nodes` is required because a plane-bound wall's top lives on
 * its level, not on the wall record.
 */
export function clampToWall(
  wallNode: WallNode,
  localX: number,
  localY: number,
  width: number,
  height: number,
  sceneOrNodes: Readonly<Record<AnyNodeId, AnyNode>> | WallCeilingSceneReader,
): { clampedX: number; clampedY: number; fits: boolean } {
  const dx = wallNode.end[0] - wallNode.start[0]
  const dz = wallNode.end[1] - wallNode.start[1]
  const wallLength = Math.hypot(dx, dz)

  const minX = width / 2
  const maxX = wallLength - width / 2

  if (width > wallLength) {
    return { clampedX: wallLength / 2, clampedY: height / 2, fits: false }
  }

  const sceneReader = toWallCeilingSceneReader(sceneOrNodes)
  const startCeiling = readHostWallCeiling(wallNode.id, sceneReader, 0)
  const endCeiling = readHostWallCeiling(wallNode.id, sceneReader, wallLength)
  const slope = (endCeiling - startCeiling) / wallLength

  let fitMinX = minX
  let fitMaxX = maxX

  if (Math.abs(slope) < 1e-6) {
    if (startCeiling < height - 1e-4) {
      return { clampedX: Math.max(minX, Math.min(maxX, localX)), clampedY: height / 2, fits: false }
    }
  } else if (slope > 0) {
    // Upward slope: lowest ceiling point for window span is at left edge (x - width/2)
    const minCenterForHeight = (height - startCeiling) / slope + width / 2
    fitMinX = Math.max(minX, minCenterForHeight)
  } else {
    // Downward slope: lowest ceiling point for window span is at right edge (x + width/2)
    const maxCenterForHeight = (height - startCeiling) / slope - width / 2
    fitMaxX = Math.min(maxX, maxCenterForHeight)
  }

  if (fitMinX > fitMaxX + 1e-4) {
    return { clampedX: Math.max(minX, Math.min(maxX, localX)), clampedY: height / 2, fits: false }
  }

  const clampedX = Math.max(fitMinX, Math.min(fitMaxX, localX))
  const leftCeil = startCeiling + slope * (clampedX - width / 2)
  const rightCeil = startCeiling + slope * (clampedX + width / 2)
  const ceilingAtX = Math.min(leftCeil, rightCeil)

  const effectiveHeight = Math.min(height, Math.max(0.01, ceilingAtX))
  const clampedY = Math.max(effectiveHeight / 2, Math.min(ceilingAtX - effectiveHeight / 2, localY))
  return { clampedX, clampedY, fits: true }
}

/**
 * Wall-child overlap is shared by door + window placement (one source of
 * truth in `shared/wall-attach-target.ts`). Re-exported here so existing
 * `./window-math` importers don't change.
 */
export { hasWallChildOverlap } from '../shared/wall-attach-target'
