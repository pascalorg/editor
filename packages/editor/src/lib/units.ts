/**
 * Shared unit conversion + formatting helpers for the editor UI.
 *
 * Pascal's scene data is ALWAYS stored in metres and square-metres;
 * the meter/foot preference (`useViewer.unit: 'metric' | 'imperial'`)
 * is purely a display choice. These helpers convert and format for
 * presentation — the underlying `updateNode` calls still take metres.
 *
 * Keep these in one place so panels/sliders/labels all agree on the
 * conversion constant (3.28084 ft per metre) and on formatting (label
 * spacing, decimal places, `²` superscript, etc.). There were already
 * four separate `formatMeasurement` / `formatArea` functions scattered
 * across the editor package — this file is the canonical home.
 */

export const METERS_TO_FEET = 3.280_84
export const SQ_METERS_TO_SQ_FEET = METERS_TO_FEET * METERS_TO_FEET

export type UnitSystem = 'metric' | 'imperial'

export function metersToFeet(meters: number): number {
  return meters * METERS_TO_FEET
}

export function feetToMeters(feet: number): number {
  return feet / METERS_TO_FEET
}

export function sqMetersToSqFeet(sqMeters: number): number {
  return sqMeters * SQ_METERS_TO_SQ_FEET
}

/**
 * Format a linear measurement (stored in metres) for display.
 * Returns `"1.20 m"` or `"3.94 ft"` depending on the user's
 * preference. `precision` defaults to 2 decimal places.
 */
export function formatLength(meters: number, unit: UnitSystem, precision = 2): string {
  if (unit === 'imperial') {
    return `${metersToFeet(meters).toFixed(precision)} ft`
  }
  return `${meters.toFixed(precision)} m`
}

/**
 * Format an area measurement (stored in square metres) for display.
 * Returns `"10.50 m²"` or `"113.03 ft²"` depending on the preference.
 */
export function formatArea(sqMeters: number, unit: UnitSystem, precision = 2): string {
  if (unit === 'imperial') {
    return `${sqMetersToSqFeet(sqMeters).toFixed(precision)} ft²`
  }
  return `${sqMeters.toFixed(precision)} m²`
}
