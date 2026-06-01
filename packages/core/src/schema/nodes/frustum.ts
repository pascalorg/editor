import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const FrustumNode = BaseNode.extend({
  id: objectId('frustum'),
  type: nodeType('frustum'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  radiusTop: z.number().min(0.001).max(10).default(0.25),
  radiusBottom: z.number().min(0.001).max(10).default(0.5),
  height: z.number().min(0.01).max(20).default(1),
  radialSegments: z.number().int().min(8).max(64).default(32),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Frustum primitive - truncated cone / circular taper for cups, flower pots, lamp bases, table legs, and industrial fittings.',
)

export type FrustumNode = z.infer<typeof FrustumNode>
