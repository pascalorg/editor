import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const ConveyorBeltDirection = z.enum(['forward', 'backward'])

export const ConveyorBeltPoint = z.tuple([z.number(), z.number(), z.number()])

export const ConveyorBeltNode = BaseNode.extend({
  id: objectId('conveyor-belt'),
  type: nodeType('conveyor-belt'),
  points: z
    .array(ConveyorBeltPoint)
    .min(2)
    .default([
      [0, 0, 0],
      [4, 0, 0],
    ]),
  width: z.number().min(0.1).max(5).default(0.8),
  thickness: z.number().min(0.02).max(0.5).default(0.08),
  elevation: z.number().min(-2).max(20).default(0.8),
  color: z.string().default('#111827'),
  edgeColor: z.string().default('#94a3b8'),
  rollerColor: z.string().default('#cbd5e1'),
  showFrame: z.boolean().default(true),
  showRollers: z.boolean().default(true),
  rollerSpacing: z.number().min(0.2).max(5).default(1),
  direction: ConveyorBeltDirection.default('forward'),
}).describe(
  dedent`
  Conveyor belt node - editable industrial transfer path.
  - points: multi-segment centerline in level coordinates.
  - width/thickness/elevation: belt cross-section and height.
  - direction: preview/runtime transfer direction along the point route.
  `,
)

export type ConveyorBeltNode = z.infer<typeof ConveyorBeltNode>
export type ConveyorBeltDirection = z.infer<typeof ConveyorBeltDirection>
