import {
  type ConcreteMix,
  type ConsistencyClass,
  consistencyClassOf,
  type Placement,
  type PressureEnvelope,
  type PressureWarning,
  unitWeightKnM3,
} from './types'

/**
 * DIN 18218:2010-01 — the European path, and the one every panel manufacturer's
 * permissible pressure is published against.
 *
 * The important difference from ACI is not the numbers, it is the shape: DIN
 * publishes a trapezoid. The pressure is hydrostatic to a depth `hs = σ/γc` and
 * constant below it, which is what legitimately lets tie and clamp spacing open up
 * in the top few metres — and is why a column's clamp schedule reads tight at the
 * bottom and progressively wider going up rather than being a single spacing.
 *
 * ⚠️ The setting-time slopes below were reverse-engineered by probing PASCHAL's
 * public DIN 18218:2010 calculator, not transcribed from the standard, which is
 * paywalled. They are internally consistent and exactly reproducible, and the
 * F1–F4 slopes are not round numbers — which strongly suggests the real Table 2
 * tabulates discrete `tE` columns and the calculator interpolates between them. So
 * every DIN result carries a `derived-coefficients` warning, and it stays there
 * until a purchased copy replaces the table.
 *
 * See `wiki/formwork/reference/design.md` §1.4.
 */

/** `σhk,max = a + b·v` at γc = 25 kN/m³, tE = 5 h, T = TRef. */
const BASE: Record<ConsistencyClass, { a: number; b: number }> = {
  F1: { a: 21, b: 5 },
  F2: { a: 19, b: 10 },
  F3: { a: 18, b: 14 },
  F4: { a: 17, b: 17 },
  F5: { a: 25, b: 30 },
  F6: { a: 25, b: 38 },
  SCC: { a: 25, b: 33 },
}

/**
 * Setting-time slopes for the vibrated classes: a uniform multiplier on the whole
 * expression, `× [1 + k(tE − 5)]`. The flowable classes are not here because the
 * correction lands on their `v` term alone — they carry no vibration surcharge to
 * scale, which is the same structural break that fixes their constant at 25.
 */
const SETTING_SLOPE: Partial<Record<ConsistencyClass, number>> = {
  F1: 0.03,
  F2: 0.053,
  F3: 0.077,
  F4: 0.14,
}

/**
 * `tE` when the job has not declared one, hours. Exported so a settings panel can
 * present the figure it is designing to as DIN's reference rather than as a blank
 * field — an unstated setting time still lands in the formula, and offering an
 * empty box for it hides which number the pressure came from.
 */
export const DIN_REFERENCE_SETTING_H = 5

/**
 * `TRef` when the job has not declared one. 20 °C is the reference temperature the
 * European concrete standards work at, and it is the value the calculator probe was
 * run against — the reference's F3 sample reaching 59.8 kN/m² at 10 °C is a 10 °C
 * delta, which only holds from 20.
 */
export const DIN_DEFAULT_REFERENCE_TEMPERATURE_C = 20

/** Colder than TRef costs more on a flowable mix than on a vibrated one. */
const TEMPERATURE_SLOPE_WARMER = 0.03
const TEMPERATURE_SLOPE_COLDER_VIBRATED = 0.03
const TEMPERATURE_SLOPE_COLDER_FLOWABLE = 0.05

/** Observed ceiling across every class. May be the calculator's rather than DIN's. */
export const DIN_PRESSURE_CEILING_KN_M2 = 250

/** DIN's own scope, enforced as input validation rather than silently exceeded. */
export const DIN_MAX_RISE_RATE_MH = 7
export const DIN_MAX_POUR_HEIGHT_M = 10

function isFlowable(consistency: ConsistencyClass): boolean {
  return SETTING_SLOPE[consistency] === undefined
}

/**
 * The multiplier the density and temperature corrections apply to the whole
 * expression. Both are exactly proportional and only the temperature *difference*
 * from TRef matters — verified against the calculator at TRef 15/T 15 and TRef 20/T
 * 20 returning the same figure.
 */
function scaleFactor(mix: ConcreteMix, placement: Placement): number {
  const consistency = consistencyClassOf(mix)
  const reference = mix.referenceTemperatureC ?? DIN_DEFAULT_REFERENCE_TEMPERATURE_C
  const delta = reference - placement.concreteTemperatureC
  const slope =
    delta <= 0
      ? TEMPERATURE_SLOPE_WARMER
      : isFlowable(consistency)
        ? TEMPERATURE_SLOPE_COLDER_FLOWABLE
        : TEMPERATURE_SLOPE_COLDER_VIBRATED
  return (unitWeightKnM3(mix) / 25) * (1 + slope * delta)
}

/** `σhk,max` from the formula alone, kN/m² — before the caps. */
export function dinCharacteristicKnM2(mix: ConcreteMix, placement: Placement): number {
  const consistency = consistencyClassOf(mix)
  const { a, b } = BASE[consistency]
  const setting = mix.endOfSettingH ?? DIN_REFERENCE_SETTING_H
  const scale = scaleFactor(mix, placement)
  const slope = SETTING_SLOPE[consistency]
  if (slope !== undefined) {
    return (
      scale * (a + b * placement.riseRateMH) * (1 + slope * (setting - DIN_REFERENCE_SETTING_H))
    )
  }
  // Flowable and SCC: the correction multiplies the rate term only.
  return scale * (a + b * placement.riseRateMH * (setting / DIN_REFERENCE_SETTING_H))
}

