import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '../schema'
import { getLevelElevations, isLevelBelowGrade } from '../services/storey'

/** The level a building stands at grade on, and whether the building says so or it is read off. */
export type GroundLevel = { level: LevelNode; explicit: boolean }

const groundMemo = new WeakMap<object, Map<string, GroundLevel | null>>()

/**
 * The ground line of `buildingId`'s stack: the level standing at grade, the levels with a lower
 * floor index below it. The building names it (`groundLevelId`, written by "Set as ground floor");
 * until it does, or when the level named is gone, it is the lowest level whose floor is not under
 * the flat datum, the reading every scene had before the line existed. `null` for an id that is
 * no building, or a building with every floor under the ground.
 */
export function groundLevelOf(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
): GroundLevel | null {
  let byBuilding = groundMemo.get(nodes)
  if (!byBuilding) {
    byBuilding = new Map()
    groundMemo.set(nodes, byBuilding)
  }
  if (byBuilding.has(buildingId)) return byBuilding.get(buildingId) ?? null
  const found = resolveGroundLevel(nodes, buildingId)
  byBuilding.set(buildingId, found)
  return found
}

function resolveGroundLevel(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
): GroundLevel | null {
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building') return null
  const elevations = getLevelElevations(nodes)
  const levels = Object.values(nodes)
    .filter(
      (node): node is LevelNode =>
        node.type === 'level' && elevations.get(node.id)?.buildingId === buildingId,
    )
    .sort((a, b) => a.level - b.level)
  const named = (building as BuildingNode).groundLevelId
  const explicit = named ? levels.find((level) => level.id === named) : undefined
  if (explicit) return { level: explicit, explicit: true }
  const derived = levels.find((level) => !isLevelBelowGrade(nodes, level.id))
  return derived ? { level: derived, explicit: false } : null
}

/**
 * Whether a building that names its ground level puts `level` under it: a lower floor index. `null`
 * when the line is only read off the elevations (nothing named), so a caller falls back to them.
 */
export function levelUnderNamedGround(
  nodes: Record<AnyNodeId, AnyNode>,
  level: LevelNode,
): boolean | null {
  const buildingId = getLevelElevations(nodes).get(level.id)?.buildingId
  if (!buildingId) return null
  const ground = groundLevelOf(nodes, buildingId)
  if (!ground?.explicit) return null
  return level.level < ground.level.level
}
