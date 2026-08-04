import type { SheetStock } from './types'

/**
 * Shuttering plywood as bought, which is where the cut list comes from: the
 * formlining is a set of rectangles nested out of these, and the sheet size is
 * what decides how many joints a wall has.
 *
 * Sizes and reuse bands from `wiki/formwork/reference/products.md` §2.1. The
 * reuse numbers are trade guidance rather than a published design value, which is
 * why every one of these is `secondary` at best — but they are the numbers that
 * decide whether formwork is charged as a consumable or amortised, so shipping no
 * number is worse than shipping a sourced range.
 */

const SOURCE = 'wiki/formwork/reference/products.md §2.1 — trade sheet sizes and reuse guidance'

function sheet(
  id: string,
  label: string,
  lengthMm: number,
  widthMm: number,
  thicknessMm: number,
  filmWeightGm2: number | undefined,
  expectedReuses: { min: number; max: number },
  areaWeightKgM2: number,
): SheetStock {
  return {
    id,
    manufacturer: 'generic',
    systemFamily: 'shuttering plywood',
    label,
    weightKg: Number(((lengthMm / 1000) * (widthMm / 1000) * areaWeightKgM2).toFixed(2)),
    catalogSource: 'trade sizes, not a single manufacturer list',
    verification: 'secondary',
    lengthMm,
    widthMm,
    thicknessMm,
    // Face grain runs along the length and carries the bending, so a sheet may
    // not be turned to fit: 1250 × 2500 and 2500 × 1250 are different products.
    rotatable: false,
    ...(filmWeightGm2 === undefined ? {} : { filmWeightGm2 }),
    expectedReuses,
    sourceRef: SOURCE,
  }
}

/** 18 mm film-faced ply weighs roughly 11 kg/m²; 21 mm about 13. */
const KG_PER_M2_18 = 11
const KG_PER_M2_21 = 13

export const SHEET_STOCK: readonly SheetStock[] = [
  sheet(
    'ply-1220x2440x18-poplar-120',
    'Film-faced plywood 1220 × 2440 × 18 mm, poplar core, 120 g/m² film',
    2440,
    1220,
    18,
    120,
    { min: 5, max: 10 },
    KG_PER_M2_18,
  ),
  sheet(
    'ply-1220x2440x18-hardwood-220',
    'Film-faced plywood 1220 × 2440 × 18 mm, hardwood core, 220 g/m² film',
    2440,
    1220,
    18,
    220,
    { min: 10, max: 20 },
    KG_PER_M2_18,
  ),
  sheet(
    'ply-1250x2500x18-birch-wbp',
    'Film-faced birch plywood 1250 × 2500 × 18 mm, WBP phenolic',
    2500,
    1250,
    18,
    167,
    { min: 20, max: 50 },
    KG_PER_M2_18,
  ),
  sheet(
    'ply-1500x3000x18-hardwood-220',
    'Film-faced plywood 1500 × 3000 × 18 mm, hardwood core, 220 g/m² film',
    3000,
    1500,
    18,
    220,
    { min: 10, max: 20 },
    KG_PER_M2_18,
  ),
  sheet(
    'ply-1220x1830x18-hardwood-220',
    'Film-faced plywood 1220 × 1830 × 18 mm (half sheet), 220 g/m² film',
    1830,
    1220,
    18,
    220,
    { min: 10, max: 20 },
    KG_PER_M2_18,
  ),
  sheet(
    'ply-1220x2440x21-hardwood-220',
    'Film-faced plywood 1220 × 2440 × 21 mm, hardwood core, 220 g/m² film',
    2440,
    1220,
    21,
    220,
    { min: 10, max: 20 },
    KG_PER_M2_21,
  ),
  sheet(
    'ply-1220x2440x18-plain',
    'Plain shuttering plywood 1220 × 2440 × 18 mm, site grade',
    2440,
    1220,
    18,
    undefined,
    { min: 3, max: 8 },
    KG_PER_M2_18,
  ),
]

/**
 * A steel panel is not one asset. The frame outlives the formlining by an order
 * of magnitude — roughly 300 uses against the 18 mm ply's 30 to 50 — so a
 * project that charges the whole panel at one rate is wrong in both directions:
 * it over-charges the frame and under-charges the sheet it will replace twice.
 */
export const STEEL_PANEL_FRAME_REUSES = 300

/**
 * 18 mm formlining in a steel frame. Longer-lived than the same sheet used loose,
 * because the frame supports it continuously.
 */
export const STEEL_PANEL_FORMLINING_REUSES = { min: 30, max: 50 }

/** The kerf a saw takes, mm. Twelve cuts across a 1220 mm sheet lose 40 mm. */
export const SAW_KERF_MM = 3.5

/**
 * Waste allowance on sheet goods over and above the nesting offcut — damaged
 * edges, breakage, sheets rejected on arrival. Trade figures put it at 5–10 %.
 */
export const SHEET_WASTE_FRACTION = { min: 0.05, max: 0.1 }

export function sheetStock(id: string): SheetStock | undefined {
  return SHEET_STOCK.find((entry) => entry.id === id)
}

/**
 * Reuses a sheet is expected to give, from its film weight alone — the fallback
 * for stock that carries no figure of its own. Film weight is the best single
 * predictor: an unfilmed sheet gives 3–8 pours, a 120 g poplar one 5–10, a 220 g
 * hardwood 10–20, a branded thick-film sheet 50 or more.
 *
 * Species, glue class and edge sealing move this too — Baltic birch on WBP
 * phenolic outlasts its film weight — so a sheet that knows its own reuse band
 * should carry it rather than be derived here.
 */
export function expectedReusesForFilm(filmWeightGm2: number | undefined): {
  min: number
  max: number
} {
  if (filmWeightGm2 === undefined || filmWeightGm2 < 120) return { min: 3, max: 8 }
  if (filmWeightGm2 < 220) return { min: 5, max: 10 }
  if (filmWeightGm2 < 300) return { min: 10, max: 20 }
  return { min: 50, max: 100 }
}
