import type { RoofType } from '@pascal-app/core'

export type RoofFeatureIdentity = {
  id: string
  kind?: string
}

// `labelKey` is resolved at render time via `t()` from `buildTab.roofType.*`.
// `value` is the stable key (used for `data-value` / state lookups / serialization).
// The footprint-source picker UI that used to live here was removed upstream —
// that choice is now driven by `<ToolOptionsPanel kind="roof" />` reading
// `useRoofFootprintSource` directly.
export type RoofTypeOption = {
  value: RoofType
  labelKey: string
}

export const ROOF_TYPE_OPTIONS: readonly RoofTypeOption[] = [
  { value: 'hip', labelKey: 'buildTab.roofType.hip' },
  { value: 'gable', labelKey: 'buildTab.roofType.gable' },
  { value: 'shed', labelKey: 'buildTab.roofType.shed' },
  { value: 'flat', labelKey: 'buildTab.roofType.flat' },
  { value: 'gambrel', labelKey: 'buildTab.roofType.gambrel' },
  { value: 'dutch', labelKey: 'buildTab.roofType.dutch' },
  { value: 'mansard', labelKey: 'buildTab.roofType.mansard' },
  { value: 'conical', labelKey: 'buildTab.roofType.conical' },
]

export function getActiveRoofFeatureId(
  features: readonly RoofFeatureIdentity[],
  activeTool: string | null | undefined,
): string | null {
  if (!activeTool) return null
  return features.find((feature) => feature.kind === activeTool)?.id ?? null
}