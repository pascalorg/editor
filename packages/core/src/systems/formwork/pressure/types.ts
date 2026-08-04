/**
 * Fresh-concrete pressure, as the three codes ask for it.
 *
 * Everything downstream — tie spacing, waler spacing, a column's clamp schedule —
 * is a function of this one number, or rather of this one *envelope*: pressure is
 * not a scalar that applies to the whole form. It rises with depth like a fluid to
 * some depth and then stops rising, because the concrete at the bottom has begun to
 * stiffen and carries itself. Where it stops is what the codes disagree about, and
 * the disagreement is worth several hundred millimetres of tie spacing.
 *
 * The three are not interchangeable and are not convertible into one another. ACI
 * publishes a single scalar `pmax` applied over the full height; DIN publishes a
 * trapezoid with an explicit hydrostatic depth; CIRIA publishes a third shape again.
 * A rating certified against one is not a check against another, which is why
 * `PermissiblePressure.pressureStandard` exists on the catalog side and why this
 * side records which standard produced a value.
 *
 * See `wiki/formwork/reference/design.md` §1 for the transcribed tables and the
 * conversion audit.
 */

/**
 * DIN's consistency classes. Not a slump number: the class decides both the
 * constant term (the vibration-immersion surcharge, which falls from F1 to F4) and
 * the slope on the rise rate, and SCC sits between F5 and F6 because it is
 * flowable but *not* vibrated.
 */
export type ConsistencyClass = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'SCC'

export const PRESSURE_STANDARD_IDS = [
  'ACI_347',
  'DIN_18218',
  'CIRIA_108',
  'BS_5975_SHORTCUT',
] as const
export type PressureStandardId = (typeof PRESSURE_STANDARD_IDS)[number]

export const PRESSURE_STANDARD_LABELS: Record<PressureStandardId, string> = {
  ACI_347: 'ACI 347R-14 (US)',
  DIN_18218: 'DIN 18218:2010-01 (Germany/EU)',
  CIRIA_108: 'CIRIA Report 108 / BS 5975 (UK)',
  BS_5975_SHORTCUT: 'BS 5975 shortcut — 25 kN/m² per metre of pour',
}

/**
 * What the binder is, rather than what coefficient it implies. Both ACI's `Cc` and
 * CIRIA's `C2` are lookups on the same three questions, so asking them once and
 * deriving both is the only way the two codes can be compared on one mix.
 *
 * `superplasticizer` is asked separately from `retarder` because ACI's Table 2.2
 * footnote counts a high-range water reducer that delays setting *as* a retarder —
 * the single most commonly missed clause in the whole chapter, and a 20 % error in
 * the pressure when it is missed.
 */
export interface CementSpec {
  /** Fraction of the binder replaced by ggbs, 0–1. Over 0.70 is ACI's high blend. */
  slagFraction?: number
  /** Fraction replaced by fly ash, 0–1. Over 0.40 is ACI's high blend. */
  flyAshFraction?: number
  retarder?: boolean
  superplasticizer?: boolean
}

/**
 * The concrete, as the codes measure it.
 *
 * `densityKgM3` and `unitWeightKnM3` are deliberately not derived from each other.
 * ACI's Table 2.1 brackets normal-weight concrete at 2240–2400 kg/m³ and DIN
 * validates its whole coefficient set at 25 kN/m³, which is about 2550 kg/m³ — so
 * converting one into the other silently moves an ACI design out of its `Cw = 1.0`
 * band, or drops a DIN design 6 % below the table it came from. The codes disagree
 * about what ordinary concrete weighs; each keeps its own figure.
 */
export interface ConcreteMix {
  /** ACI's `w`, kg/m³. Defaults to 2400 — the top of ACI's normal-weight band. */
  densityKgM3?: number
  /** DIN's and CIRIA's `γc` / `D`, kN/m³. Defaults to 25, where both are validated. */
  unitWeightKnM3?: number
  consistencyClass?: ConsistencyClass
  slumpMm?: number
  selfCompacting?: boolean
  cement?: CementSpec
  /** DIN's `tE` — end of setting, hours, at the reference temperature. */
  endOfSettingH?: number
  /** DIN's `TRef`, °C. Only the difference from the placing temperature matters. */
  referenceTemperatureC?: number
  /**
   * CIRIA's `C2`, overriding what the cement spec implies. Exposed because it is
   * the least verified number in the reference and a job may have been given one.
   */
  ciriaC2?: number
}

/** How the pour is actually done — which is most of the answer. */
export interface Placement {
  /** Rate of rise, m/h. From the pump rate divided by the plan area if pumped. */
  riseRateMH: number
  /** Concrete temperature at placing, °C. Not the air temperature. */
  concreteTemperatureC: number
  /** Height of this pour, m — the lift, not the element. */
  pourHeightM: number
  elementKind: 'wall' | 'column'
  vibration?: 'internal' | 'external' | 'none'
  /** How deep the poker goes, m. Past 1.2 m ACI's special cases are void. */
  vibratorImmersionDepthM?: number
  /** Pumped in at the bottom of the form rather than placed from the top. */
  pumpedFromBase?: boolean
}

