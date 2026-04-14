import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'

export const FenceStyle = z.enum(['slat', 'rail', 'privacy'])
export const FenceBaseStyle = z.enum(['floating', 'grounded'])

export const FenceNode = BaseNode.extend({
  id: objectId('fence'),
  type: nodeType('fence'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  height: z.number().default(1.8),
  thickness: z.number().default(0.08),
  baseHeight: z.number().default(0.22),
  postSpacing: z.number().default(2),
  postSize: z.number().default(0.1),
  topRailHeight: z.number().default(0.04),
  groundClearance: z.number().default(0),
  edgeInset: z.number().default(0.015),
  baseStyle: FenceBaseStyle.default('grounded'),
  color: z.string().default('#ffffff'),
  style: FenceStyle.default('slat'),
}).describe(
  dedent`
  Fence node - used to represent a fence segment in the building/site level coordinate system
  - start/end: fence endpoints in level coordinate system
  - height/thickness: overall fence dimensions in meters
  - baseHeight/postSpacing/postSize/topRailHeight: exact geometric controls from the plan3D fence model
  - groundClearance/edgeInset/baseStyle: fence support and inset configuration
  - color/style: visual appearance options
  `,
)

export type FenceNode = z.infer<typeof FenceNode>
