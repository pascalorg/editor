import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const CylinderNode = BaseNode.extend({
  id: objectId('cylinder'),
  type: nodeType('cylinder'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  radius: z.number().min(0.01).max(10).default(0.5),
  height: z.number().min(0.01).max(20).default(1.0),
  radialSegments: z.number().int().min(8).max(64).default(32),
  wallThickness: z.number().min(0.001).max(10).optional(),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Cylinder primitive — configurable cylindrical volume. Set wallThickness for a hollow tube.',
)

export type CylinderNode = z.infer<typeof CylinderNode>
