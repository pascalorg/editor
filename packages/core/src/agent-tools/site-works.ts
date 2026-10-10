import { z } from 'zod'
import { levelTarget } from './levels'
import { measurement } from './measurement'

// The node schemas' enums, written out: a contract imports no schema (contracts-purity); a test
// keeps them equal.
export const FENCE_STYLES = ['slat', 'rail', 'privacy', 'horizontal', 'guard', 'picket'] as const
export const FENCE_BASE_STYLES = ['floating', 'grounded', 'raised'] as const
export const COLUMN_STYLES = [
  'plain',
  'faceted',
  'fluted',
  'lathe-turned',
  'dravidian-carved',
  'cluster',
] as const
export const COLUMN_CROSS_SECTIONS = [
  'round',
  'square',
  'rectangular',
  'octagonal',
  'sixteen-sided',
] as const
export const COLUMN_BASE_STYLES = [
  'none',
  'simple-square',
  'round-rings',
  'square-plinth',
  'stepped-square',
  'lotus',
  'ribbed-lotus',
  'panelled-pedestal',
] as const
export const COLUMN_CAPITAL_STYLES = [
  'none',
  'simple',
  'simple-slab',
  'rounded',
  'stepped',
  'doric',
  'volute',
  'ionic-volute',
  'leaf-carved',
  'corinthian-leaf',
  'south-indian-bracket',
  'wood-bracket',
] as const

/**
 * The site around a building, one call each (L35, L38, L54): fences, columns, the ground's
 * surfaces and the steps up to a porch. A twin from a plan and a photo includes its site.
 */

const planPoint = z.array(z.number()).length(2)

export const addFenceTool = {
  name: 'add_fence',
  title: 'Add fence',
  description:
    "Add a fence along points on a level: one fence per side, the whole run or a lot's boundary (closed) in one call. Privacy (solid panels) by default; picket for a picket fence, slat for vertical slats, rail for open rails, horizontal for cladding boards, guard for a deck's barrier. Refused with a code: a side shorter than 10 cm, a roof level.",
  input: {
    points: z
      .array(planPoint)
      .min(2)
      .max(64)
      .describe(
        '[x, z] points in level coordinates (metres), the fence running through them in order.',
      ),
    closed: z
      .boolean()
      .optional()
      .describe("Close the run back to the first point, as a lot's boundary."),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Fence height (default 1.8 m).',
    }).optional(),
    style: z
      .enum(FENCE_STYLES)
      .optional()
      .describe('slat | rail | privacy | horizontal | guard | picket (default privacy).'),
    baseStyle: z
      .enum(FENCE_BASE_STYLES)
      .optional()
      .describe(
        'grounded (default: on the ground), floating (raised off it) or raised (on a low plinth).',
      ),
    materialPreset: z
      .string()
      .optional()
      .describe(
        'A library material (library:<id>, as search_assets and the facade paint name them).',
      ),
    ...levelTarget,
  },
}

export const SITE_SURFACE_KINDS = ['driveway', 'path', 'patio', 'lawn'] as const

export const addSiteSurfaceTool = {
  name: 'add_site_surface',
  title: 'Add site surface',
  description:
    'Lay what covers the ground outside: a driveway (concrete), a path (brick pavers), a patio (stone) or a lawn (grass green), on a polygon or between two corners, at grade. The site plan reads a driveway, path and patio as paving and a lawn as open ground. Refused with a code: a surface with no area, a roof level.',
  input: {
    kind: z.enum(SITE_SURFACE_KINDS),
    polygon: z
      .array(planPoint)
      .min(3)
      .max(200)
      .optional()
      .describe('[x, z] corners in level coordinates (metres), in order.'),
    corners: z
      .array(planPoint)
      .length(2)
      .optional()
      .describe('Two opposite corners [x, z] of a rectangle, instead of a polygon.'),
    materialPreset: z
      .string()
      .optional()
      .describe("A library material (library:<id>) instead of the kind's own."),
    name: z.string().min(1).max(120).optional().describe('What it is: "Front lawn", "Driveway".'),
    ...levelTarget,
  },
}

export const addStepsTool = {
  name: 'add_steps',
  title: 'Add steps',
  description:
    'Add a short outside flight from the ground up to a porch, a deck or a door sill: its own rise, no floor above made for it (a flight between storeys is create_stair). It rises along +z turned by rotation, from its foot at (x, z). Refused with a code: a rise of a storey or more, a roof level.',
  input: {
    x: z.number().describe('X of the foot of the flight (metres).'),
    z: z.number().describe('Z of the foot of the flight (metres).'),
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
