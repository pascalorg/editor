import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeId, nodeType } from '../base'

// Helper schemas
const SegmentTypeSchema = z.enum(['stair', 'landing'])
const AttachmentSideSchema = z.enum(['front', 'left', 'right'])

export const StairSegmentNode = BaseNode.extend({
  id: nodeId('stairsegment'),
  type: nodeType('stairsegment'),

  // Dimensions
  width: z.number().default(1.0),
  length: z.number().default(1.0), // Horizontal run
  height: z.number().default(2.0), // Vertical rise (0 for landing)

  // Logic
  segmentType: SegmentTypeSchema.default('stair'), // 'type' is reserved by BaseNode
  stepCount: z.number().default(10),
  attachmentSide: AttachmentSideSchema.default('front'),

  // Appearance
  fillToFloor: z.boolean().default(true),
  thickness: z.number().default(0.25),
}).describe(
  dedent`
  Stair segment node - used to represent a stair segment in the stair
  `,
)
export type StairSegmentNode = z.infer<typeof StairSegmentNode>

export const StairNode = BaseNode.extend({
  id: nodeId('stair'),
  type: nodeType('stair'),
  position: z.tuple([z.number(), z.number()]).default([0, 0]), // [x, y] on grid (world x, z)
  rotation: z.number().default(0), // rotation around Y
  elevation: z.number().optional(), // Height from floor
  size: z.tuple([z.number(), z.number()]).default([1, 3]), // Bounding box [width, length] roughly
  children: z.array(StairSegmentNode).default([]),
}).describe(
  dedent`
  Stair node - used to represent a stair in the building
  `,
)
export type StairNode = z.infer<typeof StairNode>
