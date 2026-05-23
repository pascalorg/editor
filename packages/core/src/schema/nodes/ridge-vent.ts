import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const RidgeVentNode = BaseNode.extend({
  id: objectId('rvent'),
  type: nodeType('ridge-vent'),

  material: MaterialSchema.optional(),
  // See note on box-vent: default to white so the paint inspector
  // reflects the current visual state instead of "no material".
  materialPreset: z.string().default('preset-white'),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  length: z.number().default(2.0),
  width: z.number().default(0.3),
  height: z.number().default(0.08),

  style: z.enum(['standard', 'shingled', 'metal']).default('standard'),
  endCaps: z.boolean().default(true),
}).describe(
  dedent`
  Ridge vent — a ventilation strip that sits along the ridge (peak) of a
  roof segment. Parented to a roof-segment; position is segment-local.
  - length: extent along the ridge
  - width: vent width straddling the ridge center
  - height: profile height above the ridge surface
  - style: standard (curved cap) / shingled / metal
  - endCaps: cap both ends or leave open
  `,
)

export type RidgeVentNode = z.infer<typeof RidgeVentNode>
