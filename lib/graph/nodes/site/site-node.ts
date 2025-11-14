import z from 'zod'
import { nodeId } from '@/lib/graph/nodes/helpers'
import { EnvironmentNode } from '../environment/environment-node'

export const SiteNode = z.object({
  id: nodeId('site'),
  name: z.string(),
  children: z.array(EnvironmentNode),
})

export type SiteNode = z.infer<typeof SiteNode>
