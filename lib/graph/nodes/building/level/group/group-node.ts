import z from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'

export const GroupNode = z.object({
  id: nodeId('group'),
  name: z.string(),
  children: z.array(z.lazy(() => z.any())),
})

export type GroupNode = z.infer<typeof GroupNode>
