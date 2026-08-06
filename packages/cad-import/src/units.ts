import type { CadUnits } from './types'

/**
 * `$INSUNITS` → metres per drawing unit.
 *
 * Index is the raw header value; the table is the DXF spec's own ordering.
 * 0 is "unitless" and maps to null, not to 1 — a unitless drawing is far
 * more often millimetres than metres, so treating it as metres would import
 * a house as a doll's house and look plausible enough to miss.
 */
const INSUNITS_TO_METERS: Record<number, number> = {
  1: 0.0254, // inches
  2: 0.3048, // feet
  3: 1609.344, // miles
  4: 0.001, // millimetres
  5: 0.01, // centimetres
  6: 1, // metres
  7: 1000, // kilometres
  8: 2.54e-8, // microinches
  9: 2.54e-5, // mils
  10: 0.9144, // yards
  11: 1e-10, // angstroms
  12: 1e-9, // nanometres
  13: 1e-6, // microns
  14: 0.1, // decimetres
  15: 10, // decametres
  16: 100, // hectometres
  17: 1e9, // gigametres
  18: 1.495978707e11, // astronomical units
  19: 9.4607304725808e15, // light years
  20: 3.0856775814913673e16, // parsecs
  21: 0.3048006096012192, // US survey feet
  22: 0.0254000508001016, // US survey inches
  23: 0.9144018288036576, // US survey yards
  24: 1609.3472186944373, // US survey miles
}

export function resolveUnits(insunits: number | null): CadUnits {
  if (insunits === null) {
    return { insunits: null, metersPerUnit: null }
  }
  return { insunits, metersPerUnit: INSUNITS_TO_METERS[insunits] ?? null }
}

/**
 * Scale factor that takes a drawing in `units` to metres, or null when the
 * drawing carries no usable unit declaration and the user must calibrate.
 */
export function metersPerUnit(units: CadUnits): number | null {
  return units.metersPerUnit
}
