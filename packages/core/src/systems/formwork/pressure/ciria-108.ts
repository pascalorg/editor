import {
  type ConcreteMix,
  cementBlend,
  delaysSetting,
  type Placement,
  type PressureEnvelope,
  type PressureWarning,
  unitWeightKnM3,
} from './types'

/**
 * CIRIA Report 108 (1985) / BS 5975 — the UK path.
 *
 * ```
 * Pmax = D·[C1·√R + C2·K·√(H − C1·√R)]     kN/m²
 * K    = (36 / (T + 16))²
 * Hz   = C1·√R                              hydrostatic zone height, m
 * ```
 *
 * The shape is the same trapezoid DIN produces but the corner is placed
 * differently: `Hz` comes from the rate alone, `C1·√R`, and the pressure above the
 * corner is the fluid head over that depth. `C1` is the section-shape coefficient
 * and it is where the code's own column/wall distinction lives — 1.5 for a narrow
 * section against 1.0 for a wall, which is a 50 % deeper hydrostatic zone on a
 * column at the same rate.
 *
 * ⚠️ `C2` is the least verified figure in the whole reference set. CIRIA groups
 * concretes 1–7 by cement type and admixture and the transcription here is from a
 * published spreadsheet implementation and one paper, not from Table 1. It is
 * exposed as `mix.ciriaC2` so a job that has been given the real value can use it,
 * and every result carries a `derived-coefficients` warning until R108 is bought.
 *
 * BS 5975:2019 also permits a no-inputs shortcut — 25 kN/m² per metre of pour, flat
 * fluid head at 25 kN/m³ — which is `bsShortcutPressure` below and the right answer
 * when nothing about the mix is known.
 *
 * See `wiki/formwork/reference/design.md` §1.5.
 */

/** Section shape: a narrow section holds a deeper fluid zone than a wall. */
const C1_WALL = 1
const C1_COLUMN = 1.5

/** CIRIA's temperature term. Colder concrete, higher `K`, higher pressure. */
export function ciriaK(concreteTemperatureC: number): number {
  return (36 / (concreteTemperatureC + 16)) ** 2
}

/**
 * `C2` from the mix, over CIRIA's three groups: plain Portland at the bottom,
 * retarded and blended in the middle, the slowest blends and retarded SCC at the
 * top. SCC lands in Group B or C rather than getting a row of its own, which is the
 * opposite of DIN's treatment of it.
 */
export function ciriaC2(mix: ConcreteMix): number {
  if (mix.ciriaC2 !== undefined) return mix.ciriaC2
  const blend = cementBlend(mix.cement)
  const retarded = delaysSetting(mix.cement)
  if (blend === 'high-blend' || (mix.selfCompacting && retarded)) return 0.6
  if (blend === 'blended' || retarded || mix.selfCompacting) return 0.45
  return 0.3
}

export function ciriaPressure(mix: ConcreteMix, placement: Placement): PressureEnvelope {
  const density = unitWeightKnM3(mix)
  const c1 = placement.elementKind === 'column' ? C1_COLUMN : C1_WALL
  const c2 = ciriaC2(mix)
  const k = ciriaK(placement.concreteTemperatureC)
  const zone = c1 * Math.sqrt(Math.max(0, placement.riseRateMH))
  const fluid = density * placement.pourHeightM
  const warnings: PressureWarning[] = [
    {
      kind: 'derived-coefficients',
      message: `C2 = ${c2} is transcribed from a published spreadsheet implementation and one paper rather than from CIRIA R108 Table 1. It is the weakest figure in the reference set — buy R108 and transcribe the table before relying on a CIRIA design.`,
    },
  ]

  // A hydrostatic zone deeper than the pour means the whole pour is fluid: there is
  // no stiffened block below to shed load into.
  if (zone >= placement.pourHeightM) {
    return {
      standard: 'CIRIA_108',
      maxKnM2: fluid,
      gradientKnM3: density,
      hydrostaticHeightM: placement.pourHeightM,
      governingEquation: `D·H hydrostatic — C1·√R = ${zone.toFixed(2)} m reaches the full ${placement.pourHeightM} m pour`,
      warnings,
    }
  }

  const formula = density * (zone + c2 * k * Math.sqrt(placement.pourHeightM - zone))
  let maxKnM2 = formula
  let governingEquation = `Pmax = D·[C1√R + C2·K·√(H − C1√R)], C1 = ${c1}, C2 = ${c2}, K = ${k.toFixed(3)}`
  if (maxKnM2 > fluid) {
    maxKnM2 = fluid
    governingEquation = `D·H hydrostatic over ${placement.pourHeightM} m (caps CIRIA Pmax)`
    warnings.push({
      kind: 'code-bound-governs',
      message: `The CIRIA formula returns ${formula.toFixed(1)} kN/m², above the ${fluid.toFixed(1)} kN/m² fluid head. R108 caps Pmax at D·H.`,
    })
  }

  return {
    standard: 'CIRIA_108',
    maxKnM2,
    gradientKnM3: density,
    // `C1√R` is the formula's first term, not the corner of the diagram. The ramp is
    // hydrostatic, so it can only reach `Pmax` at `Pmax/D` — which is the figure the
    // published spreadsheet reports as `Hz` (2.15 m against a 1.73 m `C1√R` on the
    // worked example) and the only depth that makes the diagram continuous.
    hydrostaticHeightM: Math.min(placement.pourHeightM, maxKnM2 / density),
    governingEquation,
    warnings,
  }
}

/**
 * BS 5975:2019's permitted shortcut: 25 kN/m² per metre of pour, no inputs. Full
 * fluid head at 25 kN/m³ and nothing else asked, which makes it the honest answer
 * for a model where the mix, the rate and the temperature are all unknown — and a
 * genuinely conservative one, since every rate-based formula sits below it.
 */
export function bsShortcutPressure(mix: ConcreteMix, placement: Placement): PressureEnvelope {
  const density = unitWeightKnM3(mix)
  return {
    standard: 'BS_5975_SHORTCUT',
    maxKnM2: density * placement.pourHeightM,
    gradientKnM3: density,
    hydrostaticHeightM: placement.pourHeightM,
    governingEquation: `BS 5975 shortcut — ${density} kN/m² per metre over ${placement.pourHeightM} m`,
    warnings: [
      {
        kind: 'hydrostatic-forced',
        message:
          'BS 5975 permits full fluid head as a no-inputs alternative to the CIRIA method. It is conservative by design: state the mix, rate and temperature to get a rate-based pressure instead.',
      },
    ],
  }
}
