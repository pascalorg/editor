import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '../schema'
import { getStoreyDatum } from '../services/storey-datum'
import {
  FOUNDATION_CONSTRUCTIONS,
  type FoundationReading,
  foundationReadingOf,
} from './foundation-construction'
import { footprintSamples, terrainFieldOverLevel } from './grade-standing'
import { groundLevelOf } from './ground-level'
import { heightAt } from './terrain-field'
import { levelLocalToWorldXZ, SITE_DATUM_Y } from './terrain-support-query'

/** How far the ground floor's datum may stand from its seat and still count as seated on it. */
export const GROUND_SEAT_TOLERANCE = 0.05

/**
 * Where "Set as ground floor" and `set_ground_level` stand the ground floor over finished grade
 * on the generic (block) foundation: the top of the foundation, where the wood framing starts, 8
 * in (0.203 m) above the ground. IRC R317.1 keeps wood framing resting on a foundation wall at
 * least 8 in from exposed ground. A building's region and style can choose another construction
 * and its own seat (`GroundSeat.aboveGrade`, `FOUNDATION_CONSTRUCTIONS`).
 */
export const GROUND_FLOOR_ABOVE_GRADE = FOUNDATION_CONSTRUCTIONS.cmu.seatAboveGrade

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
  /** How far the building's foundation construction stands the ground floor over grade, metres. */
  aboveGrade: number
  /** The construction, the region and style it was read from. */
  foundation: FoundationReading
  /**
   * The floor datum stands between grade and the foundation's top (`aboveGrade`, or the block's
   * 8 in where that is higher), within {@link GROUND_SEAT_TOLERANCE}: what a scene seated before
   * the 8 in rule, one seated by it and one seated by its own region's construction all satisfy,
   * so a check has nothing to say about any of them.
   */
  seated: boolean
  /** The floor datum stands at `aboveGrade` over grade, within the tolerance. */
  atFoundationTop: boolean
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
  const foundation = foundationReadingOf(nodes, buildingId)
  const aboveGrade = foundation.construction.seatAboveGrade
  return {
    buildingId,
    levelId: ground.level.id,
    explicit: ground.explicit,
    floorElevation: datum.floorElevation,
    gradeElevation,
    offset,
    aboveGrade,
    foundation,
    seated:
      offset >= -GROUND_SEAT_TOLERANCE &&
      offset <= Math.max(aboveGrade, GROUND_FLOOR_ABOVE_GRADE) + GROUND_SEAT_TOLERANCE,
    atFoundationTop: Math.abs(offset - aboveGrade) <= GROUND_SEAT_TOLERANCE,
  }
}
