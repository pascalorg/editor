import type { NodeEditContribution } from '../definition-contributions'
import { siteParametrics } from './parametrics'
import type { SiteNode } from './schema'

export const siteEditContribution: NodeEditContribution<typeof SiteNode> = {
  parametrics: siteParametrics,
}
