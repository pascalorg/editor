import {
  type FormworkResequence,
  moveKey,
  noSuchMove,
  resequenceMoveByKey,
  shiftDays,
} from '@pascal-app/core/formwork'
import type { ProjectFormwork } from './solve-project'

/**
 * Taking a resequencing proposal, and then measuring whether it worked.
 *
 * `fix-finding.ts` did this for a defect; this does it for a shortage, and the second half is
 * the point in both. `resequence.ts` proposes a move by applying it to a *copy* of the
 * programme and re-sweeping — which is the honest way to propose one, and is still a prediction.
 * The write lands in the real scene, where the pour it moves may share plant with pours the copy
 * did not have, and where the reader may have dated something since the proposal was printed.
 * So a taken move reports the peak a second sweep actually measured beside the peak the proposal
 * predicted, and says which of them the reader is looking at.
 *
 * Two predictions can disagree with the measurement and they are different situations. A
 * measured peak *above* the prediction means the move did less than it offered, and the
 * shortfall it was against may still be there. Below it means more, which is not a bonus to
 * report as one: the same disagreement in the other direction, and the reason to say the
 * measurement is the answer rather than to quietly print the better figure.
 *
 * ## Why nothing here mutates
 *
 * `fix-finding.ts`'s reason exactly: the panel writes through the store inside one history step,
 * the chat tools mutate a plain graph on the server, MCP goes through its bridge. What is shared
 * is the decision — which shutters get which dates — and the verdict, which are the two parts
 * that must not diverge between a button and a tool call.
 *
 * ## Why every member is re-dated from its own date
 *
 * A monolithic pour moves whole, and its members are not necessarily on one day: two walls cast
 * in one operation can be dated a day apart by whoever programmed them, and the sweep that
 * proposed the move shifted each of them by the same number of days rather than collapsing them
 * onto the group's date. Writing the group's `toDate` to every member would silently close that
 * gap — a pour that gains a day it never had, on the write that was supposed to preserve the
 * programme's shape.
 *
 * ## Why applying a move never commits it
 *
 * Because the pour has just moved. A commitment is a hire booking and a following trade being
 * told, and the day this writes is a day nobody has taken to either of them yet. So the new date
 * is an intent, which is what it is, and committing it is a second decision made second — the
 * same division `schedule-patch.ts` draws between its two writes, one step further along.
 */

/** One shutter's new date, as `applyPourDatePatch` takes it. */
export interface PourMoveWrite {
  assemblyId: string
  /** The member's own date plus the shift — not the group's date. */
  pourAt: string
  /** What it was, so a reply can say what changed rather than only what it is now. */
  wasPourAt: string
}

export interface FormworkMovePlan {
  /** The proposal, named the way every surface names it. */
  key: string
  /** The shortage the move is against, and what the second measurement is taken on. */
  catalogId?: string
  description?: string
  /** The sequence group being moved, and the shutters that move with it. */
  pourId?: string
  /** Signed days: negative brings the pour forward. */
  days?: number
  /** One write per member, or absent on a refusal. */
  writes?: PourMoveWrite[]
  /** What the proposal said would happen, kept so the measurement has something to disagree with. */
  predicted?: { peakBefore: number; peakAfter: number; shortfallAfter: number }
  /** Why this cannot be applied. Absent where it can. */
  refusal?: string
}

/**
 * The dates that would take proposal `key`, or the reason there are none.
 *
 * Takes the whole solution rather than the `resequence` block alone, because the writes need the
 * programme: each member's own date is in `schedule.pours`, and the group's `fromDate` is one
 * representative of it.
 */
