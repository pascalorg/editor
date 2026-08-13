import type { FormworkScheduleSettings } from '../../schema/nodes/formwork-project-settings'
import { STRIKE_TARGET_LABELS, type StrikeTarget, type StrikingTime } from './design/striking'

/**
 * When each pour happens, and when its plant arrives and comes free — the calendar the
 * other three factors have been waiting for.
 *
 * `supply.ts` answers which parts are hired, `hire.ts` for how long, `cost.ts` for how
 * much. All three are durations and quantities: none of them can say what day a set is
 * needed on site, which is the question a delivery note and a programme both ask. This
 * adds the one input that turns a period into a date, and it adds nothing else — every
 * date below is a stated pour date plus or minus a figure one of those modules already
 * derived.
 *
 * ## The date is stated, and the period is derived
 *
 * A real scheduler would compute a pour date from dependencies, float and a resource
 * calendar. Nothing here does, and a derived date would be worse than no date: it would
 * be a programme the project never agreed to, printed beside geometry that *is* derived
 * and carrying the same authority. So `pourAt` is an input on each shutter, and the only
 * arithmetic is over the strike period, which has a published table behind it.
 *
 * A shutter with no date gets **no dates**, not a date relative to something else. This
 * is the same rule the rates follow and for the same reason — there is no conservative
 * fallback for "when" — and it is why `unscheduled` is reported: a programme that quietly
 * omits half the pours reads as a short programme rather than an incomplete one.
 *
 * ## Days, and why the arithmetic rounds up
 *
 * Everything here is a whole calendar day. A pour date is a day, a hire is charged in
 * days, and a striking table is tabulated in days — an hour of precision on any of it
 * would be invented. So a period is rounded **up** to the day: ACI's 12 hours on a
 * vertical form becomes one day, because at day resolution the honest answer to "can it
 * come off the same afternoon" is no. Rounding down would put a strike date before the
 * period the code requires, which is the one error in this module that could hurt
 * somebody.
 *
 * Calendar days rather than working days, deliberately — see `FormworkScheduleSettings`.
 * A hire runs over a weekend, so a programme that skips weekends disagrees with the
 * invoice for the same set.
 *
 * ## ACI's clock is not a calendar, and that is reported rather than converted
 *
 * A BS 8110 period is calendar time: add it to a date and the answer is a date. ACI's is
 * an accumulator over hours above 10 °C, so 4 days of qualifying time is 4 days in a warm
 * July and a fortnight in a cold spring. There is no weather in this model, so the date
 * this produces under ACI is the **earliest** the form could come off, and `earliestOnly`
 * says so. Presenting it as the date is how a reader takes a cold-spring programme off a
 * summer calculation and strikes a slab early.
 */

/** Why a pour, or the programme, carries fewer dates than it looks like it should. */
export type ScheduleGap =
  /** Nobody has said when this pour happens, so it has no dates at all. */
  | 'no-pour-date'
  /** Dated, but nothing in the shutter is struck — so there is no release either. */
  | 'no-strike-period'
  /** No erection lead time recorded, so a delivery date cannot be worked back. */
  | 'no-erection-lead'
  /** No return lead time, so the day the set is free again is the day it is struck. */
  | 'no-return-lead'

export const SCHEDULE_GAP_LABELS: Record<ScheduleGap, string> = {
  'no-pour-date': 'No pour date recorded, so this pour has no programme dates',
  'no-strike-period':
    'Nothing in this shutter is struck, so it has no strike date — a bulkhead cast in and ties left in the wall are the usual reason',
  'no-erection-lead':
    'No erection lead time recorded on the project, so there is no delivery date to work back to',
  'no-return-lead':
    'No return lead time recorded, so the plant is shown as free the day it is struck — cleaning and the trip back are not in it',
}

/** One thing struck out of one pour, and the day it comes off. */
export interface ScheduledStrike {
  target: StrikeTarget
  /** `YYYY-MM-DD`. The pour date plus the period, rounded up to the day. */
  date: string
  /** The period behind it, so a programme can print its rule beside the date. */
  striking: StrikingTime
}

