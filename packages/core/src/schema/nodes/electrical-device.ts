import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Electrical device — a point-placed fixture: outlet, switch, luminaire,
 * junction box, or distribution panel. Position is in level-local meters;
 * rotation is yaw around Y in radians.
 */
export const ElectricalDeviceNode = BaseNode.extend({
  id: objectId('electrical-device'),
  type: nodeType('electrical-device'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw around Y axis, radians.
  rotation: z.number().default(0),
  deviceType: z
    .enum(['outlet', 'switch', 'light', 'junction-box', 'panel'])
    .default('outlet'),
  mounting: z.enum(['wall', 'ceiling', 'floor']).default('wall'),
  circuitId: z.string().optional(),
  voltage: z.union([z.literal(127), z.literal(220)]).default(127),
}).describe(
  dedent`
  Electrical device - outlet, switch, light fixture, junction box, or distribution panel.
  - position: [x, y, z] in level-local meters
  - rotation: yaw angle in radians
  - deviceType: outlet | switch | light | junction-box | panel
  - mounting: wall | ceiling | floor
  - circuitId: optional circuit reference label
  - voltage: 127 (standard) | 220 (high-voltage)
  `,
)
export type ElectricalDeviceNode = z.infer<typeof ElectricalDeviceNode>
export type ElectricalDeviceNodeId = ElectricalDeviceNode['id']
