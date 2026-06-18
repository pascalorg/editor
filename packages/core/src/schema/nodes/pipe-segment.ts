import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * DWV pipe segment — drain / waste / vent runs in US residential
 * plumbing. Phase 2 of the distribution-system effort: the plumbing
 * sibling of `duct-segment`, sharing the polyline model and the typed
 * port machinery.
 *
 * The defining difference from ducts is SLOPE: drains must fall
 * (IPC: ¼" per foot for pipes under 3", ⅛" allowed at 3"+). Slope is
 * stored implicitly in the path's Y coordinates — the draw tool drops
 * Y as you draw a waste run; vents run level or vertical.
 *
 * Path coordinates are level-local meters. Y may be negative (drains
 * drop below the floor into the joist / crawl space).
 */
export const PipeSegmentNode = BaseNode.extend({
  id: objectId('pipe-segment'),
  type: nodeType('pipe-segment'),
  // Polyline path in level-local meters. Minimum two points.
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  // Nominal pipe size in inches. Residential DWV: 1¼ (lav tailpiece) to
  // 4 (building drain); 6 covers oversized mains.
  diameter: z.number().min(1.25).max(8).default(2),
  pipeMaterial: z.enum(['pvc', 'abs', 'cast-iron']).default('pvc'),
  // Which DWV role the run plays. Waste carries water (sloped); vent
  // carries air (level or vertical, dashed in plan).
  system: z.enum(['waste', 'vent']).default('waste'),
}).describe(
  dedent`
  DWV pipe segment - drain / waste / vent run as a polyline of 3D points.
  - path: list of [x, y, z] points in level-local meters (min 2; y may go below the floor)
  - diameter: nominal size in inches (1.5 / 2 / 3 / 4 typical residential)
  - pipeMaterial: pvc | abs | cast-iron
  - system: waste (sloped drains) | vent (level / vertical air pipes)
  `,
)
export type PipeSegmentNode = z.infer<typeof PipeSegmentNode>
export type PipeSegmentNodeId = PipeSegmentNode['id']
