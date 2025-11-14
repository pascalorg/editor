import z from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'

export const ItemNode = z.object({
  id: nodeId('item'),
  name: z.string(),
})

export type ItemNode = z.infer<typeof ItemNode>
