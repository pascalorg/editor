import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const WedgeNode = BaseNode.extend({
  id: objectId('wedge'),
  type: nodeType('wedge'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  length: z.number().min(0.01).max(50).default(1),
  width: z.number().min(0.01).max(50).default(1),
  height: z.number().min(0.01).max(20).default(0.5),
  slopeAxis: z.enum(['x', 'z']).default('z'),
  slopeDirection: z.enum(['positive', 'negative']).default('positive'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Wedge primitive - sloped triangular prism for ramps, car hoods, keyboard side blocks, angled backs, and tapered covers.',
)

export type WedgeNode = z.infer<typeof WedgeNode>
