import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const LatheNode = BaseNode.extend({
  id: objectId('lathe'),
  type: nodeType('lathe'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  profile: z.array(z.tuple([z.number(), z.number()])).min(2).max(64).default([[0, 0], [0.5, 1]]),
  segments: z.number().int().min(8).max(128).default(32),
  arc: z.number().min(0.01).max(Math.PI * 2).default(Math.PI * 2),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Lathe primitive — a 2D profile revolved around the Y axis. Use for vases, bowls, bottles, lamp shades, bell shapes, and radially symmetric curved surfaces.',
)

export type LatheNode = z.infer<typeof LatheNode>
