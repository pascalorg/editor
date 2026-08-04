import type { ColumnClampType, ColumnFormType } from './types'

/**
 * Column forms. These need their own model because they do not tile: a column box
 * adjusts continuously inside a range in fixed increments, so the question is not
 * "which widths add up to 600 mm" but "is 600 in range and on the increment".
 */

/**
 * Adjustable steel angle clamps — the traditional column clamp, and the one the
 * clamp schedule is computed against. Three reaches, sets of four, punched at 50 mm.
 *
 * ⚠️ Only the reaches, the pitch and the set quantity come from the reference
 * (products.md §1.6); both capacities are derived here, and they are the weakest
 * numbers in the catalog.
 *
 * `bendingMomentKnM` is what governs a real schedule, so it is derived from the
 * geometry rather than borrowed: an equal angle of the size these clamps are made
 * from, `Wel` computed about the axis it bends on with the corner counted once, at
 * S235's 235 N/mm² reduced by 1.5 to a permissible value. That yields 0.85 / 1.35 /
 * 2.00 kN·m over the three reaches, which puts the base of a 600 mm column at 80
 * kN/m² on a 237 mm spacing — the order the published trade tables read at, which is
 * the only cross-check available without a stamped table.
 *
 * `capacityKn` is the corner tension, by analogy with Doka's Tie Yoke `022030` at 90
 * kN (products.md §2.4) — a comparable part in the same duty, not these clamps' own
 * rating. It almost never governs, because tension goes as `p·s·b` where the arm's
 * bending goes as `p·s·b²/8`.
 *
 * Both are `unverified` and want a manufacturer's table before a schedule derived
 * from them is built to.
 */
function adjustableClamp(
  minSizeMm: number,
  maxSizeMm: number,
  angleMm: number,
  bendingMomentKnM: number,
): ColumnClampType {
  return {
    id: `adjustable-column-clamp-${minSizeMm}-${maxSizeMm}`,
    manufacturer: 'generic',
    systemFamily: 'Adjustable column clamp',
    label: `Adjustable column clamp ${minSizeMm}–${maxSizeMm} mm`,
    weightKg: 0,
    catalogSource:
      'Trade-common adjustable column clamp ranges (products.md §1.6); capacities derived, not published',
    verification: 'unverified',
    minSizeMm,
    maxSizeMm,
    incrementMm: 50,
    setQuantity: 4,
    capacityKn: 90,
    bendingMomentKnM,
    capacityBasis: 'permissible',
    sourceRef: `products.md §1.6 — sets of 4, ranges 150–600 / 300–900 / 450–1200 mm at 50 mm punched pitch. Bending capacity derived from an L${angleMm}×${angleMm} equal angle in S235 at a 1.5 reduction; corner tension by analogy with Doka Tie Yoke 022030 (90 kN permissible, products.md §2.4). Neither is the clamps’ own published rating.`,
  }
}

export const ADJUSTABLE_COLUMN_CLAMPS: readonly ColumnClampType[] = [
  adjustableClamp(150, 600, 60, 0.85),
  adjustableClamp(300, 900, 70, 1.35),
  adjustableClamp(450, 1200, 80, 2.0),
]

/**
 * Doka KS Xlife — 20 to 60 cm in 5 cm steps, stacking on a 30 cm height grid to
 * 6.60 m. The clamps come in sets of four and in three reaches, so a
 * cross-section outside the clamp's range is unbuildable even where the panel
 * would fit.
 */
export const DOKA_KS_XLIFE: ColumnFormType = {
  id: 'doka-ks-xlife',
  manufacturer: 'Doka',
  systemFamily: 'KS Xlife',
  label: 'Doka column formwork KS Xlife',
  weightKg: 0,
  catalogSource: 'Doka KS Xlife product information',
  verification: 'secondary',
  minDimMm: 200,
  maxDimMm: 600,
  incrementMm: 50,
  heightGridMm: 300,
  maxHeightMm: 6600,
  // The 150–600 clamp covers the whole of this form's own range, so the clamp is
  // never what limits a KS Xlife cross-section.
  clamps: ADJUSTABLE_COLUMN_CLAMPS,
  pressure: {
    wallsKnM2: 80,
    columnsKnM2: 100,
    pressureStandard: 'DIN 18218:2010',
    basis: 'permissible',
    sourceRef: 'Doka KS Xlife product information — column rating not independently verified',
  },
}

/**
 * Framax panels turned into a column box with the system's own outside corners.
 * Doka publishes this as an explicit alternative to a dedicated column form, and
 * it is rated lower for it: 80 kN/m² rather than the 90 a Framax column
 * arrangement carries, because the outside corner governs.
 */
export const FRAMAX_COLUMN: ColumnFormType = {
  id: 'doka-framax-column',
  manufacturer: 'Doka',
  systemFamily: 'Framax Xlife',
  label: 'Doka Framax Xlife column arrangement',
  weightKg: 0,
  catalogSource: 'Doka item list me/91.pdf; Framax Xlife User Information',
  verification: 'verified',
  minDimMm: 200,
  maxDimMm: 1067,
  incrementMm: 51,
  heightGridMm: 1350,
  maxHeightMm: 3300,
  clamps: ADJUSTABLE_COLUMN_CLAMPS,
  pressure: {
    wallsKnM2: 80,
    columnsKnM2: 90,
    pressureStandard: 'DIN 18218:2010',
    basis: 'permissible',
    sourceRef:
      'Doka Framax S Xlife User Information — columns 90 kN/m² (1,880 psf), cross-sections to 106.7 × 106.7 cm in 5.1 cm increments; 80 kN/m² only when using Framax outside corners with ordinary panels',
  },
}

export const COLUMN_FORMS: readonly ColumnFormType[] = [DOKA_KS_XLIFE, FRAMAX_COLUMN]

/**
 * The smallest form size that contains `dimMm`, snapped up to the increment. A
 * column form is set to a size, not to the concrete's dimension, so 337 mm of
 * concrete is formed at 350 and the extra 13 mm is the compensation.
 */
export function columnFormSizeMm(form: ColumnFormType, dimMm: number): number | undefined {
  if (dimMm > form.maxDimMm) return undefined
  const clamped = Math.max(dimMm, form.minDimMm)
  const steps = Math.ceil((clamped - form.minDimMm) / form.incrementMm)
  const size = form.minDimMm + steps * form.incrementMm
  return size <= form.maxDimMm ? size : undefined
}

/**
 * How many height increments a column of `heightMm` stacks into. Rounded up,
 * because the top of the form is trimmed or over-poured to the slab soffit
 * rather than a shorter unit being ordered.
 */
export function columnStackCount(form: ColumnFormType, heightMm: number): number | undefined {
  if (heightMm > form.maxHeightMm) return undefined
  return Math.max(1, Math.ceil(heightMm / form.heightGridMm))
}
