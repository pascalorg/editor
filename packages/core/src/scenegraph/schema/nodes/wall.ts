import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, Material, nodeType, objectId } from '../base'
import { DoorNode } from './door'
import { ItemNode } from './item'
import { WindowNode } from './window'

export const WallNode = BaseNode.extend({
  id: objectId('wall'),
  type: nodeType('wall'),
  get children() {
    return z.array(z.discriminatedUnion('type', [DoorNode, WindowNode, ItemNode])).default([])
  },
  // Specific props
  thickness: z.number().optional(),
  height: z.number().optional(),
  // e.g., start/end points for path
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  position: z.tuple([z.number(), z.number()]), // TODO: remove in favor of start and end
  size: z.tuple([z.number(), z.number()]), // TODO: remove in favor of start and end
  rotation: z.number(),
  // Material properties
  materialFront: Material,
  materialBack: Material,
  interiorSide: z.enum(['front', 'back', 'both', 'neither']).optional(),
}).describe(
  dedent`
  Wall node - used to represent a wall in the building
  - thickness: thickness in meters
  - height: height in meters
  - start: start point of the wall in level coordinate system
  - end: end point of the wall in level coordinate system
  - size: size of the wall in grid units
  - materialFront: material for the front face (positive Z normal direction)
  - materialBack: material for the back face (negative Z normal direction)
  - interiorSide: which side is considered the interior side for rendering purposes
  `,
)
export type WallNode = z.infer<typeof WallNode>
