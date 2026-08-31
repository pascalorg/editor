import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Standalone refrigerant liquid line — the thin bare-copper line that carries
 * warm liquid out to the indoor coil. It is the line that used to be drawn as
 * the lineset's second rail; broken out here as its own polyline run so it can
 * be drawn on its own, including traced alongside an existing lineset.
 *
 * Path coordinates are level-local meters: [x, y, z] tuples, the same space as
 * lineset and duct paths. Diameter is nominal copper OD in inches.
 */
export const LiquidLineNode = BaseNode.extend({
  id: objectId('liquid-line'),
  type: nodeType('liquid-line'),
  // Polyline path in level-local meters. Minimum two points (start, end).
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  // Nominal copper OD in inches. Common residential sizes are 1/4"–3/8".
  diameter: z.number().min(0.125).max(1).default(0.375),
}).describe(
  dedent`
  Standalone refrigerant liquid line - a thin bare-copper polyline run.
  - path: list of [x, y, z] points in level-local meters (min 2)
  - diameter: nominal copper OD in inches (typ. 1/4"-3/8")
  `,
)
export type LiquidLineNode = z.infer<typeof LiquidLineNode>
export type LiquidLineNodeId = LiquidLineNode['id']
