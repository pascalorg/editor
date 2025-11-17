import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const ColumnNode = BaseNode.extend({
  id: nodeId('column'),
  type: nodeType('column'),
  diameter: z.number().optional(),
  height: z.number().optional(),
  position: z.tuple([z.number(), z.number()]),
}).describe(
  dedent`
  Column node - used to represent a column in the building
  - diameter: diameter in meters (default is .3 meters)
  - height: height in meters (default is 2.5 meters)
  - position: position in level coordinate system
  `,
)

export type ColumnNode = z.infer<typeof ColumnNode>
