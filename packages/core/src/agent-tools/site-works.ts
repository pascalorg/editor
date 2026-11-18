import { z } from 'zod'
import { LAWN_LIMITS } from '../schema/nodes/lawn-limits'
import { levelTarget } from './levels'
import { measurement } from './measurement'
import { NodeId } from './node-id'

/**
 * The ground's surfaces around a building and the short outside steps up to a porch or a sill,
 * one call each. A garden from a brief and a photo includes its lawn, paths and drive.
 */

const planPoint = z.array(measurement('length', 'm')).length(2)
const lawnCoordinate = measurement('length', 'm', {
  min: -LAWN_LIMITS.maxCoordinate,
  max: LAWN_LIMITS.maxCoordinate,
})
const lawnPoint = z.tuple([lawnCoordinate, lawnCoordinate])
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const SITE_SURFACE_KINDS = ['driveway', 'path', 'patio', 'lawn'] as const

export const addSiteSurfaceTool = {
  name: 'add_site_surface',
  title: 'Add site surface',
  description:
    'Add a driveway, path or patio slab, or an editable core lawn; returns a real slabId for paving, lawnId and retained-area, exclusion, blade, flower and brush facts for lawn. Paving remains flat above ground in the level frame. Lawn follows Site ground, clears buildings, paving and beds, and stores parameters and seed, never meshes. Give exactly one polygon or corners. Lawn defaults to 6 cm mown grass with flowers off; specify flower species and shares explicitly. With siteId, lawn coordinates and strokes are Site metres and level/building targets are refused; otherwise both convert once from the level or building frame. Existing flat lawn slabs and plugin lawns are not changed or hidden; preserve them and avoid deliberate overlap. materialPreset is paving-only. Refuses before writes: surface_degenerate, lawn_outline_required, lawn_target_conflict, lawn_transform_unsupported, lawn_material_unsupported, missing or ambiguous Site, roof level, invalid_input, lawn_work_budget, lawn_terrain_budget or lawn_empty. Lawn bounds: 0.25–2500 m², 200 outline points, 250000 candidates, 64 strokes of 128 points; no silent stroke eviction. Coverage is retained ground area/requested area, not blade opacity. Counts are canonical, not current-camera detail; thinning and estimated brush areas are disclosed. Edit an existing lawn through the generic node edit path.',
  input: {
    kind: z.enum(SITE_SURFACE_KINDS),
    polygon: z
      .array(planPoint)
      .min(3)
      .max(200)
      .optional()
      .describe(
        '[x, z] corners in order, in level metres; for lawn, siteId selects Site metres and buildingId selects that building’s plan frame.',
      ),
    corners: z
      .array(planPoint)
      .length(2)
      .optional()
      .describe('Two opposite corners [x, z] of a rectangle, instead of a polygon.'),
    materialPreset: z
      .string()
      .optional()
      .describe(
        "Paving only: a library material (library:<id>) instead of the kind's own. Refused for lawn.",
      ),
    siteId: NodeId.optional().describe(
      'Lawn only: explicit owning Site and Site-space coordinates; do not combine with level or building targets.',
    ),
    buildingId: NodeId.optional().describe(
      'Lawn only: read outline and strokes in this building’s plan frame.',
    ),
    height: measurement('length', 'm', { min: LAWN_LIMITS.minHeight, max: LAWN_LIMITS.maxHeight })
      .optional()
      .describe('Lawn blade height; default 0.06 m.'),
    bladeWidth: measurement('length', 'm', {
      min: LAWN_LIMITS.minBladeWidth,
      max: LAWN_LIMITS.maxBladeWidth,
    })
      .optional()
      .describe('Lawn blade width; default 0.008 m.'),
    density: z
      .number()
      .finite()
      .min(LAWN_LIMITS.minDensity)
      .max(LAWN_LIMITS.maxDensity)
      .optional()
      .describe('Lawn blades per square metre, default 100.'),
    roughness: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .optional()
      .describe('Lawn character: 0 mown to 1 rough; default 0.2.'),
    color: color.optional().describe('Lawn colour #rrggbb, default #617c36.'),
    edgeFade: measurement('length', 'm', { min: 0, max: LAWN_LIMITS.maxEdgeFade })
      .optional()
      .describe('Inward soft lawn edge in metres, default 0.1.'),
    wind: z.number().finite().min(0).max(1).optional().describe('Lawn wind amount, default 0.2.'),
    seed: z.number().int().min(-2147483648).max(2147483647).optional(),
    gen: z.literal(1).optional().describe('Lawn generator version, currently 1.'),
    flowerDensity: z
      .number()
      .finite()
      .min(0)
      .max(LAWN_LIMITS.maxFlowerDensity)
      .optional()
      .describe('Lawn flower heads per square metre, default 0 (off).'),
    flowers: z
      .array(
        z.strictObject({
          species: z.enum(['daisy', 'clover', 'yarrow']),
          share: z.number().finite().min(0.01).max(100),
          color: color.optional(),
        }),
      )
      .max(LAWN_LIMITS.maxSpecies)
      .optional()
      .describe('Explicit lawn flower mix; relative shares, not exact counts.'),
    season: z
      .enum(['spring', 'summer', 'autumn', 'winter'])
      .optional()
      .describe('Saved lawn flower season; default summer.'),
    strokes: z
      .array(
        z.strictObject({
          points: z.array(lawnPoint).min(1).max(LAWN_LIMITS.maxStrokePoints),
          radiusM: measurement('length', 'm', {
            min: LAWN_LIMITS.minStrokeRadius,
            max: LAWN_LIMITS.maxStrokeRadius,
          }),
          effect: z.enum(['bare', 'grass', 'taller', 'shorter', 'more-flowers', 'fewer-flowers']),
          strength: z.number().finite().min(0).max(1),
        }),
      )
      .max(LAWN_LIMITS.maxStrokes)
      .optional()
      .describe(
        'Ordered soft vector strokes, in the same frame as the outline; a single point is a dab.',
      ),
    name: z.string().min(1).max(120).optional().describe('What it is: "Front lawn", "Driveway".'),
    ...levelTarget,
  },
}

export const addStepsTool = {
  name: 'add_steps',
  title: 'Add steps',
  description:
    'Add a short outside flight from the ground up to a porch, a deck or a door sill: its own rise, no floor above made for it (a flight between storeys is create_stair). It rises along +z turned by rotation, from its foot at (x, z); its run follows its rise. Refused with a code: a rise of a storey or 2 m or more (steps_too_tall), a roof level.',
  input: {
    x: measurement('length', 'm', { description: 'X of the foot of the flight (metres).' }),
    z: measurement('length', 'm', { description: 'Z of the foot of the flight (metres).' }),
    rise: measurement('length', 'm', {
      positive: true,
      description: 'Height it climbs, ground to landing (e.g. 0.5 m).',
    }),
    width: measurement('length', 'm', {
      positive: true,
      description: 'Width (default 1.2 m).',
    }).optional(),
    rotation: measurement('angle', 'deg', {
      description: 'Turn about the vertical (default 0).',
    }).optional(),
    ...levelTarget,
  },
}
