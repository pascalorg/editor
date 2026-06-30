import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Electrical conduit run — a protective tube carrying wiring, modeled as
 * a polyline. Supports EMT (thin-wall metallic), PVC (non-metallic), and
 * flexible conduit. Path coordinates are level-local meters.
 */
export const ElectricalConduitNode = BaseNode.extend({
  id: objectId('electrical-conduit'),
  type: nodeType('electrical-conduit'),
  // Polyline path in level-local meters. Minimum two points.
  path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  // Trade size in inches. Common: ½, ¾, 1, 1¼.
  diameter: z.number().min(0.5).max(4).default(0.75),
  conduitMaterial: z.enum(['emt', 'pvc', 'flex']).default('emt'),
  system: z.enum(['power', 'lighting', 'data']).default('power'),
  circuitId: z.string().optional(),
}).describe(
  dedent`
  Electrical conduit run as a polyline of 3D points.
  - path: list of [x, y, z] points in level-local meters (min 2)
  - diameter: trade size in inches (0.5 / 0.75 / 1 / 1.25 typical)
  - conduitMaterial: emt (metallic thin-wall) | pvc | flex
  - system: power | lighting | data
  - circuitId: optional circuit reference label
  `,
)
export type ElectricalConduitNode = z.infer<typeof ElectricalConduitNode>
export type ElectricalConduitNodeId = ElectricalConduitNode['id']
