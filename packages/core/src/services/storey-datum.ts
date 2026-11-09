import { SITE_DATUM_Y } from '../lib/terrain-support-query'
import type { AnyNode, AnyNodeId } from '../schema'
import { getLevelElevations, getStoredLevelHeight } from './storey'

export type StoreyDatum = {
  /** World/site Y of the level plane, excluding standing slabs and sampled terrain. */
  floorElevation: number
  /** The same level plane in its building's coordinates. */
  floorElevationBuildingLocal: number
  /** Stored floor-to-floor height, with the existing legacy fallback. */
  floorToFloorHeight: number
}

/** The existing resolved storey plane, not the walking surface elected from its slabs. */
export function getStoreyDatum(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
): StoreyDatum | null {
  const level = nodes[levelId]
  if (level?.type !== 'level') return null
  const elevation = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(levelId)
  if (!elevation) return null
  const building = elevation.buildingId ? nodes[elevation.buildingId] : undefined
  const buildingY = building?.type === 'building' ? (building.position?.[1] ?? 0) : 0
  return {
    floorElevation: SITE_DATUM_Y + buildingY + elevation.baseY,
    floorElevationBuildingLocal: elevation.baseY,
    floorToFloorHeight: getStoredLevelHeight(level),
  }
}
