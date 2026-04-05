import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const StairSegmentType = z.enum(['stair', 'landing'])

export type StairSegmentType = z.infer<typeof StairSegmentType>

export const AttachmentSide = z.enum(['front', 'left', 'right'])

export type AttachmentSide = z.infer<typeof AttachmentSide>

export const StairSegmentNode = BaseNode.extend({
  id: objectId('sseg'),
  type: nodeType('stair-segment'),
  material: MaterialSchema.optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around Y axis in radians
  rotation: z.number().default(0),
  // Stair or landing
  segmentType: StairSegmentType.default('stair'),
  // Width of the stair flight / landing
  width: z.number().default(1.0),
  // Horizontal run (depth along travel direction)
  length: z.number().default(3.0),
  // Vertical rise (0 for landings)
  height: z.number().default(2.5),
  // Number of steps (only used for stair type)
  stepCount: z.number().default(10),
  // Which side of the previous segment to attach to
  attachmentSide: AttachmentSide.default('front'),
  // Whether to fill the underside down to floor level
  fillToFloor: z.boolean().default(true),
  // Thickness of the stair slab when not filled to floor
  thickness: z.number().default(0.25),
}).describe(
  dedent`
  Stair segment node - an individual flight or landing within a stair group.
  Each segment generates a complete stair/landing geometry.
  Multiple segments chain together to form complex staircase shapes (L-shape, U-shape, etc.).
  - segmentType: stair (with steps) or landing (flat platform)
  - width: width of the flight/landing
  - length: horizontal run distance
  - height: vertical rise (0 for landings)
  - stepCount: number of steps (stair type only)
  - attachmentSide: front, left, or right - which side of the previous segment to attach to
  - fillToFloor: whether to fill the underside down to the absolute floor level
  - thickness: slab thickness when not filled to floor
  `,
)

export type StairSegmentNode = z.infer<typeof StairSegmentNode>
