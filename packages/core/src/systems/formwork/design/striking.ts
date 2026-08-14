/**
 * How long the formwork stays on — the elapsed-time answer, under the two code
 * families that publish one.
 *
 * This is the figure a hire invoice multiplies, and it is also the one number in
 * the whole design chain that is *not* a property of the form. Every other module
 * here asks what the concrete does to the shutter; this asks what the shutter has
 * to wait for the concrete to do. So none of the pressure machinery applies, and
 * the sensitivity to temperature runs the *opposite* way: colder concrete sets
 * slower, which raises the pressure a form is designed for and lengthens the time
 * it is held. The same input moves two answers in opposite directions, which is
 * why they are separate modules taking separate temperatures — `Placement`'s is
 * the concrete at *placing*, and the figure here is the surface temperature while
 * it cures. Reading one as the other is how a January pour gets July's strike
 * time.
 *
 * **Two criteria exist, and one of them is a fallback.** ACI 347 §3.7 is
 * explicit that strength is the *preferred* basis and elapsed time is the
 * fallback, so it is worth being plain about which this module can answer on
 * its own:
 *
 * - *Elapsed time* is what the codes tabulate, and it is always the answer when
 *   the project has stated nothing about strength. This is the default and the
 *   fallback.
 * - *Strength / maturity* is a project decision, not a code default — design.md
 *   §3.4 flags the percentages as contract-specific rather than code-mandated,
 *   and the maturity target is calibrated from job-cured specimens. So it is
 *   evaluated only when the project records it, never guessed: a maturity
 *   function with an invented target is a check that cannot fail, which this
 *   suite already documents four of. When the strength criterion is stated but
 *   an input it needs is missing, the strike falls back to elapsed time and says
 *   what was missing rather than silently ignoring the criterion.
 *
 * `basis` on the result exists because the two families do not even measure the
 * same clock. ACI's periods are *"a cumulative number of days, or hours, not
 * necessarily consecutive, during which the temperature of the air surrounding
 * the concrete is above 50 °F (10 °C)"* — an accumulator, so 4 ACI days can be a
 * fortnight in a cold spring. BS 8110's are calendar periods at a stated surface
 * temperature. Reporting either as "days" without saying which is how a
 * programme comes to promise a strike date the concrete has not agreed to.
 *
 * See `wiki/formwork/reference/design.md` §3.1–3.4.
 */

/** Which family tabulates the period. Deliberately not `PressureStandardId` — see below. */
export const STRIKING_STANDARD_IDS = ['ACI_347', 'BS_8110'] as const
export type StrikingStandardId = (typeof STRIKING_STANDARD_IDS)[number]

export const STRIKING_STANDARD_LABELS: Record<StrikingStandardId, string> = {
  ACI_347: 'ACI 347 §3.7.2.3 (US) — cumulative time above 10 °C',
  BS_8110: 'BS 8110-1:1997 Table 6.2 (UK) — calendar time at surface temperature',
}

/**
 * What is being struck, which is the distinction that makes this useful rather
 * than decorative.
 *
 * A slab's deck sheet and the props under it are not held for the same period.
 * BS 8110 says so in its own rows — 100/(t+10) days for the soffit form against
 * 250/(t+10) for the props beneath it — and ACI says it in footnote ‡, where a
 * form that can leave its shores behind comes off at half the time. That gap is
 * the entire reason drophead systems exist, and a per-*element* strike time
 * averages it away: the panels would be reported as held for the props' period,
 * which is two and a half times too long and prices a hire accordingly.
 *
 * The two beam targets are unreachable from a scene today, because beams are not
 * modelled. They are here because the published table has four rows and a
 * transcription that silently keeps two of them is worse than one that keeps all
 * four — the missing rows get filled in later by whoever needs them, from memory.
 */
export type StrikeTarget =
  /** Wall, column and beam-side forms. Carries nothing once the concrete stands up. */
  | 'vertical-form'
  /** The deck sheet and joists under a slab. */
  | 'slab-soffit-form'
  /** The props under a slab — the shores themselves, so never halved. */
  | 'slab-props'
  /** Soffit form to a beam. */
  | 'beam-soffit-form'
  /** Props to a beam, the longest period either code publishes. */
  | 'beam-props'

export const STRIKE_TARGET_LABELS: Record<StrikeTarget, string> = {
  'vertical-form': 'Vertical form to a wall, column or beam side',
  'slab-soffit-form': 'Soffit form to a slab',
  'slab-props': 'Props to a slab',
  'beam-soffit-form': 'Soffit form to a beam',
  'beam-props': 'Props to a beam',
}

