import { z } from 'zod'
import { ROCK_LIMITS } from '../schema/nodes/rock-limits'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const point = z.array(measurement('length', 'm')).length(2)
const polygon = z.array(point).min(ROCK_LIMITS.minPoints).max(ROCK_LIMITS.maxPoints)
const dimension = measurement('length', 'm', { positive: true })

export const addRockTool = {
  name: 'add_rock',
  title: 'Add or change a rock',
  description:
    "Add or change a natural rock on a Site's ground, returning its shape, look, triangle estimates and ground/building contact facts. To add one, give exactly one footprint: polygon (or outline), or at plus size for a seeded natural footprint. Size is a plan diameter or [width, depth] in metres; at is its bounding-box centre. Edits may omit the footprint. Footprints need at least 0.25 m²; at plus size: 0.6 makes a valid small rock. The outline is where it meets the ground and the most it ever spreads; height is above the lowest ground under it, and its deterministic shape follows from its stored numbers and seed. A floor (slab) it rises through gets a hole the size of the rock's cross-section there, derived so moving or deleting the rock leaves nothing behind; walls are not cut, and what stands inside the rock is hidden by it. Returns the outline and area, foot/top elevations, ground range, slabs passed through (hole area), and walls met (length inside, curtain walls named), plus effective gen, type, look and estimated near/far triangles. A rock inside a room is intended, not a collision. Refuses invalid bounds or unknown types before computation, invalid outlines and unknown rockId.",
  input: {
    rockId: NodeId.optional().describe(
      'A rock to change; omit to add one. Only the fields you give change.',
    ),
    siteId: NodeId.optional().describe('Owning Site id; omit when the scene has one Site.'),
    buildingId: NodeId.optional().describe(
      "Give the footprint or at/size in this building's plan frame (the one its walls and slabs use) instead of the Site's; it is stored in the Site's frame.",
    ),
    name: z.string().min(1).max(120).optional(),
    gen: z.literal(1).optional().describe('Rock generator version, currently 1.'),
    rockType: z
      .enum(['boulder', 'fjord', 'granite', 'volcanic', 'river', 'stacked', 'stepping'])
      .optional()
      .describe('Exterior stone type (default boulder).'),
    weathering: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .optional()
      .describe('Wear and softened joints, 0 to 1 (default 0.35).'),
    moss: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .optional()
      .describe('Moss coverage, 0 to 1 (default 0), in addition to lichen.'),
    outline: polygon
      .optional()
      .describe(
        'Footprint corners [x, z] in metres, in order; use only one of outline, polygon or at plus size. Minimum area 0.25 m².',
      ),
    polygon: polygon
      .optional()
      .describe(
        'Footprint corners [x, z] in metres, in order; use instead of outline or at plus size. Minimum area 0.25 m².',
      ),
    at: point
      .optional()
      .describe(
        'Plan bounding-box centre [x, z] in metres. Requires size; do not combine with polygon or outline.',
      ),
    size: z
      .union([dimension, z.array(dimension).length(2)])
      .optional()
      .describe(
        'Plan diameter, or [width, depth], in metres (also accepts length text). Requires at; generates a seeded natural footprint with these exact bounds. Positive dimensions and at least 0.25 m² of footprint area; diameter 0.6 m works.',
      ),
    height: measurement('length', 'm', {
      min: ROCK_LIMITS.minHeight,
      max: ROCK_LIMITS.maxHeight,
    })
      .optional()
      .describe('Rise above the lowest ground under the outline (default 2.4 m).'),
    seed: z
      .number()
      .int()
      .optional()
      .describe('Fixes the irregular shape; another seed, another rock.'),
    form: z
      .enum(['faceted', 'weathered'])
      .optional()
      .describe('Flat facets (default) or blended, worn forms.'),
    strata: z.boolean().optional().describe('Layered bands in the stone.'),
    lichen: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('How much of its upward faces carry lichen, 0 to 1.'),
  },
}
