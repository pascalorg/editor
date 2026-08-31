import type { CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import { resolveCabinetType } from './run-ops'
import type { CabinetCompartment } from './stack'

const FIXED_WIDTH_APPLIANCE_TYPES: ReadonlySet<CabinetCompartment['type']> = new Set([
  'oven',
  'microwave',
  'dishwasher',
  'sink',
  'cooktop-gas',
  'cooktop-induction',
  'pull-out-pantry',
  'fridge-single',
  'fridge-double',
  'fridge-top-freezer',
  'fridge-bottom-freezer',
])

export function cabinetModuleSupportsPresets(module: CabinetModuleNode) {
  return module.moduleKind !== 'corner-filler'
}

export function cabinetModuleUsesFixedApplianceWidth(module: CabinetModuleNode) {
  return (
    module.stack?.some((compartment) => FIXED_WIDTH_APPLIANCE_TYPES.has(compartment.type)) ?? false
  )
}

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
