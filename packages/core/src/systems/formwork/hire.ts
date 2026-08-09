import {
  MIN_QUALIFYING_TEMPERATURE_C,
  STRIKE_TARGET_LABELS,
  type StrikeTarget,
  type StrikingAssumption,
  type StrikingInput,
  type StrikingStandardId,
  type StrikingTime,
  type StrikingWarning,
  strikingTime,
} from './design/striking'
import type { BomLine } from './parts'
import { delaysSetting } from './pressure'
import type { FormworkSettings } from './settings'

/**
 * How long each line of a bill is held — the second factor a hire charge needs.
 *
 * `supply.ts` answers *which* parts are hired. This answers *for how long*, and the
 * two together are a rental cost with only the rate missing. The rate is a
 * commercial input nobody in this model has, so this deliberately stops at the
 * duration: a period times an invented rate is a price, and a price nobody can
 * trace is the thing this whole feature is written against.
 *
 * ## Why this is not optional the way the supply split is
 *
 * `ProjectFormwork.supply` is absent where nobody has recorded a rack, because
 * ownership is a fact about the yard and silence about it is not a claim. A strike
 * period is the opposite kind of thing: it is a consequence of the code the project
 * is already designed under, so there is always an answer, and the unstated inputs
 * are named in `assumed` rather than withheld. Absent stock and an assumed curing
 * temperature are both "nobody said", and they get different treatment because one
 * has no derivation and the other has a published one.
 *
 * ## The join is the marks, not a re-derivation
 *
 * A period is per *thing struck* (`StrikeTarget`) and a bill line is per catalog id
 * at one condition, so something has to map one onto the other. That something is
 * the mark: `BomLine.marks` already carries every mark the line covers, and the
 * caller — the only layer that knows a part's host — supplies mark → targets.
 * Nothing here re-reads a scene or re-solves a shutter, for the same reason
 * `validate-project.ts` takes its evidence out of the build pass rather than
 * packing a face twice.
 *
 * ## A line can span two periods, and that is reported rather than averaged
 *
 * This is the case worth building the module around. A prop is a prop: the same
 * catalog id props a slab soffit and rakes a wall, and `bomLines` groups the two
 * together because to a delivery note they are one line. But the slab's props are
 * held ten days and the wall's rakers twelve hours. There is no single duration for
 * that line, and the three plausible answers are all wrong in a way the number
 * cannot show — the mean under-charges the shores, the max over-charges the rakers,
 * and first-mark-wins depends on solve order. So `mixed` is reported and `hours` is
 * the longest, because over-stating a hire costs money and under-stating it strikes
 * a floor early.
 */

/** One bill line's hire period. */
export interface HireLine {
  line: BomLine
  /**
   * The period the line is held, hours — the longest where the line spans more than
   * one target. Absent where nothing in the line is struck at all.
   */
  hours?: number
  /** The solved period behind `hours`, so a report can print its rule and warnings. */
  striking?: StrikingTime
  /**
   * Set where the line's parts are not all held for the same period. `hours` is then
   * the longest of them, and the figure is right for part of the line and long for
   * the rest — which is a thing to say, not a thing to average.
   */
  mixed?: {
    targets: StrikeTarget[]
    message: string
  }
}

export interface BomHire {
  standard: StrikingStandardId
  /**
   * Whether the periods are calendar time or accumulated qualifying time. A function
   * of the standard alone, carried here so a surface does not have to reach into a
   * line to find out which clock its figures are on.
   */
  basis: StrikingTime['basis']
  lines: HireLine[]
  /**
   * The distinct periods behind the lines, longest first — the readout worth showing.
   *
   * "Vertical forms 12 h, props to slabs 10 d" is the answer a planner wants, and it
   * is two numbers rather than one because they are two decisions.
   */
  periods: StrikingTime[]
  /**
   * The longest period anything in the bill is held, hours — when the *last* of this
   * scope's plant comes free.
   *
   * Not a sum and not a mean. A set's occupancy is set by its slowest release,
   * because the props holding one slab do not shorten the props holding the next, and
   * adding periods together would produce a duration longer than the job.
   */
  longestHours: number
  /** Lines whose parts are held for more than one period. */
  mixedLines: HireLine[]
  /** Inputs nobody supplied, deduped across the periods and named. */
  assumed: StrikingAssumption[]
  /** Everything the codes require to be said alongside these figures, deduped. */
  warnings: StrikingWarning[]
  /** False where some line has no period at all — a tie, a consumable. */
  complete: boolean
}

