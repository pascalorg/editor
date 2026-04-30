import { z } from 'zod'
import { AssetUrl } from '../asset-url'
import { BaseNode, nodeType, objectId } from '../base'

export const GuideScaleReference = z.object({
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  realLengthMeters: z.number().positive(),
  measuredLengthUnits: z.number().positive(),
  metersPerUnit: z.number().positive(),
  label: z.string(),
  visible: z.boolean().default(true),
})

export const GuideNode = BaseNode.extend({
  id: objectId('guide'),
  type: nodeType('guide'),
  url: AssetUrl,
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.number().default(1),
  opacity: z.number().min(0).max(100).default(50),
  locked: z.boolean().default(false),
  showIn3d: z.boolean().default(false),
  scaleReference: GuideScaleReference.nullable().default(null),
})

export type GuideScaleReference = z.infer<typeof GuideScaleReference>
export type GuideNode = z.infer<typeof GuideNode>
