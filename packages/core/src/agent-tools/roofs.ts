import { z } from 'zod'
import { CurtainGrid } from '../schema/nodes/curtain-wall'
import { RoofGlazing, RoofSystemType } from '../schema/nodes/roof-glazing-config'
import { RoofType } from '../schema/nodes/roof-types'
import { measurement, roofPitch } from './measurement'
import { NodeId } from './node-id'

const glazingGrid = CurtainGrid.partial().extend({
  spacing: measurement('length', 'm', {
    min: 0.2,
    max: 100,
    description: 'Bar spacing, for the maximum-spacing and fixed-spacing layouts.',
  }).optional(),
})

/** A roof's glazing as the node stores it, its lengths read in any unit. */
const RoofGlazingInput = RoofGlazing.partial().extend({
  across: glazingGrid.optional(),
  along: glazingGrid.optional(),
  frameWidth: measurement('length', 'm', {
    positive: true,
    description: 'Frame bar width.',
  }).optional(),
  frameDepth: measurement('length', 'm', {
    positive: true,
    description: 'Frame bar depth.',
  }).optional(),
  glassThickness: measurement('length', 'm', {
    positive: true,
    description: 'Glass pane thickness.',
  }).optional(),
})

export const createRoofTool = {
  name: 'create_roof',
  title: 'Create roof',
  description:
    "Cap a storey with a roof over its footprint (its walls' outline, else its floor plates, else its rooms), swept in the building's own axes into rectangles, one roof segment each. Without a roofType: a gable for one rectangle, hips for a few wings, flat for a large block. The roof goes on the building's roof level above the top storey (the empty level directly above when it is the only one; made, named Roof, when there is none), and stands on the storey's wall tops, so exploded and solo level views lift it off the plan. Glazed construction supports gable, straight shed and barrel. Barrel depth is the span; barrelRise is at most half the span. glazing controls frame, glass, grids and panels. Paint glazing-frame, glazing-glass or glazing-solid. Call it once the storeys and their exterior walls stand. Refused with a code: storey_above (another storey stands above: a roof caps the top one; a lower wing's roof is drawn with the Roof tool), building_required (no level named on a site of several buildings: pass a level of the one to roof), roof_exists (the storey already has a roof: edit it, or delete_node it first when the person asked for a new one), no_rooms (no rooms or closed walls on any level of the building: pass width and depth to roof a rectangle of your own).",
  input: {
    roofSystem: RoofSystemType.default('standard'),
    glazing: RoofGlazingInput.optional(),
    barrelRise: measurement('length', 'm', {
      positive: true,
      description: 'Barrel arch rise, at most half each segment span.',
    }).optional(),
    barrelSegments: z.number().int().min(4).max(32).optional(),
    wallThickness: measurement('length', 'm', {
      positive: true,
      description: 'Roof wall thickness.',
    }).optional(),
    levelId: NodeId.optional().describe(
      'The storey to cover, by an id list_levels returned. Default: the top storey with rooms. A level without rooms stands for the highest storey of its building that has some.',
    ),
    level: NodeId.optional().describe('Same as levelId.'),
    roofType: RoofType.optional().describe(
      'The shape of every segment. Default: chosen from the footprint.',
    ),
    pitch: roofPitch('deg', {
      min: 0,
      max: 85,
      description: 'Slope of the roof planes (default 40°).',
    }).optional(),
    overhang: measurement('length', 'm', {
      min: 0,
      description:
        'Eave overhang: how far the eaves reach past the walls in plan (a segment stores it along its slope). Read it from the photo: a deep modern overhang is 1–2 m. Default 0.3.',
    }).optional(),
    wallHeight: measurement('length', 'm', {
      min: 0,
      description: 'Knee walls under the eaves (default 0: the roof starts at the wall tops).',
    }).optional(),
    width: measurement('length', 'm', {
      positive: true,
      description:
        'With depth: roof a rectangle of your own instead of the footprint (a wing, or walls drawn without rooms), along x.',
    }).optional(),
    depth: measurement('length', 'm', {
      positive: true,
      description: "The rectangle's depth, along z.",
    }).optional(),
    center: z
      .array(z.number())
      .length(2)
      .optional()
      .describe("The rectangle's centre [x, z] in metres (default [0, 0])."),
    materialPreset: z.string().optional().describe('The roof finish, a library material.'),
    // A flat roof's fascia band (often about 0.3 m tall), which only apply_patch could draw before.
    fasciaHeight: measurement('length', 'm', {
      positive: true,
      description:
        "A fascia band of that height round the roof's eaves and rakes; on a flat roof it reaches the roof's top, a coping over its edge. Absent (and no fasciaMaterialPreset): no band.",
    }).optional(),
    fasciaMaterialPreset: z
      .string()
      .optional()
      .describe(
        "The band's finish, a library material (a black fascia: library:preset-nearblack); the roof's wall finish when absent.",
      ),
    name: z.string().max(120).optional().describe('What the user would call it (default "Roof").'),
  },
}

export const moveRoofsToRoofLevelTool = {
  name: 'move_roofs_to_roof_level',
  title: 'Move roofs to the roof level',
  description:
    "Move the roofs a storey holds on its own walls to the level the roof rule gives them, as a roof's panel does by hand (Move to the roof level): over the top storey, the building's roof level (made, named Roof, when there is none); under an upper storey, that storey. Each roof stands exactly where it stood, its segments, finishes and id kept: only the level holding it changes, so exploded and solo level views show the storey's plan with no roof over it. For a project built before roofs had their own level, when verify_scene reports roof_mixed_in_storey. Refused with a code: level_not_found, no_roof_on_walls (the storey holds no roof standing on its walls; a porch roof on its beam and a lower wing's roof on the storey above already sit where they belong). Returns the roofs moved (roofIds), the level they went to (roofLevelId) and the roof level made for them (createdRoofLevelId).",
  input: {
    levelId: NodeId.describe('The storey whose roofs move, by an id list_levels returned.'),
  },
}