const byKind = <T extends { kind: string }>(entries: readonly T[]): T[] => {
  const seen = new Map<string, T>()
  for (const entry of entries) if (!seen.has(entry.kind)) seen.set(entry.kind, entry)
  return [...seen.values()]
}

/**
 * How long each line is held, given what each mark is.
 *
 * `targetsForMark` returns the targets one mark is struck as — empty for a part that
 * is never struck, so such a line carries no period rather than a zero. Zero would
 * price spent material as plant returned the same day, and it would enter a
 * `longestHours` comparison as though it were an answer.
 *
 * It returns a list rather than one target because a mark is unique within a shutter
 * and not guaranteed unique across a project — `duplicateMarks` exists for exactly
 * that. A colliding mark then makes its line `mixed`, which is the honest answer,
 * where a single-valued lookup would silently keep whichever host was solved last.
 */
export function bomHire(
  lines: readonly BomLine[],
  targetsForMark: (mark: string) => readonly StrikeTarget[],
  standard: StrikingStandardId,
  input: Omit<StrikingInput, 'target'>,
): BomHire {
  // One solve per target rather than per line: a period is a function of the target
  // and the project's curing inputs, so re-solving it for each of a 200-line bill
  // would be the same arithmetic 200 times.
  const solved = new Map<StrikeTarget, StrikingTime>()
  const periodFor = (target: StrikeTarget): StrikingTime => {
    const existing = solved.get(target)
    if (existing) return existing
    const time = strikingTime(standard, { ...input, target })
    solved.set(target, time)
    return time
  }

  const hireLines: HireLine[] = lines.map((line) => {
    const targets = new Set<StrikeTarget>()
    for (const mark of line.marks) for (const target of targetsForMark(mark)) targets.add(target)
    if (targets.size === 0) return { line }

    const periods = [...targets].map(periodFor)
    const longest = periods.reduce((worst, time) => (time.hours > worst.hours ? time : worst))
    if (periods.length === 1) return { line, hours: longest.hours, striking: longest }

    const named = periods
      .map((time) => STRIKE_TARGET_LABELS[time.target].toLowerCase())
      .sort()
      .join(' and ')
    return {
      line,
      hours: longest.hours,
      striking: longest,
      mixed: {
        targets: periods.map((time) => time.target).sort(),
        message: `This line covers ${named}, which are struck at different times. The period shown is the longest of them, so it is right for the ${STRIKE_TARGET_LABELS[
          longest.target
        ].toLowerCase()} and long for the rest.`,
      },
    }
  })

  const held = hireLines.filter((entry) => entry.hours !== undefined)
  const periods = [...solved.values()].sort((a, b) => b.hours - a.hours)
  return {
    standard,
    basis: periods[0]?.basis ?? (standard === 'ACI_347' ? 'qualifying-time' : 'calendar'),
    lines: hireLines,
    periods,
    longestHours: periods[0]?.hours ?? 0,
    mixedLines: hireLines.filter((entry) => entry.mixed !== undefined),
    assumed: byKind(periods.flatMap((time) => time.assumed)),
    warnings: byKind(periods.flatMap((time) => time.warnings)),
    // A line with no period is not an incomplete answer about that line — a tie is
    // genuinely not struck. It is incomplete only as a statement about the *bill*,
    // which is what a reader adding up hire days needs to know.
    complete: held.length === hireLines.length,
  }
}

/**
 * The curing inputs a strike period is taken from, out of the project's settings.
 *
 * Here rather than at each call site because two of the four are *derived*, and a
 * second derivation would disagree with this one the first time either changed.
 *
 * `delayedSetting` is the one worth reading twice. It is not a field anybody enters:
 * a retarder or a water-reducer that delays setting is already recorded on the mix,
 * because it is worth 20 % of the pressure — and the same admixture that raises the
 * pressure also lengthens the period the form is held. So this reads the mix rather
 * than asking again, and adds the codes' other trigger, a cure below 10 °C. Asking
 * separately would let a project state a retarder for its pressure and not for its
 * strike time, and the strike time is the one that decides when a floor is allowed
 * to carry itself.
 */
export function strikingInputFor(settings: FormworkSettings): Omit<StrikingInput, 'target'> {
  const curing = settings.curing
  const surface = curing.surfaceTemperatureC
  const cold = surface !== undefined && surface < MIN_QUALIFYING_TEMPERATURE_C
  return {
    ...(surface === undefined ? {} : { temperatureC: surface }),
    ...(curing.highEarlyStrength ? { highEarlyStrength: true } : {}),
    ...(curing.shoresRemain ? { shoresRemain: true } : {}),
    ...(delaysSetting(settings.concrete.cement) || cold ? { delayedSetting: true } : {}),
  }
}
