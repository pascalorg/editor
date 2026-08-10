import type { StrikeTarget } from './design/striking'
import type { FormworkPartKind } from './parts'
import { PART_KIND_LABELS } from './parts'
import { calendarDayNumber, type FormworkSchedule, type PourSchedule } from './schedule'

/**
 * How many sets a job needs to own or hire — the question the whole commercial chain has
 * been dancing around.
 *
 * The bill has said what a pour needs standing at once since the rollup. That is not what
 * anybody buys. A job of forty pours does not buy forty walls' worth of panels; it buys
 * enough to keep the pours that are *concurrently formed* standing, and reuses them. The
 * difference is the entire economics of the trade: the same 100 panels serving twenty
 * sequential pours is one purchase, and serving twenty simultaneous ones is twenty.
 *
 * ## The dates are what made this expressible, and nothing else here is new
 *
 * `supply.ts` has carried the caveat since it was written — a per-level owned figure is
 * right per level and two of them must not be added, because whether two levels are formed
 * at once is a thing it cannot see. `schedule.ts` gave every dated pour an `erectAt` and a
 * `releaseAt`, which is an interval, and the maximum number of intervals overlapping on any
 * one day is the number of sets. That sweep is all this module is. It solves no geometry,
 * re-reads no scene and invents no date.
 *
 * ## Per catalog id, and per kind, because one sweep over "everything" is wrong
 *
 * A deck panel comes off in a day and the props under it stay ten. Their intervals are
 * different lengths, so their peaks fall on different days and there is no single moment
 * the job is at its maximum. Sweeping the bill as one pool would report the panel peak on
 * the prop peak's day and be wrong about both. So the sweep runs per catalog id, and the
 * per-kind rollup is a sum of those peaks rather than a sweep of its own — a *kind's* peak
 * is what the yard racks together, and two panel types peaking a fortnight apart still need
 * both peaks' worth of rack.
 *
 * ## A partial programme cannot be counted, and it fails low
 *
 * This is the refusal the module is built around. Every other gap in this feature is
 * visible in its own output: an unpriced bill has no money in it, and an undated pour has
 * no dates. A set count off a partial programme is different in kind, because it is a
 * *plausible small number*. Three dated pours out of forty overlap barely, so the sweep
 * reports a peak of one set, and one set is what a reader orders. The number looks like an
 * answer and there is nothing in it to show it is a tenth of one.
 *
 * So there is a coverage threshold, and below it there is no count at all. Above it the
 * count is still reported as a floor with the shortfall named, because a programme missing
 * one pour in twenty can only under-count: an undated pour cannot subtract from an overlap.
 */

/**
 * The share of a scope's pours that must be dated before a count is reported.
 *
 * Nine tenths rather than everything, because a real programme is never quite finished and
 * refusing at one undated pour in fifty would mean refusing always. Nine tenths rather than
 * a half, because the error is one-directional and unbounded: the count can only come out
 * low, and the reader cannot see by how much. There is nothing to derive this from — it is
 * a judgement about when a floor stops being useful, stated once here rather than argued
 * differently on four surfaces.
 */
export const SET_COUNT_COVERAGE_THRESHOLD = 0.9

/** Why a scope has no set count, or a count that is short. */
export type SetCountGap =
  /** Too few pours are dated for a sweep to mean anything. No count at all. */
  | 'programme-too-partial'
  /** Some pours are dated and counted, and some are not — so the peaks are a floor. */
  | 'partial-programme'
  /** A dated pour has no release date, so its interval had no end and it was left out. */
  | 'no-release-date'
  /** Nothing in scope carries a catalog id, so there is nothing poolable to count. */
  | 'nothing-poolable'

export const SET_COUNT_GAP_LABELS: Record<SetCountGap, string> = {
  'programme-too-partial':
    'Too few pours are dated to count sets — a sweep over a fraction of the programme reports a peak the job never has',
  'partial-programme':
    'Some pours are undated and are not in this sweep, so every peak below is a floor rather than the peak',
  'no-release-date':
    'Some dated pours have no release date, so their plant has no interval and is not in the sweep',
  'nothing-poolable':
    'Nothing in scope has a catalog id, so there is no reusable stock to count sets of',
}

