import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const RoundedPanelNode = BaseNode.extend({
  id: objectId('rounded-panel'),
  type: nodeType('rounded-panel'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.preprocess(
    (val) => (typeof val === 'number' ? [0, val, 0] : val),
    z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  ),
  length: z.number().min(0.01).max(20).default(1.0),
  width: z.number().min(0.01).max(20).default(0.5),
  thickness: z.number().min(0.005).max(2).default(0.04),
  cornerRadius: z.number().min(0).max(2).default(0.04),
  cornerSegments: z.number().int().min(1).max(12).default(4),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
}).describe(
  'Rounded rectangular panel primitive - thin bevelled panel/keycap/screen/cushion with rounded rectangular footprint.',
)

export type RoundedPanelNode = z.infer<typeof RoundedPanelNode>
