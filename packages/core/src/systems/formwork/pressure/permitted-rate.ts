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

/** Which end of the supply chain is the narrower — the mixing end or the placing end. */
export type SupplySource = 'batch-plant' | 'pump'

export const SUPPLY_SOURCE_LABELS: Record<SupplySource, string> = {
  'batch-plant': 'the batching plant’s output',
  pump: 'the placing rate of the pump or skip',
}

/** What the concrete supply lets this pour rise at, and which end of it decided. */
export interface SupplyRate {
  /** The narrower of the two stated rates, m³/h. */
  outputM3PerHour: number
  governing: SupplySource
  /** The pour's plan area, m² — what turns m³/h into m/h. */
  planAreaM2: number
  /** Output over plan area, m/h. */
  sustainableRateMH: number
}

/**
 * Which of the three limits on a rate of rise actually decides this pour.
 *
 * `stated` is the ordinary answer and means the project's own rate is the slowest of the
 * three — the pour as planned is inside both the form's rating and the supply, and there is
 * nothing to report. The other two are the pour being *something other than what was
 * designed*, and in opposite directions: a rating that governs means the form is overloaded
 * and the pour has to slow, and a supply that governs means the pour cannot go as fast as
 * stated whatever anyone intends — so the pressure the form was built for is never developed
 * and the shutter is over-built rather than unsafe.
 */
export type RateGoverning = 'stated' | 'panel-rating' | 'concrete-supply'

export const RATE_GOVERNING_LABELS: Record<RateGoverning, string> = {
  stated: 'the rate the project stated — inside both the form’s rating and the supply',
  'panel-rating':
    'the panels’ rated pressure — the pour as stated overloads the form and has to be slowed to this',
  'concrete-supply':
    'the concrete supply — the pour cannot rise as fast as stated, so the form is designed for a pressure this pour never develops',
}

/**
 * The rate the concrete supply sustains, or `undefined` where none is stated.
 *
 * Two constraints in series and the slower governs, which is why both are reported rather
 * than only the answer: a starved pour behind a 40 m³/h plant and a 15 m³/h pump is a pump
 * to change, and the same figure behind a 15 m³/h plant is a phone call to the supplier.
 *
 * The plan area is the pour's, and it is what makes this a *rate of rise* rather than an
 * output: 12 m³/h into a 6 m² wall is 2 m/h and into a 0.36 m² column is 33, which is why
 * a supply figure cannot be compared with a stated rate anywhere but here.
 */
export function supplyRiseRate(
  supply: { batchPlantOutputM3PerHour?: number; pumpRateM3PerHour?: number } | undefined,
  planAreaM2: number,
): SupplyRate | undefined {
  if (supply === undefined || planAreaM2 <= 0) return undefined
  const candidates: { source: SupplySource; output: number }[] = [
    ...(supply.batchPlantOutputM3PerHour === undefined
      ? []
      : [{ source: 'batch-plant' as const, output: supply.batchPlantOutputM3PerHour }]),
    ...(supply.pumpRateM3PerHour === undefined
      ? []
      : [{ source: 'pump' as const, output: supply.pumpRateM3PerHour }]),
  ]
  if (candidates.length === 0) return undefined
  // The plant wins a tie: where both ends state the same figure the concrete is what there
  // is, and telling a reader to hire a bigger pump would be the one useless remedy.
  const narrowest = candidates.reduce((worst, next) => (next.output < worst.output ? next : worst))
  return {
    outputM3PerHour: narrowest.output,
    governing: narrowest.source,
    planAreaM2,
    sustainableRateMH: Math.round((narrowest.output / planAreaM2) * 100) / 100,
  }
}

export const RISE_RATE_REFUSAL_LABELS: Record<RiseRateRefusal, string> = {
  'standard-does-not-invert':
    'this standard has no rate term to solve back — the BS shortcut is a function of pour height alone, and CIRIA’s does not invert in closed form, so a slower pour is not a remedy under either',
  'no-rate-is-slow-enough':
    'no rate of rise brings the pressure inside this rating — the constant term alone exceeds it, so the form is overloaded by concrete standing still',
}

