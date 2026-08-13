import { aciMaxRiseRateMH } from './aci-347'
import { dinMaxRiseRateMH } from './din-18218'
import type { ConcreteMix, Placement, PressureStandardId } from './types'

/**
 * How fast this pour may rise before the form it is in is overloaded.
 *
 * Every other answer in this feature is a *spacing*: the pressure is what it is and the
 * hardware moves to suit it. On a panel system that inverts, because the frame is what it
 * is — a Framax panel is rated 60 kN/m² and no arrangement of it is rated more, so a pour
 * that produces 80 has exactly three fixes and all three are pour decisions: slower,
 * warmer, or a stiffer consistency. The check that catches it could only ever say "reduce
 * the pressure", which is a sentence nobody can act on. This says *to what*.
 *
 * `maxRiseRateMH` has shipped for ACI and DIN since the pressure engine landed and was
 * called by nothing. That is the whole of what this module adds: the rating a panel
 * publishes and the inverse solve a code offers, joined.
 *
 * ## Why the two codes that cannot answer say so
 *
 * The BS shortcut has no rate term at all — 25 kN/m² per metre of pour is a function of
 * height alone, so no rate clears anything and pouring slower is not a remedy under it.
 * CIRIA's `√R` inside a `√(H − C1√R)` has no closed-form inverse. Returning a figure for
 * either would be inventing the one number on this screen somebody sets a pump by, so
 * they are refused by name and the reader is told which decision is theirs instead.
 *
 * ## Why a rate can be refused under a code that does invert
 *
 * Both inverse solves have a constant term — ACI's 7.2 kPa, DIN's `a` — so a rating below
 * it is not reachable by pouring slowly. A panel that cannot carry the concrete standing
 * still is not a pour-rate problem, and reporting 0.1 m/h for it would send a crew to a
 * gang that will fail whatever they do.
 */

export type RiseRateRefusal = 'standard-does-not-invert' | 'no-rate-is-slow-enough'

export const RISE_RATE_REFUSAL_LABELS: Record<RiseRateRefusal, string> = {
  'standard-does-not-invert':
    'this standard has no rate term to solve back — the BS shortcut is a function of pour height alone, and CIRIA’s does not invert in closed form, so a slower pour is not a remedy under either',
  'no-rate-is-slow-enough':
    'no rate of rise brings the pressure inside this rating — the constant term alone exceeds it, so the form is overloaded by concrete standing still',
}

export interface RiseRateLimit {
  /** What the form is rated for, kN/m² — the governing panel, not the average. */
  permissibleKnM2: number
  /** What the stated pour produces at the base, kN/m². */
  designKnM2: number
  /** The rate the project has stated, m/h — what the pressure above came from. */
  statedRateMH: number
  /** The fastest rise the rating allows, m/h, where the code inverts and one exists. */
  maxRateMH?: number
  refusal?: RiseRateRefusal
}

/**
 * The rate the form's own rating allows, from the pressure the pour was solved at.
 *
 * `designKnM2` is passed rather than recomputed. The envelope is already solved by the
 * time anything asks this, and re-deriving the peak here would let a warning quote a
 * pressure the design does not have — the same second-derivation hazard the validator's
 * `packs` and `envelopes` inputs exist to refuse.
 */
export function riseRateLimit(
  standard: PressureStandardId,
  mix: ConcreteMix,
  placement: Placement,
  permissibleKnM2: number,
  designKnM2: number,
): RiseRateLimit {
  const base: RiseRateLimit = {
    permissibleKnM2,
    designKnM2,
    statedRateMH: placement.riseRateMH,
  }
  if (standard !== 'ACI_347' && standard !== 'DIN_18218') {
    return { ...base, refusal: 'standard-does-not-invert' }
  }
  const rate =
    standard === 'ACI_347'
      ? aciMaxRiseRateMH(mix, placement, permissibleKnM2)
      : dinMaxRiseRateMH(mix, placement, permissibleKnM2)
  if (rate === undefined) return { ...base, refusal: 'no-rate-is-slow-enough' }
  return { ...base, maxRateMH: Math.round(rate * 100) / 100 }
}
