/**
 * Unit parsing for dimension input.
 *
 * Parses strings like "3.5m", "12ft", "120cm" into meters.
 * Numbers without a suffix are treated as project units (meters).
 */

const UNIT_FACTORS: Record<string, number> = {
  m: 1,
  ft: 0.3048,
  cm: 0.01,
  in: 0.0254,
  mm: 0.001,
}

/**
 * Parse a dimension string with optional unit suffix into meters.
 *
 * Supported suffixes: m, ft, cm, in, mm (case-insensitive).
 * A bare number (e.g. "3.5") is treated as meters.
 *
 * @returns The value in meters, or null if parsing fails.
 */
export function parseDimension(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const match = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/)
  if (!match || !match[1]) return null

  const value = parseFloat(match[1])
  if (Number.isNaN(value)) return null

  const unit = (match[2] ?? '').toLowerCase()
  if (unit === '') return value // no suffix → meters

  const factor = UNIT_FACTORS[unit]
  if (factor === undefined) return null

  return value * factor
}

/**
 * Parse an angle string into degrees.
 *
 * Accepts plain numbers (e.g. "45", "90.5").
 * Trailing "°" or "deg" suffixes are stripped if present.
 *
 * @returns The angle in degrees, or null if parsing fails.
 */
export function parseAngle(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Strip common degree suffixes
  const cleaned = trimmed.replace(/°|deg$/i, '').trim()
  if (!cleaned) return null

  const value = parseFloat(cleaned)
  if (Number.isNaN(value)) return null

  // Normalize to 0-360 range
  return ((value % 360) + 360) % 360
}

/**
 * Calculate the next point given a start point, length (meters), and angle (degrees).
 * Angle is measured clockwise from the +X axis (east).
 *
 * @returns [x, z] of the calculated point.
 */
export function pointFromLengthAngle(
  start: [number, number],
  lengthMeters: number,
  angleDeg: number,
): [number, number] {
  const rad = (angleDeg * Math.PI) / 180
  return [
    start[0] + Math.cos(rad) * lengthMeters,
    start[1] + Math.sin(rad) * lengthMeters,
  ]
}