/** One pour's programme. Every date absent where its input is. */
export interface PourSchedule {
  /** The caller's own handle for the pour — an assembly id, normally. */
  id: string
  /** What the project stated, `YYYY-MM-DD`, or absent for an unprogrammed pour. */
  pourAt?: string
  /** When the plant has to be on site: the pour date less the erection lead. */
  erectAt?: string
  /**
   * When the last of this pour's plant is struck.
   *
   * The last rather than the first, because it is the day the *set* comes free, which is
   * what a hire runs to and what the next pour is waiting for. A slab's deck comes off
   * days before its props and both are in `strikes` — collapsing them to the earlier one
   * would show a set available while it is still holding a floor up.
   */
  strikeAt?: string
  /** When the set is available again: struck, plus the return lead. */
  releaseAt?: string
  /** Every distinct thing struck out of this pour, earliest first. */
  strikes: ScheduledStrike[]
  /** Set where a strike date is the earliest possible rather than the date — ACI's clock. */
  earliestOnly?: true
  gaps: ScheduleGap[]
}

export interface FormworkSchedule {
  pours: PourSchedule[]
  /** The first day any plant is needed on site, `YYYY-MM-DD`. */
  firstErectAt?: string
  firstPourAt?: string
  lastPourAt?: string
  /** The day the last of this scope's plant is struck. */
  lastStrikeAt?: string
  /** The day the whole scope's plant is free — what a hire is charged to. */
  lastReleaseAt?: string
  /**
   * Pours with a date, and pours without.
   *
   * Both counted rather than only the scheduled ones: a window over 3 of 40 pours is a
   * true statement about 3 pours and a wrong one about the job, and the count is the only
   * thing in the answer that shows which it is.
   */
  scheduledCount: number
  unscheduled: PourSchedule[]
  /** Set where any date is an earliest-possible rather than a date. */
  earliestOnly: boolean
  /** False where any pour is missing a date it could have had. */
  complete: boolean
  gaps: ScheduleGap[]
}

/** A pour, as this module needs it: a date somebody stated, and what gets struck. */
export interface SchedulablePour {
  id: string
  /** `YYYY-MM-DD`, or absent. */
  pourAt?: string
  /**
   * The periods for everything this shutter holds — one per distinct `StrikeTarget`.
   *
   * Supplied rather than solved here for the reason `bomHire` takes its marks from the
   * caller: a target depends on a part's *host* (a prop under a slab is a shore and the
   * same prop against a wall is a raker), and only the layer that built the shutter knows
   * which. Empty means nothing in this shutter is ever struck.
   */
  striking: readonly StrikingTime[]
}

const MS_PER_DAY = 86_400_000

/**
 * `YYYY-MM-DD` → days since the epoch, or `undefined` for a date that does not exist.
 *
 * The round-trip check is what catches `2026-02-30`: the regex on the schema accepts it
 * and `Date.UTC` rolls it forward to 1 March, so a programme would silently move a pour
 * to a day nobody entered. UTC throughout because these are civil dates with no time in
 * them — parsing them in a local zone shifts every date in the programme by one day for
 * half the world.
 *
 * Exported for the set sweep, which orders and differences the very dates this module
 * produced. A second parser there would be a second place to get 2026-02-30 wrong, and a
 * sweep that disagreed with the programme above it about which day a pour falls on would
 * report a peak on a day no pour happens.
 */
export function calendarDayNumber(date: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!parts) return undefined
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const stamp = Date.UTC(year, month - 1, day)
  if (Number.isNaN(stamp)) return undefined
  // The month is the whole check: an overflowed day rolls into the next month, so a
  // separate day comparison is unreachable. A year check catches `2026-13-01`.
  const rolled = new Date(stamp)
  if (rolled.getUTCFullYear() !== year || rolled.getUTCMonth() !== month - 1) return undefined
  return stamp / MS_PER_DAY
}

/**
 * Whether a string is a date the calendar actually has.
 *
 * Exported for the write path, which has to refuse `2026-02-30` rather than store it: the
 * node's regex accepts it and every reader here would silently move the pour to 1 March.
 * The same function as the one the arithmetic uses, deliberately — a validator that
 * agreed with the parser today and drifted tomorrow would accept a date no date in the
 * programme was ever computed from.
 */
export function isCalendarDate(date: string): boolean {
  return calendarDayNumber(date) !== undefined
}

/** Days since the epoch → `YYYY-MM-DD`. */
function toDateString(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10)
}

/**
 * A date shifted by whole days, or `undefined` if the input was not a date.
 *
 * Exported for the write that applies a resequencing move, which has to land the pour on the
 * day the proposal was measured for. Same parser as the arithmetic above it, deliberately: a
 * second one would be a second place to roll 2026-02-30 forward, and a written date that
 * disagreed with the swept one by a day would clear a shortage on a day the peak never fell on.
 */