/** One catalog id's peak, and the day it falls on. */
export interface SetPeak {
  catalogId: string
  kind: FormworkPartKind
  description: string
  /**
   * The most of this item in use at once — the number to own or hire.
   *
   * A quantity rather than a count of "sets": a set is not a unit anybody stocks. A yard
   * owns 180 panels, not 3 sets, and which pours those 180 serve changes every week.
   */
  peakQuantity: number
  /** `YYYY-MM-DD` — the first day the peak is reached, where more than one day ties. */
  peakOn: string
  /** Every pour holding this item on `peakOn`, so a peak can be traced to its pours. */
  peakPourIds: string[]
  /** The total this item is fitted over the whole programme, peaks and reuses together. */
  totalFitted: number
  /**
   * How many times over the peak is reused: `totalFitted / peakQuantity`.
   *
   * The figure that turns a peak into a buy-or-hire decision. A peak of 100 fitted 800
   * times is 8 uses out of each panel, and 8 uses is what amortises a purchase against a
   * hire — one use is a hire every time.
   */
  reuseFactor: number
  /** `YYYY-MM-DD` — the first day any of this item is committed anywhere in the scope. */
  committedFrom: string
  /** `YYYY-MM-DD` — the last day any of it is still held. */
  committedTo: string
  /**
   * `committedFrom` to `committedTo` inclusive, days — what a hire desk charges for.
   *
   * Not the sum of the item's strike periods, and the difference is the point: a set used
   * on five pours a week apart is held two days each time and *on site* for five weeks. The
   * yard invoices the five weeks. Summing the periods gives ten days and is the single
   * easiest way to under-price a reused set by 70 %.
   */
  committedDays: number
  /**
   * Quantity × days held, summed over every fitting — the work the item actually does.
   *
   * Against `peakQuantity × committedDays`, which is what holding the peak for the whole
   * span costs, this is how busy the set is kept. A low ratio is a programme with gaps in
   * it rather than a design fault, and it is the figure that says whether hiring the peak
   * for the span is being paid for idle plant.
   */
  fittedUnitDays: number
}

/** A kind's rack: the sum of its catalog ids' peaks. */
export interface SetKindPeak {
  kind: FormworkPartKind
  label: string
  /**
   * Summed across the kind's catalog ids rather than swept as one pool.
   *
   * Two panel types peaking a fortnight apart still need both peaks' worth of rack, because
   * a 2.4 m panel is not a 1.2 m panel and neither covers for the other. A sweep of the
   * kind as one pool would report the larger peak alone and under-order the rack by the
   * whole of the smaller.
   */
  peakQuantity: number
}

export interface FormworkSetCount {
  /** Per catalog id, largest peak first. */
  peaks: SetPeak[]
  /** Per kind, largest rack first. */
  kinds: SetKindPeak[]
  /**
   * The most pours formed at once anywhere in the programme, and when.
   *
   * The headline a planner reads first, and it is deliberately not derived from the
   * quantity peaks: it counts *pours* whose intervals overlap, which is the question "how
   * many gangs and how many sets of everything" rather than "how many of this panel".
   */
  peakConcurrentPours: number
  peakConcurrentOn?: string
  /** How many of the scope's pours are in the sweep, and how many exist. */
  countedPours: number
  totalPours: number
  /** `countedPours / totalPours`, 0 where there are no pours. */
  coverage: number
  gaps: SetCountGap[]
}

/** One pour's poolable quantities, keyed by catalog id. */
export interface PourQuantities {
  /** The pour's own id — an assembly id, matching the schedule's. */
  id: string
  /** How many of each catalog id this pour has standing. */
  quantities: ReadonlyArray<{
    catalogId: string
    kind: FormworkPartKind
    description: string
    quantity: number
    /**
     * What this item is struck as, where the caller knows.
     *
     * The field that makes the per-id sweep mean anything. Without it every item in a pour
     * is held until the *last* thing in that pour comes off, so a deck panel that strikes
     * in four days is counted as committed for the ten its props are — and the two peaks
     * land on the same day, which is the error sweeping per catalog id exists to avoid.
     *
     * Optional because a part that is never struck has no target — a tie, a consumable —
     * and those fall back to the pour's own release, which is the honest answer for
     * something that never comes off at all.
     */
    target?: StrikeTarget
  }>
}

