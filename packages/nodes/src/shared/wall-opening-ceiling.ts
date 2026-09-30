import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  getOpeningFloorDatum,
  type WallNode,
  wallSupportForNodes,
} from '@pascal-app/core'
import { resolveWallOpeningCeiling } from '@pascal-app/core/building'

/**
 * Structural subset of `SceneApi` the opening-cap readers need — matches
 * both handle-descriptor callbacks (which receive the full SceneApi) and
 * tools holding a nodes snapshot.
 */
export type WallCeilingSceneReader = {
  get: (id: AnyNodeId) => unknown
  nodes: () => Readonly<Record<AnyNodeId, AnyNode>>
}

/** The ceiling an opening's top edge must stay under: the shared rule in core. */
export { resolveWallOpeningCeiling }

/**
 * Height cap for a wall-hosted opening's resize handles. Infinity only when
 * the opening is unhosted (no wallId, or the wall is gone) — roof-hosted
 * openings clamp elsewhere.
 */
export function readHostWallCeiling(
  wallId: string | null | undefined,
  scene: WallCeilingSceneReader,
  opening?: Pick<DoorNode, 'position' | 'width' | 'height'>,
): number {
  if (!wallId) return Number.POSITIVE_INFINITY
  const wall = scene.get(wallId as AnyNodeId) as WallNode | undefined
  if (!wall) return Number.POSITIVE_INFINITY
  const nodes = scene.nodes()
  const lift = opening
    ? getOpeningFloorDatum(wall, opening, nodes) - wallSupportForNodes(wall, nodes).elevation
    : 0
  return resolveWallOpeningCeiling(wall, nodes) - lift
}
