import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const CapsuleNode = BaseNode.extend({
  id: objectId('capsule'),
  type: nodeType('capsule'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  radius: z.number().min(0.01).max(10).default(0.25),
  height: z.number().min(0.02).max(20).default(1.0),
  capSegments: z.number().int().min(1).max(16).default(6),
  radialSegments: z.number().int().min(8).max(64).default(32),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Capsule primitive - rounded-ended cylinder for pillows, bolsters, handles, rounded bars, and soft furniture forms.',
)

export type CapsuleNode = z.infer<typeof CapsuleNode>
