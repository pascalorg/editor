import z from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'
import { ItemNode } from '@/lib/graph/nodes/item/item-node'

export const CeilingNode = z.object({
  id: nodeId('ceiling'),
  name: z.string(),
  children: z.array(ItemNode),
})

export type CeilingNode = z.infer<typeof CeilingNode>
