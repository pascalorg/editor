import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const BoxNode = BaseNode.extend({
  id: objectId('box'),
  type: nodeType('box'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  length: z.number().min(0.01).max(20).default(1.0),
  width: z.number().min(0.01).max(20).default(1.0),
  height: z.number().min(0.01).max(20).default(1.0),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Box (cuboid) primitive — configurable solid rectangular volume.',
)

export type BoxNode = z.infer<typeof BoxNode>
