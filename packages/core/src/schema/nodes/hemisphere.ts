import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const HemisphereNode = BaseNode.extend({
  id: objectId('hemisphere'),
  type: nodeType('hemisphere'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
  radius: z.number().min(0.01).max(10).default(0.5),
  widthSegments: z.number().int().min(8).max(64).default(32),
  heightSegments: z.number().int().min(4).max(32).default(16),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Hemisphere primitive - closed half-sphere dome for buttons, camera covers, lamp covers, domes, and rounded housings.',
)

export type HemisphereNode = z.infer<typeof HemisphereNode>
