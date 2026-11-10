import type { NodeEditContribution } from '../definition-contributions'
import { guideParametrics } from './parametrics'
import type { GuideNode } from './schema'

export const guideEditContribution: NodeEditContribution<typeof GuideNode> = {
  parametrics: guideParametrics,
}
