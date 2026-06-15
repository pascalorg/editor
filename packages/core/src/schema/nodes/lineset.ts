import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Refrigerant lineset — the copper pipe pair that links the outdoor
 * condenser to the indoor coil (furnace / air handler) of a split system.
 * It is the refrigerant-side analogue of a duct run: a polyline of points,
 * but carrying two lines instead of one airway.
 *
 * Real linesets run a fat insulated SUCTION line (cool vapour back to the
 * compressor) beside a thin bare LIQUID line (warm liquid out to the coil).
 * The geometry builder draws a single copper line on the path centerline
 * (sized to `suctionDiameter`, wrapped in a foam jacket when `insulated`);
 * draw the liquid line as a second lineset rather than both off one path.
 *
 * Path coordinates are level-local meters: [x, y, z] tuples, same space as
 * duct paths and grid events. Diameters are nominal copper OD in inches.
 */
export const LinesetNode = BaseNode.extend({
  id: objectId('lineset'),
  type: nodeType('lineset'),
  // Polyline path in level-local meters. Minimum two points (start, end).
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  // Nominal suction-line copper OD in inches (the large insulated line).
  // Common residential sizes are 3/4"–1-1/8".
  suctionDiameter: z.number().min(0.25).max(2).default(0.875),
  // Nominal liquid-line copper OD in inches (the small bare line).
  // Common residential sizes are 1/4"–3/8".
  liquidDiameter: z.number().min(0.125).max(1).default(0.375),
  // Whether the suction line carries its foam insulation jacket. Bare = false.
  insulated: z.boolean().default(true),
}).describe(
  dedent`
  Refrigerant lineset - copper suction + liquid pair linking a condenser to an indoor coil.
  - path: list of [x, y, z] points in level-local meters (min 2)
  - suctionDiameter: nominal copper OD in inches of the large insulated line (typ. 3/4"-1-1/8")
  - liquidDiameter: nominal copper OD in inches of the small bare line (typ. 1/4"-3/8")
  - insulated: whether the suction line wears its foam jacket
  `,
)
export type LinesetNode = z.infer<typeof LinesetNode>
export type LinesetNodeId = LinesetNode['id']
