import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const DownspoutNode = BaseNode.extend({
  id: objectId('downspout'),
  type: nodeType('downspout'),

  material: MaterialSchema.optional(),
  // Match the gutter family default — paint inspector reads "White"
  // instead of "no material" on a freshly placed downspout.
  materialPreset: z.string().default('preset-white'),

  // Logical attachment: the gutter this downspout drains. Scene-graph
  // parent is the same roof-segment that hosts the gutter, so the
  // renderer can be reached through the segment's children list (like
  // every other roof accessory). gutterId then drives the LOOKUP of
  // outlet X/Z/diameter — the downspout's actual mount position is
  // derived from the gutter, not stored.
  gutterId: z.string().optional(),
  // Which of the host gutter's `outlets` this downspout drains, by the
  // outlet's `id`. The mount position, bore, and cross-section shape are
  // looked up from that outlet — so several downspouts on one gutter no
  // longer stack on a single drop.
  outletId: z.string().optional(),

  // Length the pipe extends DOWN from the gutter outlet, in metres.
  // Default 2.5 m covers a typical residential storey; the placement
  // tool can default to the gutter's eave-Y minus building floor on
  // commit so the user doesn't have to set it on every drop.
  length: z.number().default(2.5),
  // Bore diameter, default 0.07 m ≈ 3″ to match the gutter outlet
  // default. Larger downspouts are common on commercial gutters.
  diameter: z.number().default(0.07),
  // Gap between the pipe's wall-facing surface and the wall face, in
  // metres. The downspout's offset elbows step it back from the eave
  // overhang to the wall; this controls how far proud of the wall it
  // sits (real downspouts mount on standoff brackets ~1–2 cm off the
  // wall). Larger values pull the run back OUT toward the eave — the
  // escape hatch when the auto-routed wall position doesn't match the
  // actual wall (overshoots into it). Default 0.02 m.
  standoff: z.number().default(0.02),

  // Cross-section shape. 'auto' follows the host gutter's profile (round
  // on half-round, rectangular on k-style / box); 'round' / 'rect'
  // override it for a mixed look.
  shape: z.enum(['auto', 'round', 'rect']).default('auto'),

  // Wall straps clamping the run to the wall. 'band' renders periodic
  // bands; 'none' hides them. Spacing is metres between bands.
  strapStyle: z.enum(['band', 'none']).default('band'),
  strapSpacing: z.number().default(1.8),

  // What happens at the bottom of the run:
  //  - 'splash':   kickout elbow + a splash block on the ground (default)
  //  - 'kickout':  kickout elbow only (e.g. into a drain pipe)
  //  - 'straight': no kick — runs straight down (into a grade drain)
  terminal: z.enum(['splash', 'kickout', 'straight']).default('splash'),
}).describe(
  dedent`
  Downspout — a vertical pipe that takes water from a gutter outlet
  down to ground level. Parented to a roof-segment (scene-graph),
  linked to a specific gutter via gutterId for outlet position.
  - length:   vertical pipe length below the gutter outlet
  - diameter: bore diameter; should match the host gutter's outletDiameter
  - standoff: gap the pipe sits proud of the wall (pulls the run out toward the eave)
  - shape:    cross-section (auto follows the gutter profile, or force round / rect)
  - strapStyle / strapSpacing: wall straps clamping the run
  - terminal: bottom treatment (splash block, kickout only, or straight down)
  `,
)

export type DownspoutNode = z.infer<typeof DownspoutNode>
