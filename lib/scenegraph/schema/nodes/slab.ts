import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const SlabNode = BaseNode.extend({
  id: objectId('slab'),
  type: nodeType('slab'),
  // Grid props
  position: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  size: z.tuple([z.number(), z.number()]),
  // Specific props
  thickness: z.number().optional(),
}).describe(
  dedent`
  Slab node - used to represent a concrete slab
  `,
)

export type SlabNode = z.infer<typeof SlabNode>
