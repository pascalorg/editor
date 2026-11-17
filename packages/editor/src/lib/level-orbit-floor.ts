import { type AnyNode, type AnyNodeId, getLevelElevations } from '@pascal-app/core'
import { getLevelPresentationY } from '@pascal-app/viewer'

type LevelMode = Parameters<typeof getLevelPresentationY>[2]

/**
 * The world height of a level's floor plane as the editor presents it: where the level sits in
 * its building (`getLevelPresentationY`: stacked, or lifted apart when exploded) plus the height
 * the building itself stands at on the site. A house seated on a slope does not stand at the
 * datum, and the orbit rests on its floor, not on the datum under or over it. Analytic, as
 * `getLevelPresentationY` is. 0 for no level.
 */
export function levelOrbitFloorY(
  levelId: string | null | undefined,
  nodes: Record<AnyNodeId, AnyNode>,
  levelMode: LevelMode,
): number {
  if (!levelId) return 0
  const buildingId = getLevelElevations(nodes).get(levelId)?.buildingId
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  const seatY = building?.type === 'building' ? building.position[1] : 0
  return seatY + getLevelPresentationY(levelId, nodes, levelMode)
}
