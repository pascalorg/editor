/**
 * The foundation — PlanCrafters' `applyFoundation` (gen.js), the flat-ground
 * half. A house is either SLAB-ON-GRADE with its top of slab 8 in above
 * grade, or RAISED on a stemwall over a crawl space with the finish floor
 * 18 in above grade (three risers at the door). On flat ground the style
 * and the footprint decide:
 *
 *   - the long-low ranch, an ADU, or a NARROW footprint (≤ 34 ft — the
 *     narrow-lot entry-level product, one riser at a clamped 8 ft stoop) is a
 *     slab house;
 *   - everything else is raised.
 *
 * The terrain branches (Δ ≥ 12 in across the footprint → raised on a taller
 * stem; Δ > 30 in → a daylight basement) need sampled grade under the
 * footprint, which the site does not carry yet — they are the next pass
 * (TERRAIN-DATUM-SPEC), and nothing here pretends otherwise.
 *
 * The record rides the building node (`metadata.foundation`) so Bones
 * frames the platform, the mudsill, the stem from the frost line below
 * GRADE, and the garage slab at grade; the building's y is the finish-floor
 * height above the site plane.
 */
import type { StylePreset } from './styles'

export type FoundationType = 'slab' | 'raised'

export interface FoundationChoice {
  type: FoundationType
  /** Finish floor above grade, inches (PlanCrafters foundation.stemHeight). */
  ffAboveGradeIn: number
  /** Why — the panel and the notes say it. */
  source: string
}

/** IRC R404.1.6 / R317.1: top of slab 8 in above grade. */
export const SLAB_FF_ABOVE_GRADE_IN = 8
/** PlanCrafters' raised default on flat ground: 18 in — three risers. */
export const RAISED_FF_ABOVE_GRADE_IN = 18
/** A footprint this narrow takes the slab path (PlanCrafters R67). */
export const NARROW_FOOTPRINT_FT = 34

export function foundationFor(
  style: StylePreset,
  mode: '1story' | 'adu',
  footprintWidthFt: number,
): FoundationChoice {
  if (mode === 'adu')
    return { type: 'slab', ffAboveGradeIn: SLAB_FF_ABOVE_GRADE_IN, source: 'ADU — slab on grade' }
  if (style.longLow) {
    return {
      type: 'slab',
      ffAboveGradeIn: SLAB_FF_ABOVE_GRADE_IN,
      source: `${style.label} — long-low massing, slab on grade`,
    }
  }
  if (footprintWidthFt <= NARROW_FOOTPRINT_FT) {
    return {
      type: 'slab',
      ffAboveGradeIn: SLAB_FF_ABOVE_GRADE_IN,
      source: `narrow footprint (${footprintWidthFt.toFixed(0)}' ≤ ${NARROW_FOOTPRINT_FT}') — slab on grade`,
    }
  }
  return {
    type: 'raised',
    ffAboveGradeIn: RAISED_FF_ABOVE_GRADE_IN,
    source: `${style.label} on flat ground — raised floor over a crawl space`,
  }
}