/** One item's occupancy: the days it is committed, `from` and `to` both inclusive. */
interface Interval {
  id: string
  from: number
  to: number
}

/**
 * When each pour's plant arrives, and when each thing in it comes free.
 *
 * `erectAt` where there is one and the pour date otherwise, because a set is committed from
 * the day it is wanted on site — and where no erection lead is recorded, the earliest day
 * anything is known to be standing is the pour itself.
 *
 * The end is the day *before* the release, because `releaseAt` is the day the set is
 * available again rather than the last day it is held. This is a deliberate difference from
 * `scheduleOccupancyDays`, which counts the release day: that figure is what a yard invoices
 * for and this one is when a gang can refit, and they are different questions about the same
 * two dates. The consequence — back-to-back pours sharing one set with no slack for cleaning
 * — is named in the caveats rather than absorbed into the arithmetic.
 *
 * `returnOffset` is recovered from the pour's own two dates rather than taken from the
 * settings, so a per-target release cannot disagree with the release the programme printed.
 */
interface PourWindow {
  id: string
  from: number
  /** The day the last of this pour's plant comes free, inclusive. */
  to: number
  /** Days between a strike and the plant being free again, off this pour's own dates. */
  returnOffset: number
  /** Per-target strike days, so an item's own release can be worked out. */
  strikeDayByTarget: Map<StrikeTarget, number>
}

function windowsFor(schedule: FormworkSchedule): {
  windows: PourWindow[]
  unusable: PourSchedule[]
} {
  const windows: PourWindow[] = []
  const unusable: PourSchedule[] = []
  for (const pour of schedule.pours) {
    const start = pour.erectAt ?? pour.pourAt
    const end = pour.releaseAt ?? pour.strikeAt
    if (start === undefined || end === undefined) {
      unusable.push(pour)
      continue
    }
    const from = calendarDayNumber(start)
    const releaseDay = calendarDayNumber(end)
    if (from === undefined || releaseDay === undefined) {
      unusable.push(pour)
      continue
    }
    const strikeDay = pour.strikeAt === undefined ? undefined : calendarDayNumber(pour.strikeAt)
    const strikeDayByTarget = new Map<StrikeTarget, number>()
    for (const strike of pour.strikes) {
      const day = calendarDayNumber(strike.date)
      if (day !== undefined) strikeDayByTarget.set(strike.target, day)
    }
    windows.push({
      id: pour.id,
      from,
      // Clamped at `from`: a pour erected and released on one day still occupies that day,
      // and the alternative if the dates ever inverted is a sweep that drops the pour.
      to: Math.max(from, releaseDay - 1),
      returnOffset: strikeDay === undefined ? 0 : Math.max(0, releaseDay - strikeDay),
      strikeDayByTarget,
    })
  }
  return { windows, unusable }
}

/** One item's own interval within a pour's window, given what it is struck as. */
function intervalFor(window: PourWindow, target: StrikeTarget | undefined): Interval {
  const strikeDay = target === undefined ? undefined : window.strikeDayByTarget.get(target)
  if (strikeDay === undefined) return { id: window.id, from: window.from, to: window.to }
  // This item's own release, from its own strike — never later than the pour's last, which
  // is what `window.to` already is.
  const to = Math.max(window.from, strikeDay + window.returnOffset - 1)
  return { id: window.id, from: window.from, to: Math.min(to, window.to) }
}

/** Days since the epoch → `YYYY-MM-DD`. */
function toDateString(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10)
}

/** One thing held over one interval: what the sweep actually adds up. */
interface Held {
  interval: Interval
  quantity: number
}

/**
 * The day a quantity is at its highest, by sweeping the interval boundaries.
 *
 * Only the start days can raise a total, so those are the only days examined — an interval
 * ending changes nothing until the next one begins. That makes this linear in starts rather
 * than in calendar days, which matters because a programme spans years and its pours number
 * in the hundreds.
 *
 * Ties resolve to the earliest day, because the peak is a procurement date: the reader is
 * asking when the stock has to be there, and the first of several equal days is the answer.
 */
