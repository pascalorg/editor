import type { AnyNode, AnyNodeId } from '../schema'
import {
  BELOW_GRADE_TOLERANCE,
  getLevelElevations,
  levelLowestFloorWorldY,
  levelPlaneWorldY,
  levelPlateUndersideWorldY,
} from '../services/storey'
import {
  floorBuriedOnFlatSite,
  type LevelGradeStanding,
  levelGradeStanding,
  terrainFieldOverLevel,
} from './grade-standing'
import { groundOverPart } from './ground-over-part'
import { difference, intersection, type MultiPolygon, union } from './polygon-boolean'
import { type Point2D, unionPolygons } from './polygon-union'
import { isSiteFlatwork } from './site-flatwork'
import { levelLocalToWorldXZ } from './terrain-support-query'

type LevelPlates = {
  buildingId: string | null | undefined
  index: number
  visible: boolean
  standing: LevelGradeStanding
  /** Every floor slab of the level (a recessed one is a pit, not a floor), placed on the site. */
  plates: Point2D[][]
  /**
   * The part of those below grade: the whole plates of a fully buried level; for a floor only
   * partly below grade (a walk-out on a hillside) the part the ground stands over, not its whole
   * plate, the valley side staying closed; nothing at grade.
   */
  buried: Point2D[][]
}

// Identity-keyed memo (`nodes` is an immutable store slice): the standing of every level is worked
// out once per scene state, however many sets the callers ask for (the hole and the ring ask for
// the shown stack, the materials for whether any level is buried at all, the ground for what the
// house covers).
const platesMemo = new WeakMap<object, LevelPlates[]>()

function levelPlates(nodes: Record<AnyNodeId, AnyNode>): LevelPlates[] {
  const hit = platesMemo.get(nodes)
  if (hit) return hit
  const elevations = getLevelElevations(nodes)
  const levels: LevelPlates[] = []
  for (const level of Object.values(nodes)) {
    if (level.type !== 'level') continue
    const standing = levelGradeStanding(nodes, level.id)
    const buildingId = elevations.get(level.id)?.buildingId
    const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
    const placed = building?.type === 'building' ? building : null
    // A partly buried level is cut slab by slab, each over the ground that stands above its own
    // floor: a split level's sunken room is buried by ground the raised part's top is above.
    const plane = standing === 'partly-below-grade' ? levelPlaneWorldY(nodes, level.id) : null
    const field = plane === null ? null : terrainFieldOverLevel(nodes, level)
    const plates: Point2D[][] = []
    const buried: Point2D[][] = []
    for (const childId of level.children) {
      const slab = nodes[childId as AnyNodeId]
      if (slab?.type !== 'slab' || slab.recessed === true || isSiteFlatwork(slab)) continue
      const plate = slab.polygon.map(([x, z]) => levelLocalToWorldXZ(placed, x, z))
      plates.push(plate)
      if (standing === 'at-grade') continue
      if (field && plane !== null)
        buried.push(...groundOverPart(plate, field, plane + slab.elevation + BELOW_GRADE_TOLERANCE))
      else if (plane !== null) {
        // A flat site, a level of floors at different heights: a floor is buried or it is not.
        if (floorBuriedOnFlatSite(plane + slab.elevation)) buried.push(plate)
      } else buried.push(plate)
    }
    levels.push({
      buildingId,
      index: level.level,
      visible: level.visible !== false,
      standing,
      plates,
      buried,
    })
  }
  platesMemo.set(nodes, levels)
  return levels
}

/**
 * Where the ground meets the levels below grade, in the site's plan: each such level's floor slabs
 * placed where its building stands and joined into outlines, the levels' together as one set (a
 * deeper level wider than the one over it, or under part of it, gives one outline, not overlapping
 * ones). The 3D view cuts its hole in the ground and draws its grade ring along them while the
 * ground is veiled. An automatic floor follows the walls' centrelines, so an outline runs half a
 * wall inside the outer faces. A level only partly below grade (a walk-out on a hillside) gives
 * the part of its floor the ground stands over by more than {@link BELOW_GRADE_TOLERANCE}, the
 * edge following the slope; fully buried levels give their whole floor.
 *
 * With `shownLevelId`, only what the level display needs open over that level: the level itself and
 * the levels between it and grade (the ones the display hides above it: `level` index at or over
 * its own, in every building, as the display decides from the index alone), the levels the author
 * has hidden left out. The levels deeper than the one shown stay under the ground. Without it,
 * every level below grade.
 */
export function belowGradeFootprints(
  nodes: Record<AnyNodeId, AnyNode>,
  shownLevelId?: string | null,
): Point2D[][] {
  const shown = shownLevelId ? nodes[shownLevelId as AnyNodeId] : undefined
  const fromIndex = shown?.type === 'level' ? shown.level : Number.NEGATIVE_INFINITY
  const floors: Point2D[][] = []
  for (const level of levelPlates(nodes)) {
    if (level.standing === 'at-grade') continue
    if (level.index < fromIndex || (shown && !level.visible)) continue
    floors.push(...level.buried)
  }
  return unionPolygons(floors)
}

