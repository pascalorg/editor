import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const SweepNode = BaseNode.extend({
  id: objectId('sweep'),
  type: nodeType('sweep'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  path: z
    .array(z.tuple([z.number(), z.number(), z.number()]))
    .min(2)
    .max(64)
    .default([
      [-0.5, 0, 0],
      [0.5, 0, 0],
    ]),
  radius: z.number().min(0.005).max(2).default(0.03),
  tubularSegments: z.number().int().min(2).max(128).default(24),
  radialSegments: z.number().int().min(3).max(32).default(12),
  closed: z.boolean().default(false),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Sweep primitive - circular tube swept along a 3D path for cables, hoses, curved handles, rails, and piping.',
)

export type SweepNode = z.infer<typeof SweepNode>
