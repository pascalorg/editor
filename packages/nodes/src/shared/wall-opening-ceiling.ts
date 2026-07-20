import {
  type AnyNode,
  type AnyNodeId,
  getWallPlaneTop,
  resolveWallEffectiveHeight,
  spatialGridManager,
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
): number {
  const levelId = wall.parentId ?? 'default'
  const support = spatialGridManager.getSlabSupportForWall(
    levelId,
    wall.start,
    wall.end,
    wall.curveOffset ?? 0,
    wall.thickness,
    wall.supportSlabId,
  )
  // Covering-clamped plane: openings cap under a flush/thick slab from the
  // level above, matching the shortened wall body.
  const planeTop = getWallPlaneTop(wall, levelId, nodes as Record<AnyNodeId, AnyNode>)
  return resolveWallEffectiveHeight(wall, planeTop, support.elevation)
}

/**
 * Height cap for a wall-hosted opening's resize handles. Infinity only when
 * the opening is unhosted (no wallId, or the wall is gone) — roof-hosted
 * openings clamp elsewhere.
 */
export function readHostWallCeiling(
  wallId: string | null | undefined,
  scene: WallCeilingSceneReader,
): number {
  if (!wallId) return Number.POSITIVE_INFINITY
  const wall = scene.get(wallId as AnyNodeId) as WallNode | undefined
  if (!wall) return Number.POSITIVE_INFINITY
  return resolveWallOpeningCeiling(wall, scene.nodes())
}
