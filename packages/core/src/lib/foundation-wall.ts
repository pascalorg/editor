import type { AnyNode, AnyNodeId, LevelNode, WallNode } from '../schema'
import type { Assembly } from '../schema/assembly'
import { assemblyThickness } from '../systems/wall/wall-assembly'
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
 * Whether new walls on `levelId` are foundation walls: the level is below grade everywhere, or the
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

/**
 * The construction a wall drawn on `levelId` is born with when nobody chose one: the CMU foundation
 * wall below grade, `null` anywhere else (the wall keeps the schema default). Existing walls are
 * never rewritten; the editor's wall tool, `add_wall` and the rooms the agent builds all ask here.
 */
export function defaultWallConstruction(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): { assembly: Assembly; thickness: number } | null {
  if (!levelHoldsFoundationWalls(nodes, levelId)) return null
  return {
    assembly: structuredClone(FOUNDATION_WALL_ASSEMBLY),
    // Micrometres: the stored thickness is a clean 0.241, not the float noise of 0.203 + 0.038.
    thickness: Math.round(assemblyThickness(FOUNDATION_WALL_ASSEMBLY) * 1e6) / 1e6,
  }
}

/**
 * `defaults` with the level's default construction under them: a wall the caller gives a thickness
 * or an assembly keeps what it gave (a thickness alone is a choice, so no stack rides on it).
 */
export function withDefaultWallConstruction<T extends Partial<WallNode>>(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
  defaults: T,
): T {
  if (defaults.assembly !== undefined || defaults.thickness !== undefined) return defaults
  const construction = defaultWallConstruction(nodes, levelId)
  return construction ? { ...defaults, ...construction } : defaults
}
