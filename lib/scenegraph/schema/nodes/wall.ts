// lib/scenegraph/schema/nodes/wall.ts
import { z } from 'zod'
import { BaseNode, id, nodeType } from '../base'
import { DoorNode } from './door'
import { WindowNode } from './window'

export const WallNode = BaseNode.extend({
  id: id('wall'),
  type: nodeType('wall'),
  get children() {
    return z.array(z.discriminatedUnion('type', [DoorNode, WindowNode]))
  },
  // Specific props
  thickness: z.number().optional(),
  height: z.number().optional(),
  // e.g., start/end points for path
})

export type WallNode = z.infer<typeof WallNode>
