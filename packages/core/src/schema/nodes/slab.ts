import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { SurfaceHoleMetadata } from './surface-hole-metadata'

export const SlabNode = BaseNode.extend({
  id: objectId('slab'),
  type: nodeType('slab'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  polygon: z.array(z.tuple([z.number(), z.number()])),
  holes: z.array(z.array(z.tuple([z.number(), z.number()]))).default([]),
  holeMetadata: z.array(SurfaceHoleMetadata).default([]),
  elevation: z.number().default(0.05), // Elevation in meters
  autoFromWalls: z.boolean().default(false),
}).describe(
  dedent`
  Slab node - used to represent a slab/floor in the building
  - polygon: array of [x, z] points defining the slab boundary
  - holes: array of [x, z] polygons representing cutouts in the slab
  - holeMetadata: metadata parallel to holes, used to preserve manual and stair-managed cutouts
  - elevation: elevation in meters
  - autoFromWalls: whether the slab is automatically generated from a closed wall loop
  `,
)

export type SlabNode = z.infer<typeof SlabNode>
