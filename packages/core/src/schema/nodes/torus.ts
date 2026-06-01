import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const TorusNode = BaseNode.extend({
  id: objectId('torus'),
  type: nodeType('torus'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  majorRadius: z.number().min(0.01).max(10).default(0.5),
  tubeRadius: z.number().min(0.001).max(5).default(0.08),
  radialSegments: z.number().int().min(3).max(64).default(16),
  tubularSegments: z.number().int().min(8).max(128).default(48),
  arc: z
    .number()
    .min(0.01)
    .max(Math.PI * 2)
    .default(Math.PI * 2),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Torus primitive - donut/ring tube for tires, steering wheels, seals, fan rims, rings, and handles.',
)

export type TorusNode = z.infer<typeof TorusNode>
