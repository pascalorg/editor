import type { MeasurementStandard, MeasurementStandardId } from './types'

/**
 * The shipped rule sets, as data. Each entry is the clause, not an
 * interpretation of it — see `wiki/formwork/reference/products.md` §4.3 for the
 * quoted text and sources.
 */

/**
 * IS 1200 measures formwork as "the actual surfaces in contact with the
 * concrete" in m² with no width or soffit staging, so it has neither band.
 *
 * cl.6.4 — "No deductions shall be made for each opening up to 0.4 m²."
 */
const IS_1200_5: MeasurementStandard = {
  id: 'IS_1200_5',
  label: 'IS 1200 Pt.5:1982 (India)',
  sourceRef: 'IS 1200 Part 5 : 1982 cl. 6, 6.4',
  verification: 'certified',
  openings: { kind: 'deduct-above-area', thresholdSqM: 0.4 },
  revealsMeasured: true,
}

/**
 * NRM2 §11 item 23 counts openings in `nr` by area band with the wall
 * thickness stated, and item 24 excludes the ends and soffits an opening
 * creates because they are "deemed included in the item for forming the
 * opening". So: no area deduction, and no reveal addition either.
 *
 * Item 24 is also the width switch, and it reaches a narrower set of faces than
 * HKSMM4's: wall *ends* and steps, not wall sides — a 200 mm-thick wall's side
 * face is still m² however thin the wall. It asks for the width to be stated
 * rather than staged, so there is no `stageM`.
 */
const NRM2: MeasurementStandard = {
  id: 'NRM2',
  label: 'RICS NRM2 §11 In-situ Concrete Works',
  sourceRef: 'NRM2 11.23 (openings), 11.24 (wall ends and soffits)',
  verification: 'certified',
  openings: { kind: 'extra-over-count', bandsSqM: [5, 10] },
  revealsMeasured: false,
  narrowWidth: {
    roles: ['end-start', 'end-end', 'edge'],
    thresholdM: 0.5,
    sourceRef: 'NRM2 11.24 — 1 ≤ 500 wide, width stated; 2 > 500 wide',
  },
  slopingTopBandDeg: 15,
}

/**
 * HKSMM4 — formwork deducted for openings exceeding 1.00 m².
 *
 * It is the only shipped standard that stages a soffit, and its width switch
 * reaches wall sides: a nib 300 mm wide or less is billed by the metre in 100 mm
 * stages, because a strip that narrow costs per length rather than per area.
 */
const HKSMM4: MeasurementStandard = {
  id: 'HKSMM4',
  label: 'HKSMM4 (Hong Kong)',
  sourceRef: 'HKSMM4/4R — formwork, openings exceeding 1.00 m²',
  verification: 'certified',
  openings: { kind: 'deduct-above-area', thresholdSqM: 1 },
  revealsMeasured: true,
  narrowWidth: {
    roles: ['side-a', 'side-b', 'end-start', 'end-end', 'edge'],
    thresholdM: 0.3,
    stageM: 0.1,
    sourceRef: 'HKSMM4/4R — wall-side formwork ≤ 300 mm wide measured in m, 100 mm stages',
  },
  soffitStages: {
    thicknessBaseM: 0.2,
    thicknessStepM: 0.1,
    heightBaseM: 3.5,
    heightStepM: 1.5,
    sourceRef:
      'HKSMM4/4R — soffit thickness stages 0–200 mm then 100 mm, height above support 0–3.50 m then 1.50 m',
  },
}

/**
 * CESMM4 Class G. Measurement rule: "No deduction from the areas measured
 * shall be made for openings and holes each not exceeding 0.5 m² in area" —
 * the formwork rule in Class G, confirmed 2026-08-15 across the CESMM4 full
 * text (ICE Publishing ISBN 978-0-7277-5751-7) and the CESMM3 OCR text, which
 * agree, and echoed by the timber-decking rule (same 0.5 m² threshold).
 *
 * This corrects the plan's §12 note, which had lumped CESMM4 in with POMI's
 * "no deduction ≤ 1.00 m²" reading: the 1.00 m² figure is HKSMM4's; CESMM
 * Class G sits at 0.5 m².
 *
 * No `narrowWidth`: Class G is reported to band *every* width (≤0.1, 0.1–0.2,
 * 0.2–0.4, 0.4–1.22, >1.22 m), which classifies an m² item rather than
 * switching its unit, so it is a different rule from the one modelled here and
 * guessing at it would put wrong widths on a bill.
 */
const CESMM4: MeasurementStandard = {
  id: 'CESMM4',
  label: 'CESMM4 Class G (Concrete Ancillaries)',
  sourceRef:
    'CESMM4 Class G — measurement rule, openings and holes not exceeding 0.5 m² in area (ISBN 978-0-7277-5751-7)',
  verification: 'certified',
  openings: { kind: 'deduct-above-area', thresholdSqM: 0.5 },
  revealsMeasured: true,
}

/** POMI. Unverified; the ≤ 1.00 m² non-deduction is the widely reported reading. */
const POMI: MeasurementStandard = {
  id: 'POMI',
  label: 'POMI (Principles of Measurement International)',
  sourceRef: 'POMI — clause text not obtained',
  verification: 'unverified',
  openings: { kind: 'deduct-above-area', thresholdSqM: 1 },
  revealsMeasured: true,
}

export const MEASUREMENT_STANDARDS: Record<MeasurementStandardId, MeasurementStandard> = {
  IS_1200_5,
  NRM2,
  HKSMM4,
  CESMM4,
  POMI,
}

/**
 * Contract standard when a project has not chosen one. HKSMM4 is the most
 * precisely specified of the verified three, so it is the safest thing to
 * measure against before anyone states a contract.
 */
export const DEFAULT_MEASUREMENT_STANDARD_ID: MeasurementStandardId = 'HKSMM4'

export function measurementStandard(id: MeasurementStandardId): MeasurementStandard {
  return MEASUREMENT_STANDARDS[id]
}

/** Which `nr` band an opening falls in, for standards that enumerate them. */
export function openingBandIndex(areaSqM: number, bandsSqM: readonly number[]): number {
  for (let i = 0; i < bandsSqM.length; i++) {
    if (areaSqM <= (bandsSqM[i] as number)) return i
  }
  return bandsSqM.length
}

/** Human band label, e.g. "≤ 5.00 m²", "5.00–10.00 m²", "> 10.00 m²". */
export function openingBandLabel(areaSqM: number, bandsSqM: readonly number[]): string {
  const index = openingBandIndex(areaSqM, bandsSqM)
  const upper = bandsSqM[index]
  const lower = bandsSqM[index - 1]
  if (upper === undefined) return `> ${(lower as number).toFixed(2)} m²`
  if (lower === undefined) return `≤ ${upper.toFixed(2)} m²`
  return `${lower.toFixed(2)}–${upper.toFixed(2)} m²`
}
