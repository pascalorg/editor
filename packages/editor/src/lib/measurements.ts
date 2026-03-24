export type UnitSystem = 'metric' | 'imperial'

export const METERS_PER_INCH = 0.0254
export const INCHES_PER_FOOT = 12
export const METERS_PER_FOOT = METERS_PER_INCH * INCHES_PER_FOOT
export const SQUARE_FEET_PER_SQUARE_METER = 10.763910416709722

const trimFixed = (value: number, precision: number) =>
  value
    .toFixed(precision)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')

const formatMetricLength = (meters: number, precision?: number) => {
  const resolvedPrecision =
    precision ?? (Math.abs(meters) >= 10 ? 1 : Math.abs(meters) >= 1 ? 2 : 3)
  return trimFixed(meters, resolvedPrecision)
}

const formatImperialLength = (
  meters: number,
  options?: {
    includeZeroInches?: boolean
  },
) => {
  const totalInches = Math.round(Math.abs(meters) / METERS_PER_INCH)
  const feet = Math.floor(totalInches / INCHES_PER_FOOT)
  const inches = totalInches % INCHES_PER_FOOT
  const sign = meters < 0 ? '-' : ''

  if (feet > 0) {
    if (inches > 0 || options?.includeZeroInches) {
      return `${sign}${feet}' ${inches}"`
    }
    return `${sign}${feet}'`
  }

  return `${sign}${inches}"`
}

const parseMetricLength = (value: string) => {
  const match = value.match(
    /^(-?\d+(?:\.\d+)?)\s*(mm|millimeters?|cm|centimeters?|m|meters?|metres?)$/,
  )
  if (!match) return null

  const amount = Number.parseFloat(match[1]!)
  const unit = match[2]!

  if (!Number.isFinite(amount)) return null
  if (unit.startsWith('mm')) return amount / 1000
  if (unit.startsWith('cm')) return amount / 100
  return amount
}

const parseImperialLength = (value: string) => {
  const normalized = value
    .replace(/[′’]/g, "'")
    .replace(/[″”“]/g, '"')
    .replace(/\b(feet|foot|ft)\b/g, "'")
    .replace(/\b(inches|inch|in)\b/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

  if (!(normalized.includes("'") || normalized.includes('"'))) return null

  const sign = normalized.startsWith('-') ? -1 : 1
  const feetMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*'/)
  const inchesMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*"/)

  if (!(feetMatch || inchesMatch)) return null

  const feet = Math.abs(Number.parseFloat(feetMatch?.[1] ?? '0'))
  const inches = Math.abs(Number.parseFloat(inchesMatch?.[1] ?? '0'))

  if (!(Number.isFinite(feet) && Number.isFinite(inches))) return null

  return sign * (feet * METERS_PER_FOOT + inches * METERS_PER_INCH)
}

export const formatLength = (
  meters: number,
  unitSystem: UnitSystem,
  options?: {
    compact?: boolean
    includeZeroInches?: boolean
    precision?: number
  },
) => {
  if (!Number.isFinite(meters)) return '--'

  if (unitSystem === 'imperial') {
    return formatImperialLength(meters, {
      includeZeroInches: options?.includeZeroInches,
    })
  }

  const value = formatMetricLength(meters, options?.precision)
  return options?.compact ? `${value}m` : `${value} m`
}

export const formatLengthInputValue = (meters: number, unitSystem: UnitSystem) => {
  if (!Number.isFinite(meters)) return ''

  if (unitSystem === 'imperial') {
    return formatImperialLength(meters, { includeZeroInches: true })
  }

  return formatMetricLength(meters)
}

export const getLengthInputUnitLabel = (unitSystem: UnitSystem) =>
  unitSystem === 'imperial' ? 'ft/in' : 'm'

export const parseLengthInput = (value: string, preferredUnitSystem: UnitSystem) => {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  const imperial = parseImperialLength(normalized)
  if (imperial !== null) return imperial

  const metric = parseMetricLength(normalized)
  if (metric !== null) return metric

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed)) return null

  return preferredUnitSystem === 'imperial' ? parsed * METERS_PER_FOOT : parsed
}

export const formatArea = (squareMeters: number, unitSystem: UnitSystem) => {
  if (!Number.isFinite(squareMeters)) return '--'

  if (unitSystem === 'imperial') {
    const squareFeet = squareMeters * SQUARE_FEET_PER_SQUARE_METER
    const precision = squareFeet >= 100 ? 0 : squareFeet >= 10 ? 1 : 2
    return `${trimFixed(squareFeet, precision)} ft²`
  }

  const precision = squareMeters >= 100 ? 0 : squareMeters >= 10 ? 1 : 2
  return `${trimFixed(squareMeters, precision)} m²`
}
