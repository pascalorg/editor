import z from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'

export const TerrainNode = z.object({
  id: nodeId('terrain'),
  name: z.string(),
})

export type TerrainNode = z.infer<typeof TerrainNode>
