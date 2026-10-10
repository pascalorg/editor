import { z } from 'zod'
import { registerPlansGuideSection } from './guides'
import { measurement } from './measurement'
import { NodeId } from './node-id'

// The schema's RoofType, restated: the schema module pulls in packages a contract may not.
const ROOF_TYPES = [
  'hip',
  'gable',
  'shed',
  'gambrel',
  'dutch',
  'mansard',
  'flat',
  'conical',
] as const

export const createRoofTool = {
  name: 'create_roof',
  title: 'Create roof',
  description:
    "Cap a storey with a roof over its footprint (its floor plates, else its rooms), swept in the building's own axes into rectangles, one roof segment each. Without a roofType: a gable for one rectangle, hips for a few wings, flat for a large block. The roof goes on a roof level of its own above the storey: the level directly above when it is a roof level or empty, else a new one. Call it once the storeys and their exterior walls stand. Refused with a code: a storey with another storey above it (a roof caps the top one), and no rooms on any level of the building (pass width and depth to roof a rectangle of your own).",
  input: {
    levelId: NodeId.optional().describe(
      'The storey to cover, by an id list_levels returned. Default: the top storey with rooms. A level without rooms stands for the highest storey of its building that has some.',
    ),
    level: NodeId.optional().describe('Same as levelId.'),
    roofType: z
      .enum(ROOF_TYPES)
      .optional()
      .describe('The shape of every segment. Default: chosen from the footprint.'),
    pitch: measurement('angle', 'deg', {
      min: 0,
      max: 85,
      description: 'Slope of the roof planes (default 40°).',
    }).optional(),
    overhang: measurement('length', 'm', {
      min: 0,
      description:
        'Eave overhang: how far the roof reaches past the walls. Read it from the photo: a deep modern overhang is 1–2 m. Default 0.3.',
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
    // Hawkesbury's flat roofs wear a black fascia about 0.3 m tall, which only apply_patch could
    // draw (2026-10-03).
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

/** The plans guide's step 4, brought with these tools. */
registerPlansGuideSection({
  name: 'envelope',
  order: 4,
  text: '4. Envelope: the roof over the top floor (create_roof, with the overhang the photo shows: a deep modern eave is 1–2 m), then the facade (5).',
})