export function plannedMove(solution: ProjectFormwork, key: string): FormworkMovePlan {
  const resequence: FormworkResequence | undefined = solution.resequence
  if (resequence === undefined) {
    return {
      key,
      // Distinguished from a stale key, because the remedy is different and the reader's
      // expectation is wrong in a different way: there is nothing to accept here at all.
      refusal:
        'Nothing in this scope proposes a move: either no item is short of the peak, or the programme is too partial to sweep. Read the takeoff — where something is short and no move is offered, the reason is on the shortage itself.',
    }
  }
  const found = resequenceMoveByKey(resequence, key)
  if (found === undefined) return { key, refusal: noSuchMove(key) }
  const { answer, move } = found

  const dated = new Map(
    (solution.schedule?.pours ?? []).map((pour) => [pour.id, pour.pourAt] as const),
  )
  const base = {
    key,
    catalogId: answer.catalogId,
    description: answer.description,
    pourId: move.pourId,
    days: move.days,
    predicted: {
      peakBefore: move.peakBefore,
      peakAfter: move.peakAfter,
      shortfallAfter: move.shortfallAfter,
    },
  }

  const writes: PourMoveWrite[] = []
  for (const assemblyId of move.members) {
    const wasPourAt = dated.get(assemblyId)
    // A member with no date is refused rather than skipped, and so is one whose date will not
    // shift. Half a monolithic pour cannot be moved: leaving one member where it is would break
    // the operation the group exists to describe, and the peak was swept over all of them.
    if (wasPourAt === undefined) {
      return {
        ...base,
        refusal: `${assemblyId} is part of this pour and carries no date, so the operation cannot move whole. Date it with set_pour_date and read the proposals again.`,
      }
    }
    const pourAt = shiftDays(wasPourAt, move.days)
    if (pourAt === undefined) {
      return {
        ...base,
        refusal: `${assemblyId} is dated ${wasPourAt}, which is not a day the calendar has, so nothing can be measured from it. Correct it with set_pour_date first.`,
      }
    }
    writes.push({ assemblyId, pourAt, wasPourAt })
  }

  return { ...base, writes }
}

export interface FormworkMoveOutcome {
  /** True where the shortage the move was against is gone in the written programme. */
  cleared: boolean
  /** What the proposal said, and what a second sweep of the written programme found. */
  predictedPeak: number
  measuredPeak?: number
  /** The peak before the move, so the three figures read in one line. */
  peakBefore: number
  /** What is still short of this item after the move. */
  shortfallAfter?: number
  /**
   * Other items the move left the job shorter of, largest rise first.
   *
   * Shortfall rather than peak, which is the one place this deliberately differs from the
   * proposal's own `raises`. The proposal was comparing two sweeps and had only peaks to compare;
   * this has the rack in front of it, and a peak that rose inside what the yard owns costs
   * nothing and is not worth reporting as a cost. What is worth reporting is an order that was
   * not there before.
   */
  raised: Array<{ catalogId: string; description: string; from: number; to: number }>
  /** Every date written, so a reply can say what moved rather than that something did. */
  moved: PourMoveWrite[]
  /** What to tell the user, in one sentence. */
  message: string
}

/**
 * Whether the shortage the move was against is gone, and what else moved — from the two
 * solutions rather than from the proposal's own arithmetic.
 *
 * Takes both solves for `fixOutcome`'s reason: each caller re-solves through the path it already
 * uses, and a verdict read off the prediction that proposed the move would only ever agree with
 * itself.
 *
 * The disagreement between predicted and measured is reported whichever way it falls. A
 * measurement that came out better than the proposal is the same fault as one that came out
 * worse — the copy of the programme the proposal was swept over was not the scene — and printing
 * the better of the two would be choosing which sweep to believe on the basis of which reads
 * well.
 */
