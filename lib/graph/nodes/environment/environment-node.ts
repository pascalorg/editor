import { z } from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'

export const EnvironmentNode = z.object({
  id: nodeId('environment'),
  name: z.string(),
})
