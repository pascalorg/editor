/**
 * Unit helpers. Pascal scenes are metric (meters); US framing vocabulary is
 * imperial. Engines compute in meters; UI formats imperial-first.
 */

export const INCH = 0.0254
export const FOOT = 0.3048

export const inches = (n: number): number => n * INCH
export const feet = (n: number): number => n * FOOT

export const toInches = (m: number): number => m / INCH
export const toFeet = (m: number): number => m / FOOT

/** Format meters as ft-in, e.g. 2.44 → `8'-0"`. */
export function formatFtIn(m: number): string {
  const totalIn = Math.round(toInches(m) * 16) / 16
  const ft = Math.floor(totalIn / 12)
  const inch = Math.round((totalIn - ft * 12) * 16) / 16
  if (inch >= 12) return `${ft + 1}'-0"`
  const inchStr = Number.isInteger(inch) ? `${inch}` : inch.toFixed(2).replace(/\.?0+$/, '')
  return `${ft}'-${inchStr}"`
}

/** Format meters as a compact inches string, e.g. 0.4064 → `16"`. */
export function formatIn(m: number): string {
  const v = Math.round(toInches(m) * 100) / 100
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/\.?0+$/, '')}"`
}
