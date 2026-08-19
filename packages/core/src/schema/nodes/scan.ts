import { CaptureSessionLocatorSchema } from '@pascal-app/capture-protocol'
import { z } from 'zod'
import { AssetUrl } from '../asset-url'
import { BaseNode, nodeType, objectId } from '../base'

export const CaptureSessionReference = CaptureSessionLocatorSchema.extend({
  manifestUrl: AssetUrl.optional(),
})

export const ScanLayerVisibility = z
  .record(z.string().min(1), z.boolean())
  .default({ deviceMotion: true, model: true })
  .transform((layers): Record<string, boolean> => ({ deviceMotion: true, model: true, ...layers }))

export const ScanNode = BaseNode.extend({
  id: objectId('scan'),
  type: nodeType('scan'),
  url: AssetUrl.nullable().default(null),
  captureSession: CaptureSessionReference.nullable().default(null),
  layers: ScanLayerVisibility,
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.number().default(1),
  opacity: z.number().min(0).max(100).default(100),
})

export type CaptureSessionReference = z.infer<typeof CaptureSessionReference>
export type CaptureSessionReferenceInput = z.input<typeof CaptureSessionReference>
export type ScanLayerVisibility = z.infer<typeof ScanLayerVisibility>
export type ScanNode = z.infer<typeof ScanNode>
