import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const MeasurementPoint = z.tuple([z.number(), z.number(), z.number()])

export const MeasurementPointAttachment = z.object({
  buildingId: z.string().optional(),
  feature: z.discriminatedUnion('kind', [
    z.object({ index: z.number().int().nonnegative(), kind: z.literal('plan-anchor') }),
    z.object({
      index: z.number().int().nonnegative(),
      kind: z.literal('plan-segment'),
      t: z.number().min(0).max(1),
    }),
    z.object({ kind: z.literal('node-bounds'), normalized: MeasurementPoint }),
  ]),
  nodeId: z.string(),
  ownerNodeId: z.string().optional(),
})

export const MeasurementNode = BaseNode.extend({
  id: objectId('measurement'),
  type: nodeType('measurement'),
  measurementId: z.string(),
  start: MeasurementPoint,
  end: MeasurementPoint,
  view: z.enum(['2d', '3d']),
  measuredDistanceMeters: z.number().positive().optional(),
  startAttachment: MeasurementPointAttachment.optional(),
  endAttachment: MeasurementPointAttachment.optional(),
})

export type MeasurementNode = z.infer<typeof MeasurementNode>
export type MeasurementPointAttachment = z.infer<typeof MeasurementPointAttachment>
