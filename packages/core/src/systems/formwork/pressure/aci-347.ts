import {
  ACI_SLUMP_LIMIT_MM,
  ACI_VIBRATION_DEPTH_LIMIT_M,
  type CementSpec,
  type ConcreteMix,
  cementBlend,
  delaysSetting,
  densityKgM3,
  type Placement,
  type PressureEnvelope,
  type PressureWarning,
  PUMP_SURGE_FACTOR,
} from './types'

/**
 * ACI 347R-14 §2.2.2 — lateral pressure of fresh concrete, the US path.
 *
 * ACI's model is a single scalar applied over the whole height, not an envelope:
 * `pmax` is the design pressure everywhere below the top of the pour, and the fact
 * that the real pressure tails off above `pmax/w` is acknowledged in the commentary
 * and then deliberately not exploited, because uniform spacing is what a crew
 * actually builds. So the envelope this returns has its corner at `pmax/w` and is
 * flat below — which is the same number ACI designs to, expressed in the shape the
 * rest of the engine reads.
 *
 * The special-case formulas (2.2/2.3/2.4) buy a substantial reduction against the
 * fluid head, and they hold only inside a stated envelope: slump ≤ 175 mm, internal
 * vibration no deeper than 1.2 m, and a rise rate at or below 4.5 m/h on a wall.
 * Outside it — and for SCC always, and for anything pumped in at the base — the
 * answer is the full fluid head, which is roughly double. That is not a
 * conservatism this code applies on its own initiative; ACI states each of those
 * exclusions explicitly.
 *
 * Metric is not the imperial path converted. 600 psf is 28.7 kPa and ACI rounds it
 * *up* to 30; 14 ft is 4.267 m and ACI rounds it *down* to 4.2. The two give
 * slightly different answers by design, and this module implements the SI column.
 *
 * See `wiki/formwork/reference/design.md` §1.1–1.3.
 */

/** Above this rise rate Eq 2.4 does not apply at all — fluid head only. */
const MAX_RATE_FOR_EQ_24_MH = 4.5

/** Eq 2.3's band: below this rate, and only up to `EQ_23_MAX_HEIGHT_M`. */
const EQ_23_MAX_RATE_MH = 2.1
const EQ_23_MAX_HEIGHT_M = 4.2

/** SI minimum on the special cases, kPa, before `Cw`. Explicitly not on Eq 2.1. */
const MINIMUM_KN_M2 = 30

const G = 9.81

/**
 * Table 2.1 — unit weight coefficient. Normal-weight concrete is 1.0; a lightweight
 * mix gets a reduction with a floor at 0.80, and a heavyweight one a proportional
 * increase with no cap.
 */
export function unitWeightCoefficient(densityKgM3Value: number): number {
  if (densityKgM3Value < 2240) return Math.max(0.8, 0.5 * (1 + densityKgM3Value / 2320))
  if (densityKgM3Value > 2400) return densityKgM3Value / 2320
  return 1
}

/**
 * Table 2.2 — chemistry coefficient. The retarder question includes any
 * superplasticizer that delays set, per the table's own footnote; `delaysSetting`
 * is where that is applied.
 */
export function chemistryCoefficient(cement: CementSpec | undefined): number {
  const retarded = delaysSetting(cement)
  switch (cementBlend(cement)) {
    case 'high-blend':
      return 1.4
    case 'blended':
      return retarded ? 1.4 : 1.2
    default:
      return retarded ? 1.2 : 1
  }
}

/** Eq 2.1b — the fluid case. `ρgh` in kPa, which is the ceiling on everything else. */
export function hydrostaticKnM2(densityKgM3Value: number, depthM: number): number {
  return (densityKgM3Value * G * depthM) / 1000
}

/**
 * Whether the special-case formulas may be used at all. Each of these is an
 * explicit exclusion in the text rather than an interpretation, and each one that
 * bites replaces the formula with the full fluid head.
 */
