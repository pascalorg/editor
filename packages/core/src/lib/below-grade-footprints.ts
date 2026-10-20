import type { AnyNode, AnyNodeId } from '../schema'
import {
  BELOW_GRADE_TOLERANCE,
  getLevelElevations,
  levelFloorWorldY,
  levelPlateUndersideWorldY,
} from '../services/storey'
import { levelGradeStanding, terrainFieldOverLevel } from './grade-standing'
import { groundOverPart } from './ground-over-part'
import { type Point2D, unionPolygons } from './polygon-union'
import { levelLocalToWorldXZ } from './terrain-support-query'

type BuriedLevel = { index: number; visible: boolean; floors: Point2D[][] }

// Identity-keyed memo (`nodes` is an immutable store slice): the standing of every level is worked
// out once per scene state, however many sets the callers ask for (the hole and the ring ask for
// the shown stack, the materials for whether any level is buried at all).
const buriedMemo = new WeakMap<object, BuriedLevel[]>()

function buriedLevels(nodes: Record<AnyNodeId, AnyNode>): BuriedLevel[] {
  const hit = buriedMemo.get(nodes)
  if (hit) return hit
  const elevations = getLevelElevations(nodes)
  const buried: BuriedLevel[] = []
  for (const level of Object.values(nodes)) {
    if (level.type !== 'level') continue
    const standing = levelGradeStanding(nodes, level.id)
    if (standing === 'at-grade') continue
    const buildingId = elevations.get(level.id)?.buildingId
    const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
    const placed = building?.type === 'building' ? building : null
    // A floor only partly below grade (a walk-out on a hillside) is opened over the part the
    // ground stands over, not its whole plate: on the valley side the ground stays closed.
    const floorY = standing === 'partly-below-grade' ? levelFloorWorldY(nodes, level.id) : null
    const field = floorY === null ? null : terrainFieldOverLevel(nodes, level)
    const floors: Point2D[][] = []
    for (const childId of level.children) {
      const slab = nodes[childId as AnyNodeId]
      if (slab?.type !== 'slab' || slab.recessed === true) continue
      const plate = slab.polygon.map(([x, z]) => levelLocalToWorldXZ(placed, x, z))
      if (field && floorY !== null)
        floors.push(...groundOverPart(plate, field, floorY + BELOW_GRADE_TOLERANCE))
      else floors.push(plate)
    }
    buried.push({ index: level.level, visible: level.visible !== false, floors })
  }
  buriedMemo.set(nodes, buried)
  return buried
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
  for (const level of buriedLevels(nodes)) {
    if (level.index < fromIndex || (shown && !level.visible)) continue
    floors.push(...level.floors)
  }
  return unionPolygons(floors)
}

/**
 * How deep the pit under the hole goes: the world Y of the floor of the level shown, the deepest
 * of the levels the hole is cut over (`belowGradeFootprints` with the same id). `null` when no
 * level is shown or it is not below grade.
 */
export function belowGradeFloorY(
  nodes: Record<AnyNodeId, AnyNode>,
  shownLevelId?: string | null,
): number | null {
  if (!shownLevelId || levelGradeStanding(nodes, shownLevelId) === 'at-grade') return null
  return levelFloorWorldY(nodes, shownLevelId)
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
 * of its floor (`belowGradeFloorY`) by {@link GROUND_PIT_FLOOR_DROP}, which for the default plate
 * is exactly its underside, where the footing and the walls on it stop. When that lands within
 * {@link GROUND_PIT_PLATE_CLEARANCE} of the underside (the default plate, a thinner one, a plate
 * whose top is the level plane) the floor lies that far under it instead; anywhere else it keeps
 * to its place. `null` when `belowGradeFloorY` is.
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
