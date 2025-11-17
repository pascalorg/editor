import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const FloorNode = BaseNode.extend({
  id: nodeId('floor'),
  type: nodeType('floor'),
  // Specific props
  thickness: z.number().optional(),
  // Grid points (x, z) in level coordinate system
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
}).describe(
  dedent`
  Floor node - used to represent a floor in the building
  - thickness: thickness in meters
  - start: start point of the floor in level coordinate system
  - end: end point of the floor in level coordinate system
  `,
)

export type FloorNode = z.infer<typeof FloorNode>