export type StrikingAssumptionKind =
  /** No curing temperature stated, so the table's own printed column was taken. */
  | 'temperature'
  /** No clear span stated, so ACI's longest band was taken. */
  | 'clear-span'
  /** The permanent structure's load ratio is unrecorded, so ACI's longer column was taken. */
  | 'load-ratio'
  /** A strength criterion stated no maturity datum, so the shipped 0 °C was taken. */
  | 'maturity-datum'

export interface StrikingAssumption {
  kind: StrikingAssumptionKind
  /** What was taken, in the same words a report should print beside the figure. */
  message: string
}

export type StrikingWarningKind =
  /**
   * The period is accumulated qualifying time, not calendar time. Carried as a
   * warning rather than left to `basis` because it is the one that turns a correct
   * figure into a missed date, and a reader who does not know it cannot ask.
   */
  | 'qualifying-time-not-calendar'
  /** High-early-strength concrete permits a reduction the code declines to quantify. */
  | 'reduction-permitted-not-quantified'
  /** A retarder or a cold spell requires a lengthening the code declines to quantify. */
  | 'increase-required-not-quantified'
  /** The vertical form also carries a soffit form, whose longer period governs. */
  | 'soffit-form-governs'
  /** Below freezing the concrete is not curing and no tabulated period applies. */
  | 'temperature-below-table'
  /** DIN's own family answers this in EN 13670 §5.5, which is not covered here. */
  | 'standard-outside-own-family'
  /**
   * A strength criterion was stated but the inputs to evaluate it are missing, so
   * the strike falls back to the elapsed-time table and names what was missing.
   */
  | 'strength-criterion-not-evaluated'

export interface StrikingWarning {
  kind: StrikingWarningKind
  message: string
}

export interface StrikingInput {
  target: StrikeTarget
  /**
   * Concrete surface temperature while it cures, °C — BS's `t`. Not the placing
   * temperature: `Placement.concreteTemperatureC` is the mix as it goes in, and a
   * pour placed at 20 °C into a form standing in 4 °C air does not cure at 20.
   */
  temperatureC?: number
  /** Clear span between the permanent supports, m. ACI bands its soffit table on it. */
  clearSpanM?: number
  /**
   * The finished structure's live load exceeds its dead load, which selects ACI's
   * shorter column — *"the result of more reserve strength being available for dead
   * load in absence of live load at time of stripping"*.
   */
  liveExceedsDead?: boolean
  /**
   * The form comes away without disturbing the shores — a drophead or early-strip
   * system. ACI footnote ‡ halves the period, floored at 3 days.
   */
  shoresRemain?: boolean
  /** This vertical form also supports a soffit form, whose period governs (ACI footnote *). */
  supportsSoffitForm?: boolean
  /** High-early-strength concrete. Warns rather than shortens — see below. */
  highEarlyStrength?: boolean
  /** A retarder in the mix, or ambient below 10 °C. Warns rather than lengthens. */
  delayedSetting?: boolean
  /**
   * The strength criterion, as the maturity the concrete must reach before it is
   * struck — Nurse–Saul `M_target`, degree-hours, calibrated from job-cured
   * specimens (design.md §3.4). Stated as a project decision rather than
   * defaulted: a guessed target is a check that cannot fail. When it is stated,
   * the governing strike is the later of this and the elapsed-time table, and a
   * criterion missing the temperature history it accumulates over falls back to
   * elapsed time and names it.
   */
  maturityTargetDegreeHours?: number
  /**
   * Nurse–Saul datum temperature, °C. Unstated takes 0 °C and says so — a target
   * calibrated against a different datum cannot be compared with this one.
   */
  maturityDatumC?: number
  /**
   * The required strength the target was calibrated for, as a fraction of the
   * design strength — the way a contract states a strike criterion. Report-only
   * naming: the strike is decided by the maturity target, and this is what it is
   * called in words.
   */
  requiredStrengthFraction?: number
  /** The concrete's design strength, MPa, for the naming above. */
  designStrengthMpa?: number
}

