import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  getOpeningFloorDatum,
  getWallChordFractionAt,
  getWallCurveLength,
  getWallStationAtChordFraction,
  type WallNode,
  wallSupportForNodes,
} from '@pascal-app/core'
import { resolveWallOpeningCeiling, wallOpeningCeilingOver } from '@pascal-app/core/building'

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
  if (wall?.type !== 'wall') return Number.POSITIVE_INFINITY
  const nodes = scene.nodes()
  if (!opening) return wallOpeningCeilingOver(wall, nodes, 0, getWallCurveLength(wall))
  const left = opening.position[0] - opening.width / 2
  const right = opening.position[0] + opening.width / 2
  return wallOpeningCeilingOver(wall, nodes, left, right) - openingLift(wall, opening, nodes)
}

/**
 * Width cap for a wall-hosted opening's side handle: how far the moving edge can travel from
 * `anchorS` (in direction `growSign`) before a sloped top drops below the opening's top `topY`,
 * capped at `maxLength`. Zero when the top is already below `topY` at the anchor.
 */
export function readHostWallCeilingMaxWidth(
  wallId: string | null | undefined,
  scene: WallCeilingSceneReader,
  anchorS: number,
  growSign: number,
  topY: number,
  maxLength: number,
  opening?: Pick<DoorNode, 'position' | 'width' | 'height'>,
): number {
  if (!wallId) return maxLength
  const wall = scene.get(wallId as AnyNodeId) as WallNode | undefined
  if (wall?.type !== 'wall') return maxLength
  if (getWallCurveLength(wall) < 1e-4) return 0

  const nodes = scene.nodes()
  const lift = opening ? openingLift(wall, opening, nodes) : 0
  const startHeight = resolveWallOpeningCeiling(wall, nodes, 0) - lift
  const rise = resolveWallOpeningCeiling(wall, nodes, 1) - lift - startHeight

  if (startHeight + rise * getWallChordFractionAt(wall, anchorS) < topY - 1e-4) return 0
  if (rise * growSign >= -1e-6) return maxLength

  const limitS = getWallStationAtChordFraction(wall, (topY - startHeight) / rise)
  return Math.max(0, Math.min(maxLength, (limitS - anchorS) / growSign))
}

/** How far the opening's floor datum sits above the wall's elected base. */
function openingLift(
  wall: WallNode,
  opening: Pick<DoorNode, 'position' | 'width' | 'height'>,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): number {
  return getOpeningFloorDatum(wall, opening, nodes) - wallSupportForNodes(wall, nodes).elevation
}
