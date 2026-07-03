import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const PumpType = z.enum(['centrifugal', 'positive_displacement', 'metering'])
export type PumpType = z.infer<typeof PumpType>

export const FactoryPumpNode = BaseNode.extend({
  id: objectId('factory-pump'),
  type: nodeType('factory:pump'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  pumpType: PumpType.default('centrifugal'),
  length: z.number().positive().default(2.4),
  width: z.number().positive().default(1.1),
  height: z.number().positive().default(1.35),
  flowRate: z.number().nonnegative().default(120),
  motorPower: z.number().nonnegative().default(15),
  inletDiameter: z.number().positive().default(0.15),
  outletDiameter: z.number().positive().default(0.1),
  skidMounted: z.boolean().default(true),
  casingColor: z.string().default('#4f7f93'),
  motorColor: z.string().default('#2563eb'),
  skidColor: z.string().default('#475569'),
})

export type FactoryPumpNode = z.infer<typeof FactoryPumpNode>
