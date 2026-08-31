export const CREATABLE_MEASUREMENT_KINDS = [
  'distance',
  'angle',
  'area',
  'perimeter',
  'volume',
] as const

export type CreatableMeasurementKind = (typeof CREATABLE_MEASUREMENT_KINDS)[number]

export const DEFAULT_CREATABLE_MEASUREMENT_KIND: CreatableMeasurementKind = 'distance'

export function isCreatableMeasurementKind(value: unknown): value is CreatableMeasurementKind {
  return CREATABLE_MEASUREMENT_KINDS.includes(value as CreatableMeasurementKind)
}

export function normalizeCreatableMeasurementKind(value: unknown): CreatableMeasurementKind {
  return isCreatableMeasurementKind(value) ? value : DEFAULT_CREATABLE_MEASUREMENT_KIND
}