function peakOver(held: readonly Held[]): { peak: number; on?: number; ids: string[] } {
  const candidates = [...new Set(held.map((entry) => entry.interval.from))].sort((a, b) => a - b)
  let peak = 0
  let on: number | undefined
  let ids: string[] = []
  for (const day of candidates) {
    const standing = held.filter((entry) => entry.interval.from <= day && day <= entry.interval.to)
    const total = standing.reduce((sum, entry) => sum + entry.quantity, 0)
    if (total > peak) {
      peak = total
      on = day
      ids = standing.map((entry) => entry.interval.id)
    }
  }
  return { peak, ...(on === undefined ? {} : { on }), ids: [...new Set(ids)].sort() }
}

/**
 * How many of each thing the job needs at once, given when its pours happen.
 *
 * Returns `undefined` rather than a count where the programme is too partial to sweep. That
 * is the module's whole reason for existing as a separate step, and it is a refusal rather
 * than a caveat because the number it would otherwise return is a plausible one. See the
 * module docstring.
 */
export function formworkSetCount(
  schedule: FormworkSchedule,
  quantities: readonly PourQuantities[],
): FormworkSetCount | undefined {
  const totalPours = schedule.pours.length
  if (totalPours === 0) return undefined

  const { windows, unusable } = windowsFor(schedule)
  const coverage = windows.length / totalPours
  if (coverage < SET_COUNT_COVERAGE_THRESHOLD) return undefined

  const gaps: SetCountGap[] = []
  if (unusable.length > 0) {
    gaps.push(
      unusable.some((pour) => pour.pourAt !== undefined) ? 'no-release-date' : 'partial-programme',
    )
  }
  const windowById = new Map(windows.map((window) => [window.id, window]))

  // Quantities per pour per catalog id, plus the catalog metadata, in one pass. A pour can
  // list the same catalog id twice — a bill is grouped on provenance as well as id, so a
  // drilled panel and an untouched one of the same type are two entries — and the sweep
  // wants one number per pour per id, because the rack does not care which was drilled.
  //
  // The targets are accumulated rather than collapsed, for the reason `bomHire` accumulates
  // them: the same prop shores a slab in one place and rakes a wall in another, and the two
  // are struck days apart. The longest interval wins below, because over-stating occupancy
  // costs rack space and under-stating it hands out a set that is still holding a floor up.
  const byId = new Map<
    string,
    {
      kind: FormworkPartKind
      description: string
      perPour: Map<string, { quantity: number; targets: Set<StrikeTarget>; untargeted: boolean }>
    }
  >()
  for (const pour of quantities) {
    if (!windowById.has(pour.id)) continue
    for (const entry of pour.quantities) {
      if (entry.quantity <= 0) continue
      let record = byId.get(entry.catalogId)
      if (!record) {
        record = { kind: entry.kind, description: entry.description, perPour: new Map() }
        byId.set(entry.catalogId, record)
      }
      let held = record.perPour.get(pour.id)
      if (!held) {
        held = { quantity: 0, targets: new Set(), untargeted: false }
        record.perPour.set(pour.id, held)
      }
      held.quantity += entry.quantity
      if (entry.target === undefined) held.untargeted = true
      else held.targets.add(entry.target)
    }
  }
  if (byId.size === 0) gaps.push('nothing-poolable')

  const peaks: SetPeak[] = []
  for (const [catalogId, record] of byId) {
    const held: Held[] = []
    for (const [pourId, entry] of record.perPour) {
      const window = windowById.get(pourId)
      if (window === undefined) continue
      // The latest release among this item's targets. An untargeted entry — a tie, a
      // consumable — falls back to the pour's own last release, which is the honest answer
      // for something that never comes off on a schedule of its own.
      const candidates = entry.untargeted
        ? [intervalFor(window, undefined)]
        : [...entry.targets].map((target) => intervalFor(window, target))
      const to = candidates.reduce((latest, interval) => Math.max(latest, interval.to), window.from)
      held.push({ interval: { id: pourId, from: window.from, to }, quantity: entry.quantity })
    }
    if (held.length === 0) continue
    const { peak, on, ids } = peakOver(held)
    if (peak === 0 || on === undefined) continue
    const totalFitted = held.reduce((sum, entry) => sum + entry.quantity, 0)
    const from = held.reduce((first, entry) => Math.min(first, entry.interval.from), Infinity)
    const to = held.reduce((last, entry) => Math.max(last, entry.interval.to), -Infinity)
    peaks.push({
      catalogId,
      kind: record.kind,
      description: record.description,
      peakQuantity: peak,
      peakOn: toDateString(on),
      peakPourIds: ids,
      totalFitted,
      reuseFactor: totalFitted / peak,
      committedFrom: toDateString(from),
      committedTo: toDateString(to),
      committedDays: to - from + 1,
      fittedUnitDays: held.reduce(
        (sum, entry) => sum + entry.quantity * (entry.interval.to - entry.interval.from + 1),
        0,
      ),
    })
  }
  peaks.sort((a, b) => b.peakQuantity - a.peakQuantity || a.catalogId.localeCompare(b.catalogId))

  const kindTotals = new Map<FormworkPartKind, number>()
  for (const peak of peaks) {
    kindTotals.set(peak.kind, (kindTotals.get(peak.kind) ?? 0) + peak.peakQuantity)
  }
  const kinds: SetKindPeak[] = [...kindTotals.entries()]
    .map(([kind, peakQuantity]) => ({ kind, label: PART_KIND_LABELS[kind], peakQuantity }))
    .sort((a, b) => b.peakQuantity - a.peakQuantity || a.kind.localeCompare(b.kind))

  // Each pour weighs one, so this counts concurrent *pours* rather than quantities — a
  // different question from the peaks above and asked by a different reader. Over the whole
  // window rather than any item's own interval: a pour is under way from the day its plant
  // arrives until the last of it comes free.
  const concurrent = peakOver(windows.map((window) => ({ interval: window, quantity: 1 })))

  return {
    peaks,
    kinds,
    peakConcurrentPours: concurrent.peak,
    ...(concurrent.on === undefined ? {} : { peakConcurrentOn: toDateString(concurrent.on) }),
    countedPours: windows.length,
    totalPours,
    coverage,
    gaps,
  }
}

