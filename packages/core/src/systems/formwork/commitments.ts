import type { FormworkPartKind } from './parts'
import { PART_KIND_LABELS } from './parts'
import { calendarDayNumber, type FormworkSchedule } from './schedule'
import { type PourQuantities, type PourWindow, pourWindowsFor } from './sets'

/**
 * What is spoken for, and from when to when — the last item in the plan's phase 10.
 *
 * `sets.ts` says how many of an item the job needs at its busiest. `acquire.ts` says how
 * many of those the yard has not got. `resequence.ts` says which pour to move so it needs
 * fewer. All three are statements about dates somebody *typed*, and every one of them is
 * free to change the moment somebody types a different date. That is the right model for a
 * programme being planned and the wrong one for a programme being built to, because at some
 * point a hire company has the delivery in its diary, the following trade has been told when
 * the floor is theirs, and the date has stopped being an opinion.
 *
 * A commitment window is that: **this much of this item is spoken for from here to here, and
 * the pours behind it are ones nobody can quietly move.**
 *
 * ## Why this needed a schema field where the sequence did not
 *
 * `sequence.ts` needed no new field, because precedence was already stated three times over
 * in the scene — `liftIndex`, `castOrder`, `pourId`. There was nothing equivalent to read
 * here, and that is the whole finding: the scene records what the project *intends* and had
 * nowhere to record what anybody has *agreed*. `pourAt` cannot serve, because it answers a
 * different question and answers it for every pour whether or not a booking exists. So
 * `committedPourAt` was added beside it, holding the day that was agreed rather than a flag
 * saying that some day was — see the field's own comment for why that distinction is load
 * bearing, and `drifted` below for what it buys.
 *
 * ## Committed pours only, which is what makes a window a claim about a plan
 *
 * The sweep is the same interval sweep `sets.ts` runs, over the same `pourWindowsFor`
 * intervals, restricted to the pours that carry a commitment. That restriction is the entire
 * difference and it is not a filter for tidiness: a window over uncommitted pours would be a
 * peak wearing a booking's clothes, and the reader would act on it — cancelling a hire
 * because the "commitment" ended, or refusing a move because the plant was "spoken for" when
 * nobody had asked for it.
 *
 * Which is why an uncommitted programme gets **no windows at all** rather than windows over
 * everything, following `rates` and `sets` exactly. There is no conservative default for
 * "what has been agreed": assume nothing and the takeoff shows plant free that is booked;
 * assume everything and every resequencing proposal in the feature goes silent.
 *
 * ## The drift is the answer this module exists to give
 *
 * A committed pour whose `pourAt` has moved off its `committedPourAt` is the expensive state,
 * and it is invisible in every other output: the programme prints the new date, the set count
 * sweeps the new date, and the hire company is still holding the old one. It is not an error
 * — sites move booked pours, and refusing the edit would only make somebody clear the
 * commitment first and lose the record. So it is reported, per pour, with both days and the
 * signed number of days between them, because "four days later" and "four days earlier" are
 * different phone calls: one is a set standing idle and the other is plant that has not
 * arrived.
 */

/** Why a scope's commitments say less than they look like they do. */
export type CommitmentGap =
  /** Nobody has committed to any pour, so there are no windows at all. */
  | 'nothing-committed'
  /** Some pours are committed and some are not, so the windows cover part of the job. */
  | 'partly-committed'
  /** A committed pour has drifted off the day it was booked for. */
  | 'drifted-off-booking'
  /** A pour carries a commitment and no date at all, so it has no window. */
  | 'committed-without-date'

export const COMMITMENT_GAP_LABELS: Record<CommitmentGap, string> = {
  'nothing-committed':
    'No pour has been committed, so nothing here is booked — every date in the programme is still an intent anybody can move',
  'partly-committed':
    'Only some pours are committed, so these windows are what is booked rather than what the job needs',
  'drifted-off-booking':
    'A committed pour has been moved off the day it was booked for, so the plant is reserved for one day and the programme says another',
  'committed-without-date':
    'A pour is committed and carries no date, so there is nothing to book against — clearing the date leaves the commitment behind',
}

/** One catalog id, spoken for. */
export interface CommitmentWindow {
  catalogId: string
  kind: FormworkPartKind
  description: string
  /**
   * The most of this item any committed pour holds at once — what is actually reserved.
   *
   * Deliberately the same sweep as `SetPeak.peakQuantity` and deliberately a smaller number
   * on almost every job: this counts only the committed pours, so it is what has been
   * promised rather than what the job will need. The two must never be confused, which is
   * why every surface prints them apart and names which is which.
   */
  committedQuantity: number
  /** `YYYY-MM-DD` — the first day any committed pour wants this item on site. */
  from: string
  /** `YYYY-MM-DD` — the last day a committed pour is still holding it. */
  to: string
  /** `from` to `to` inclusive. What a hire runs to, if the booking is honoured. */
  days: number
  /** The committed pours holding this item, so a window traces back to its bookings. */
  pourIds: string[]
}