export function moveOutcome(
  before: ProjectFormwork,
  after: ProjectFormwork,
  plan: FormworkMovePlan,
): FormworkMoveOutcome {
  const catalogId = plan.catalogId
  const beforeLine = before.acquisition?.lines.find((line) => line.catalogId === catalogId)
  const afterLine = after.acquisition?.lines.find((line) => line.catalogId === catalogId)
  const predictedPeak = plan.predicted?.peakAfter ?? 0
  const peakBefore = plan.predicted?.peakBefore ?? beforeLine?.peakQuantity ?? 0
  const moved = plan.writes ?? []

  const beforeShort = new Map(
    (before.acquisition?.lines ?? []).map((line) => [line.catalogId, line] as const),
  )
  const raised: FormworkMoveOutcome['raised'] = []
  for (const line of after.acquisition?.lines ?? []) {
    if (line.catalogId === catalogId) continue
    const was = beforeShort.get(line.catalogId)
    if (was === undefined || line.shortfall <= was.shortfall) continue
    raised.push({
      catalogId: line.catalogId,
      description: line.description,
      from: was.shortfall,
      to: line.shortfall,
    })
  }
  raised.sort((a, b) => b.to - b.from - (a.to - a.from) || a.catalogId.localeCompare(b.catalogId))

  const dates = moved.map((write) => `${write.assemblyId} ${write.wasPourAt} → ${write.pourAt}`)
  const head = `Moved ${plan.pourId} ${Math.abs(plan.days ?? 0)} d ${(plan.days ?? 0) < 0 ? 'earlier' : 'later'}: ${dates.join(', ')}.`

  if (afterLine === undefined) {
    // No line for the item at all after the write, which a shift cannot cause — the honest
    // reading is that the two solves disagree about the scope rather than that the shortage was
    // cured, so it is reported as unmeasured rather than as cleared.
    return {
      cleared: false,
      predictedPeak,
      peakBefore,
      raised,
      moved,
      message: `${head} The written programme carries no peak for ${plan.description ?? catalogId} to measure, so nothing here confirms the shortage cleared — read the takeoff rather than taking the proposal's figure.`,
    }
  }

  const cleared = afterLine.shortfall === 0
  const measuredPeak = afterLine.peakQuantity
  const asPredicted = measuredPeak === predictedPeak
  const verdict = cleared
    ? `${plan.description ?? catalogId} is no longer short: peak ${peakBefore} → ${measuredPeak} against ${afterLine.ownedQuantity} owned.`
    : `${plan.description ?? catalogId} is still ${afterLine.shortfall} short by ${afterLine.peakOn}: peak ${peakBefore} → ${measuredPeak} against ${afterLine.ownedQuantity} owned.`
  const disagreement = asPredicted
    ? ''
    : ` The proposal predicted ${predictedPeak} and the written programme measures ${measuredPeak} — the measurement is the answer, because the proposal was swept over a copy of the programme rather than over the scene.`
  const collateral =
    raised.length === 0
      ? ''
      : ` It left the job short of ${raised.length} other ${raised.length === 1 ? 'item' : 'items'}: ${raised.map((rise) => `${rise.description} ${rise.from} → ${rise.to}`).join(', ')}.`
  // Said on every outcome rather than only where something went wrong, because it is the caveat
  // the proposals themselves carry and the one a reader is most likely to break next: every
  // other move in that reply had its float measured against the date this write just changed.
  const stale =
    ' Every other proposal read before this was measured against the old date, so re-read the takeoff before taking another.'

  return {
    cleared,
    predictedPeak,
    measuredPeak,
    peakBefore,
    shortfallAfter: afterLine.shortfall,
    raised,
    moved,
    message: `${head} ${verdict}${disagreement}${collateral}${stale}`,
  }
}

/**
 * Every proposal with the key that takes it — the read a panel maps over and a model acts on.
 *
 * One shape for all three surfaces, `findingsWithRemedies`' reason: a move offered on screen and
 * a move described to an agent have to be the same move, and a key composed differently on two
 * surfaces is a key that works from one of them.
 */
export interface KeyedPourMove {
  key: string
  catalogId: string
  pourId: string
  days: number
  members: string[]
  fromDate: string
  toDate: string
  clearsShortage: boolean
}

export function keyedMoves(resequence: FormworkResequence): KeyedPourMove[] {
  return resequence.answers.flatMap((answer) =>
    answer.moves.map((move) => ({
      key: moveKey(answer.catalogId, move),
      catalogId: answer.catalogId,
      pourId: move.pourId,
      days: move.days,
      members: move.members,
      fromDate: move.fromDate,
      toDate: move.toDate,
      clearsShortage: move.clearsShortage,
    })),
  )
}
