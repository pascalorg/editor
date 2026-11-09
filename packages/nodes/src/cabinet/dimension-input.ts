import { parseMeasurement } from '@pascal-app/editor'

export function parseCabinetDimensionInput(
  input: string,
  options: {
    locale: string
    metricNotation: 'meters' | 'millimeters'
    unit: 'metric' | 'imperial'
  },
): number | null {
  return parseMeasurement(
    input,
    { kind: 'length', unitId: 'm' },
    {
      bareUnit:
        options.unit === 'imperial' ? 'in' : options.metricNotation === 'millimeters' ? 'mm' : 'm',
      locale: options.locale,
      system: options.unit === 'imperial' ? 'imperial' : 'metric',
    },
  )
}
