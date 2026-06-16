import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ConeNode = BaseNode.extend({
  id: objectId('cone'),
  type: nodeType('cone'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  radius: z.number().min(0.01).max(10).default(0.5),
  height: z.number().min(0.01).max(20).default(1),
  radialSegments: z.number().int().min(3).max(64).default(32),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Cone primitive - circular cone for traffic cones, tapered tips, lamp shades, roofs, and pointed mechanical parts.',
)

export type ConeNode = z.infer<typeof ConeNode>
