import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { FenceFeature } from './fence'

const fields = FenceFeature.omit({ id: true, kind: true }).shape
export const FenceGateNode = BaseNode.extend({
  ...fields,
  id: objectId('fence-gate'),
  type: nodeType('fence-gate'),
  center: fields.center.default(1.5),
  width: fields.width.min(0.35).default(1.1),
}).describe('An individually selectable gate hosted by a fence')
export const FenceOpeningNode = BaseNode.extend({
  center: fields.center.default(1.5),
  width: fields.width.min(0.35).default(1.1),
  matchFenceStyle: z.boolean().optional(),
  matchFenceHeight: fields.matchFenceHeight,
  height: fields.height,
  showPosts: z.boolean().default(true),
  id: objectId('fence-opening'),
  type: nodeType('fence-opening'),
}).describe('An individually selectable open passage hosted by a fence')
export type FenceGateNode = z.infer<typeof FenceGateNode>
export type FenceOpeningNode = z.infer<typeof FenceOpeningNode>
export type FenceFeatureNode = FenceGateNode | FenceOpeningNode
