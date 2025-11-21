import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

export const WindowNode = BaseNode.extend({
  id: nodeId('window'),
  type: nodeType('window'),
  // Specific props: size, position on wall, etc.
  height: z.number().default(1), // height in meters of the bottom of the window
  position: z.tuple([z.number(), z.number()]), // position in local coordinate system of the wall
  size: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
}).describe(
  dedent`
  Window node - used to represent a window in the wall:
  - height: height in meters (default is 1 meter)
  - position: position in local coordinate system of the wall
  `,
)

export type WindowNode = z.infer<typeof WindowNode>
