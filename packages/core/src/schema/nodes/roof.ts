import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { RoofSegmentNode } from './roof-segment'

export const RoofNode = BaseNode.extend({
  id: objectId('roof'),
  type: nodeType('roof'),
  // Position of the roof group center
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Child roof segment IDs
  children: z.array(RoofSegmentNode.shape.id).default([]),
  // Legacy dimensions used by simple roof renderer
  length: z.number().default(10),
  height: z.number().default(4),
  leftWidth: z.number().default(4),
  rightWidth: z.number().default(4),
}).describe(
  dedent`
  Roof node - a container for roof segments.
  Acts as a group that holds one or more RoofSegmentNodes.
  When not being edited, segments are visually combined into a single solid.
  - position: center position of the roof group
  - rotation: rotation around Y axis
  - children: array of RoofSegmentNode IDs
  - length: legacy overall length
  - height: legacy peak height
  - leftWidth: legacy left slope width
  - rightWidth: legacy right slope width
  `,
)

export type RoofNode = z.infer<typeof RoofNode>