export type PressureWarningKind =
  /** The special-case formulas do not apply, so the full fluid head does. */
  | 'hydrostatic-forced'
  /** Outside the code's stated scope — the answer is indicative, not certified. */
  | 'outside-code-scope'
  /** A bound rather than the formula set the answer. */
  | 'code-bound-governs'
  /** Pumping from the base adds surge on top of the full fluid head. */
  | 'pump-surge'
  /** The coefficients behind this were reverse-engineered, not transcribed. */
  | 'derived-coefficients'
  /**
   * The poker reaches below the hydrostatic zone, which re-liquefies concrete that
   * had begun to stiffen. The model does not hold and the pressure is higher than
   * anything here reports.
   */
  | 'immersion-below-hydrostatic-zone'

export interface PressureWarning {
  kind: PressureWarningKind
  message: string
}

/**
 * The pressure diagram, as two numbers and a shape: it rises at `gradientKnM3` per
 * metre of depth below the top of the pour until it reaches `maxKnM2`, and is
 * constant below that. Every code in the set produces this shape; they differ only
 * in where the corner falls, and ACI's `pmax` is the degenerate case where the
 * corner is at the base.
 */
export interface PressureEnvelope {
  standard: PressureStandardId
  maxKnM2: number
  /**
   * How fast the triangular part rises, kN/m³. The concrete's own unit weight,
   * except under pump surge where the piston adds to it.
   */
  gradientKnM3: number
  /** Depth below the top of the pour at which the ramp reaches `maxKnM2`, m. */
  hydrostaticHeightM: number
  /** Which equation or bound produced `maxKnM2`, for the design report. */
  governingEquation: string
  warnings: PressureWarning[]
}

/** ACI's own normal-weight ceiling, and the figure a US design starts from. */
export const DEFAULT_DENSITY_KG_M3 = 2400

/** Where DIN's and CIRIA's tables are validated, kN/m³. */
export const DEFAULT_UNIT_WEIGHT_KN_M3 = 25

/** Pumping from the base is full fluid head plus this, at least (ACI §2.2.2.4). */
export const PUMP_SURGE_FACTOR = 1.25

/**
 * ACI §2.2.2.1.3: a vertical element with no plan dimension over this is a column,
 * and anything wider is a wall — which changes the equation, not just the label. A
 * 2.1 m "column" must be designed as a wall.
 */
export const ACI_COLUMN_PLAN_LIMIT_M = 2

/** The special-case formulas hold only up to this slump; past it, fluid head. */
export const ACI_SLUMP_LIMIT_MM = 175

/** And only for internal vibration no deeper than this. */
export const ACI_VIBRATION_DEPTH_LIMIT_M = 1.2

/**
 * Which equation an element takes, from its plan dimensions in m. Read off the
 * geometry rather than asked, because the answer is a code definition and not a
 * preference — and because the element a user calls a column is regularly one.
 */
export function verticalElementKind(planDimensionsM: readonly number[]): 'wall' | 'column' {
  return planDimensionsM.every((dim) => dim <= ACI_COLUMN_PLAN_LIMIT_M) ? 'column' : 'wall'
}

/** Pressure at `depthM` below the top of the pour, kN/m². */
export function pressureAtDepth(envelope: PressureEnvelope, depthM: number): number {
  if (depthM <= 0) return 0
  return Math.min(envelope.gradientKnM3 * depthM, envelope.maxKnM2)
}

/**
 * The envelope as the tie grid wants it: pressure at an elevation above the pour
 * base, in mm. The two run in opposite directions — pressure is measured down from
 * the top of the pour and a layout is measured up from its base — and getting that
 * inversion wrong puts the dense end of a tie grid at the top of the wall.
 */
export function pressureAtElevationMm(
  envelope: PressureEnvelope,
  pourHeightMm: number,
): (elevationMm: number) => number {
  return (elevationMm) => pressureAtDepth(envelope, (pourHeightMm - elevationMm) / 1000)
}

/** Depth of fluid concrete that would exert `maxKnM2`, m — DIN's `hs`. */
export function equivalentHeadM(envelope: PressureEnvelope): number {
  return envelope.hydrostaticHeightM
}

export function densityKgM3(mix: ConcreteMix): number {
  return mix.densityKgM3 ?? DEFAULT_DENSITY_KG_M3
}

export function unitWeightKnM3(mix: ConcreteMix): number {
  return mix.unitWeightKnM3 ?? DEFAULT_UNIT_WEIGHT_KN_M3
}

/**
 * Whether the mix contains anything that delays setting. One question for both
 * codes, and the place ACI's superplasticizer footnote is honoured.
 */
export function delaysSetting(cement: CementSpec | undefined): boolean {
  return Boolean(cement?.retarder || cement?.superplasticizer)
}

/** ACI's blend bands: over 70 % slag or 40 % fly ash is the slow one. */
export function cementBlend(cement: CementSpec | undefined): 'portland' | 'blended' | 'high-blend' {
  const slag = cement?.slagFraction ?? 0
  const flyAsh = cement?.flyAshFraction ?? 0
  if (slag > 0.7 || flyAsh > 0.4) return 'high-blend'
  if (slag > 0 || flyAsh > 0) return 'blended'
  return 'portland'
}

/**
 * The class to design to when the job has not stated one. SCC is its own class
 * whatever the slump says, and F3 (soft) is where ordinary vibrated structural
 * concrete sits — the middle of the vibrated range rather than the safest end,
 * because F4 would quietly over-design every wall in the model.
 */
export function consistencyClassOf(mix: ConcreteMix): ConsistencyClass {
  if (mix.selfCompacting) return 'SCC'
  return mix.consistencyClass ?? 'F3'
}
