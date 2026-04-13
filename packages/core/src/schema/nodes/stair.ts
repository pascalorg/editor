import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { StairSegmentNode } from './stair-segment'

export const StairRailingMode = z.enum(['none', 'left', 'right', 'both'])

export type StairRailingMode = z.infer<typeof StairRailingMode>

export const StairNode = BaseNode.extend({
  id: objectId('stair'),
  type: nodeType('stair'),
  material: MaterialSchema.optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  railingMode: StairRailingMode.default('none'),
  railingHeight: z.number().default(0.92),
  // Child stair segment IDs
  children: z.array(StairSegmentNode.shape.id).default([]),
}).describe(
  dedent`
  Stair node - a container for stair segments.
  Acts as a group that holds one or more StairSegmentNodes (flights and landings).
  Segments chain together based on their attachmentSide to form complex staircase shapes.
  - position: center position of the stair group
  - rotation: rotation around Y axis
  - railingMode: whether to render railings and on which side(s)
  - railingHeight: top height of the railing above the stair surface
  - children: array of StairSegmentNode IDs
  `,
)

export type StairNode = z.infer<typeof StairNode>
