/**
 * The foundation — PlanCrafters' `applyFoundation` (gen.js). A house is
 * either SLAB-ON-GRADE with its top of slab 8 in above grade, or RAISED on
 * a stemwall over a crawl space with the finish floor 18 in above grade
 * (three risers at the door). The grade under the footprint decides first,
 * then the style and the footprint:
 *
 *   - HILLS (the site carries a USGS heightfield, TERRAIN-DATUM-SPEC): more
 *     than 30 in of fall under the footprint is where PlanCrafters cuts a
 *     daylight basement (8 ft deep, 24 in stem) — not modelled here yet, so
 *     the house is raised on a 36 in stem and says so; 12 in or more of
 *     fall raises the house on a stem sized to the fall (24–36 in, to the
 *     half foot), footings stepped down the hill by Bones;
 *   - flat ground (or less than 12 in of fall): the long-low ranch, an ADU,
 *     or a NARROW footprint (≤ 34 ft — the narrow-lot entry-level product,
 *     one riser at a clamped 8 ft stoop) is a slab house; everything else
 *     is raised.
 *
 * The record rides the building node (`metadata.foundation`) so Bones
 * frames the platform, the mudsill, the stem from the frost line below
 * GRADE, and the garage slab at grade; the building's y is the finish-floor
 * height above the HIGHEST grade under the footprint (nothing wood ever
 * below grade anywhere around the house — the 8 in / stem clearance holds
 * at the high side, the low side exposes more stem).
 */
import type { StylePreset } from './styles'

export type FoundationType = 'slab' | 'raised'

/** The sampled ground under the placed footprint (site metres). */
export interface TerrainUnderFootprint {
  /** Highest − lowest grade under the footprint, inches. */
  reliefIn: number
  /** The governing grade — the datum the house stands on, site-local metres. */
  highestM: number
  lowestM: number
  /** How many points were read. */
  samples: number
}

export interface FoundationChoice {
  type: FoundationType
  /** Finish floor above grade, inches (PlanCrafters foundation.stemHeight). */
  ffAboveGradeIn: number
  /** Why — the panel and the notes say it. */
  source: string
  /** The ground that decided it (absent on a site with no terrain). */
  terrain?: TerrainUnderFootprint | null
}

/** IRC R404.1.6 / R317.1: top of slab 8 in above grade. */
export const SLAB_FF_ABOVE_GRADE_IN = 8
/** PlanCrafters' raised default on flat ground: 18 in — three risers. */
export const RAISED_FF_ABOVE_GRADE_IN = 18
/** A footprint this narrow takes the slab path (PlanCrafters R67). */
export const NARROW_FOOTPRINT_FT = 34
/** PlanCrafters applyFoundation: fall ≥ this raises the house on a taller stem. */
export const HILL_RAISED_RELIEF_IN = 12
/** Fall > this is basement territory (PlanCrafters); here a 36 in stem, said honestly. */
export const HILL_BASEMENT_RELIEF_IN = 30
/** The hillside stem band, inches (PlanCrafters clamp(snap(delta), 24, 36)). */
export const HILL_STEM_MIN_IN = 24
export const HILL_STEM_MAX_IN = 36

export function foundationFor(
  style: StylePreset,
  mode: '1story' | 'adu',
  footprintWidthFt: number,
  terrain?: TerrainUnderFootprint | null,
): FoundationChoice {
  const t = terrain ?? null
  const fall = t ? `${Math.round(t.reliefIn)}" of fall under the footprint` : ''
  if (t && t.reliefIn > HILL_BASEMENT_RELIEF_IN && mode !== 'adu') {
    return {
      type: 'raised',
      ffAboveGradeIn: HILL_STEM_MAX_IN,
      source: `hillside — ${fall}: PlanCrafters cuts a daylight basement here (8 ft, 24 in stem), not modelled yet — raised on a ${HILL_STEM_MAX_IN} in stem, footings stepped`,
      terrain: t,
    }
  }
  if (t && t.reliefIn >= HILL_RAISED_RELIEF_IN) {
    const stem = Math.min(
      HILL_STEM_MAX_IN,
      Math.max(HILL_STEM_MIN_IN, Math.round(t.reliefIn / 6) * 6),
    )
    return {
      type: 'raised',
      ffAboveGradeIn: stem,
      source: `hillside — ${fall}, raised on a ${stem} in stem, footings stepped`,
      terrain: t,
    }
  }
  const ground = t ? ` (${fall} — flat enough)` : ''
  if (mode === 'adu')
    return {
      type: 'slab',
      ffAboveGradeIn: SLAB_FF_ABOVE_GRADE_IN,
      source: `ADU — slab on grade${ground}`,
      terrain: t,
    }
  if (style.longLow) {
    return {
      type: 'slab',
      ffAboveGradeIn: SLAB_FF_ABOVE_GRADE_IN,
      source: `${style.label} — long-low massing, slab on grade${ground}`,
      terrain: t,
    }
  }
  if (footprintWidthFt <= NARROW_FOOTPRINT_FT) {
    return {
      type: 'slab',
      ffAboveGradeIn: SLAB_FF_ABOVE_GRADE_IN,
      source: `narrow footprint (${footprintWidthFt.toFixed(0)}' ≤ ${NARROW_FOOTPRINT_FT}') — slab on grade${ground}`,
      terrain: t,
    }
  }
  return {
    type: 'raised',
    ffAboveGradeIn: RAISED_FF_ABOVE_GRADE_IN,
    source: `${style.label} on flat ground — raised floor over a crawl space${ground}`,
    terrain: t,
  }
}
