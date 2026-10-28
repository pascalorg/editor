import type { AnyNode, AnyNodeId, BuildingNode, LevelNode } from '../schema'
import { getStoreyDatum } from '../services/storey-datum'
import {
  FOUNDATION_CONSTRUCTIONS,
  type FoundationReading,
  foundationReadingOf,
} from './foundation-construction'
import { designedFoundationReport } from './generic-foundation'
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

/**
 * What seats the ground floor: the building's foundation construction (`aboveGrade` over the grade
 * under the floor), or its designed foundation's own rule over the highest grade along it: a
 * slab's, a raised floor's or a pile-borne floor's top `ffAboveGradeIn`, a basement's walls' top
 * `basementTopAboveGradeIn`.
 */
export type GroundSeatRule = 'construction' | 'slab' | 'raised' | 'piles' | 'basement'

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
  /**
   * The `offset` at which the ground floor is seated, metres: as far as the building's foundation
   * construction stands it over grade, or where its designed foundation's rule holds (`rule`).
   */
  aboveGrade: number
  /** The construction, the region and style it was read from. */
  foundation: FoundationReading
  rule: GroundSeatRule
  /** What the rule asks, inches: the construction's seat, or the record's height over grade. */
  askedIn: number
  /**
   * The floor datum stands between grade and the foundation's top (`aboveGrade`, or the block's
   * 8 in where that is higher), within {@link GROUND_SEAT_TOLERANCE}: what a scene seated before
   * the 8 in rule, one seated by it and one seated by its own region's construction all satisfy,
   * so a check has nothing to say about any of them. On a designed foundation, what its rule
   * measures stands between the highest grade and its seat.
   */
  seated: boolean
  /** The ground floor stands at its seat (`aboveGrade`), within the tolerance. */
  atFoundationTop: boolean
}

/**
 * `null` for an id that is no building, or a building with no level at or over the ground. Where
 * the building's designed foundation stands under its ground floor (`designedFoundationReport`),
 * the seat is that foundation's own (`designedSeatOf`); else the construction's.
 */
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
  const base = {
    buildingId,
    levelId: ground.level.id,
    explicit: ground.explicit,
    floorElevation: datum.floorElevation,
    gradeElevation,
    offset,
    foundation,
  }
  const designed = designedSeatOf(nodes, buildingId, ground.level.id)
  if (designed) {
    // The offset at which the designed seat holds, so a move by `aboveGrade - offset` reaches it.
    const miss = designed.over - designed.asked
    return {
      ...base,
      aboveGrade: offset - miss,
      rule: designed.rule,
      askedIn: designed.asked / INCH,
      seated: designed.over >= -GROUND_SEAT_TOLERANCE && miss <= GROUND_SEAT_TOLERANCE,
      atFoundationTop: Math.abs(miss) <= GROUND_SEAT_TOLERANCE,
    }
  }
  const aboveGrade = foundation.construction.seatAboveGrade
  return {
    ...base,
    aboveGrade,
    rule: 'construction',
    askedIn: aboveGrade / INCH,
    seated:
      offset >= -GROUND_SEAT_TOLERANCE &&
      offset <= Math.max(aboveGrade, GROUND_FLOOR_ABOVE_GRADE) + GROUND_SEAT_TOLERANCE,
    atFoundationTop: Math.abs(offset - aboveGrade) <= GROUND_SEAT_TOLERANCE,
  }
}

const INCH = 0.0254

/**
 * How the building's designed foundation seats its ground floor, where one stands under it: what
 * it measures over the highest grade along the foundation (`over`: a slab's, a raised floor's or a
 * pile-borne floor's top; over a basement, the basement walls' top) and what the record asks of it
 * (`asked`: `ffAboveGradeIn`, or `basementTopAboveGradeIn`), metres. `null` where none is designed,
 * or it stands under another level than the ground floor.
 */
function designedSeatOf(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
  groundLevelId: string,
): { rule: Exclude<GroundSeatRule, 'construction'>; over: number; asked: number } | null {
  const report = designedFoundationReport(nodes, buildingId)
  if (!report) return null
  const { foundation } = report
  if (report.basement)
    return report.basement.groundLevelId === groundLevelId
      ? {
          rule: 'basement',
          over: report.basement.wallTopY - report.highestGradeY,
          asked: foundation.basementTopAboveGradeIn * INCH,
        }
      : null
  if (report.levelId !== groundLevelId) return null
  return {
    rule: foundation.support === 'piles' ? 'piles' : foundation.type,
    over: report.floorTopY - report.highestGradeY,
    asked: foundation.ffAboveGradeIn * INCH,
  }
}
