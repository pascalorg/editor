import type { AnyNode, AnyNodeId, WallNode } from '@pascal-app/core'
import { readHostWallCeiling, type WallCeilingSceneReader } from '../shared/wall-opening-ceiling'

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

  const sceneReader: WallCeilingSceneReader =
    typeof (sceneOrNodes as WallCeilingSceneReader).nodes === 'function'
      ? (sceneOrNodes as WallCeilingSceneReader)
      : {
          get: (id: AnyNodeId) => (sceneOrNodes as Readonly<Record<AnyNodeId, AnyNode>>)[id],
          nodes: () => sceneOrNodes as Readonly<Record<AnyNodeId, AnyNode>>,
        }

  function getCeilingAt(testX: number) {
    const leftHeight = readHostWallCeiling(wallNode.id, sceneReader, testX - width / 2)
    const rightHeight = readHostWallCeiling(wallNode.id, sceneReader, testX + width / 2)
    return Math.min(leftHeight, rightHeight)
  }

  let clampedX = Math.max(minX, Math.min(maxX, localX))
  let ceilingAtX = getCeilingAt(clampedX)
  let fits = ceilingAtX >= height - 1e-4

  if (!fits) {
    const step = 0.1
    const maxSearch = wallLength / 2
    for (let offset = step; offset <= maxSearch; offset += step) {
      if (clampedX - offset >= minX) {
        const ceiling = getCeilingAt(clampedX - offset)
        if (ceiling >= height - 1e-4) {
          clampedX -= offset
          ceilingAtX = ceiling
          fits = true
          break
        }
      }
      if (clampedX + offset <= maxX) {
        const ceiling = getCeilingAt(clampedX + offset)
        if (ceiling >= height - 1e-4) {
          clampedX += offset
          ceilingAtX = ceiling
          fits = true
          break
        }
      }
    }
  }

  const clampedY = Math.max(height / 2, Math.min(ceilingAtX - height / 2, localY))

  return { clampedX, clampedY, fits }
}

/**
 * Wall-child overlap is shared by door + window placement (one source of
 * truth in `shared/wall-attach-target.ts`). Re-exported here so existing
 * `./window-math` importers don't change.
 */
export { hasWallChildOverlap } from '../shared/wall-attach-target'