/** One pour whose booking and whose programme no longer agree. */
export interface CommitmentDrift {
  pourId: string
  /** The day the plant is booked for. */
  committedAt: string
  /** The day the programme now says, or absent where the date was cleared outright. */
  pourAt?: string
  /**
   * Days from the booking to the current date. Positive is later, negative is earlier.
   *
   * Signed rather than absolute because the two directions are different problems. Later
   * means a set arrives and stands idle, and the hire runs from the booked day either way.
   * Earlier means the pour happens before the plant is due, which is not a cost but a stop.
   */
  driftDays?: number
}

export interface FormworkCommitments {
  /** Per catalog id, largest committed quantity first. */
  windows: CommitmentWindow[]
  /** Per kind, summed across its catalog ids — the rack that is spoken for. */
  kinds: Array<{ kind: FormworkPartKind; label: string; committedQuantity: number }>
  /** How many pours carry a commitment, and how many exist in scope. */
  committedPours: number
  totalPours: number
  /** The committed pours' own ids, earliest booking first. */
  committedPourIds: string[]
  /** Bookings the programme has moved off. Empty is the ordinary case. */
  drifts: CommitmentDrift[]
  /** `YYYY-MM-DD` — the span the whole scope's committed plant is spoken for over. */
  firstCommittedDay?: string
  lastCommittedDay?: string
  gaps: CommitmentGap[]
}

/** A pour's commitment, as this module needs it. */
export interface CommittablePour {
  id: string
  /** What the programme currently says, `YYYY-MM-DD` or absent. */
  pourAt?: string
  /** The day the plant is booked against, `YYYY-MM-DD` or absent for uncommitted. */
  committedPourAt?: string
}

/** Days since the epoch → `YYYY-MM-DD`. */
function toDateString(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10)
}

/**
 * What is spoken for in this scope, or `undefined` where nothing is.
 *
 * `undefined` rather than an empty result for the reason `formworkSetCount` returns it: an
 * empty windows list and a job with no bookings read identically on a surface, and only one
 * of them is a state anybody should act on. Every caller distinguishes "no commitments" from
 * "commitments that turned out to be empty", and there is no second case here — a committed
 * pour with a date always produces a window.
 */
export function formworkCommitments(
  schedule: FormworkSchedule,
  quantities: readonly PourQuantities[],
  pours: readonly CommittablePour[],
): FormworkCommitments | undefined {
  const committed = pours.filter((pour) => pour.committedPourAt !== undefined)
  if (committed.length === 0) return undefined

  const gaps: CommitmentGap[] = []
  const drifts: CommitmentDrift[] = []
  for (const pour of committed) {
    const committedAt = pour.committedPourAt as string
    if (pour.pourAt === committedAt) continue
    if (pour.pourAt === undefined) {
      // The date cleared out from under a booking. Distinct from a drift with two days in
      // it, because there is no new day to negotiate towards — the pour is unprogrammed and
      // the plant is still reserved.
      gaps.push('committed-without-date')
      drifts.push({ pourId: pour.id, committedAt })
      continue
    }
    const booked = calendarDayNumber(committedAt)
    const now = calendarDayNumber(pour.pourAt)
    gaps.push('drifted-off-booking')
    drifts.push({
      pourId: pour.id,
      committedAt,
      pourAt: pour.pourAt,
      ...(booked === undefined || now === undefined ? {} : { driftDays: now - booked }),
    })
  }

  // The sweep runs over the *programme's* windows rather than over the booked days, which is
  // the only defensible reading once the two have drifted: the plant is wanted when the pour
  // now happens, and the booking is a promise about a day that has moved. The drift is what
  // says the promise needs renegotiating; using the booked day here as well would produce a
  // window nobody is working to.
  const { windows: allWindows } = pourWindowsFor(schedule)
  const committedIds = new Set(committed.map((pour) => pour.id))
  const windowById = new Map<string, PourWindow>()
  for (const window of allWindows) {
    if (committedIds.has(window.id)) windowById.set(window.id, window)
  }

  const byId = new Map<
    string,
    { kind: FormworkPartKind; description: string; perPour: Map<string, number> }
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
      record.perPour.set(pour.id, (record.perPour.get(pour.id) ?? 0) + entry.quantity)
    }
  }

  const windows: CommitmentWindow[] = []
  for (const [catalogId, record] of byId) {
    const held: Array<{ from: number; to: number; quantity: number; id: string }> = []
    for (const [pourId, quantity] of record.perPour) {
      const window = windowById.get(pourId)
      if (window === undefined) continue
      held.push({ from: window.from, to: window.to, quantity, id: pourId })
    }
    if (held.length === 0) continue
    // The peak over the committed pours only. Same sweep shape as `sets.ts`: a total can only
    // rise on a day an interval starts, so those are the only days worth examining.
    const days = [...new Set(held.map((entry) => entry.from))].sort((a, b) => a - b)
    let committedQuantity = 0
    for (const day of days) {
      const standing = held.filter((entry) => entry.from <= day && day <= entry.to)
      const total = standing.reduce((sum, entry) => sum + entry.quantity, 0)
      if (total > committedQuantity) committedQuantity = total
    }
    if (committedQuantity === 0) continue
    const from = held.reduce((first, entry) => Math.min(first, entry.from), Infinity)
    const to = held.reduce((last, entry) => Math.max(last, entry.to), -Infinity)
    windows.push({
      catalogId,
      kind: record.kind,
      description: record.description,
      committedQuantity,
      from: toDateString(from),
      to: toDateString(to),
      days: to - from + 1,
      pourIds: held.map((entry) => entry.id).sort(),
    })
  }
  windows.sort(
    (a, b) => b.committedQuantity - a.committedQuantity || a.catalogId.localeCompare(b.catalogId),
  )

  const kindTotals = new Map<FormworkPartKind, number>()
  for (const window of windows) {
    kindTotals.set(window.kind, (kindTotals.get(window.kind) ?? 0) + window.committedQuantity)
  }

  if (committed.length < pours.length) gaps.push('partly-committed')

  const allDays = windows.flatMap((window) => [window.from, window.to]).sort()
  return {
    windows,
    kinds: [...kindTotals.entries()]
      .map(([kind, committedQuantity]) => ({
        kind,
        label: PART_KIND_LABELS[kind],
        committedQuantity,
      }))
      .sort((a, b) => b.committedQuantity - a.committedQuantity || a.kind.localeCompare(b.kind)),
    committedPours: committed.length,
    totalPours: pours.length,
    committedPourIds: [...committed]
      .sort((a, b) => (a.committedPourAt as string).localeCompare(b.committedPourAt as string))
      .map((pour) => pour.id),
    drifts: drifts.sort((a, b) => a.committedAt.localeCompare(b.committedAt)),
    ...(allDays[0] === undefined ? {} : { firstCommittedDay: allDays[0] }),
    ...(allDays.length === 0 ? {} : { lastCommittedDay: allDays[allDays.length - 1] }),
    gaps: [...new Set(gaps)],
  }
}

