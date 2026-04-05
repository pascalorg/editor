import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { StairSegmentNode } from './stair-segment'

export const StairNode = BaseNode.extend({
  id: objectId('stair'),
  type: nodeType('stair'),
  material: MaterialSchema.optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Child stair segment IDs
  children: z.array(StairSegmentNode.shape.id).default([]),
}).describe(
  dedent`
  Stair node - a container for stair segments.
  Acts as a group that holds one or more StairSegmentNodes (flights and landings).
  Segments chain together based on their attachmentSide to form complex staircase shapes.
  - position: center position of the stair group
  - rotation: rotation around Y axis
  - children: array of StairSegmentNode IDs
  `,
)

export type StairNode = z.infer<typeof StairNode>
