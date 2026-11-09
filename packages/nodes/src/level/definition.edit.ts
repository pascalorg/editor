import type { NodeEditContribution } from '../definition-contributions'
import { levelParametrics } from './parametrics'
import type { LevelNode } from './schema'

export const levelEditContribution: NodeEditContribution<typeof LevelNode> = {
  parametrics: levelParametrics,
}