function specialCaseExclusions(mix: ConcreteMix, placement: Placement): PressureWarning[] {
  const out: PressureWarning[] = []
  if (mix.selfCompacting) {
    out.push({
      kind: 'hydrostatic-forced',
      message:
        'ACI 347 has no SCC provisions and directs the hydrostatic equation for self-consolidating concrete until the effect on formwork pressure is measured. The 30·Cw minimum is suppressed with it.',
    })
  }
  if ((mix.slumpMm ?? 0) > ACI_SLUMP_LIMIT_MM) {
    out.push({
      kind: 'hydrostatic-forced',
      message: `Slump ${mix.slumpMm} mm exceeds the ${ACI_SLUMP_LIMIT_MM} mm validity limit on Eq. 2.2–2.4, so the fluid head governs.`,
    })
  }
  if (placement.vibration === 'external') {
    out.push({
      kind: 'hydrostatic-forced',
      message: 'External vibration voids the special-case formulas — design for the fluid head.',
    })
  }
  if ((placement.vibratorImmersionDepthM ?? 0) > ACI_VIBRATION_DEPTH_LIMIT_M) {
    out.push({
      kind: 'hydrostatic-forced',
      message: `Internal vibration to ${placement.vibratorImmersionDepthM} m is deeper than the ${ACI_VIBRATION_DEPTH_LIMIT_M} m the special cases are validated to, so the fluid head governs.`,
    })
  }
  if (placement.pumpedFromBase) {
    out.push({
      kind: 'pump-surge',
      message: `Pumped from the base of the form: ACI §2.2.2.4 directs the full fluid head plus at least 25 % for pump surge, and notes pressure can reach the face pressure of the pump piston.`,
    })
  }
  if (placement.elementKind === 'wall' && placement.riseRateMH > MAX_RATE_FOR_EQ_24_MH) {
    out.push({
      kind: 'hydrostatic-forced',
      message: `Eq. 2.4 does not apply above ${MAX_RATE_FOR_EQ_24_MH} m/h — Committee 347 has insufficient data at higher rates — so a wall rising at ${placement.riseRateMH} m/h takes the fluid head.`,
    })
  }
  return out
}

/** Eq 2.2 / 2.3, kPa before the bounds. Columns at any height, and short walls. */
function equation22(cw: number, cc: number, rate: number, temperatureC: number): number {
  return cw * cc * (7.2 + (785 * rate) / (temperatureC + 17.8))
}

/** Eq 2.4, kPa before the bounds. Tall walls and the middle rate band. */
function equation24(cw: number, cc: number, rate: number, temperatureC: number): number {
  return cw * cc * (7.2 + 1156 / (temperatureC + 17.8) + (244 * rate) / (temperatureC + 17.8))
}

