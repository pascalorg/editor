export type LinearUnit = 'metric' | 'imperial'
export type MeasurementDisplayPrecision = 'coarse' | 'standard' | 'fine'

const METERS_PER_FOOT = 0.3048
const FEET_PER_METER = 1 / METERS_PER_FOOT

type LinearControlValueOptions = {
  minMeters?: number
  maxMeters?: number
}

type MeasurementFormatOptions = {
  precision?: MeasurementDisplayPrecision
}

const METRIC_DECIMALS: Record<MeasurementDisplayPrecision, number> = {
  coarse: 1,
  standard: 2,
  fine: 3,
}

const AREA_DECIMALS: Record<MeasurementDisplayPrecision, number> = {
  coarse: 0,
  standard: 1,
  fine: 2,
}

const ANGLE_DECIMALS: Record<MeasurementDisplayPrecision, number> = {
  coarse: 0,
  standard: 1,
  fine: 2,
}

const IMPERIAL_INCH_DENOMINATOR: Record<MeasurementDisplayPrecision, number> = {
  coarse: 1,
  standard: 2,
  fine: 8,
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

function formatDecimal(value: number, decimals: number): string {
  return Number.parseFloat(value.toFixed(decimals)).toString()
}

function formatInches(inches: number, denominator: number): string {
  if (denominator === 1) return `${Math.round(inches)}"`

  const whole = Math.floor(inches)
  const numerator = Math.round((inches - whole) * denominator)
  if (numerator === 0) return `${whole}"`
  if (numerator === denominator) return `${whole + 1}"`
  return whole > 0 ? `${whole} ${numerator}/${denominator}"` : `${numerator}/${denominator}"`
}

export function formatLinearMeasurement(
  meters: number,
  unit: LinearUnit,
  options: MeasurementFormatOptions = {},
): string {
  if (!Number.isFinite(meters)) return '--'

  const absoluteMeters = Math.abs(meters)
  const precision = options.precision ?? 'standard'

  if (unit === 'imperial') {
    const feet = metersToLinearUnit(absoluteMeters, unit)
    let wholeFeet = Math.floor(feet)
    const denominator = IMPERIAL_INCH_DENOMINATOR[precision]
    let inches = Math.round((feet - wholeFeet) * 12 * denominator) / denominator
    if (inches >= 12) {
      wholeFeet += 1
      inches = 0
    }

    const sign = meters < 0 && (wholeFeet !== 0 || inches !== 0) ? '-' : ''

    return `${sign}${wholeFeet}'${formatInches(inches, denominator)}`
  }

  const roundedMeters = Number.parseFloat(absoluteMeters.toFixed(METRIC_DECIMALS[precision]))
  const sign = meters < 0 && roundedMeters !== 0 ? '-' : ''

  return `${sign}${roundedMeters}m`
}

export function formatAreaMeasurement(
  squareMeters: number,
  unit: LinearUnit,
  options: MeasurementFormatOptions = {},
): string {
  if (!Number.isFinite(squareMeters)) return '--'

  const absoluteSquareMeters = Math.abs(squareMeters)
  const precision = options.precision ?? 'standard'

  if (unit === 'imperial') {
    const squareFeet = absoluteSquareMeters * FEET_PER_METER * FEET_PER_METER
    return `${formatDecimal(squareFeet, AREA_DECIMALS[precision])}ft²`
  }

  return `${formatDecimal(absoluteSquareMeters, AREA_DECIMALS[precision])}m²`
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

export function formatAngleMeasurement(
  radians: number,
  options: MeasurementFormatOptions = {},
): string {
  if (!Number.isFinite(radians)) return '--'
  const precision = options.precision ?? 'standard'
  return `${formatDecimal((radians * 180) / Math.PI, ANGLE_DECIMALS[precision])}°`
}
