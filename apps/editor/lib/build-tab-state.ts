import type { RoofType } from '@pascal-app/core'
import type { MessageKey } from '@/lib/i18n'

export type RoofFeatureIdentity = {
  id: string
  kind?: string
}

const ROOF_FOOTPRINT_SOURCES = [
  { label: 'Room', value: 'room' },
  { label: 'Wall', value: 'walls' },
  { label: 'Draw', value: 'draw' },
] as const

export type RoofFootprintSource = (typeof ROOF_FOOTPRINT_SOURCES)[number]['value']

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

export const ROOF_TYPE_OPTIONS: ReadonlyArray<{
  label: string
  labelKey: MessageKey
  value: RoofType
}> = [
  { label: 'Hip', labelKey: 'roof.hip', value: 'hip' },
  { label: 'Gable', labelKey: 'roof.gable', value: 'gable' },
  { label: 'Shed', labelKey: 'roof.shed', value: 'shed' },
  { label: 'Flat', labelKey: 'roof.flat', value: 'flat' },
  { label: 'Gambrel', labelKey: 'roof.gambrel', value: 'gambrel' },
  { label: 'Dutch', labelKey: 'roof.dutch', value: 'dutch' },
  { label: 'Mansard', labelKey: 'roof.mansard', value: 'mansard' },
  { label: 'Conical', labelKey: 'roof.conical', value: 'conical' },
]

export function getActiveRoofFeatureId(
  features: readonly RoofFeatureIdentity[],
  activeTool: string | null | undefined,
): string | null {
  if (!activeTool) return null
  return features.find((feature) => feature.kind === activeTool)?.id ?? null
}
