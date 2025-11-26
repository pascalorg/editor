import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'
import { GroupNode } from './group'
import { ItemNode } from './item'

export const CeilingNode = BaseNode.extend({
  id: nodeId('ceiling'),
  type: nodeType('ceiling'),
  // Grid props
  position: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  size: z.tuple([z.number(), z.number()]),
}).describe(
  dedent`
  Ceiling node - used to represent a ceiling surface
  - position: bottom-left corner position in grid coordinates
  - rotation: rotation in radians
  - size: width and depth in grid units
  - elevation: height above floor in meters
  `,
)

export type CeilingNode = z.infer<typeof CeilingNode>
