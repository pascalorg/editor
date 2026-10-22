import { z } from 'zod'
import { FOUNDATION_BY_REGION_NOTE } from '../lib/foundation-construction'
import { measurement } from './measurement'
import { NodeId } from './node-id'

export const listLevelsTool = {
  name: 'list_levels',
  title: 'List levels',
  description:
    'List every level of every building in floor order: id, name, floorIndex, building (parentId), role (occupied storey, roof-only level or support level), child count, gradeStanding (at-grade, partly-below-grade or below-grade against the ground line and the terrain), isGroundLevel, and which one the person is viewing (isActive); groundLevels names, per building, the level at grade (levelId, whether the building names it, floorElevation, gradeElevation, floorOverGrade, seated). A roof-only level is the roof, not a storey.',
  input: {},
}

// `level` is the chat's older name for the same parameter; threads and habits still use it.
export const levelTarget = {
  levelId: NodeId.optional().describe(
    'The level, by an id list_levels returned; an id made up from a name ("level_1", "level_ground") does not exist. Default: the floor the person is viewing, else the lowest floor.',
  ),
  level: NodeId.optional().describe('Same as levelId.'),
}

export const getLevelSummaryTool = {
  name: 'get_level_summary',
  title: 'Get level summary',
  description:
    "Summarise one level so nothing on it goes unseen: its role and counts, then walls (length, heights, doors and windows), zones (name, area, size, floor_choices), slabs, ceilings, items (floor, wall and ceiling), floor openings, stairs, roofs, and anything else by type. Zone polygons: get_zones; a node's full data: get_node.",
  input: levelTarget,
}

export const getWallsTool = {
  name: 'get_walls',
  title: 'Get walls',
  description:
    'Get the walls of a level: start and end in metres, length, stored and resolved height, thickness, and their doors and windows. wallFaceChains gives base-chain provenance for geometric faces a (left of start → end) and b (right): ref (authored face slot), legacy (inline spec), or default (declared fallback ref). These are not final rendered finishes: room intent, face paint regions, exterior assembly cladding and reference availability can change appearance. A chosen white or default-matching ref is legitimate; fallback alone is not a defect or a requirement to paint.',
  input: levelTarget,
}

export const getZonesTool = {
  name: 'get_zones',
  title: 'Get zones',
  description:
    'Get the zones (rooms) of a level: name, colour, polygon and holes in metres, area in m² (holes taken out), bounding size, and floor_choices: the floor plates the room can take (key, plateId, name, current; drawn and mezzanine flags). A room shares its floor plate with the rooms next to it unless detached. Persisted authored wall intent is wallMaterial (string, or null when absent) and wallOverrides (records of wallId, geometric face a or b, and finish; [] when absent). This is not a final rendered finish or visual verification: local overrides and face paint can take precedence, and absent room intent is not a defect or a requirement to paint.',
  input: levelTarget,
}

export const addLevelTool = {
  name: 'add_level',
  title: 'Add level',
  description:
    "Add an empty level to a building, as the editor does: above its top storey, under the building's roof level, which moves up one so the roof stays on top; or below its lowest level for a basement, which goes one storey under the lowest level and every existing level keeps its place, the ground floor included. On a scene with no building (a new or cleared scene), it starts the scene as the editor does: a site, a building and its ground level. A level that ends up below grade says in its result how a new wall on it is built (wallConstruction): a wall against the ground is a foundation wall, " +
    FOUNDATION_BY_REGION_NOTE +
    ', a partition is an ordinary wall. To copy a floor with its content, use duplicate_level.',
  input: {
    buildingId: NodeId.optional().describe(
      "The building. Default: the building of the floor the person is viewing, else the scene's only building.",
    ),
    position: z
      .enum(['above', 'below'])
      .optional()
      .describe(
        'above (default): over the top storey, under the roof level; below: under the lowest, a basement.',
      ),
    name: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('Name of the level, e.g. "Basement", "Attic".'),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Floor-to-floor storey height (default 2.5 m).',
    }).optional(),
  },
}

export const duplicateLevelTool = {
  name: 'duplicate_level',
  title: 'Duplicate level',
  description:
    'Copy a level with everything on it, as the editor does: fresh ids, internal links kept, and units whose rooms are all on that level copied too; plan references, scans and spawn points stay behind. The copy goes above the original (or below it) and the floors past it move up one.',
  input: {
    levelId: NodeId.optional().describe(
      'The level to copy, by an id list_levels returned. Default: the floor the person is viewing.',
    ),
    position: z
      .enum(['above', 'below'])
      .optional()
      .describe('Where the copy goes: above the original (default) or below it.'),
    name: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'Name of the copy. Default: none, so it reads by its floor like a new level (Floor 1, Ground floor…).',
      ),
    preset: z
      .enum(['everything', 'structure', 'structure-materials', 'structure-furniture'])
      .optional()
      .describe(
        'What to copy, as in the editor: everything (default); structure (walls, zones, slabs, ceilings, roofs, stairs, doors, windows) without materials; structure with its materials; or structure and furniture.',
      ),
  },
}

export const setGroundLevelTool = {
  name: 'set_ground_level',
  title: 'Set ground level',
  description:
    "Make a level the building's ground floor: the one standing at grade, its floor 8 in over the ground (about 6 in on cast concrete foundations, 12 in on stone: the building's foundation construction seats it; the result names it). A building's levels stack on a ground line; the levels with a lower floor index are below grade (basements), the ones at or over it are not, and list_levels reads it as groundLevels (levelId, floorElevation, floorOverGrade, seated) and each level's gradeStanding (at-grade, partly-below-grade, below-grade) and isGroundLevel. This names the level on the building, seats the building so that level's floor datum, the top of the foundation where the wood framing starts, stands 0.203 m (8 in) over grade on a block foundation, 0.15 m on cast concrete (Europe), 0.3 m on stone (a historic style) (flat site: world Y 0.203; sculpted terrain: 0.203 m over the mean ground height under its floor), moving the building in height only — the plan stays where it is and every level keeps its place relative to the others — and renumbers the floor indices so it is 0 and the ones under it are -1, -2…. A level added below (add_level position below) stacks under the lowest level without moving the ground floor. A roof level or a support level cannot be the ground floor (not_a_storey). One undo step. Refusals: level_not_found, not_a_level, no_building, not_a_storey. Answering unchanged: true when the level is already the named ground floor, at that seat, at index 0.",
  input: {
    levelId: NodeId.describe('The level to stand at grade, by an id list_levels returned.'),
  },
}
