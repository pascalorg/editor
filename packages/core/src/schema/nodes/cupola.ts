import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const CupolaNode = BaseNode.extend({
  id: objectId('cupola'),
  type: nodeType('cupola'),

  material: MaterialSchema.optional(),
  // Default to the white preset so a freshly-placed cupola reads as clean
  // painted metal and the paint inspector shows "White" (matches box-vent).
  materialPreset: z.string().default('preset-white'),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  // Cupolas are larger than the other vents — a roof lantern, not a cap.
  width: z.number().default(0.8),
  depth: z.number().default(0.8),
  height: z.number().default(1.0),

  // Roof cap shape: `dome` (round) or `pyramid` (four-sided point).
  roofStyle: z.enum(['dome', 'pyramid']).default('dome'),
  // Decorative post + ball at the apex.
  finial: z.boolean().default(true),
}).describe(
  dedent`
  Cupola — a louvered roof lantern that sits astride a roof ridge or slope:
  a louvered body topped by a dome or pyramid roof, optionally crowned with
  a finial. Parented to a roof-segment; position is segment-local. Rotation
  is around the segment's vertical axis (post-slope tilt).
  `,
)

export type CupolaNode = z.infer<typeof CupolaNode>
