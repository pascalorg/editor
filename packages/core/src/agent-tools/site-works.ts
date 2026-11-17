import { z } from 'zod'
import { levelTarget } from './levels'
import { measurement } from './measurement'

/**
 * The ground's surfaces around a building and the short outside steps up to a porch or a sill,
 * one call each. A garden from a brief and a photo includes its lawn, paths and drive.
 */

const planPoint = z.array(measurement('length', 'm')).length(2)

export const SITE_SURFACE_KINDS = ['driveway', 'path', 'patio', 'lawn'] as const

export const addSiteSurfaceTool = {
  name: 'add_site_surface',
  title: 'Add site surface',
  description:
    'Lay what covers the ground outside: a driveway (concrete), a path (brick pavers), a patio (stone) or a lawn (grass green), on a polygon or between two corners, flat at a fixed height just above the ground. The site plan reads a driveway, path and patio as paving and a lawn as open ground. Refused with a code: a surface with no area (surface_degenerate), a roof level.',
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
