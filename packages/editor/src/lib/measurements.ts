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

export function formatAreaMeasurement(squareMeters: number, unit: LinearUnit): string {
  if (!Number.isFinite(squareMeters)) return '--'

  const absoluteSquareMeters = Math.abs(squareMeters)

  if (unit === 'imperial') {
    const squareFeet = absoluteSquareMeters * FEET_PER_METER * FEET_PER_METER
    return `${Math.round(squareFeet).toLocaleString()}ft²`
  }

  return `${Number.parseFloat(absoluteSquareMeters.toFixed(1))}m²`
}

export function angleBetweenMeasurements(
  first: readonly [number, number, number],
  vertex: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const ax = first[0] - vertex[0]
  const ay = first[1] - vertex[1]
  const az = first[2] - vertex[2]
  const bx = second[0] - vertex[0]
  const by = second[1] - vertex[1]
  const bz = second[2] - vertex[2]
  const aLength = Math.hypot(ax, ay, az)
  const bLength = Math.hypot(bx, by, bz)
  if (aLength < 1e-4 || bLength < 1e-4) return 0
  const dot = (ax * bx + ay * by + az * bz) / (aLength * bLength)
  return Math.acos(Math.min(1, Math.max(-1, dot)))
}

export function formatAngleMeasurement(radians: number): string {
  if (!Number.isFinite(radians)) return '--'
  return `${Number.parseFloat(((radians * 180) / Math.PI).toFixed(1))}°`
}
