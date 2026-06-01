import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const AssemblyNode = BaseNode.extend({
  id: objectId('assembly'),
  type: nodeType('assembly'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  children: z.array(z.string()).default([]),
}).describe('Assembly node - transformable parent group for generated multi-part objects.')

export type AssemblyNode = z.infer<typeof AssemblyNode>
