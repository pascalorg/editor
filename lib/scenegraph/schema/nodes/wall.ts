import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'
import { DoorNode } from './door'
import { WindowNode } from './window'

export const WallNode = BaseNode.extend({
  id: nodeId('wall'),
  type: nodeType('wall'),
  get children() {
    return z.array(z.discriminatedUnion('type', [DoorNode, WindowNode]))
  },
  // Specific props
  thickness: z.number().optional(),
  height: z.number().optional(),
  // e.g., start/end points for path
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
}).describe(
  dedent`
  Wall node - used to represent a wall in the building
  - thickness: thickness in meters
  - height: height in meters
  - start: start point of the wall in level coordinate system
  - end: end point of the wall in level coordinate system
  `,
)

export type WallNode = z.infer<typeof WallNode>
