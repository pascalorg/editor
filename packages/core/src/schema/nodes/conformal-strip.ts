import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const ConformalStripNode = BaseNode.extend({
  id: objectId('conformal-strip'),
  type: nodeType('conformal-strip'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  surface: z.enum(['ellipsoid-cylinder']).default('ellipsoid-cylinder'),
  side: z.enum(['left', 'right']).default('left'),
  xStart: z.number().min(-50).max(50).default(-0.5),
  xEnd: z.number().min(-50).max(50).default(0.5),
  verticalOffset: z.number().min(-20).max(20).default(0),
  width: z.number().min(0.001).max(20).default(0.04),
  thickness: z.number().min(0.0005).max(1).default(0.003),
  surfaceRadiusY: z.number().min(0.001).max(20).default(0.25),
  surfaceRadiusZ: z.number().min(0.001).max(20).default(0.25),
  surfaceLength: z.number().min(0.001).max(100).optional(),
  endTaper: z.number().min(0).max(0.95).default(0.28),
  segments: z.number().int().min(1).max(128).default(16),
  widthSegments: z.number().int().min(1).max(16).default(2),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Conformal strip primitive - a thin curved rectangular decal/stripe that follows an ellipsoid-cylinder surface such as an aircraft fuselage.',
)

export type ConformalStripNode = z.infer<typeof ConformalStripNode>
