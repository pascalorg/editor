import { type AnyNode, type AnyNodeId, isCurvedWall, type WallNode } from '@pascal-app/core'

/**
 * Shared helpers for the kinds whose 2D move snaps onto a wall in plan
 * space (door, window, item with `attachTo === 'wall' | 'wall-side'`).
 *
 * The 3D move tools listen to R3F `WallEvent`s (mesh-hit with normal)
 * for wall snapping. The 2D path doesn't have that — pointer events
 * land on the SVG layer, not on the wall meshes. This helper does the
 * equivalent plan-space projection: for each wall on the level, find
 * the perpendicular projection of the pointer onto the wall line and
 * pick the closest one within a reasonable range.
 *
 * Curved walls are excluded — the legacy door / window placement also
 * rejects curved walls (mitering + arc + opening would tear in 3D).
 */

const WALL_SNAP_DISTANCE_M = 1.5

export type WallHit = {
  wall: WallNode
  /** Distance along the wall from `start` (clamped to [0, length]). */
  localX: number
  /** Signed perpendicular distance from the wall axis (+ on the "front" side). */
  perpDistance: number
  /** Which face of the wall the pointer was on. */
  side: 'front' | 'back'
  /** Wall direction unit vector, x. */
  dirX: number
  /** Wall direction unit vector, y (== z in plan). */
  dirY: number
  /** Wall length in metres. */
  wallLength: number
  /**
   * Rotation around Y in **wall-local** space — 0 for the front face,
   * π for the back. Matches the 3D `calculateItemRotation(normal)`
   * convention (normal +Z → 0, normal -Z → π). Items / doors / windows
   * are children of the wall mesh, so their `rotation.y` is in the
   * wall's local frame; writing a world-space rotation here would mis-
   * orient the node by `wallRotation` (off by 90° on vertical walls).
   */
  itemRotation: number
}

/**
 * Walk every wall under `parentLevelId` and return the closest one to
 * `planPoint`, or `null` if no wall is within `WALL_SNAP_DISTANCE_M`.
 * `excludeWallId` skips a specific wall (e.g. the current parent during
 * a re-parent flow if you want a "must change" guard).
 */
export function findClosestWallInPlan(
  planPoint: readonly [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
  parentLevelId: AnyNodeId | null,
  excludeWallId?: AnyNodeId,
): WallHit | null {
  if (!parentLevelId) return null
  const level = nodes[parentLevelId]
  const childIds = (level as unknown as { children?: AnyNodeId[] })?.children
  if (!Array.isArray(childIds)) return null

  let best: WallHit | null = null

  for (const childId of childIds) {
    const node = nodes[childId]
    if (!node || node.type !== 'wall') continue
    if (childId === excludeWallId) continue
    const wall = node as WallNode
    if (isCurvedWall(wall)) continue

    const sx = wall.start[0]
    const sy = wall.start[1]
    const dx = wall.end[0] - sx
    const dy = wall.end[1] - sy
    const wallLength = Math.hypot(dx, dy)
    if (wallLength < 1e-6) continue

    const dirX = dx / wallLength
    const dirY = dy / wallLength

    // Project pointer onto wall axis.
    const px = planPoint[0] - sx
    const py = planPoint[1] - sy
    const along = px * dirX + py * dirY
    const perpRaw = px * -dirY + py * dirX // signed perpendicular distance
    const clampedAlong = Math.max(0, Math.min(wallLength, along))

    // Distance from the pointer to the wall segment (not just the line).
    const closestPointX = sx + dirX * clampedAlong
    const closestPointY = sy + dirY * clampedAlong
    const distance = Math.hypot(planPoint[0] - closestPointX, planPoint[1] - closestPointY)
    if (distance > WALL_SNAP_DISTANCE_M) continue
    if (best && distance >= Math.abs(best.perpDistance) && best.wall.id !== wall.id) continue

    // Side determination, calibrated to the 3D wall convention. In
    // wall-local space the wall extends along +X and its +Z axis is the
    // front-face normal. After `mesh.rotation.y = -wallAngle`:
    //   - For a wall going `+X` in plan (wallAngle=0): wall-local +Z
    //     maps to world +Z = plan +Y, so the front face is on plan +Y.
    //     `perpRaw = py` is positive → front.
    //   - For a wall going `+Y` in plan (wallAngle=π/2): wall-local +Z
    //     maps to world -X = plan -X, so the front face is on plan -X.
    //     `perpRaw = -px` is positive there → front.
    // So `perpRaw >= 0` is consistently the front side. The earlier
    // labelling had this flipped, which produced rotations that were
    // off by 90° on non-horizontal walls.
    const side: 'front' | 'back' = perpRaw >= 0 ? 'front' : 'back'

    // Rotation in wall-local space — matches 3D `calculateItemRotation`:
    // 0 when the item faces the front normal (+Z), π for the back. The
    // node is parented to the wall, so this composes with the wall's
    // own rotation when rendered. Don't return a world-space rotation
    // here — the consumer writes this straight into `node.rotation[1]`.
    const itemRotation = side === 'front' ? 0 : Math.PI

    best = {
      wall,
      localX: clampedAlong,
      perpDistance: perpRaw,
      side,
      dirX,
      dirY,
      wallLength,
      itemRotation,
    }
  }

  return best
}
