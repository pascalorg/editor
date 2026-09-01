import type { RoofType } from '@pascal-app/core'

export type RoofFeatureIdentity = {
  id: string
  kind?: string
}

// Labels are resolved via i18n at render time — `value` is the stable key
// (used for `data-value` / state lookups / serialization), `labelKey` is the
// translator lookup. Both en.json and zh.json keep these in lockstep under
// `buildTab.*`.
type RoofFootprintSourceDescriptor = {
  value: RoofFootprintSource
  labelKey: string
}

const ROOF_FOOTPRINT_SOURCES: readonly RoofFootprintSourceDescriptor[] = [
  { value: 'room', labelKey: 'buildTab.roofSource.room' },
  { value: 'walls', labelKey: 'buildTab.roofSource.walls' },
  { value: 'draw', labelKey: 'buildTab.roofSource.draw' },
]

export type RoofFootprintSource = 'room' | 'walls' | 'draw'

const CONICAL_ROOF_FOOTPRINT_SOURCES = [ROOF_FOOTPRINT_SOURCES[1]] as const

const STANDARD_ROOF_FOOTPRINT_SOURCES = [
  ROOF_FOOTPRINT_SOURCES[2],
  ROOF_FOOTPRINT_SOURCES[0],
] as const

export function getRoofFootprintSources(roofType: RoofType) {
  return roofType === 'conical' ? CONICAL_ROOF_FOOTPRINT_SOURCES : STANDARD_ROOF_FOOTPRINT_SOURCES
}

export function getRoofFootprintSource(roofType: RoofType, value: unknown): RoofFootprintSource {
  const sources = getRoofFootprintSources(roofType)
  return sources.some((source) => source.value === value)
    ? (value as RoofFootprintSource)
    : sources[0].value
}

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