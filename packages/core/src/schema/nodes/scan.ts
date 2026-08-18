import { z } from 'zod'
import { AssetUrl } from '../asset-url'
import { BaseNode, nodeType, objectId } from '../base'

export const CaptureSessionReference = z.object({
  sessionId: z.string().min(1),
  manifestUrl: AssetUrl,
  schemaVersion: z.number().int().positive().optional(),
})

export const ScanNode = BaseNode.extend({
  id: objectId('scan'),
  type: nodeType('scan'),
  url: AssetUrl.nullable().default(null),
  captureSession: CaptureSessionReference.nullable().default(null),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.number().default(1),
  opacity: z.number().min(0).max(100).default(100),
})

export type CaptureSessionReference = z.infer<typeof CaptureSessionReference>
export type CaptureSessionReferenceInput = z.input<typeof CaptureSessionReference>
export type ScanNode = z.infer<typeof ScanNode>