export function shiftDays(date: string, days: number): string | undefined {
  const start = calendarDayNumber(date)
  if (start === undefined) return undefined
  return toDateString(start + days)
}

/**
 * The programme for a scope, from the pour dates it has and the periods it has solved.
 *
 * `settings` is the whole group rather than two numbers so an absent group and a group
 * with an absent field stay distinguishable: both leave the date off, and only one of
 * them is a gap somebody can close by filling a field in.
 */
export function formworkSchedule(
  pours: readonly SchedulablePour[],
  settings: FormworkScheduleSettings | undefined,
): FormworkSchedule {
  const erectionLead = settings?.erectionLeadDays
  const returnLead = settings?.returnLeadDays

  const scheduled: PourSchedule[] = pours.map((pour) => {
    const gaps: ScheduleGap[] = []
    // Rounded up, and up is the direction that cannot hurt anybody: a period of 12 hours
    // is a strike the day after at this resolution, where rounding down would print a
    // date before the code's own period had elapsed.
    const strikes: ScheduledStrike[] = []
    if (pour.pourAt === undefined) {
      // Not even the strikes are dated. A period with no date is the `hire` answer, which
      // already exists and is reported there; repeating it here as a date relative to
      // nothing would be a second, weaker copy of it.
      return { id: pour.id, strikes: [], gaps: ['no-pour-date'] }
    }
    const pourAt = pour.pourAt

    for (const striking of [...pour.striking].sort((a, b) => a.hours - b.hours)) {
      const date = shiftDays(pourAt, Math.ceil(striking.days))
      if (date !== undefined) strikes.push({ target: striking.target, date, striking })
    }

    const erectAt =
      erectionLead === undefined ? undefined : shiftDays(pourAt, -Math.ceil(erectionLead))
    if (erectionLead === undefined) gaps.push('no-erection-lead')

    const last = strikes[strikes.length - 1]
    if (last === undefined) gaps.push('no-strike-period')

    const strikeAt = last?.date
    let releaseAt: string | undefined
    if (strikeAt !== undefined) {
      if (returnLead === undefined) gaps.push('no-return-lead')
      // The struck date itself where no lead is recorded, rather than no date at all: the
      // set is certainly not free before it comes off, so this is a floor on the answer
      // in the way an absent pour date is not. The gap says what is missing from it.
      releaseAt = shiftDays(strikeAt, Math.ceil(returnLead ?? 0))
    }

    const earliestOnly = pour.striking.some((time) => time.basis === 'qualifying-time')
    return {
      id: pour.id,
      pourAt,
      ...(erectAt === undefined ? {} : { erectAt }),
      ...(strikeAt === undefined ? {} : { strikeAt }),
      ...(releaseAt === undefined ? {} : { releaseAt }),
      strikes,
      ...(earliestOnly && strikes.length > 0 ? { earliestOnly: true as const } : {}),
      gaps,
    }
  })

  const dated = scheduled.filter((pour) => pour.pourAt !== undefined)
  const gaps = new Set<ScheduleGap>()
  for (const pour of scheduled) for (const gap of pour.gaps) gaps.add(gap)

  const earliest = (dates: Array<string | undefined>): string | undefined =>
    dates.filter((date): date is string => date !== undefined).sort()[0]
  const latest = (dates: Array<string | undefined>): string | undefined =>
    dates
      .filter((date): date is string => date !== undefined)
      .sort()
      .pop()

  const firstErectAt = earliest(dated.map((pour) => pour.erectAt))
  const firstPourAt = earliest(dated.map((pour) => pour.pourAt))
  const lastPourAt = latest(dated.map((pour) => pour.pourAt))
  const lastStrikeAt = latest(dated.map((pour) => pour.strikeAt))
  const lastReleaseAt = latest(dated.map((pour) => pour.releaseAt))

  return {
    pours: scheduled,
    ...(firstErectAt === undefined ? {} : { firstErectAt }),
    ...(firstPourAt === undefined ? {} : { firstPourAt }),
    ...(lastPourAt === undefined ? {} : { lastPourAt }),
    ...(lastStrikeAt === undefined ? {} : { lastStrikeAt }),
    ...(lastReleaseAt === undefined ? {} : { lastReleaseAt }),
    scheduledCount: dated.length,
    unscheduled: scheduled.filter((pour) => pour.pourAt === undefined),
    earliestOnly: scheduled.some((pour) => pour.earliestOnly === true),
    complete: gaps.size === 0,
    gaps: [...gaps],
  }
}

