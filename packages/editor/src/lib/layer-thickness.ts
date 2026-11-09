import type { LinearUnit } from './measurements'

const METRES_PER_INCH = 0.0254

/**
 * Imperial-friendly thickness input. Accepts `5/8`, `5/8"`, `7/16 in`,
 * `1-1/4"`, `1 1/2"`, `12mm`, `0.012m`. A bare number means INCHES in imperial
 * display and MILLIMETRES in metric — layers are millimetre-scale and
 * typing `0.0127` for half-inch board is nobody's idea of usable.
 */
export function parseLayerThickness(raw: string, unit: LinearUnit): number | null {
  const text = raw.trim().toLowerCase().replace(/["”]/g, ' in ')
  if (!text) return null
  const explicit = /(mm|cm|m|in|ft|')\s*$/.exec(text)
  const suffix = explicit?.[1]
  const body = (suffix ? text.slice(0, explicit?.index) : text).trim()

  // `1-1/4` / `1 1/2` / `5/8` / `0.4375`
  const mixed = /^(\d+(?:\.\d+)?)[\s-]+(\d+)\s*\/\s*(\d+)$/.exec(body)
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(body)
  let value: number
  if (mixed) {
    value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  } else if (fraction) {
    value = Number(fraction[1]) / Number(fraction[2])
  } else {
    value = Number(body)
  }
  if (!Number.isFinite(value) || value < 0) return null

  switch (suffix) {
    case 'mm':
      return value / 1000
    case 'cm':
      return value / 100
    case 'm':
      return value
    case 'in':
      return value * METRES_PER_INCH
    case 'ft':
    case "'":
      return value * 12 * METRES_PER_INCH
    default:
      return unit === 'imperial' ? value * METRES_PER_INCH : value / 1000
  }
}

/**
 * An exact 32nd of an inch as its fraction, so 7/16 in (0.0111125 m) reads back as `7/16"`; any
 * other value as decimal inches (0.0111 m is `0.437"`).
 */
export function formatLayerThickness(metres: number, unit: LinearUnit): string {
  if (unit !== 'imperial') return `${Math.round(metres * 1000 * 10) / 10} mm`
  const inchValue = metres / METRES_PER_INCH
  const parts = Math.round(inchValue * 32)
  if (Math.abs(inchValue * 32 - parts) > 1e-6) return `${Math.round(inchValue * 1000) / 1000}"`
  const whole = Math.floor(parts / 32)
  let numerator = parts % 32
  let denominator = 32
  while (numerator % 2 === 0 && numerator > 0) {
    numerator /= 2
    denominator /= 2
  }
  if (numerator === 0) return `${whole}"`
  return whole > 0 ? `${whole}-${numerator}/${denominator}"` : `${numerator}/${denominator}"`
}

/**
 * A summed depth to read, not type back (a plane's deck or covering, a ceiling's thickness): in
 * imperial to the nearest 1/16" as a fraction, as the lumber and panels it adds up read, so a
 * covering of 0.54" reads 9/16" beside a 10-3/16" deck.
 */
export function formatLayerDepth(metres: number, unit: LinearUnit): string {
  if (unit !== 'imperial') return formatLayerThickness(metres, unit)
  return formatLayerThickness(
    (Math.round((metres / METRES_PER_INCH) * 16) / 16) * METRES_PER_INCH,
    unit,
  )
}
