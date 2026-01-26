import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

// Polygon boundary for zone area - array of [x, z] coordinates
export const SlabPolygon = z.array(z.tuple([z.number(), z.number()]))

export const SlabNode = BaseNode.extend({
  id: objectId('slab'),
  type: nodeType('slab'),
  // Specific props
  // Polygon boundary - array of [x, z] coordinates defining the slab
  polygon: SlabPolygon,
  elevation: z.number().default(0.05), // Elevation in meters
}).describe(
  dedent`
  Slab node - used to represent a slab/floor in the building
  - polygon: array of [x, z] points defining the slab boundary
  - elevation: elevation in meters
  `,
)

export type SlabNode = z.infer<typeof SlabNode>
export type SlabPolygon = z.infer<typeof SlabPolygon>
