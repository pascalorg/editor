import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const UNIT_KINDS = ['apartment', 'hotel-room', 'commercial', 'common'] as const
export type UnitKind = (typeof UNIT_KINDS)[number]
export const DEFAULT_UNIT_COLOR = '#f59e0b'

export const UnitNode = BaseNode.extend({
  id: objectId('unit'),
  type: nodeType('unit'),
  name: z.string().default('Unit'),
  kind: z.enum(UNIT_KINDS).default('apartment'),
  members: z.array(objectId('zone')).default([]),
  color: z.string().default(DEFAULT_UNIT_COLOR),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

export type UnitNode = z.infer<typeof UnitNode>
