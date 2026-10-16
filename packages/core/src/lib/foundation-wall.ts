import { type AnyNode, type AnyNodeId, type LevelNode, WallNode } from '../schema'
import type { Assembly } from '../schema/assembly'
import { assemblyThickness } from '../systems/wall/wall-assembly'
import { enclosedWallIds } from './exterior-wall-loops'
import { levelGradeStanding } from './grade-standing'
import { levelUnderNamedGround } from './ground-level'

/** An 8 in CMU foundation wall (0.203 m): the block stands the 8 in over finished grade. */
export const FOUNDATION_BLOCK_THICKNESS = 0.203
/** A 2x4 pressure-treated furring strip laid flat, 1.5 in (0.038 m), on the inside of the block. */
export const FOUNDATION_FURRING_THICKNESS = 0.038

/** The wall a person gets for a new wall below grade, as the stack the wall stores. */
export const FOUNDATION_WALL_ASSEMBLY: Assembly = {
  layers: [
    {
      id: 'block',
      role: 'structure',
      core: true,
      material: 'cmu',
      thickness: FOUNDATION_BLOCK_THICKNESS,
    },
    // IRC R317.1: furring on the inside of below-grade masonry is pressure treated, 16 in on centre.
    {
      id: 'furring',
      role: 'furring',
      material: 'pressure-treated wood',
      thickness: FOUNDATION_FURRING_THICKNESS,
    },
  ],
  face: 'exterior',
}

/** What the below-grade default says about itself, for the tool results that build a basement. */
export const FOUNDATION_WALL_DESCRIPTION =
  '8 in (0.203 m) CMU with 2x4 pressure-treated furring laid flat on the inside, 16 in on centre, interior finish as the level has it'

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

/** What the agent is told of the rule: the foundation wall, and what is not one. */
export const FOUNDATION_WALL_RULE = `a wall against the ground on a level below grade is a foundation wall (${FOUNDATION_WALL_DESCRIPTION}); a partition is an ordinary wall`

/** The construction a foundation wall is born with. */
export function foundationWallConstruction(): { assembly: Assembly; thickness: number } {
  return {
    assembly: structuredClone(FOUNDATION_WALL_ASSEMBLY),
    // Micrometres: the stored thickness is a clean 0.241, not the float noise of 0.203 + 0.038.
    thickness: Math.round(assemblyThickness(FOUNDATION_WALL_ASSEMBLY) * 1e6) / 1e6,
  }
}

/**
 * The `candidates` (walls among `levelWalls`, the level's walls with them in) that hold the earth
 * back: the level holds foundation walls and no closed circuit of walls encloses them. A partition
 * inside the outline is not one. A wall with no closed circuit around it yet (the first walls of a
 * basement, an open run) counts as the outline in the making, so a basement drawn wall by wall is
 * foundation all the way round. The outline is the one `genericFoundation` draws under.
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
 * default builds them: the walls against the ground take the CMU foundation construction, a
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
  return inserted.map((wall) =>
    against.has(wall.id) ? WallNode.parse({ ...wall, ...foundationWallConstruction() }) : wall,
  )
}
