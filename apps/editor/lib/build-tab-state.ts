import type { RoofType } from '@pascal-app/core'

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

const CONICAL_ROOF_FOOTPRINT_SOURCES = [
  ROOF_FOOTPRINT_SOURCES[1],
  ROOF_FOOTPRINT_SOURCES[2],
] as const

const STANDARD_ROOF_FOOTPRINT_SOURCES = [
  ROOF_FOOTPRINT_SOURCES[0],
  ROOF_FOOTPRINT_SOURCES[2],
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

export const ROOF_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: RoofType }> = [
  { label: 'Hip', value: 'hip' },
  { label: 'Gable', value: 'gable' },
  { label: 'Shed', value: 'shed' },
  { label: 'Flat', value: 'flat' },
  { label: 'Gambrel', value: 'gambrel' },
  { label: 'Dutch', value: 'dutch' },
  { label: 'Mansard', value: 'mansard' },
  { label: 'Conical', value: 'conical' },
]

export function getActiveRoofFeatureId(
  features: readonly RoofFeatureIdentity[],
  activeTool: string | null | undefined,
): string | null {
  if (!activeTool) return null
  return features.find((feature) => feature.kind === activeTool)?.id ?? null
}
