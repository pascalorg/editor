import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const ItemNode = BaseNode.extend({
  id: nodeId('item'),
  type: nodeType('item'),
  position: z.tuple([z.number(), z.number()]),
}).describe(dedent`Item node - used to represent a item in the building`)

export type ItemNode = z.infer<typeof ItemNode>
