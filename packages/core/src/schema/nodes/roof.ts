import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { RoofSegmentNode } from './roof-segment'

export const RoofNode = BaseNode.extend({
  id: objectId('roof'),
  type: nodeType('roof'),
  material: MaterialSchema.optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Child roof segment IDs
  children: z.array(RoofSegmentNode.shape.id).default([]),
}).describe(
  dedent`
  Roof node - a container for roof segments.
  Acts as a group that holds one or more RoofSegmentNodes.
  When not being edited, segments are visually combined into a single solid.
  - position: center position of the roof group
  - rotation: rotation around Y axis
  - children: array of RoofSegmentNode IDs
  `,
)

export type RoofNode = z.infer<typeof RoofNode>
