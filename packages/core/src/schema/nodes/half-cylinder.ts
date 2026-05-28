import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const HalfCylinderNode = BaseNode.extend({
  id: objectId('half-cylinder'),
  type: nodeType('half-cylinder'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  radius: z.number().min(0.01).max(10).default(0.5),
  height: z.number().min(0.01).max(20).default(1.0),
  radialSegments: z.number().int().min(8).max(64).default(24),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Half-cylinder primitive - semicircular extrusion with a flat cut face for arched covers, fenders, half pipes, and rounded housings.',
)

export type HalfCylinderNode = z.infer<typeof HalfCylinderNode>
