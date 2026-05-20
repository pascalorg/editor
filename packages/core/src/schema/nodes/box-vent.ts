import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const BoxVentNode = BaseNode.extend({
  id: objectId('bvent'),
  type: nodeType('box-vent'),

  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  width: z.number().default(0.4),
  depth: z.number().default(0.4),
  height: z.number().default(0.15),
  hoodOverhang: z.number().default(0.04),

  style: z.enum(['standard', 'low-profile', 'dome']).default('standard'),
}).describe(
  dedent`
  Box vent node — a small louvered ventilation box that sits on a roof slope.
  Often used in groups for attic exhaust ventilation. Parented to a
  roof-segment; position is segment-local. Rotation is around the
  segment's vertical axis (post-slope tilt).
  `,
)

export type BoxVentNode = z.infer<typeof BoxVentNode>
