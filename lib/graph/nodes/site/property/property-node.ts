import z from 'zod'
import { nodeId } from '../../helpers'

export const PropertyNode = z.object({
  id: nodeId('property'),
  name: z.string(),
})

export type PropertyNode = z.infer<typeof PropertyNode>
