import type { AnyNode, BatchableConfig } from '@pascal-app/core'
import type { CabinetModuleNode, CabinetNode } from './schema'
import { compartmentCooktopBurnersOn, stackForCabinet } from './stack'

/**
 * Cabinet runs and modules batch wherever they sit under a level: a run's
 * modules (and the wall units stacked on them) are released by the run's
 * edits, tint and gestures. Opening a door or drawer is a live override or a
 * dirty mark, both of which release. A cooktop with lit burners animates its
 * flames every frame and draws itself.
 */
export const cabinetBatchable: BatchableConfig = {
  scope: 'level',
  excluded: (node: AnyNode) =>
    stackForCabinet(node as CabinetNode | CabinetModuleNode).some(compartmentCooktopBurnersOn),
}