export interface StrikingTime {
  standard: StrikingStandardId
  target: StrikeTarget
  /** The period the form is held, hours. */
  hours: number
  /** The same in days, for a figure a programme is written in. */
  days: number
  /**
   * Whether `hours` is a calendar period or an accumulator over qualifying hours.
   * ACI's is the latter and the difference is a fortnight in a cold spring.
   */
  basis: 'calendar' | 'qualifying-time'
  /**
   * Which of the two criteria set the strike — the elapsed-time table, or a
   * strength/maturity criterion the project stated. Time is the default and the
   * fallback; strength appears only when the project recorded a target and the
   * inputs to evaluate it were present.
   */
  criterion: StrikingCriterion
  /**
   * The strength criterion's assessment, present wherever one was stated and
   * could be evaluated. The governing strike is the later of the two, so under a
   * strength-governed strike `accumulatedDegreeHours` meets the target and under
   * a time-governed one it has already surpassed it.
   */
  maturity?: StrikingMaturity
  /** The table row or formula that produced it, for a report that has to be traceable. */
  governingRule: string
  /** Inputs nobody supplied, taken at the conservative end and named. */
  assumed: StrikingAssumption[]
  warnings: StrikingWarning[]
}

/** Which criterion set the strike on a `StrikingTime`. */
export type StrikingCriterion = 'elapsed-time' | 'strength'

/**
 * One strength criterion, as far as it was recorded and evaluated.
 *
 * The criterion itself is the maturity target: the concrete is struck when its
 * accumulated maturity reaches `targetDegreeHours`, and `accumulatedDegreeHours`
 * is that maturity count at the strike the result reports. The strength fraction
 * and the design strength are the same criterion spoken as a contract would — the
 * percentages are contract-specific rather than code-mandated, so they name the
 * criterion and do not decide it.
 */
export interface StrikingMaturity {
  /** `M_target`, degree-hours — the maturity that reaches the required strength. */
  targetDegreeHours: number
  /** The Nurse–Saul datum the target is measured against, °C. */
  datumC: number
  /** Accumulated maturity at the strike date, degree-hours. */
  accumulatedDegreeHours: number
  /** The required strength, as a fraction of the design strength, where stated. */
  requiredStrengthFraction?: number
  /** The concrete's design strength, MPa, where stated. */
  designStrengthMpa?: number
}

const HOURS_PER_DAY = 24

/** BS 8110 caps the benefit of a warm cure here, so `t_eff = min(t, 16)`. */
export const BS_TEMPERATURE_CAP_C = 16

/** Below this the concrete is not gaining strength and no tabulated period applies. */
export const MIN_CURING_TEMPERATURE_C = 0

/**
 * ACI's threshold for a qualifying hour, °C — and both codes' trigger for a period
 * the engineer has to lengthen. One constant because it is one clause read twice:
 * below this, ACI stops counting and BS's own note calls for an increase.
 */
export const MIN_QUALIFYING_TEMPERATURE_C = 10

/** ACI 347 §3.7.2.3 — vertical and side forms, hours. */
export const ACI_VERTICAL_FORM_H = 12

/** ACI footnote ‡ — a halved soffit period may not fall below this, days. */
export const ACI_HALVED_FLOOR_DAYS = 3

/**
 * Nurse–Saul datum when a strength criterion states none. 0 °C is the degree-hours
 * clock — one hour at 1 °C above freezing is one degree-hour (design.md §3.4).
 */
export const DEFAULT_MATURITY_DATUM_C = 0

/** BS 8110 Table 6.2 numerators, over `(t + 10)`. The vertical row is hours; the rest days. */
const BS_COEFFICIENT: Record<StrikeTarget, number> = {
  'vertical-form': 300,
  'slab-soffit-form': 100,
  // One row in the table covers both: "soffit formwork to beams and props to slabs".
  'slab-props': 250,
  'beam-soffit-form': 250,
  'beam-props': 360,
}

/** ACI's soffit bands, in days, as `[liveBelowDead, liveAboveDead]`. */
const ACI_SOFFIT_DAYS: Record<'slab' | 'beam', ReadonlyArray<readonly [number, number]>> = {
  // One-way floor slabs: < 3 m, 3–6 m, > 6 m.
  slab: [
    [4, 3],
    [7, 4],
    [10, 7],
  ],
  // Joist, beam and girder soffits.
  beam: [
    [7, 4],
    [14, 7],
    [21, 14],
  ],
}

const BAND_LABELS = ['under 3 m clear span', '3–6 m clear span', 'over 6 m clear span'] as const

/**
 * Which of ACI's three span bands a soffit falls in. Absent span takes the
 * longest, because a period guessed short is a slab struck before it can carry
 * itself and a period guessed long only costs hire.
 */
