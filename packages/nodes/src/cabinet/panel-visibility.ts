import type { CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import { resolveCabinetType } from './run-ops'

export function cabinetModuleSupportsTopFinish({
  module,
  parentIsModule,
  parentRun,
}: {
  module: CabinetModuleNode
  parentIsModule: boolean
  parentRun?: CabinetNode
}) {
  return (
    module.moduleKind === 'corner-filler' ||
    parentIsModule ||
    resolveCabinetType(module, parentRun) === 'tall' ||
    parentRun?.runTier === 'wall'
  )
}
