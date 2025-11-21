import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const ItemNode = BaseNode.extend({
  id: nodeId('item'),
  type: nodeType('item'),
  category: z.string(),
  position: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  size: z.tuple([z.number(), z.number()]),
  src: z.string(),
  modelScale: z
    .union([z.number(), z.tuple([z.number(), z.number(), z.number()])])
    .default([1, 1, 1]),
  modelPosition: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  modelRotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
}).describe(dedent`Item node - used to represent a item in the building
  - position: position in level coordinate system
  - rotation: rotation in level coordinate system
  - size: size in level coordinate system
  - src: url of the model
`)

export type ItemNode = z.infer<typeof ItemNode>
