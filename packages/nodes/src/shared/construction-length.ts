const INCHES_PER_METER = 1 / 0.0254
const IMPERIAL_FRACTION_DENOMINATOR = 16

export type ConstructionLinearUnit = 'metric' | 'imperial'

export function formatConstructionLength(meters: number, unit: ConstructionLinearUnit): string {
  if (!Number.isFinite(meters)) return '--'

  if (unit === 'metric') {
    const rounded = Number.parseFloat(Math.abs(meters).toFixed(2))
    const sign = meters < 0 && rounded !== 0 ? '-' : ''
    return `${sign}${rounded}m`
  }

  const sign = meters < 0 ? '-' : ''
  const totalFractionUnits = Math.round(
    Math.abs(meters) * INCHES_PER_METER * IMPERIAL_FRACTION_DENOMINATOR,
  )
  const unitsPerFoot = 12 * IMPERIAL_FRACTION_DENOMINATOR
  const feet = Math.floor(totalFractionUnits / unitsPerFoot)
  const remainder = totalFractionUnits - feet * unitsPerFoot
  const inches = Math.floor(remainder / IMPERIAL_FRACTION_DENOMINATOR)
  const numerator = remainder - inches * IMPERIAL_FRACTION_DENOMINATOR
  const fraction = formatFraction(numerator, IMPERIAL_FRACTION_DENOMINATOR)
  const inchText = fraction ? `${inches} ${fraction}` : `${inches}`

  if (feet === 0) return `${sign}${inchText}"`
  return `${sign}${feet}'-${inchText}"`
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
