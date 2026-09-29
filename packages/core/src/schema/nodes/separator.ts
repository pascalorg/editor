import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const SeparatorNode = BaseNode.extend({
  id: objectId('separator'),
  type: nodeType('separator'),
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
}).describe(
  'A virtual, zero-thickness room boundary. A level child with start and end in level-local XZ metres; no physical wall body.',
)

export type SeparatorNode = z.infer<typeof SeparatorNode>
