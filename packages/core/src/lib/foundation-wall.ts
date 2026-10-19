import { type AnyNode, type AnyNodeId, type LevelNode, WallNode } from '../schema'
import type { Assembly } from '../schema/assembly'
import { assemblyThickness } from '../systems/wall/wall-assembly'
import { enclosedWallIds } from './exterior-wall-loops'
import {
  type FoundationConstruction,
  type FoundationReading,
  foundationReadingOfLevel,
} from './foundation-construction'
import { levelGradeStanding } from './grade-standing'
import { levelUnderNamedGround } from './ground-level'

/**
 * Whether a wall against the ground on `levelId` is a foundation wall: the level is below grade everywhere, or the
 * building's ground line puts it under the ground floor (a basement the terrain leaves part of out
 * of the ground). A floor a hillside only half buries, with nothing named under the line, is a floor.
 */
export function levelHoldsFoundationWalls(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): boolean {
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return false
  const standing = levelGradeStanding(nodes, levelId)
  if (standing === 'below-grade') return true
  return (
    standing === 'partly-below-grade' && levelUnderNamedGround(nodes, level as LevelNode) === true
  )
}

/** What the agent is told of the rule: the foundation wall of this building's construction, and what is not one. */
export function foundationWallRule(reading: FoundationReading): string {
  return `a wall against the ground on a level below grade is a foundation wall (${reading.construction.description}); a partition is an ordinary wall; the construction follows the region and style (${reading.basis})`
}

/** The construction a foundation wall is born with. */
export function foundationWallConstruction(construction: FoundationConstruction): {
  assembly: Assembly
  thickness: number
} {
  return {
    assembly: structuredClone(construction.assembly),
    // Micrometres: the stored thickness is a clean 0.241, not the float noise of 0.203 + 0.038.
    thickness: Math.round(assemblyThickness(construction.assembly) * 1e6) / 1e6,
  }
}

/**
 * The `candidates` (walls among `levelWalls`, the level's walls with them in) that hold the earth
 * back: the level holds foundation walls and no closed circuit of walls encloses them. A partition
 * inside the outline is not one, nor is a ring of walls inside it (a courtyard walled on every
 * side: a room open to the sky, as the structure kernel reads it, facing air, not earth). A wall
 * outside the outline (a well against it) is. A wall with no closed circuit around it yet (the
 * first walls of a basement, an open run) counts as the outline in the making, so a basement drawn
 * wall by wall is foundation all the way round. The outline is the one `genericFoundation` draws
 * under.
 */
export function wallsAgainstGround(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
  levelWalls: WallNode[],
  candidates: WallNode[],
): WallNode[] {
  if (!levelHoldsFoundationWalls(nodes, levelId)) return []
  const enclosed = enclosedWallIds(levelWalls.filter((wall) => wall.visible !== false))
  return candidates.filter((wall) => !enclosed.has(wall.id))
}

/**
 * The walls just drawn on `levelId` (`inserted`, among `levelWalls` with them in) as the level's
 * default builds them: the walls against the ground take the foundation construction of the
 * building's region (CMU or cast concrete), a
 * partition keeps the ordinary wall. A caller who gave a thickness or an assembly (`given`) keeps
 * it; existing walls are never rewritten.
 */
export function withFoundationConstruction(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
  levelWalls: WallNode[],
  inserted: WallNode[],
  given: Partial<WallNode>,
): WallNode[] {
  if (given.assembly !== undefined || given.thickness !== undefined) return inserted
  const against = new Set(
    wallsAgainstGround(nodes, levelId, levelWalls, inserted).map((wall) => wall.id),
  )
  if (against.size === 0) return inserted
  const { construction } = foundationReadingOfLevel(nodes, levelId)
  return inserted.map((wall) =>
    against.has(wall.id)
      ? WallNode.parse({ ...wall, ...foundationWallConstruction(construction) })
      : wall,
  )
}