function scopeWarnings(mix: ConcreteMix, placement: Placement): PressureWarning[] {
  const out: PressureWarning[] = [
    {
      kind: 'derived-coefficients',
      message:
        'The DIN 18218 setting-time and temperature coefficients were reverse-engineered from PASCHAL’s public calculator, not transcribed from the standard. Reproducible and internally consistent, but indicative until a purchased copy replaces them.',
    },
  ]
  if (placement.riseRateMH > DIN_MAX_RISE_RATE_MH) {
    out.push({
      kind: 'outside-code-scope',
      message: `DIN 18218's model is stated for rise rates to ${DIN_MAX_RISE_RATE_MH} m/h; this pour rises at ${placement.riseRateMH} m/h.`,
    })
  }
  if (placement.pourHeightM > DIN_MAX_POUR_HEIGHT_M) {
    out.push({
      kind: 'outside-code-scope',
      message: `DIN 18218's model is stated for pours to ${DIN_MAX_POUR_HEIGHT_M} m; this lift is ${placement.pourHeightM} m.`,
    })
  }
  if (placement.vibration === 'external') {
    out.push({
      kind: 'outside-code-scope',
      message:
        'The DIN coefficients assume compaction by internal vibrator. Externally vibrated formwork is outside the model.',
    })
  }
  if (!mix.selfCompacting && placement.pumpedFromBase) {
    out.push({
      kind: 'outside-code-scope',
      message:
        'The DIN model assumes concrete placed from the top of the form. Pumping in at the base is outside it — ACI directs the fluid head plus 25 % surge for that case.',
    })
  }
  return out
}

export function dinPressure(mix: ConcreteMix, placement: Placement): PressureEnvelope {
  const gamma = unitWeightKnM3(mix)
  const warnings = scopeWarnings(mix, placement)
  const formula = dinCharacteristicKnM2(mix, placement)
  const fluid = gamma * placement.pourHeightM

  let maxKnM2 = formula
  let governingEquation = `σhk,max = ${BASE[consistencyClassOf(mix)].a} + ${BASE[consistencyClassOf(mix)].b}·v (${consistencyClassOf(mix)})`
  if (fluid < maxKnM2) {
    maxKnM2 = fluid
    governingEquation = `γc·H hydrostatic over ${placement.pourHeightM} m`
    warnings.push({
      kind: 'code-bound-governs',
      message: `The ${consistencyClassOf(mix)} formula returns ${formula.toFixed(1)} kN/m², more than the ${fluid.toFixed(1)} kN/m² a full ${placement.pourHeightM} m column of concrete exerts. The fluid head caps it.`,
    })
  }
  if (maxKnM2 > DIN_PRESSURE_CEILING_KN_M2) {
    maxKnM2 = DIN_PRESSURE_CEILING_KN_M2
    governingEquation = `${DIN_PRESSURE_CEILING_KN_M2} kN/m² ceiling`
    warnings.push({
      kind: 'code-bound-governs',
      message: `Clamped at the ${DIN_PRESSURE_CEILING_KN_M2} kN/m² ceiling observed across every consistency class. Whether that is DIN's limit or the calculator's is unverified.`,
    })
  }

  const hydrostaticHeightM = Math.min(placement.pourHeightM, maxKnM2 / gamma)
  const immersion = placement.vibratorImmersionDepthM
  if (immersion !== undefined && (immersion > hydrostaticHeightM || immersion > 1)) {
    warnings.push({
      kind: 'immersion-below-hydrostatic-zone',
      message: `The poker reaches ${immersion} m against a ${hydrostaticHeightM.toFixed(2)} m hydrostatic zone and a 1 m limit. Vibrating below it re-liquefies concrete that had begun to stiffen, and the real pressure is higher than any figure here.`,
    })
  }

  return {
    standard: 'DIN_18218',
    maxKnM2,
    gradientKnM3: gamma,
    hydrostaticHeightM,
    governingEquation,
    warnings,
  }
}

/**
 * The rate a form rated to `permissibleKnM2` may be poured at, m/h. This is the
 * direction a site actually asks the question in — the form is what it is, and the
 * decision is how fast the pump may run — and it is the inversion PERI's and
 * PASCHAL's calculators both expose as a toggle.
 *
 * Undefined when the rating is already exceeded at a standstill: the pressure a
 * mix exerts at v = 0 is its constant term, and no rate makes that smaller.
 */
export function dinMaxRiseRateMH(
  mix: ConcreteMix,
  placement: Placement,
  permissibleKnM2: number,
): number | undefined {
  const consistency = consistencyClassOf(mix)
  const { a, b } = BASE[consistency]
  const setting = mix.endOfSettingH ?? DIN_REFERENCE_SETTING_H
  const scale = scaleFactor(mix, placement)
  const slope = SETTING_SLOPE[consistency]
  const rate =
    slope !== undefined
      ? (permissibleKnM2 / (scale * (1 + slope * (setting - DIN_REFERENCE_SETTING_H))) - a) / b
      : (permissibleKnM2 / scale - a) / (b * (setting / DIN_REFERENCE_SETTING_H))
  if (!Number.isFinite(rate) || rate <= 0) return undefined
  return Math.min(rate, DIN_MAX_RISE_RATE_MH)
}
