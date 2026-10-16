import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '../schema'
import { getStoreyDatum } from '../services/storey-datum'
import { footprintSamples, terrainFieldOverLevel } from './grade-standing'
import { groundLevelOf } from './ground-level'
import { heightAt } from './terrain-field'
import { levelLocalToWorldXZ, SITE_DATUM_Y } from './terrain-support-query'

/** How far the ground floor's datum may stand from grade and still count as seated on it. */
export const GROUND_SEAT_TOLERANCE = 0.05

/**
 * The grade a level's floor is seated against: the flat datum on a flat site, and on shaped
 * terrain the ground's mean height over the level's floor slabs (the building's own origin when it
 * has none yet).
 */
export function gradeUnderLevel(nodes: Record<AnyNodeId, AnyNode>, level: LevelNode): number {
  const field = terrainFieldOverLevel(nodes, level)
  if (!field) return SITE_DATUM_Y
  const samples = footprintSamples(nodes, level, field)
  if (samples.length === 0) {
    const building = nodes[level.parentId as AnyNodeId]
    const placed = building?.type === 'building' ? (building as BuildingNode) : null
    const [x, z] = levelLocalToWorldXZ(placed, 0, 0)
    return heightAt(field, x, z)
  }
  let sum = 0
  for (const [x, z] of samples) sum += heightAt(field, x, z)
  return sum / samples.length
}

/** Where a building's ground level stands against grade. */
export type GroundSeat = {
  buildingId: string
  levelId: string
  /** The building names it; false when it is read off the elevations. */
  explicit: boolean
  /** World Y of the ground level's floor datum (without its slab). */
  floorElevation: number
  /** World Y of the grade under it. */
  gradeElevation: number
  /** How far the floor datum stands over grade: negative when it is sunk. */
  offset: number
  /** The floor datum is at grade, within {@link GROUND_SEAT_TOLERANCE}. */
  seated: boolean
}

/** `null` for an id that is no building, or a building with no level at or over the ground. */
export function groundSeat(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
): GroundSeat | null {
  const ground = groundLevelOf(nodes, buildingId)
  const datum = ground ? getStoreyDatum(nodes, ground.level.id) : null
  if (!(ground && datum)) return null
  const gradeElevation = gradeUnderLevel(nodes, ground.level)
  const offset = datum.floorElevation - gradeElevation
  return {
    buildingId,
    levelId: ground.level.id,
    explicit: ground.explicit,
    floorElevation: datum.floorElevation,
    gradeElevation,
    offset,
    seated: Math.abs(offset) <= GROUND_SEAT_TOLERANCE,
  }
}
