import type { CabinetModuleNode as CabinetModuleNodeType } from '@pascal-app/core'
import { MAX_CABINET_WIDTH } from './resize-limits'
import { cabinetMetadataRecord } from './run-ops'

const PRESET_WIDTH_DEBT_KEY = 'cabinetPresetWidthDebtBySource'
const PRESET_NOMINAL_WIDTH_KEY = 'cabinetPresetNominalWidth'

export function presetWidthDebt(
  module: CabinetModuleNodeType,
  sourceId: CabinetModuleNodeType['id'],
): number {
  const value = cabinetMetadataRecord(module.metadata)[PRESET_WIDTH_DEBT_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const debt = (value as Record<string, unknown>)[sourceId]
  return typeof debt === 'number' && debt > 0 ? debt : 0
}

export function metadataWithPresetWidthDebt(
  module: CabinetModuleNodeType,
  sourceId: CabinetModuleNodeType['id'],
  widthDelta: number,
): CabinetModuleNodeType['metadata'] {
  const metadata = cabinetMetadataRecord(module.metadata)
  const value = metadata[PRESET_WIDTH_DEBT_KEY]
  const debts =
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {}
  const nextDebt = Math.max(0, presetWidthDebt(module, sourceId) - widthDelta)
  if (nextDebt > 1e-4) debts[sourceId] = nextDebt
  else delete debts[sourceId]
  const nextMetadata = { ...metadata }
  if (widthDelta < -1e-4 && typeof nextMetadata[PRESET_NOMINAL_WIDTH_KEY] !== 'number') {
    nextMetadata[PRESET_NOMINAL_WIDTH_KEY] = module.width
  }
  if (Object.keys(debts).length > 0) nextMetadata[PRESET_WIDTH_DEBT_KEY] = debts
  else delete nextMetadata[PRESET_WIDTH_DEBT_KEY]
  return nextMetadata as CabinetModuleNodeType['metadata']
}

export function metadataForSelectedWidth(
  module: CabinetModuleNodeType,
  width: number,
  patchMetadata?: CabinetModuleNodeType['metadata'],
): CabinetModuleNodeType['metadata'] {
  const metadata = cabinetMetadataRecord(patchMetadata ?? module.metadata)
  const { [PRESET_WIDTH_DEBT_KEY]: _removed, ...rest } = metadata
  return { ...rest, [PRESET_NOMINAL_WIDTH_KEY]: width } as CabinetModuleNodeType['metadata']
}

export function presetNominalWidth(module: CabinetModuleNodeType): number {
  const value = cabinetMetadataRecord(module.metadata)[PRESET_NOMINAL_WIDTH_KEY]
  return typeof value === 'number' && value >= module.width ? value : MAX_CABINET_WIDTH
}

export function recordedPresetNominalWidth(module: CabinetModuleNodeType): number {
  const value = cabinetMetadataRecord(module.metadata)[PRESET_NOMINAL_WIDTH_KEY]
  return typeof value === 'number' && value >= module.width ? value : module.width
}
