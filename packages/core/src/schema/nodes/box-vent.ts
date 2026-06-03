import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const BoxVentNode = BaseNode.extend({
  id: objectId('bvent'),
  type: nodeType('box-vent'),

  material: MaterialSchema.optional(),
  // Default to the white preset so newly-placed vents read as clean
  // painted metal — and so the paint inspector shows "White" as the
  // current selection instead of an empty "no material" state, which
  // made it look like the vent had nothing applied even though the
  // renderer was falling back to white internally.
  materialPreset: z.string().default('preset-white'),

  roofSegmentId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),

  width: z.number().default(0.4),
  depth: z.number().default(0.4),
  height: z.number().default(0.15),
  // `cap` + `dome` only. Width of the flange skirt past the body. Ignored
  // by the `box` style (no flange).
  hoodOverhang: z.number().default(0.04),
  // `cap`-only: how much the pyramid hood narrows at the top. 0 = no
  // taper (flat-top column), 1 = comes to a point. ~0.4 reads as a
  // classic attic-vent cap. Ignored by `box` / `dome`.
  topTaper: z.number().default(0.4),
  // `cap`-only: absolute height of the chamfered cap section. The body
  // walls take up the rest of the total `height`. Together with
  // `topTaper`, this controls the visible chamfer angle.
  capHeight: z.number().default(0.07),
  // `cap`-only: vertical air gap between the body's closed top and the
  // cap's flange. Reads as the ventilation slot on real attic vents.
  // 0 = cap sits flush on the body (the original cap shape).
  capGap: z.number().default(0),
  // `dome`-only: radial decay of the dome cap. 1 = clean ellipsoid
  // (default — reads as a proper hemispherical dome), <1 = fuller pillow,
  // >1 = pointier. Ignored by `box` / `cap`.
  domeCurvature: z.number().default(1.0),
  // `box`-only: how much the lower (smaller) riser is inset from the
  // upper (larger) cover. 0 = same footprint as the cover.
  baseInset: z.number().default(0.06),
  // `box`-only: height of the lower riser. The upper cover takes up
  // the remaining `height - baseHeight`.
  baseHeight: z.number().default(0.04),
  // `box`-only: radius of the corner chamfer on both stacked boxes.
  // 0 = sharp corners.
  cornerBevel: z.number().default(0.012),

  // Migrate legacy style values (`standard` / `low-profile`) saved in
  // older scenes to the new three-way enum so old data keeps parsing.
  style: z.preprocess(
    (value) => {
      if (value === 'standard') return 'cap'
      if (value === 'low-profile') return 'box'
      return value
    },
    z.enum(['box', 'cap', 'dome']).default('cap'),
  ),
}).describe(
  dedent`
  Box vent node — a small louvered ventilation box that sits on a roof slope.
  Often used in groups for attic exhaust ventilation. Parented to a
  roof-segment; position is segment-local. Rotation is around the
  segment's vertical axis (post-slope tilt).
  `,
)

export type BoxVentNode = z.infer<typeof BoxVentNode>
