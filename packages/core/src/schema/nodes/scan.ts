import { z } from 'zod'
import { AssetUrl } from '../asset-url'
import { BaseNode, nodeType, objectId } from '../base'

export const CaptureSessionReference = z.object({
  sessionId: z.string().min(1),
  manifestUrl: AssetUrl,
  schemaVersion: z.number().int().positive().optional(),
})

export const ScanLayerVisibility = z
  .object({
    model: z.boolean().default(true),
    deviceMotion: z.boolean().default(true),
  })
  .default({ model: true, deviceMotion: true })

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
