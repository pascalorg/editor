import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

// A single drop outlet drilled in the gutter floor. A gutter can carry
// several so a long run can split between multiple downspouts (each
// downspout links to one outlet via its `outletId`).
export const GutterOutlet = z.object({
  // Stable id the downspout references. Generated with `generateId('outlet')`.
  id: z.string(),
  // Position along the gutter length (gutter-local +X), signed from the
  // CENTER. The geometry clamps it inside the end caps at build time, so
  // a stored value that no longer fits just rides the nearest bound.
  offset: z.number().default(0),
  // Bore diameter of this drop. Default 0.07 m ≈ 3″. The cross-section
  // SHAPE (round vs rectangular) follows the gutter's profile, not this.
  diameter: z.number().default(0.07),
})
export type GutterOutlet = z.infer<typeof GutterOutlet>

export const GutterNode = BaseNode.extend({
  id: objectId('gutter'),
  type: nodeType('gutter'),

  material: MaterialSchema.optional(),
  // White preset by default — matches the rest of the roof accessory
  // family (box-vent / ridge-vent) so the paint inspector reads as
  // "White" instead of "no material" on a freshly-placed gutter.
  materialPreset: z.string().default('preset-white'),

  roofSegmentId: z.string().optional(),
  // Segment-local. The placement tool snaps to the eave line (Z =
  // +depth/2, Y = wallHeight) of the segment under the cursor; X is
  // wherever the user clicked. After placement the inspector + length
  // handles can shift X along the eave.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Rotation around the gutter's own local Y. Kept at 0 by default
  // because the gutter's length axis is constrained to the eave
  // direction (segment-local +X) — but exposed in case the user wants
  // to tilt for a custom run.
  rotation: z.number().default(0),

  // Length along the eave (gutter-local +X).
  length: z.number().default(2.0),
  // Profile size — the vertical drop of the U-channel below the eave
  // line. 5″ (0.127 m) is the most common residential gutter size; 6″
  // (0.152 m) is the common commercial / heavy-duty size. Default
  // rounds the residential value to 0.13 m.
  size: z.number().default(0.13),
  // Wall thickness of the U-channel. Visible on the rim from above; too
  // thin reads as a paper strip, too thick reads as a curb.
  thickness: z.number().default(0.006),

  profile: z.enum(['k-style', 'half-round', 'box']).default('k-style'),

  // End caps close the open ends of the U-channel so water can't run
  // out the sides. Independent per-end because a downspout typically
  // joins the gutter at one end while the other stays capped. Default
  // true on both — matches a freshly-installed residential gutter.
  endCapLeft: z.boolean().default(true),
  endCapRight: z.boolean().default(true),

  // Hangers are the metal straps that hold the gutter onto the
  // fascia. 'strap' renders periodic bars across the rim; 'none'
  // hides them (some plastic gutters use hidden clips). Spacing is
  // metres between hanger centers; real residential code is roughly
  // 0.6 m for snow-load areas, 0.75 m elsewhere.
  hangerStyle: z.enum(['strap', 'none']).default('strap'),
  hangerSpacing: z.number().default(0.6),

  // Downspout outlets — short drop tubes descending from the gutter
  // floor where downspouts connect. Empty by default so existing
  // gutters don't sprout outlets on schema upgrade. Each is drilled
  // through the trough floor via CSG; a downspout links to one by id.
  outlets: z.array(GutterOutlet).default([]),
}).describe(
  dedent`
  Gutter — a rain-water channel running along the eave of a roof
  segment. Parented to a roof-segment; position is segment-local.
  - length: span along the eave (gutter-local +X)
  - size:   profile drop below the eave line (vertical extent)
  - profile: k-style (ogee fascia), half-round, or square box
  - endCapLeft / endCapRight: close the trough at gutter-local -X / +X
  - hangerStyle / hangerSpacing: visible metal straps across the rim
  - outlets: drop-tube outlets (id + along-length offset + bore diameter)
  `,
)

export type GutterNode = z.infer<typeof GutterNode>
