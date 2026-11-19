import { z } from 'zod'
import { HEDGE_LIMITS } from '../schema/nodes/hedge-limits'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const point = z.array(measurement('length', 'm')).length(2)

/** A hedge longer than this is refused: plant it as several. */
export const HEDGE_MAX_LENGTH_M = 400

export const addHedgeTool = {
  name: 'add_hedge',
  title: 'Add or change a hedge',
  description:
    "Add a hedge planted along a line on a Site's ground, or change one by hedgeId. The line is points in order, or a side of the lot (boundary). The hedge follows the Site ground and ground-storey slabs, steps across changes of support height, and is stored as its line and numbers, never as a mesh; its irregular form follows from them and seed. Site frame, metres. Returns facts: the length of the smoothed line and the length planted, every opening asked for with where it was left or why it was not, the ground under it, and its triangle count. Refuses, before building anything: neither or both of points and boundary (hedge_line_required), two points closer than 10 cm (hedge_side_too_short), a line over 400 m (hedge_too_long), a lot with no such side (hedge_no_boundary) or a side of more than 64 corners (hedge_too_many_points), openings that leave nothing planted (hedge_all_open), an unknown hedgeId, Site or building, changing an existing hedge's Site (hedge_site_mismatch), or a building on another Site (building_site_mismatch).",
  input: {
    hedgeId: NodeId.optional().describe(
      'A hedge to change; omit to add one. Only the fields you give change.',
    ),
    siteId: NodeId.optional().describe('Owning Site id; omit when the scene has one Site.'),
    buildingId: NodeId.optional().describe(
      "Give points and openings in this building's plan frame (the one its walls and fences use) instead of the Site's; they are stored in the Site's frame.",
    ),
    name: z.string().min(1).max(120).optional(),
    points: z
      .array(point)
      .min(HEDGE_LIMITS.minPoints)
      .max(HEDGE_LIMITS.maxPoints)
      .optional()
      .describe('Centreline points [x, z] in metres, in order: 2 to 64. Give points or boundary.'),
    boundary: z
      .strictObject({
        side: z
          .enum(['front', 'rear', 'left', 'right', 'all'])
          .describe(
            "The lot's edges with that role (front is the street); all is the whole outline, closed.",
          ),
        insetM: measurement('length', 'm', { min: 0, max: 20 })
          .optional()
          .describe(
            'How far inside the lot line the centreline stands (default half the width: the outer face on the lot line).',
          ),
      })
      .optional()
      .describe('Plant along a side of the lot instead of points.'),
    closed: z
      .boolean()
      .optional()
      .describe('Ring back to the first point (3 points or more). Default false.'),
    curve: z
      .boolean()
      .optional()
      .describe(
        'true bends the line smoothly through the points; false (default) keeps the sides straight and rounds the corners.',
      ),
    height: measurement('length', 'm', {
      min: HEDGE_LIMITS.minHeight,
      max: HEDGE_LIMITS.maxHeight,
    })
      .optional()
      .describe('Height above the ground (default 1.2 m).'),
    width: measurement('length', 'm', { min: HEDGE_LIMITS.minWidth, max: HEDGE_LIMITS.maxWidth })
      .optional()
      .describe('Width across (default 0.7 m).'),
    clip: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        '0 left to grow (uneven outline, rounded, shoots above the top) to 1 freshly clipped (straight sides, flat top). Default 1.',
      ),
    leafSize: measurement('length', 'm', {
      min: HEDGE_LIMITS.minLeafSize,
      max: HEDGE_LIMITS.maxLeafSize,
    })
      .optional()
      .describe('Length of a leaf (default 0.09 m).'),
    leafColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .describe('Leaf colour as #rrggbb (default #4c8a32).'),
    gaps: z
      .array(
        z.strictObject({
          at: point.describe(
            'Where the opening is centred, [x, z]: the nearest place on the line is opened.',
          ),
          width: measurement('length', 'm', {
            min: HEDGE_LIMITS.minGapWidth,
            max: HEDGE_LIMITS.maxGapWidth,
          }).describe('Clear width of the opening along the line.'),
        }),
      )
      .max(HEDGE_LIMITS.maxGaps)
      .optional()
      .describe(
        'Openings left for gates and paths, at most 16. Given on a change, they replace the openings the hedge had.',
      ),
    seed: z
      .number()
      .int()
      .optional()
      .describe('Fixes the irregular form; another seed, another hedge of the same numbers.'),
  },
}
