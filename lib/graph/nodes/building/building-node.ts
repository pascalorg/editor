import z from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'
import { LevelNode } from './level/level-node'

export const BuildingNode = z.object({
  id: nodeId('building'),
  name: z.string(),
  children: z.array(LevelNode),
})

export type BuildingNode = z.infer<typeof BuildingNode>
