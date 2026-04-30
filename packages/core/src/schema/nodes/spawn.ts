import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const SpawnNode = BaseNode.extend({
  id: objectId('spawn'),
  type: nodeType('spawn'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
})

export type SpawnNode = z.infer<typeof SpawnNode>
