import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const EyebrowVentNode = BaseNode.extend({
  id: objectId('eyebrow-vent'),
  type: nodeType('eyebrow-vent'),

  material: MaterialSchema.optional(),
  // Default to the white preset so a freshly-placed vent reads as clean
  // painted metal and the paint inspector shows "White" (matches box-vent).
  materialPreset: z.string().default('preset-white'),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  // `width` is the opening width (left↔right across the louvered face),
  // `depth` the front-to-back projection along the roof, `height` the rise.
  width: z.number().default(0.5),
  depth: z.number().default(0.6),
  height: z.number().default(0.3),

  // Body shape:
  //  - `scoop`      : rounded louvered opening that sweeps back and tapers
  //                   into the flashing plate (the classic dormer "eyebrow").
  //  - `half-round` : a D-shaped half-round louver vent (flat louvered face,
  //                   semicircular curved top, short body).
  //  - `slant-box`  : a low box with a slanted top and a screened front.
  style: z.enum(['scoop', 'half-round', 'slant-box']).default('scoop'),

  // Number of horizontal louver slats across the front opening (0 = open /
  // screened only).
  louverCount: z.number().int().min(0).max(8).default(3),

  // `slant-box` only: the low rear edge as a fraction of the tall front edge.
  // 1 = flat-topped box, lower = the top slopes down more steeply toward the
  // back.
  backRatio: z.number().min(0.15).max(1).default(0.5),
}).describe(
  dedent`
  Eyebrow vent — a low roof ventilator with a rounded, louvered front that
  sits on a flashing plate. Three styles: a swept "scoop" eyebrow, a D-shaped
  "half-round" louver vent, and a "slant-box" hood. Parented to a roof-segment;
  position is segment-local. Rotation is around the segment's vertical axis
  (post-slope tilt).
  `,
)

export type EyebrowVentNode = z.infer<typeof EyebrowVentNode>