function spanBand(clearSpanM: number | undefined): 0 | 1 | 2 {
  if (clearSpanM === undefined) return 2
  if (clearSpanM < 3) return 0
  return clearSpanM <= 6 ? 1 : 2
}

/**
 * The striking standard a project on a given pressure standard should use, and
 * the reason this is a mapping rather than the same field.
 *
 * The two are not one choice. A pressure standard is picked because a panel's
 * permissible rating is certified against it; a striking table is picked because a
 * contract cites it. DIN 18218 tabulates no striking period at all — its family
 * answers this in EN 13670 §5.5, which is open item 4 and genuinely uncovered — so
 * a DIN project has no period from its own code and falls to BS 8110's formulas,
 * which is a substitution worth saying out loud rather than performing quietly.
 */
export function strikingStandardFor(pressureStandard: string): StrikingStandardId {
  return pressureStandard === 'ACI_347' ? 'ACI_347' : 'BS_8110'
}

/** Whether that mapping was a substitution across families rather than a match. */
export function isSubstitutedStrikingStandard(pressureStandard: string): boolean {
  return pressureStandard === 'DIN_18218'
}

function aciStriking(input: StrikingInput): StrikingTime {
  const assumed: StrikingAssumption[] = []
  const warnings: StrikingWarning[] = [
    {
      kind: 'qualifying-time-not-calendar',
      message:
        'ACI counts only time when the air around the concrete is above 10 °C, and the days need not be consecutive. This is not a calendar period — in a cold spell the strike date is later than the figure suggests.',
    },
  ]

  let hours: number
  let governingRule: string

  if (input.target === 'vertical-form') {
    hours = ACI_VERTICAL_FORM_H
    governingRule = 'ACI 347 §3.7.2.3 — vertical and side forms, 12 h'
    if (input.supportsSoffitForm) {
      warnings.push({
        kind: 'soffit-form-governs',
        message:
          'This vertical form also supports a soffit form, so ACI 347 §3.7.2.3 makes the soffit’s own removal time govern rather than the 12 h shown. Take the period for the soffit it carries.',
      })
    }
  } else {
    const family = input.target.startsWith('slab') ? 'slab' : 'beam'
    const band = spanBand(input.clearSpanM)
    const column = input.liveExceedsDead ? 1 : 0
    const tableDays = ACI_SOFFIT_DAYS[family][band]?.[column] as number

    if (input.clearSpanM === undefined) {
      assumed.push({
        kind: 'clear-span',
        message:
          'No clear span between the permanent supports is recorded, so ACI’s longest band (over 6 m) was taken.',
      })
    }
    if (input.liveExceedsDead === undefined) {
      assumed.push({
        kind: 'load-ratio',
        message:
          'The finished structure’s live-to-dead load ratio is unrecorded, so ACI’s longer column (live load below dead load) was taken.',
      })
    }

    const isForm = input.target.endsWith('soffit-form')
    const halved = isForm && input.shoresRemain === true && column === 0
    const days = halved ? Math.max(tableDays / 2, ACI_HALVED_FLOOR_DAYS) : tableDays

    hours = days * HOURS_PER_DAY
    governingRule = halved
      ? `ACI 347 §3.7.2.3 footnote ‡ — ${tableDays} d for a ${family} soffit, ${BAND_LABELS[band]}, halved to ${days} d because the form leaves its shores`
      : `ACI 347 §3.7.2.3 — ${family} soffit, ${BAND_LABELS[band]}, ${
          column === 1 ? 'live load over dead load' : 'live load under dead load'
        }, ${days} d`
  }

  return {
    standard: 'ACI_347',
    target: input.target,
    hours,
    days: hours / HOURS_PER_DAY,
    basis: 'qualifying-time',
    criterion: 'elapsed-time',
    governingRule,
    assumed,
    warnings: warnings.concat(adjustmentWarnings(input)),
  }
}

