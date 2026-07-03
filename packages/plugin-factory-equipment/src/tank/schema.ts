import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const TankOrientation = z.enum(['vertical', 'horizontal'])
export type TankOrientation = z.infer<typeof TankOrientation>

export const FactoryTankNode = BaseNode.extend({
  id: objectId('factory-tank'),
  type: nodeType('factory:tank'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  orientation: TankOrientation.default('vertical'),
  length: z.number().positive().default(2.4),
  width: z.number().positive().default(1.4),
  height: z.number().positive().default(2.8),
  capacity: z.number().nonnegative().default(5),
  inletDiameter: z.number().positive().default(0.12),
  outletDiameter: z.number().positive().default(0.12),
  liquidLevel: z.number().min(0).max(1).default(0.5),
  shellColor: z.string().default('#94a3b8'),
  bandColor: z.string().default('#475569'),
  liquidColor: z.string().default('#38bdf8'),
})

export type FactoryTankNode = z.infer<typeof FactoryTankNode>
