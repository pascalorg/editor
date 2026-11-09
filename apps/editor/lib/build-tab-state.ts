import type { MessageDescriptor, RoofType } from '@pascal-app/core'

export type RoofFeatureIdentity = {
  id: string
  kind?: string
}

const ROOF_FOOTPRINT_SOURCES = [
  { label: /* i18n */ { id: 'app.lib.buildTabState.room', message: 'Room' }, value: 'room' },
  { label: /* i18n */ { id: 'app.lib.buildTabState.wall', message: 'Wall' }, value: 'walls' },
  { label: /* i18n */ { id: 'app.lib.buildTabState.draw', message: 'Draw' }, value: 'draw' },
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

export const ROOF_TYPE_OPTIONS: ReadonlyArray<{ label: MessageDescriptor; value: RoofType }> = [
  { label: /* i18n */ { id: 'app.lib.buildTabState.hip', message: 'Hip' }, value: 'hip' },
  { label: /* i18n */ { id: 'app.lib.buildTabState.gable', message: 'Gable' }, value: 'gable' },
  { label: /* i18n */ { id: 'app.lib.buildTabState.shed', message: 'Shed' }, value: 'shed' },
  { label: /* i18n */ { id: 'app.lib.buildTabState.flat', message: 'Flat' }, value: 'flat' },
  {
    label: /* i18n */ { id: 'app.lib.buildTabState.gambrel', message: 'Gambrel' },
    value: 'gambrel',
  },
  { label: /* i18n */ { id: 'app.lib.buildTabState.dutch', message: 'Dutch' }, value: 'dutch' },
  {
    label: /* i18n */ { id: 'app.lib.buildTabState.mansard', message: 'Mansard' },
    value: 'mansard',
  },
  {
    label: /* i18n */ { id: 'app.lib.buildTabState.conical', message: 'Conical' },
    value: 'conical',
  },
]

export function getActiveRoofFeatureId(
  features: readonly RoofFeatureIdentity[],
  activeTool: string | null | undefined,
): string | null {
  if (!activeTool) return null
  return features.find((feature) => feature.kind === activeTool)?.id ?? null
}