function bsStriking(input: StrikingInput): StrikingTime {
  const assumed: StrikingAssumption[] = []
  const warnings: StrikingWarning[] = []

  const stated = input.temperatureC
  if (stated === undefined) {
    assumed.push({
      kind: 'temperature',
      message:
        'No curing surface temperature is recorded, so BS 8110’s own printed column (16 °C and above) was taken. A colder cure lengthens every period below.',
    })
  } else if (stated < MIN_CURING_TEMPERATURE_C) {
    warnings.push({
      kind: 'temperature-below-table',
      message: `A surface temperature of ${stated} °C is below BS 8110 Table 6.2’s range, and below freezing the concrete is not gaining strength at all. The period was taken at 0 °C, which is the longest the table publishes and still not an answer for a frozen pour.`,
    })
  }

  const effective = Math.min(
    Math.max(stated ?? BS_TEMPERATURE_CAP_C, MIN_CURING_TEMPERATURE_C),
    BS_TEMPERATURE_CAP_C,
  )
  const coefficient = BS_COEFFICIENT[input.target]
  const inHours = input.target === 'vertical-form'
  const value = coefficient / (effective + 10)
  const hours = inHours ? value : value * HOURS_PER_DAY

  return {
    standard: 'BS_8110',
    target: input.target,
    hours,
    days: hours / HOURS_PER_DAY,
    basis: 'calendar',
    criterion: 'elapsed-time',
    governingRule: `BS 8110-1:1997 Table 6.2 — ${coefficient}/(t + 10) ${
      inHours ? 'h' : 'd'
    } at t = ${effective} °C`,
    assumed,
    warnings: warnings.concat(adjustmentWarnings(input)),
  }
}

/**
 * The two adjustments both codes require and neither quantifies.
 *
 * ACI: high-early-strength concrete means the periods *"can be reduced as
 * approved"*, and a retarder or ambient below 10 °C means they *"should be
 * increased at the discretion of the engineer/architect"*. Both are conditions on
 * a named person's judgement, with no factor attached. Applying an invented one
 * would put a fabricated number into the figure that decides when a slab is
 * allowed to carry itself, so they are reported and not applied — and the
 * reduction is reported as *available* rather than taken, which is the direction
 * that costs hire rather than the direction that drops a floor.
 */
function adjustmentWarnings(input: StrikingInput): StrikingWarning[] {
  const warnings: StrikingWarning[] = []
  if (input.highEarlyStrength) {
    warnings.push({
      kind: 'reduction-permitted-not-quantified',
      message:
        'High-early-strength concrete permits a shorter period, but the code attaches no factor to it — the reduction is the engineer’s to approve. The figure here is the unreduced one.',
    })
  }
  if (input.delayedSetting) {
    warnings.push({
      kind: 'increase-required-not-quantified',
      message:
        'A retarder in the mix, or ambient below 10 °C, requires a longer period at the engineer’s discretion, and the code attaches no factor to it. The figure here is not adjusted and is therefore short.',
    })
  }
  return warnings
}

/**
 * How long the form stays on, under the standard given.
 *
 * Pure, and takes the target rather than an element, because the answer is per
 * thing-being-struck: the deck sheet and the props under one slab are two periods
 * and pricing them as one is the mistake this shape exists to prevent.
 */
export function strikingTime(standard: StrikingStandardId, input: StrikingInput): StrikingTime {
  const elapsed = standard === 'ACI_347' ? aciStriking(input) : bsStriking(input)
  return withStrength(elapsed, input)
}

/**
 * A stated strength criterion, judged against the elapsed-time answer.
 *
 * The elapsed tables are the default and the fallback; strength exists only when
 * the project states a maturity target, and then only as far as the inputs to
 * evaluate it allow. The governing strike is the *later* of the two — the form
 * stays until both the code's period and the concrete's strength agree it can
 * come off, which is the same conservative direction every default in this
 * module already takes. A criterion that cannot be evaluated is not silently
 * dropped: it falls back to elapsed time and says what was missing (spec
 * "A strength criterion without the inputs to evaluate it is not silently
 * dropped").
 */
