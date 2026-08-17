import {
  type AnyNode,
  type AnyNodeId,
  getWallEffectiveHeightForNodes,
  type WallNode,
} from '@pascal-app/core'

/**
 * Structural subset of `SceneApi` the opening-cap readers need — matches
 * both handle-descriptor callbacks (which receive the full SceneApi) and
 * tools holding a nodes snapshot.
 */
export type WallCeilingSceneReader = {
  get: (id: AnyNodeId) => unknown
  nodes: () => Readonly<Record<AnyNodeId, AnyNode>>
}

/**
 * Available wall-local Y span for an opening hosted on `wall`: the wall's
 * resolved top (storey plane for plane-bound walls, stored height for
 * explicit ones) minus the wall's elected slab base. Wall-local Y = 0 sits
 * at the elected base (where the viewer positions the wall mesh), so this
 * is the ceiling an opening's top edge must stay under.
 *
 * Uses the same slab election as the viewer's WallSystem
 * (`spatialGridManager.getSlabSupportForWall`) so the cap agrees with the
 * rendered wall; headless callers with an empty spatial grid elect base 0
 * and fall back to the full storey height.
 */
export function resolveWallOpeningCeiling(
  wall: WallNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  t?: number,
): number {
  return getWallEffectiveHeightForNodes(wall, nodes as Record<string, AnyNode>, t)
}

/**
 * Height cap for a wall-hosted opening's resize handles. Infinity only when
 * the opening is unhosted (no wallId, or the wall is gone) — roof-hosted
 * openings clamp elsewhere.
 */
export function readHostWallCeiling(
  wallId: string | null | undefined,
  scene: WallCeilingSceneReader,
  positionS?: number,
): number {
  if (!wallId) return Number.POSITIVE_INFINITY
  const wall = scene.get(wallId as AnyNodeId) as WallNode | undefined
  if (!wall) return Number.POSITIVE_INFINITY
  if (positionS !== undefined) {
    // When positionS is given, convert it to a parametric t in the chord frame
    // (0 → wall start, 1 → wall end) to match the slope evaluation in
    // applyWallEndHeightSlope (WallSystem).
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    if (length > 1e-4) {
      const localT = Math.max(0, Math.min(1, positionS / length))
      return Math.max(0.01, resolveWallOpeningCeiling(wall, scene.nodes(), localT))
    }
  }
  return Math.max(0.01, resolveWallOpeningCeiling(wall, scene.nodes()))
}

export function readHostWallCeilingMaxWidth(
  wallId: string | null | undefined,
  scene: WallCeilingSceneReader,
  anchorS: number,
  growSign: number,
  topY: number,
  maxLength: number,
): number {
  if (!wallId) return maxLength
  const wall = scene.get(wallId as AnyNodeId) as WallNode | undefined
  if (!wall) return maxLength

  const anchorCeiling = readHostWallCeiling(wallId, scene, anchorS)
  if (anchorCeiling < topY - 1e-4) {
    return 0
  }

  // Fast check: if the extreme end is also valid, the entire linear span fits
  const endS = anchorS + growSign * maxLength
  if (readHostWallCeiling(wallId, scene, endS) >= topY - 1e-4) {
    return maxLength
  }

  // Binary search for the intersection
  let low = 0
  let high = maxLength
  for (let i = 0; i < 15; i++) {
    const mid = (low + high) / 2
    const testS = anchorS + growSign * mid
    if (readHostWallCeiling(wallId, scene, testS) >= topY - 1e-4) {
      low = mid
    } else {
      high = mid
    }
  }
  return low
}
