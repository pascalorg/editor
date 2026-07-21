const INCHES_PER_METER = 1 / 0.0254
const IMPERIAL_FRACTION_DENOMINATOR = 16

export type ConstructionLinearUnit = 'metric' | 'imperial'
export type ConstructionLengthProfile = 'editor' | 'document'
export type ConstructionMetricNotation = 'meters' | 'millimeters'
export type ConstructionImperialPrecision = '1' | '1/2' | '1/4' | '1/8' | '1/16'

export type ConstructionLengthFormatOptions = {
  metricNotation?: ConstructionMetricNotation
  imperialPrecision?: ConstructionImperialPrecision
}

export function formatConstructionLength(
  meters: number,
  unit: ConstructionLinearUnit,
  profile: ConstructionLengthProfile = 'editor',
  options: ConstructionLengthFormatOptions = {},
): string {
  if (!Number.isFinite(meters)) return '--'

  if (unit === 'metric') {
    if (profile === 'document' || options.metricNotation === 'millimeters') {
      return `${Math.round(meters * 1000)}`
    }

    const rounded = Number.parseFloat(Math.abs(meters).toFixed(2))
    const sign = meters < 0 && rounded !== 0 ? '-' : ''
    return `${sign}${rounded}m`
  }

  const sign = meters < 0 ? '-' : ''
  const denominator = imperialPrecisionDenominator(options.imperialPrecision)
  const totalFractionUnits = Math.round(Math.abs(meters) * INCHES_PER_METER * denominator)
  const unitsPerFoot = 12 * denominator
  const feet = Math.floor(totalFractionUnits / unitsPerFoot)
  const remainder = totalFractionUnits - feet * unitsPerFoot
  const inches = Math.floor(remainder / denominator)
  const numerator = remainder - inches * denominator
  const fraction = formatFraction(numerator, denominator)
  const inchText = fraction ? `${inches} ${fraction}` : `${inches}`

  if (feet === 0) return `${sign}${inchText}"`
  return `${sign}${feet}'-${inchText}"`
}

function imperialPrecisionDenominator(precision?: ConstructionImperialPrecision): number {
  switch (precision) {
    case '1':
      return 1
    case '1/2':
      return 2
    case '1/4':
      return 4
    case '1/8':
      return 8
    default:
      return IMPERIAL_FRACTION_DENOMINATOR
  }
}

function formatFraction(numerator: number, denominator: number): string {
  if (numerator === 0) return ''
  const divisor = greatestCommonDivisor(numerator, denominator)
  return `${numerator / divisor}/${denominator / divisor}`
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right !== 0) {
    const next = left % right
    left = right
    right = next
  }
  return left || 1
}