function withStrength(elapsed: StrikingTime, input: StrikingInput): StrikingTime {
  const target = input.maturityTargetDegreeHours
  const fraction = input.requiredStrengthFraction
  const design = input.designStrengthMpa
  if (target === undefined && fraction === undefined && design === undefined) return elapsed

  const assumed = [...elapsed.assumed]
  const warnings = [...elapsed.warnings]
  const fallback = (message: string): StrikingTime => ({
    ...elapsed,
    criterion: 'elapsed-time',
    assumed,
    warnings: [...warnings, { kind: 'strength-criterion-not-evaluated', message }],
  })

  if (target === undefined) {
    return fallback(
      `The strength criterion (${strengthName(fraction, design)}) could not be evaluated because the maturity it must reach to get there is not recorded — the degree-hours target calibrated from job-cured specimens. The strike falls back to the elapsed-time criterion: ${elapsed.governingRule}.`,
    )
  }

  const datum = input.maturityDatumC ?? DEFAULT_MATURITY_DATUM_C
  if (input.maturityDatumC === undefined) {
    assumed.push({
      kind: 'maturity-datum',
      message: `The strength criterion names no maturity datum, so the shipped ${DEFAULT_MATURITY_DATUM_C} °C datum was taken. A target calibrated against a different datum cannot be compared with this one.`,
    })
  }

  const criterion = `${strengthName(fraction, design)} at ${target} °C·h of maturity (Nurse–Saul at a ${datum} °C datum)`
  const surface = input.temperatureC
  if (surface === undefined) {
    return fallback(
      `The strength criterion (${criterion}) could not be evaluated because the curing temperature history is not recorded — the surface temperature while it cures, which the maturity accumulates over. The strike falls back to the elapsed-time criterion: ${elapsed.governingRule}.`,
    )
  }
  if (surface <= datum) {
    return fallback(
      `The strength criterion (${criterion}) could not be evaluated because at ${surface} °C against a ${datum} °C datum no maturity accumulates. The strike falls back to the elapsed-time criterion: ${elapsed.governingRule}.`,
    )
  }

  const strengthHours = target / (surface - datum)
  const strengthGoverns = strengthHours > elapsed.hours
  const hours = strengthGoverns ? strengthHours : elapsed.hours
  const accumulated = (surface - datum) * hours

  const sentence = strengthGoverns
    ? ` The strike is governed by the strength criterion: ${strengthName(
        fraction,
        design,
      )} is reached at ${target} °C·h of maturity, which at ${surface} °C against the ${datum} °C datum takes ${formatPeriod(
        strengthHours,
      )} — later than the elapsed-time period of ${formatPeriod(elapsed.hours)}.`
    : ` The strength criterion (${strengthName(
        fraction,
        design,
      )} at ${target} °C·h of maturity) is reached in ${formatPeriod(
        strengthHours,
      )}, sooner than the elapsed-time period — time governs.`

  return {
    ...elapsed,
    hours,
    days: hours / HOURS_PER_DAY,
    criterion: strengthGoverns ? 'strength' : 'elapsed-time',
    maturity: {
      targetDegreeHours: target,
      datumC: datum,
      accumulatedDegreeHours: accumulated,
      ...(fraction === undefined ? {} : { requiredStrengthFraction: fraction }),
      ...(design === undefined ? {} : { designStrengthMpa: design }),
    },
    governingRule: `${elapsed.governingRule}.${sentence}`,
    assumed,
    warnings,
  }
}

/** The strength criterion in words a report should print, from what was stated. */
function strengthName(fraction: number | undefined, design: number | undefined): string {
  if (fraction !== undefined && design !== undefined)
    return `${Math.round(fraction * 100)} % of the design strength (${design} MPa)`
  if (fraction !== undefined) return `${Math.round(fraction * 100)} % of the design strength`
  if (design !== undefined) return `the design strength of ${design} MPa`
  return 'the required strength'
}

/** A period as a report reads it: hours when it is part of a day, days above. */
function formatPeriod(hours: number): string {
  return hours < 48 ? `${Math.round(hours)} h` : `${(hours / 24).toFixed(1)} d`
}

/**
 * Which period a part is held for, from its own kind.
 *
 * The join that turns a striking table into a hire duration: `bomLines` groups on
 * catalog id, every line knows its kind, and a kind is enough to say whether the
 * part is a face that can come away early or a shore that cannot. `undefined` for
 * the kinds that are not struck at all — a tie is cut off and consumed, a
 * consumable is gone — so a caller cannot silently price them as held plant.
 */
export function strikeTargetForPartKind(
  kind: string,
  hostKind: 'wall' | 'column' | 'slab',
): StrikeTarget | undefined {
  if (hostKind !== 'slab') {
    // Everything forming a wall or a column is a vertical form, props included:
    // a wall's raker holds it on line against wind, it is not shoring a soffit.
    return kind === 'tie' || kind === 'consumable' ? undefined : 'vertical-form'
  }
  switch (kind) {
    case 'prop':
      return 'slab-props'
    case 'panel':
    case 'filler':
    case 'ply-piece':
    case 'joist':
    case 'waler':
    case 'corner':
    case 'stop-end':
    case 'brace':
    case 'accessory':
      return 'slab-soffit-form'
    default:
      return undefined
  }
}