export function aciPressure(mix: ConcreteMix, placement: Placement): PressureEnvelope {
  const density = densityKgM3(mix)
  const gradient = (density * G) / 1000
  const fluid = hydrostaticKnM2(density, placement.pourHeightM)
  const warnings = specialCaseExclusions(mix, placement)

  const surge = placement.pumpedFromBase
  const forced = warnings.some((warning) => warning.kind === 'hydrostatic-forced') || surge
  if (forced) {
    const maxKnM2 = surge ? fluid * PUMP_SURGE_FACTOR : fluid
    return {
      standard: 'ACI_347',
      maxKnM2,
      gradientKnM3: surge ? gradient * PUMP_SURGE_FACTOR : gradient,
      hydrostaticHeightM: placement.pourHeightM,
      governingEquation: surge
        ? 'Eq. 2.1b hydrostatic ρgh × 1.25 pump surge'
        : 'Eq. 2.1b hydrostatic ρgh',
      warnings,
    }
  }

  const cw = unitWeightCoefficient(density)
  const cc = chemistryCoefficient(mix.cement)
  const rate = placement.riseRateMH
  const temperature = placement.concreteTemperatureC

  // Which special case applies. A column takes Eq. 2.2 at any height; a wall takes
  // Eq. 2.3 only when it is both slow and short, and Eq. 2.4 otherwise.
  const shortAndSlow = rate < EQ_23_MAX_RATE_MH && placement.pourHeightM <= EQ_23_MAX_HEIGHT_M
  const isEq22 = placement.elementKind === 'column' || shortAndSlow
  const formula = isEq22
    ? equation22(cw, cc, rate, temperature)
    : equation24(cw, cc, rate, temperature)
  const label = isEq22
    ? placement.elementKind === 'column'
      ? 'Eq. 2.2 (columns)'
      : 'Eq. 2.3 (walls, R < 2.1 m/h and H ≤ 4.2 m)'
    : 'Eq. 2.4 (walls)'

  const minimum = MINIMUM_KN_M2 * cw
  let maxKnM2 = Math.max(formula, minimum)
  let governingEquation = formula < minimum ? `${label}, at the 30·Cw minimum` : label
  if (maxKnM2 >= fluid) {
    maxKnM2 = fluid
    governingEquation = `Eq. 2.1b hydrostatic ρgh (caps ${label})`
    warnings.push({
      kind: 'code-bound-governs',
      message: `${label} returns ${formula.toFixed(1)} kN/m², above the ${fluid.toFixed(1)} kN/m² fluid head over ${placement.pourHeightM} m. ACI caps every special case at Eq. 2.1.`,
    })
  } else if (formula < minimum) {
    warnings.push({
      kind: 'code-bound-governs',
      message: `${label} returns ${formula.toFixed(1)} kN/m², below the ${minimum.toFixed(1)} kN/m² floor of 30·Cw, so the minimum governs.`,
    })
  }

  return {
    standard: 'ACI_347',
    maxKnM2,
    gradientKnM3: gradient,
    // ACI designs to one scalar over the full height rather than exploiting the
    // tail-off above pmax/w, so the corner is placed where the ramp meets pmax and
    // the diagram is flat from there to the base — the same number, in the shape
    // the layout reads.
    hydrostaticHeightM: Math.min(placement.pourHeightM, maxKnM2 / gradient),
    governingEquation,
    warnings,
  }
}

/**
 * The rate of rise a form rated to `permissibleKnM2` may be poured at, m/h — the
 * inverse solve every manufacturer's calculator exposes. Undefined when the rating
 * is already exceeded at a standstill, which is a form that cannot be used on this
 * pour at all rather than one to pour slowly.
 */
export function aciMaxRiseRateMH(
  mix: ConcreteMix,
  placement: Placement,
  permissibleKnM2: number,
): number | undefined {
  const density = densityKgM3(mix)
  const cw = unitWeightCoefficient(density)
  const cc = chemistryCoefficient(mix.cement)
  const temperature = placement.concreteTemperatureC
  const scale = cw * cc
  const shortAndSlow = placement.pourHeightM <= EQ_23_MAX_HEIGHT_M
  const isEq22 = placement.elementKind === 'column' || shortAndSlow
  const target = permissibleKnM2 / scale
  const rate = isEq22
    ? ((target - 7.2) * (temperature + 17.8)) / 785
    : ((target - 7.2) * (temperature + 17.8) - 1156) / 244
  if (!Number.isFinite(rate) || rate <= 0) return undefined
  // A wall solved on Eq. 2.3 has to stay inside that equation's own rate band, or
  // the answer belongs to Eq. 2.4 and is lower.
  if (isEq22 && placement.elementKind === 'wall' && rate >= EQ_23_MAX_RATE_MH) {
    const eq24 = ((target - 7.2) * (temperature + 17.8) - 1156) / 244
    return eq24 > 0 ? Math.min(eq24, MAX_RATE_FOR_EQ_24_MH) : EQ_23_MAX_RATE_MH
  }
  return placement.elementKind === 'wall' ? Math.min(rate, MAX_RATE_FOR_EQ_24_MH) : rate
}