const coveredMemo = new WeakMap<object, Point2D[][]>()

/**
 * The part of the ground that lies over the house itself: what is below grade under the footprint
 * of the levels above it, in the site's plan. The house covers it, so the ground can stand open
 * there whatever level is shown: from outside nothing changes (the storeys are over it), and the
 * stairwells and floor openings of the stacked view, and the walkthrough on a stair, meet the
 * basement and not a sheet of ground across it. A below-grade level reaching out under the garden
 * gives only the part the house stands over; the rest stays closed, no pit in the garden.
 *
 * Per building, a level below grade is covered by the floor slabs of the visible levels over it
 * (`level` index above its own) that are not themselves fully buried: the ones at grade, and the
 * part of a floor only partly below grade that stands out of the hill. A hidden level covers
 * nothing and is covered by nothing. Of a level only partly below grade, only the part the ground
 * stands over is open. A slab's own openings do not count: the stairwell is where the ground
 * should be open.
 *
 * Outlines with an inner outline (a courtyard the house wraps round) are left out: the ground
 * cannot be cut around an island of itself, and closed is the safe side.
 */
export function coveredBelowGradeFootprints(nodes: Record<AnyNodeId, AnyNode>): Point2D[][] {
  const hit = coveredMemo.get(nodes)
  if (hit) return hit
  const levels = levelPlates(nodes)
  const covered: MultiPolygon[] = []
  for (const level of levels) {
    if (level.standing === 'at-grade' || !level.visible || level.buried.length === 0) continue
    if (!level.buildingId) continue
    const over: MultiPolygon[] = []
    for (const upper of levels) {
      if (
        upper === level ||
        upper.buildingId !== level.buildingId ||
        !upper.visible ||
        upper.index <= level.index ||
        upper.standing === 'below-grade' ||
        upper.plates.length === 0
      )
        continue
      const plates = union(upper.plates)
      over.push(upper.standing === 'at-grade' ? plates : difference(plates, union(upper.buried)))
    }
    if (over.length === 0) continue
    covered.push(intersection(union(level.buried), union(over)))
  }
  const rings = union(covered.flat().map((polygon) => [polygon]))
    .filter((polygon) => polygon.holes.length === 0)
    .map((polygon) => polygon.outer)
  coveredMemo.set(nodes, rings)
  return rings
}

/**
 * How deep the pit under the hole goes: the world Y of the top of the lowest floor of the level
 * shown (the sunken room of a split level, not its raised part), the deepest of the levels the hole
 * is cut over (`belowGradeFootprints` with the same id). `null` when no level is shown or it is
 * not below grade.
 */
export function belowGradeFloorY(
  nodes: Record<AnyNodeId, AnyNode>,
  shownLevelId?: string | null,
): number | null {
  if (!shownLevelId || levelGradeStanding(nodes, shownLevelId) === 'at-grade') return null
  return levelLowestFloorWorldY(nodes, shownLevelId)
}

/** How far under the top of the floor plate the pit hangs its own floor: the default plate's thickness. */
export const GROUND_PIT_FLOOR_DROP = 0.05
/**
 * How far the pit's floor keeps from the plane of the plate's underside. The foundation under the
 * level tops out on that plane (`genericFoundation`), and seen through the hole it has to stand
 * on the pit's floor, not share its plane: two faces on one plane flicker. 2 cm is what a 24-bit
 * depth buffer with the viewer's 0.3 m near plane tells apart out to about 300 m, further than
 * the hole is ever looked into from.
 */
export const GROUND_PIT_PLATE_CLEARANCE = 0.02

/**
 * The world Y the pit under the hole draws its dark floor at, over the level shown: under the top
 * of its lowest floor (`belowGradeFloorY`) by {@link GROUND_PIT_FLOOR_DROP}, which for the default
 * plate is exactly its underside, where the footing and the walls on it stop. When that lands
 * within {@link GROUND_PIT_PLATE_CLEARANCE} of the underside (the default plate, a thinner one, a
 * plate whose top is the level plane) the floor lies that far under it instead; anywhere else it
 * keeps to its place. `null` when `belowGradeFloorY` is.
 */
export function groundPitFloorY(
  nodes: Record<AnyNodeId, AnyNode>,
  shownLevelId?: string | null,
): number | null {
  const floorY = belowGradeFloorY(nodes, shownLevelId)
  const underside = shownLevelId ? levelPlateUndersideWorldY(nodes, shownLevelId) : null
  if (floorY === null || underside === null) return null
  const hung = floorY - GROUND_PIT_FLOOR_DROP
  return Math.abs(hung - underside) < GROUND_PIT_PLATE_CLEARANCE
    ? underside - GROUND_PIT_PLATE_CLEARANCE
    : hung
}
