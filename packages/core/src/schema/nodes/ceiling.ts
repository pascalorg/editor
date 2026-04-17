import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { ItemNode } from './item'
import { SurfaceHoleMetadata } from './surface-hole-metadata'

export const CeilingNode = BaseNode.extend({
  id: objectId('ceiling'),
  type: nodeType('ceiling'),
  children: z.array(ItemNode.shape.id).default([]),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  polygon: z.array(z.tuple([z.number(), z.number()])),
  holes: z.array(z.array(z.tuple([z.number(), z.number()]))).default([]),
  holeMetadata: z.array(SurfaceHoleMetadata).default([]),
  height: z.number().default(2.5), // Height in meters
  autoFromWalls: z.boolean().default(false),
}).describe(
  dedent`
  Ceiling node - used to represent a ceiling in the building
  - polygon: array of [x, z] points defining the ceiling boundary
  - holes: array of polygons representing holes in the ceiling
  - holeMetadata: metadata parallel to holes, used to preserve manual and stair-managed cutouts
  - autoFromWalls: whether the ceiling is automatically generated from a closed wall loop
  `,
)

export type CeilingNode = z.infer<typeof CeilingNode>
