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

  // Length the pipe extends DOWN from the gutter outlet, in metres.
  // Default 2.5 m covers a typical residential storey; the placement
  // tool can default to the gutter's eave-Y minus building floor on
  // commit so the user doesn't have to set it on every drop.
  length: z.number().default(2.5),
  // Bore diameter, default 0.07 m ≈ 3″ to match the gutter outlet
  // default. Larger downspouts are common on commercial gutters.
  diameter: z.number().default(0.07),
}).describe(
  dedent`
  Downspout — a vertical pipe that takes water from a gutter outlet
  down to ground level. Parented to a roof-segment (scene-graph),
  linked to a specific gutter via gutterId for outlet position.
  - length:   vertical pipe length below the gutter outlet
  - diameter: bore diameter; should match the host gutter's outletDiameter
  `,
)

export type DownspoutNode = z.infer<typeof DownspoutNode>