/**
 * Which pours are booked, as the set every other module asks about.
 *
 * A set rather than the full result because that is all `resequence.ts` needs and the
 * question it asks is a membership test on a hot path. Built from the same pours the windows
 * are, so a pour cannot be immovable to the proposals and absent from the windows.
 */
export function committedPourIds(pours: readonly CommittablePour[]): Set<string> {
  return new Set(pours.filter((pour) => pour.committedPourAt !== undefined).map((pour) => pour.id))
}

/**
 * What makes a commitment window wrong, in words.
 *
 * The first caveat is the one that has to be printed even when everything agrees, because the
 * figure invites exactly one wrong reading: a committed quantity is smaller than the set
 * count's peak on almost every job, and a reader who takes it for the job's requirement
 * under-orders by every uncommitted pour.
 */
export function formworkCommitmentCaveats(commitments: FormworkCommitments): string[] {
  const out: string[] = []
  if (commitments.windows.length === 0 && commitments.drifts.length === 0) return out
  out.push(
    'These are the quantities somebody has agreed to, not the quantities the job needs. A committed figure is swept over the committed pours alone, so it is smaller than the set count above it wherever any pour is still uncommitted — and ordering to it would leave the rest of the job short.',
  )
  if (commitments.committedPours < commitments.totalPours) {
    const rest = commitments.totalPours - commitments.committedPours
    out.push(
      `${commitments.committedPours} of ${commitments.totalPours} pours ${commitments.committedPours === 1 ? 'is' : 'are'} committed, so ${rest} ${rest === 1 ? 'is' : 'are'} still an intent anybody can move. A window says nothing about those.`,
    )
  }
  const drifted = commitments.drifts.filter((drift) => drift.pourAt !== undefined)
  if (drifted.length > 0) {
    const worst = [...drifted].sort(
      (a, b) => Math.abs(b.driftDays ?? 0) - Math.abs(a.driftDays ?? 0),
    )[0]
    const days = worst?.driftDays ?? 0
    out.push(
      `${drifted.length} committed ${drifted.length === 1 ? 'pour has' : 'pours have'} moved off the day the plant was booked for — the largest by ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ${days < 0 ? 'earlier' : 'later'}. The hire company is still holding the booked day, so this is a call to make rather than a figure to reconcile: moved later, a set arrives and stands idle at the booked rate; moved earlier, the pour is due before the plant is.`,
    )
  }
  if (commitments.gaps.includes('committed-without-date')) {
    out.push(
      `${COMMITMENT_GAP_LABELS['committed-without-date']}, so the plant is reserved for a pour the programme no longer places.`,
    )
  }
  out.push(
    'A commitment records that a date was agreed, not that it cannot change. Nothing here stops a pour being moved — it stops the takeoff proposing the move on its own, and reports the disagreement if somebody makes it anyway.',
  )
  return out
}
