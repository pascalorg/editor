import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const TrapezoidPrismNode = BaseNode.extend({
  id: objectId('trapezoid-prism'),
  type: nodeType('trapezoid-prism'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  length: z.number().min(0.01).max(50).default(1),
  width: z.number().min(0.01).max(50).default(1),
  height: z.number().min(0.01).max(20).default(0.5),
  topLengthScale: z.number().min(0.01).max(3).default(0.7),
  topWidthScale: z.number().min(0.01).max(3).default(0.7),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Trapezoid-prism primitive - tapered rectangular block with smaller/larger top face for appliance shells, plinths, tapered cushions, and stylized housings.',
)

export type TrapezoidPrismNode = z.infer<typeof TrapezoidPrismNode>
