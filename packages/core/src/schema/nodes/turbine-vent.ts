import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const TurbineVentNode = BaseNode.extend({
  id: objectId('tvent'),
  type: nodeType('turbine-vent'),

  material: MaterialSchema.optional(),
  // Default to the white preset so a freshly-placed turbine reads as
  // clean painted/galvanised metal and the paint inspector shows "White"
  // as the current selection (matches box-vent's reasoning).
  materialPreset: z.string().default('preset-white'),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  // Overall diameter of the spinning head at its widest point.
  diameter: z.number().default(0.32),
  // Total height from the flange base to the top knob.
  height: z.number().default(0.42),
  // Height of the throat cylinder between the flange and the head. The
  // head occupies the remaining `height - neckHeight`.
  neckHeight: z.number().default(0.09),
  // How far the flange flashing flares past the throat on every side.
  baseOverhang: z.number().default(0.05),
  // Number of curved vanes around the head. More vanes read denser /
  // finer; fewer read as a chunkier industrial turbine.
  vaneCount: z.number().int().default(20),
  // Idle spin speed in radians/second. 0 = static (the head holds still),
  // which is the default — a newly-placed turbine starts paused and is set
  // spinning via the panel's Play toggle or the Spin Speed slider. Driven by
  // the renderer's `useFrame`, not stored per-frame.
  spinSpeed: z.number().default(0),

  // `globe`   → classic spherical whirlybird (bulged barrel + domed top)
  // `cylinder`→ straight-barrel turbine with a flat disc top
  style: z.enum(['globe', 'cylinder']).default('globe'),
}).describe(
  dedent`
  Turbine vent (whirlybird) — a wind-driven spinning exhaust vent that
  sits on a roof slope. A finned head spins on a throat above a flange.
  Parented to a roof-segment; position is segment-local. Rotation is
  around the segment's vertical axis (post-slope tilt).
  `,
)

export type TurbineVentNode = z.infer<typeof TurbineVentNode>
