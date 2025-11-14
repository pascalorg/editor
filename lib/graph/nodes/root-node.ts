import { z } from 'zod'
import { BuildingNode } from './building/building-node'
import { SiteNode } from './site/site-node'

export const RootNode = z.object({
  site: SiteNode,
  buildings: z.array(BuildingNode),
})

export type RootNode = z.infer<typeof RootNode>
