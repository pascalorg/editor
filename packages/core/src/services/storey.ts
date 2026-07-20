import type { BuildingNode, LevelNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { DEFAULT_LEVEL_HEIGHT } from './level-height'

/**
 * Stored storey height in meters (floor-to-floor). Falls back to
 * {@link DEFAULT_LEVEL_HEIGHT} for unmigrated legacy levels whose `height`
 * field is absent.
 */
export function getStoredLevelHeight(level: Pick<LevelNode, 'height'>): number {
  return level.height ?? DEFAULT_LEVEL_HEIGHT
}

export type LevelElevation = {
  /** World Y of the level's floor: prefix sum of the storey heights below it. */
  baseY: number
  /** Stored storey height of this level (fallback applied). */
  height: number
  buildingId: string | null
  ordinal: number
}

/**
 * Resolves the owning building: explicit `parentId` pointing at a building
 * wins; legacy levels that only appear in a building's `children` array
 * resolve through that membership.
 */
function resolveLevelBuildingId(
  levelId: LevelNode['id'],
  parentId: string | null,
  buildings: readonly BuildingNode[],
): string | null {
  const directParent = parentId ? buildings.find((building) => building.id === parentId) : undefined
  if (directParent) return directParent.id

  return buildings.find((building) => building.children.includes(levelId))?.id ?? null
}

/**
 * Per-building stacked elevations from stored storey heights: levels are
 * sorted by ordinal ascending within each building, the lowest level's floor
 * sits at 0, and each next floor sits on top of the previous storey height.
 * Levels with no resolvable building share one legacy stack from 0.
 *
 * Pure — operates on the serialized nodes record only.
 */
export function getLevelElevations(nodes: Record<AnyNodeId, AnyNode>): Map<string, LevelElevation> {
  const buildings = Object.values(nodes).filter(
    (node): node is BuildingNode => node?.type === 'building',
  )

  const entries: Array<{ levelId: string } & LevelElevation> = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'level') continue
    const level = node as LevelNode
    entries.push({
      levelId: level.id,
      baseY: 0,
      height: getStoredLevelHeight(level),
      buildingId: resolveLevelBuildingId(level.id, level.parentId, buildings),
      ordinal: level.level,
    })
  }

  const elevations = new Map<string, LevelElevation>()
  const cumulativeYByBuilding = new Map<string | null, number>()
  for (const entry of entries.sort((a, b) => a.ordinal - b.ordinal)) {
    const baseY = cumulativeYByBuilding.get(entry.buildingId) ?? 0
    elevations.set(entry.levelId, {
      baseY,
      height: entry.height,
      buildingId: entry.buildingId,
      ordinal: entry.ordinal,
    })
    cumulativeYByBuilding.set(entry.buildingId, baseY + entry.height)
  }

  return elevations
}