/**
 * The pours in the order a programme reads them: earliest first, undated last.
 *
 * Here rather than in each reader because it is one rule with one trap in it. Sorting a
 * `'~'` sentinel for the undated pours looks equivalent and is not — `localeCompare`
 * treats punctuation as ignorable, so the sentinel collates *before* a date and the
 * undated pours head the programme as though they began the job. Two surfaces working
 * that out separately is two chances to get it wrong, and a CSV that disagreed with the
 * panel above it about the order of a programme is a disagreement about the job.
 */
export function scheduleInPourOrder(schedule: FormworkSchedule): PourSchedule[] {
  return [...schedule.pours].sort((a, b) => {
    if (a.pourAt === undefined || b.pourAt === undefined) {
      return (a.pourAt === undefined ? 1 : 0) - (b.pourAt === undefined ? 1 : 0)
    }
    return a.pourAt.localeCompare(b.pourAt)
  })
}

/**
 * How many calendar days the whole scope's plant is on site, or `undefined`.
 *
 * The figure a hire negotiation actually turns on, and it is deliberately **not** what
 * `bomHire.longestHours` reports. That is how long one pour holds its plant; this is
 * arrival to release across every pour in the scope, so a set used on five pours a week
 * apart is on site for five weeks and held for two days each time. Both are true and only
 * this one is what the yard invoices for.
 */
export function scheduleOccupancyDays(schedule: FormworkSchedule): number | undefined {
  const start = schedule.firstErectAt ?? schedule.firstPourAt
  const end = schedule.lastReleaseAt ?? schedule.lastStrikeAt ?? schedule.lastPourAt
  if (start === undefined || end === undefined) return undefined
  const from = calendarDayNumber(start)
  const to = calendarDayNumber(end)
  if (from === undefined || to === undefined) return undefined
  // Inclusive of both ends: a pour erected and struck on one day occupies that day, and a
  // difference of zero would report a set that was never on site.
  return to - from + 1
}

/**
 * What makes a programme wrong, in words.
 *
 * Separate from the dates for the reason `bomCostCaveats` is separate from the money: a
 * date is quoted, and two of the things that make one wrong here do not look like gaps.
 * Ordered with the omission first — a reader who takes a window over 3 of 40 pours for
 * the job's programme is wrong by more than any missing lead time.
 */
export function formworkScheduleCaveats(schedule: FormworkSchedule): string[] {
  const out: string[] = []
  if (schedule.pours.length === 0) return out
  if (schedule.unscheduled.length > 0) {
    const count = schedule.unscheduled.length
    const total = schedule.pours.length
    out.push(
      `${count} of ${total} ${total === 1 ? 'pour has' : 'pours have'} no date, so this programme covers ${schedule.scheduledCount} of them. The dates below are right for those and say nothing about the rest.`,
    )
  }
  if (schedule.earliestOnly) {
    out.push(
      'ACI 347 counts qualifying hours above 10 °C rather than calendar days, so the strike dates are the earliest the forms could come off. A cold spell pushes every one of them later, and nothing in this model knows the weather.',
    )
  }
  if (schedule.gaps.includes('no-erection-lead')) {
    out.push(
      'No erection lead time is recorded, so there is no delivery date here — the pour dates are when the concrete goes in, not when the plant is wanted.',
    )
  }
  if (schedule.gaps.includes('no-return-lead')) {
    out.push(
      'No return lead time is recorded, so a set is shown as free the day it is struck. Cleaning, repair and the trip back are not in these dates and a hire normally runs to the return.',
    )
  }
  if (schedule.gaps.includes('no-strike-period')) {
    out.push(
      `${SCHEDULE_GAP_LABELS['no-strike-period']}. Those pours carry a pour date and no release.`,
    )
  }
  const multi = schedule.pours.filter((pour) => pour.strikes.length > 1)
  if (multi.length > 0) {
    const parts = multi[0]?.strikes ?? []
    const named = parts.map((strike) => STRIKE_TARGET_LABELS[strike.target].toLowerCase())
    out.push(
      `${multi.length} ${multi.length === 1 ? 'pour holds' : 'pours hold'} plant that is struck at different times — ${named.join(' before ')} — so the strike date is the last of them, which is when the set comes free rather than when the shutter comes off.`,
    )
  }
  return out
}
