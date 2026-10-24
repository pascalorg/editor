import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/** Single refrigerant suction route, retaining the persisted `lineset` kind.
 * The liquid route uses `liquid-line`. Path points are level-local metres;
 * diameters are nominal copper OD in inches. */
export const LinesetNode = BaseNode.extend({
  id: objectId('lineset'),
  type: nodeType('lineset'),
  slots: z.record(z.string(), z.string()).optional(),
  // Polyline path in level-local meters. Minimum two points (start, end).
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  // Nominal suction-line copper OD in inches (the large insulated line).
  // Common residential sizes are 3/4"–1-1/8".
  suctionDiameter: z.number().min(0.25).max(2).default(0.875),
  // Retained when loading/saving old scenes; only liquid-line renders the liquid route.
  liquidDiameter: z.number().min(0.125).max(1).default(0.375),
  // Whether the suction line carries its foam insulation jacket. Bare = false.
  insulated: z.boolean().default(true),
}).describe(
  dedent`
  Refrigerant suction line linking a condenser to an indoor coil. The separate liquid-line node models the liquid route.
  - path: list of [x, y, z] points in level-local meters (min 2)
  - suctionDiameter: nominal copper OD in inches of the large insulated line (typ. 3/4"-1-1/8")
  - liquidDiameter: retained legacy data; does not change this suction-line geometry
  - insulated: whether the suction line wears its foam jacket
  `,
)
export type LinesetNode = z.infer<typeof LinesetNode>
export type LinesetNodeId = LinesetNode['id']