export interface RiseRateLimit {
  /**
   * What the form is rated for, kN/m² — the governing panel, not the average.
   *
   * Absent where the layout used no catalog panel. A conventional or bespoke shutter is
   * sized by `wallDesign` against its own members and publishes nothing to compare a
   * pressure to, and it is still a pour with a supply — which is why this shape answers for
   * both rather than existing only where a rating does.
   */
  permissibleKnM2?: number
  /** What the stated pour produces at the base, kN/m². */
  designKnM2: number
  /** The rate the project has stated, m/h — what the pressure above came from. */
  statedRateMH: number
  /** The fastest rise the rating allows, m/h, where the code inverts and one exists. */
  maxRateMH?: number
  refusal?: RiseRateRefusal
  /** What the concrete supply sustains, where the project stated one. */
  supply?: SupplyRate
  /** Which of the three limits is the slowest, and therefore what this pour actually does. */
  governing: RateGoverning
  /** The slowest of the three, m/h — the rate this pour rises at. */
  effectiveRateMH: number
}

/**
 * The rate this pour actually rises at, from the three things that limit it.
 *
 * The rating and the supply live on one shape rather than two so they cannot disagree about
 * which governs: two callers each comparing one ceiling against the stated rate would both
 * report themselves as the answer, and a reader given two answers has none. `designKnM2` is
 * passed rather than recomputed for the same reason — the envelope is already solved by the
 * time anything asks this, and re-deriving the peak here would let a warning quote a pressure
 * the design does not have.
 *
 * A tie goes to the stated rate, then to the rating. A pour designed at exactly its ceiling
 * is a pour designed as stated, and reporting it as governed by the ceiling would turn a
 * full-utilisation pass into a finding.
 */
export function riseRateLimit(
  standard: PressureStandardId,
  mix: ConcreteMix,
  placement: Placement,
  permissibleKnM2: number | undefined,
  designKnM2: number,
  supply?: SupplyRate,
): RiseRateLimit {
  const base = {
    ...(permissibleKnM2 === undefined ? {} : { permissibleKnM2 }),
    designKnM2,
    statedRateMH: placement.riseRateMH,
    ...(supply === undefined ? {} : { supply }),
  }
  const rate =
    permissibleKnM2 === undefined || (standard !== 'ACI_347' && standard !== 'DIN_18218')
      ? undefined
      : standard === 'ACI_347'
        ? aciMaxRiseRateMH(mix, placement, permissibleKnM2)
        : dinMaxRiseRateMH(mix, placement, permissibleKnM2)
  const refusal: RiseRateRefusal | undefined =
    permissibleKnM2 === undefined
      ? undefined
      : standard !== 'ACI_347' && standard !== 'DIN_18218'
        ? 'standard-does-not-invert'
        : rate === undefined
          ? 'no-rate-is-slow-enough'
          : undefined
  const maxRateMH = rate === undefined ? undefined : Math.round(rate * 100) / 100
  // Only a rating the pour actually exceeds is a limit on it. A panel rated well above this
  // pressure still inverts to some rate, and that rate is not what the pour is doing.
  const ratingCeiling =
    maxRateMH !== undefined && permissibleKnM2 !== undefined && designKnM2 > permissibleKnM2
      ? maxRateMH
      : undefined
  let governing: RateGoverning = 'stated'
  let effectiveRateMH = placement.riseRateMH
  if (ratingCeiling !== undefined && ratingCeiling < effectiveRateMH) {
    governing = 'panel-rating'
    effectiveRateMH = ratingCeiling
  }
  if (supply !== undefined && supply.sustainableRateMH < effectiveRateMH) {
    governing = 'concrete-supply'
    effectiveRateMH = supply.sustainableRateMH
  }
  return {
    ...base,
    ...(maxRateMH === undefined ? {} : { maxRateMH }),
    ...(refusal === undefined ? {} : { refusal }),
    governing,
    effectiveRateMH,
  }
}