/**
 * What makes a set count wrong, in words.
 *
 * The reuse line is the one worth printing even when nothing is missing. A peak of 100 with
 * a reuse factor of 1.0 is a job where nothing is ever struck and refitted, which is either
 * a programme with no overlap at all or a scope of one pour — and in both cases the "set
 * count" is just the bill again, which a reader should be told rather than left to infer
 * from two identical numbers on different panels.
 */
export function formworkSetCaveats(count: FormworkSetCount): string[] {
  const out: string[] = []
  if (count.countedPours < count.totalPours) {
    const missing = count.totalPours - count.countedPours
    out.push(
      `${missing} of ${count.totalPours} pours ${missing === 1 ? 'is' : 'are'} not in this sweep, so every figure below is a floor. An undated pour cannot reduce an overlap, so the real peak is this or higher — never lower.`,
    )
  }
  if (count.gaps.includes('no-release-date')) {
    out.push(
      `${SET_COUNT_GAP_LABELS['no-release-date']}. A pour with nothing struck is the usual reason.`,
    )
  }
  if (count.gaps.includes('nothing-poolable')) {
    out.push(SET_COUNT_GAP_LABELS['nothing-poolable'])
  }
  const noReuse = count.peaks.filter((peak) => peak.reuseFactor === 1)
  if (noReuse.length > 0 && noReuse.length === count.peaks.length) {
    out.push(
      'Nothing in this scope is reused: every peak equals its total fitted, so these numbers are the bill rather than a set count. A single pour, or a programme whose pours never overlap, both read this way.',
    )
  }
  // The sweep counts a set as available the day it is released, which is what the programme
  // says and not quite what a yard does. Said here rather than silently absorbed into the
  // dates, because the person who acts on a peak of exactly 100 is the person who finds out.
  out.push(
    'A set is counted as free from its release date, so back-to-back pours are shown sharing one set with no slack. A gang cannot strike, clean and refit the same day, so treat a peak with no margin as the minimum.',
  )
  return out
}
