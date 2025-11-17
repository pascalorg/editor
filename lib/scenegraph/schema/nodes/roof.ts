import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const RoofNode = BaseNode.extend({
  id: nodeId('roof'),
  type: nodeType('roof'),
  position: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  size: z.tuple([z.number(), z.number()]),
  height: z.number(),
  leftWidth: z.number(),
  rightWidth: z.number(),
}).describe(
  dedent`
  Roof node - used to represent a roof in the building
  - position: position of the roof
  - rotation: rotation of the roof
  - size: size of the roof (length, width)
  - height: height of the roof
  - leftWidth: width of the left side of the roof (in meters)
  - rightWidth: width of the right side of the roof (in meters)
  `,
)

export type RoofNode = z.infer<typeof RoofNode>
