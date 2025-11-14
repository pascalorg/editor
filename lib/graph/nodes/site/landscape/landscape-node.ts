import z from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'

export const LandscapeNode = z.object({
  id: nodeId('landscape'),
  name: z.string(),
})
