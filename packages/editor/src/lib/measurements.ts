export type LinearUnit = 'metric' | 'imperial'

const METERS_PER_FOOT = 0.3048
const FEET_PER_METER = 1 / METERS_PER_FOOT

type LinearControlValueOptions = {
  minMeters?: number
  maxMeters?: number
}

export function metersToLinearUnit(meters: number, unit: LinearUnit): number {
  return unit === 'imperial' ? meters * FEET_PER_METER : meters
}

export function linearUnitToMeters(value: number, unit: LinearUnit): number {
  return unit === 'imperial' ? value * METERS_PER_FOOT : value
}

export function linearControlValueToMeters(
  value: number,
  unit: LinearUnit,
  options: LinearControlValueOptions = {},
): number {
  const meters = linearUnitToMeters(value, unit)
  const minMeters = options.minMeters ?? Number.NEGATIVE_INFINITY
  const maxMeters = options.maxMeters ?? Number.POSITIVE_INFINITY

  return Math.min(Math.max(meters, minMeters), maxMeters)
}

export function getLinearUnitLabel(unit: LinearUnit): string {
  return unit === 'imperial' ? 'ft' : 'm'
}

export function formatLinearMeasurement(meters: number, unit: LinearUnit): string {
  if (!Number.isFinite(meters)) return '--'

  const absoluteMeters = Math.abs(meters)

  if (unit === 'imperial') {
    const feet = metersToLinearUnit(absoluteMeters, unit)
    let wholeFeet = Math.floor(feet)
    let inches = Math.round((feet - wholeFeet) * 12)
    if (inches === 12) {
      wholeFeet += 1
      inches = 0
    }

    const sign = meters < 0 && (wholeFeet !== 0 || inches !== 0) ? '-' : ''

    return `${sign}${wholeFeet}'${inches}"`
  }

  const roundedMeters = Number.parseFloat(absoluteMeters.toFixed(2))
  const sign = meters < 0 && roundedMeters !== 0 ? '-' : ''

  return `${sign}${roundedMeters}m`
}
