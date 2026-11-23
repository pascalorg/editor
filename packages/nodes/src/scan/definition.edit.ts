import type { NodeEditContribution } from '../definition-contributions'
import { scanParametrics } from './parametrics'
import type { ScanNode } from './schema'

export const scanEditContribution: NodeEditContribution<typeof ScanNode> = {
  parametrics: scanParametrics,
}
