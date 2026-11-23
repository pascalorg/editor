import { z } from 'zod'
import { PLANTING_LIMITS } from '../schema/nodes/planting-limits'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const coordinate = measurement('length', 'm', {
  min: -PLANTING_LIMITS.maxCoordinate,
  max: PLANTING_LIMITS.maxCoordinate,
})
const point = z.tuple([coordinate, coordinate])
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const addPlantingTool = {
  name: 'add_planting',
  title: 'Add or change a planting bed',
  description:
    'Add a layered planting bed on Site ground, or change one by plantingId; returns area, actual plant counts by habit and layer, cover and mesh counts. Give an outline or an area around a center, in Site metres (buildingId converts from that building’s plan frame). The seen side is +Z. Defaults mix evergreen structure and airy grass behind violet spikes and white flowers, with a low sage-green edge. The organic outline preserves area; seed fixes the layout. Plants clear building footprints, paved paths and ground steps. Ground reads the Site surface and ground-storey slabs, including their holes. Stores one compact node, never a node per plant. Refuses before generating: invalid fields (invalid_input), neither or both outline and area (planting_outline_required), a crossed, repeated, degenerate or oversized outline (planting_invalid_outline: 0.25–2500 m², at most 200 m across), unreasonable density (planting_budget_exceeded: area times share-weighted inverse spacing squared over 40000). Refuses when no plants fit (planting_empty), or the bed, Site or building is missing, ambiguous or in a different Site. A tipped building cannot supply its plan frame (planting_transform_unsupported). Geometry is thinned to the per-bed cap; counts describe the retained scatter, not requested quantities.',
  input: {
    plantingId: NodeId.optional().describe(
      'A planting bed to change; omit to add. Only supplied fields change.',
    ),
    siteId: NodeId.optional().describe(
      'Owning Site; omit when the scene has one Site, or to keep an existing bed’s Site.',
    ),
    buildingId: NodeId.optional().describe(
      'Read outline and center in this building’s plan frame; store them in Site metres.',
    ),
    name: z.string().min(1).max(120).optional(),
    outline: z
      .array(point)
      .min(PLANTING_LIMITS.minPoints)
      .max(PLANTING_LIMITS.maxPoints)
      .optional()
      .describe(
        'Simple outline, 3 to 64 [x, z] corners in metres; do not repeat the first point. Give outline or area.',
      ),
    area: measurement('area', 'm2', { min: PLANTING_LIMITS.minArea, max: PLANTING_LIMITS.maxArea })
      .optional()
      .describe(
        'Area in square metres, or text with area units; makes an island around center instead of an outline.',
      ),
    center: point.optional().describe('Center [x, z] for an area-based bed, default [0, 0].'),
    plants: z
      .array(
        z.strictObject({
          habit: z
            .enum(['mound', 'ball', 'spike', 'tuft', 'carpet'])
            .optional()
            .describe('Plant form, default mound.'),
          height: measurement('length', 'm', {
            min: PLANTING_LIMITS.minHeight,
            max: PLANTING_LIMITS.maxHeight,
          })
            .optional()
            .describe('Mature height, default 0.55 m.'),
          spread: measurement('length', 'm', {
            min: PLANTING_LIMITS.minSpread,
            max: PLANTING_LIMITS.maxSpread,
          })
            .optional()
            .describe('Mature crown width, default 0.55 m.'),
          spacing: measurement('length', 'm', {
            min: PLANTING_LIMITS.minSpacing,
            max: PLANTING_LIMITS.maxSpacing,
          })
            .optional()
            .describe(
              'Centre spacing, default 0.45 m. Pair clearance averages the two species’ spacings.',
            ),
          share: z
            .number()
            .finite()
            .min(0.01)
            .max(100)
            .optional()
            .describe('Relative share within its layer, default 1; not an exact count.'),
          layer: z
            .enum(['back', 'mid', 'edge'])
            .optional()
            .describe('Layer from the seen side (+Z), default mid.'),
          leafColor: color.optional().describe('Leaf colour #rrggbb, default #7f957a.'),
          flowerColor: color.optional().describe('Optional flower colour #rrggbb.'),
        }),
      )
      .min(1)
      .max(PLANTING_LIMITS.maxSpecies)
      .optional()
      .describe(
        'One to eight species; omit for the gentle three-layer planting. On a change, replaces the species list.',
      ),
    pattern: z
      .enum(['drifts', 'mixed', 'rows'])
      .optional()
      .describe('Layout, default drifts (same-species clumps).'),
    ground: z.enum(['soil', 'mulch', 'none']).optional().describe('Bed surface, default mulch.'),
    edging: z
      .enum(['none', 'steel', 'stone'])
      .optional()
      .describe('Outline edging, default steel.'),
    seed: z
      .number()
      .int()
      .min(-2147483648)
      .max(2147483647)
      .optional()
      .describe('Fixes the layout and plant variants, default 1.'),
    gen: z.literal(1).optional().describe('Planting bed generator version, currently 1.'),
  },
}
