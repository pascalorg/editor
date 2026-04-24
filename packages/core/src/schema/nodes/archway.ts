import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ArchwayNode = BaseNode.extend({
  id: objectId('archway'),
  type: nodeType('archway'),
  material: MaterialSchema.optional(),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  wallId: z.string().optional(),

  width: z.number().default(1.2),
  height: z.number().default(2.4),
  
  // Arch specific properties
  archHeight: z.number().default(0.4), // Height of the curved part from the top of the straight part
  thickness: z.number().default(0.1),  // Decorative trim thickness
  depth: z.number().default(0.25),     // Decorative trim depth
  
  showTrim: z.boolean().default(true),
}).describe('Archway node - a parametric archway placed on a wall')

export type ArchwayNode = z.infer<typeof ArchwayNode>
