import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Pressurized water supply line — cold or hot water runs as a polyline.
 * Unlike DWV pipe segments, water lines run at positive pressure and need
 * no slope. Path coordinates are level-local meters.
 */
export const WaterLineNode = BaseNode.extend({
  id: objectId('water-line'),
  type: nodeType('water-line'),
  // Polyline path in level-local meters. Minimum two points.
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  // Nominal pipe size in inches. Residential supply: ¾ main, ½ branches.
  diameter: z.number().min(0.25).max(4).default(0.75),
  pipeMaterial: z.enum(['pvc', 'cpvc', 'pex', 'copper']).default('pex'),
  system: z.enum(['cold-water', 'hot-water']).default('cold-water'),
}).describe(
  dedent`
  Water supply pipe - pressurized water line (cold or hot) as a polyline of 3D points.
  - path: list of [x, y, z] points in level-local meters (min 2)
  - diameter: nominal size in inches (0.5 / 0.75 / 1 typical residential)
  - pipeMaterial: pvc | cpvc | pex | copper
  - system: cold-water | hot-water
  `,
)
export type WaterLineNode = z.infer<typeof WaterLineNode>
export type WaterLineNodeId = WaterLineNode['id']
