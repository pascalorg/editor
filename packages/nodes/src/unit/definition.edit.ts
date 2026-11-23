import type { NodeEditContribution } from '../definition-contributions'
import { unitParametrics } from './parametrics'
import type { UnitNode } from './schema'

export const unitEditContribution: NodeEditContribution<typeof UnitNode> = {
  parametrics: unitParametrics,
}
