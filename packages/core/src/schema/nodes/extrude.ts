import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ExtrudeNode = BaseNode.extend({
  id: objectId('extrude'),
  type: nodeType('extrude'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  profile: z
    .array(z.tuple([z.number(), z.number()]))
    .min(3)
    .max(256)
    .default([
      [-0.5, -0.25],
      [0.5, -0.25],
      [0.5, 0.25],
      [-0.5, 0.25],
    ]),
  holes: z
    .array(
      z
        .array(z.tuple([z.number(), z.number()]))
        .min(3)
        .max(128),
    )
    .max(16)
    .default([]),
  depth: z.number().min(0.005).max(10).default(0.1),
  bevelSize: z.number().min(0).max(1).default(0.01),
  bevelThickness: z.number().min(0).max(1).default(0.01),
  bevelSegments: z.number().int().min(0).max(12).default(2),
  curveSegments: z.number().int().min(1).max(32).default(8),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Extrude primitive - custom 2D profile extruded through depth for logos, brackets, handles, silhouettes, and non-rectangular panels.',
)

export type ExtrudeNode = z.infer<typeof ExtrudeNode>
