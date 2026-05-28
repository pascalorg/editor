import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const SphereNode = BaseNode.extend({
  id: objectId('sphere'),
  type: nodeType('sphere'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
  radius: z.number().min(0.01).max(10).default(0.5),
  widthSegments: z.number().int().min(8).max(64).default(32),
  heightSegments: z.number().int().min(8).max(64).default(32),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Sphere primitive — configurable solid spherical volume. Use scale [sx, sy, sz] for ellipsoids (e.g. [2, 0.3, 1] for a flattened engine-hood dome).',
)

export type SphereNode = z.infer<typeof SphereNode>
