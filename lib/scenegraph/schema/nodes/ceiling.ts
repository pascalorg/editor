import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'
import { GroupNode } from './group'
import { ItemNode } from './item'

export const CeilingNode = BaseNode.extend({
  id: nodeId('ceiling'),
  type: nodeType('ceiling'),
  // Specific props
  thickness: z.number().optional(),
  // Grid points (x, z) in level coordinate system
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  // TODO: test custom ItemGroupNode in children
  children: z.array(z.discriminatedUnion('type', [ItemNode])).default([]),
}).describe(
  dedent`
  Ceiling node - used to represent a ceiling in the building
  - thickness: thickness in meters
  - start: start point of the ceiling in level coordinate system
  - end: end point of the ceiling in level coordinate system
  `,
)

export type CeilingNode = z.infer<typeof CeilingNode>
