import type { AcquireLine, FormworkAcquisition } from './acquire'
import { calendarDayNumber, type FormworkSchedule, type PourSchedule } from './schedule'
import { type FormworkSequence, floatForPourId, type SequencedPour } from './sequence'
import { formworkSetCount, type PourQuantities } from './sets'

/**
 * Which pour to move, to stop being short — the first answer in this feature that proposes a
 * change to the project rather than describing one.
 *
 * `sets.ts` finds the day a rack is over-subscribed and names the pours standing together on
 * it. `acquire.ts` turns that into a quantity to go and get, and its own caveat says the other
 * remedy out loud: *"resequencing any one of them out of the overlap removes the shortfall"*.
 * Until `sequence.ts` there was no way to say which one could move. This says it.
 *
 * ## The peak is re-swept, not adjusted
 *
 * The tempting arithmetic is to subtract the moved pour's quantity from the peak. It is wrong
 * often enough to be dangerous: a pour leaving the peak day usually lands somewhere else, and
 * what it lands on may already be busy. So a candidate move is applied to a *copy of the
 * programme* and the whole sweep runs again. The reported figure is therefore the peak the
 * moved programme actually has, including any new peak the move created — which is the number
 * the reader would otherwise find out about afterwards.
 *
 * That is also why every move is costed against **every** catalog id rather than the one that
 * was short. Moving a wall pour to relieve a panel shortage can put two slabs in the same week
 * and leave the job short of props instead, and a proposal that only reported the id it was
 * asked about would look like a clean win.
 *
 * ## The move is bounded by float, and float is local
 *
 * Every candidate shift is inside the pour's own `totalFloat`, so no proposal here breaks a
 * dependency the project stated. What it cannot do is propose two moves: float is measured
 * against neighbours' stated dates, so the second move's allowance was computed against a date
 * the first move just changed. One move, then re-solve — said in the caveats, because a list of
 * five moves reads as a plan.
 *
 * ## The shift is a floor on what is needed, not the minimum
 *
 * The days proposed are what takes the whole pour clear of the peak day, measured on the
 * pour's own window. An individual item may come off earlier than the pour's last plant, so a
 * shorter move can sometimes clear that item alone. Searching for the true minimum would mean
 * a sweep per candidate day, and the honest trade is to propose a move that certainly works
 * and say that a shorter one might.
 *
 * ## A booked pour is not a candidate
 *
 * Float says a pour *could* move without breaking a stated dependency. It says nothing about
 * whether anybody would let it: a pour with a hire delivery in somebody's diary and the
 * following trade already told has float and is not available, and a proposal to move it is a
 * proposal the reader has to decline every time they read the takeoff. So `committed` — the
 * pours carrying a `committedPourAt`, from `commitments.ts` — is excluded from the candidates
 * outright, and where that leaves nothing to move the refusal says so rather than the answer
 * going quiet.
 *
 * Excluded as a candidate and kept as an obstacle: a committed pour still stands in the
 * overlap, so it is still one of the `others` a candidate has to clear. Dropping it from both
 * would let a move be proposed that lands the mover straight back beside a booked pour.
 *
 * The exclusion is per *group*, on any member. A monolithic pour moves whole, so one committed
 * member commits the operation — half a monolithic pour cannot be moved.
 *
 * ## This is not a plan
 *
 * There is no gang, no crew size, no batching plant and no concrete supply in this model. A
 * move that is feasible against formwork precedence may be impossible for four reasons this
 * module cannot see. It is an argument to take to the planner, and the caveats say so.
 */

/** Why a shortage has no resequencing answer. */
export type ResequenceRefusal =
  /** Every pour in the overlap is pinned by its neighbours — nothing can move. */
  | 'all-pinned'
  /** Nothing in the scope states an order, so the float is the programme and means nothing. */
  | 'nothing-sequenced'
  /** Every move within float leaves the peak where it was, or raises it. */
  | 'no-move-helps'
  /** A pour on the peak day is not in the sequence at all, so it has no float to read. */
  | 'pour-not-sequenced'
  /** Nothing orders the pours in the overlap, so their float is the span and means nothing. */
  | 'overlap-unsequenced'
  /** Every pour in the overlap with float to spend is committed, so no move is anybody's to make. */
  | 'overlap-committed'

export const RESEQUENCE_REFUSAL_LABELS: Record<ResequenceRefusal, string> = {
  'all-pinned':
    'Every pour in the overlap is pinned by the dates around it, so nothing can move without breaking a stated dependency — this shortage has to be bought or hired',
  'nothing-sequenced':
    'Nothing in this scope states an order, so no pour has a real float and there is no move to propose',
  'no-move-helps':
    'No move inside the available float reduces the peak — the overlap re-forms elsewhere in the programme',
  'pour-not-sequenced':
    'A pour on the peak day is not in the sequence, so there is no float to read for it',
  'overlap-unsequenced':
    'Nothing states an order for the pours in this overlap, so their float is the programme’s own span rather than an allowance — set a cast order on those elements and the move follows',
  'overlap-committed':
    'Every pour in this overlap that has float to spend is committed, so the only moves left are ones somebody has already agreed not to make — release a commitment or buy the shortage',
}

/** One proposal: move this pour by this many days, and here is what happens. */
export interface ResequenceMove {
  /** The sequence's group id — a monolithic pour moves as one operation. */
  pourId: string
  /** The assembly ids that move with it. */
  members: string[]
  /** Signed days: negative brings the pour forward, positive pushes it back. */
  days: number
  /** The pour's stated date, and where the move puts it. */
  fromDate: string
  toDate: string
  /** The peak of the short item before and after, from two runs of the same sweep. */
  peakBefore: number
  peakAfter: number
  /** `peakBefore` − `peakAfter`, and how much of the shortfall it clears. */
  reduction: number
  /** What is still short after the move: `peakAfter` over the owned quantity, floored. */
  shortfallAfter: number
  /** True where the move clears the shortage outright. */
  clearsShortage: boolean
  /**
   * Other catalog ids the move makes worse, largest rise first.
   *
   * The half of the answer that makes a proposal arguable. A move relieving panels by putting
   * two slabs in one week costs props, and a proposal reporting only the id it was asked about
   * would read as free.
   */
  raises: Array<{ catalogId: string; description: string; from: number; to: number }>
  /** How many days of float are left after the move, in the direction it used. */
  floatRemaining: number
}

/** One short item, and the moves that would relieve it. */
export interface ResequenceAnswer {
  catalogId: string
  description: string
  /** The peak day the shortage falls on, and what the yard owns against it. */
  peakOn: string
  peakQuantity: number
  ownedQuantity: number
  shortfall: number
  /** Every move that reduces the peak, largest reduction first. Empty where none does. */
  moves: ResequenceMove[]
  /** Pours in the overlap with no float to spend, so a reader can see what is stuck. */
  pinnedPourIds: string[]
  /**
   * Pours in the overlap nobody here can move, because their date has been committed.
   *
   * Reported beside `pinnedPourIds` and kept separate from it, because the two are undone
   * differently: a pinned pour needs the programme around it changed, and a committed one
   * needs a phone call.
   */
  committedPourIds: string[]
  /** Present where no move is proposed, with the reason. */
  refusal?: ResequenceRefusal
}

export interface FormworkResequence {
  answers: ResequenceAnswer[]
  /** Shortages a move would clear outright, largest first — the actionable list. */
  clearable: ResequenceAnswer[]
  /** Shortages nothing can be done about by moving, which is the buy-or-hire list. */
  unavoidable: ResequenceAnswer[]
}

/** Days since the epoch → `YYYY-MM-DD`. */
function toDateString(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10)
}

/** A date shifted by whole days, or left alone where it was never a date. */
function shift(date: string | undefined, days: number): string | undefined {
  if (date === undefined) return undefined
  const day = calendarDayNumber(date)
  if (day === undefined) return undefined
  return toDateString(day + days)
}

/**
 * The programme with one pour's dates moved, aggregates and all.
 *
 * Every date on the pour moves together — delivery, pour, each strike and the release — because
 * a pour moving takes its own shape with it. Rebuilding the aggregates rather than only the
 * rows, so the copy is a `FormworkSchedule` that agrees with itself: the set sweep reads the
 * rows, but nothing should be able to hand this object to a caller that reads `lastReleaseAt`
 * and get the unmoved programme's answer.
 */
function scheduleWithMove(
  schedule: FormworkSchedule,
  members: readonly string[],
  days: number,
): FormworkSchedule {
  const moving = new Set(members)
  const pours: PourSchedule[] = schedule.pours.map((pour) => {
    if (!moving.has(pour.id) || pour.pourAt === undefined) return pour
    const pourAt = shift(pour.pourAt, days)
    if (pourAt === undefined) return pour
    return {
      ...pour,
      pourAt,
      ...(pour.erectAt === undefined ? {} : { erectAt: shift(pour.erectAt, days) as string }),
      ...(pour.strikeAt === undefined ? {} : { strikeAt: shift(pour.strikeAt, days) as string }),
      ...(pour.releaseAt === undefined ? {} : { releaseAt: shift(pour.releaseAt, days) as string }),
      strikes: pour.strikes.map((strike) => ({
        ...strike,
        date: shift(strike.date, days) ?? strike.date,
      })),
    }
  })

  const dated = pours.filter((pour) => pour.pourAt !== undefined)
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
    ...schedule,
    pours,
    ...(firstErectAt === undefined ? {} : { firstErectAt }),
    ...(firstPourAt === undefined ? {} : { firstPourAt }),
    ...(lastPourAt === undefined ? {} : { lastPourAt }),
    ...(lastStrikeAt === undefined ? {} : { lastStrikeAt }),
    ...(lastReleaseAt === undefined ? {} : { lastReleaseAt }),
  }
}

/** The group's window in the stated programme: first day wanted, last day held. */
function windowOf(
  schedule: FormworkSchedule,
  members: readonly string[],
): { from: number; to: number } | undefined {
  const moving = new Set(members)
  let from = Infinity
  let to = -Infinity
  for (const pour of schedule.pours) {
    if (!moving.has(pour.id)) continue
    const start = calendarDayNumber(pour.erectAt ?? pour.pourAt ?? '')
    const end = calendarDayNumber(pour.releaseAt ?? pour.strikeAt ?? pour.pourAt ?? '')
    if (start === undefined || end === undefined) continue
    from = Math.min(from, start)
    to = Math.max(to, end)
  }
  if (from === Infinity || to === -Infinity) return undefined
  return { from, to }
}

/**
 * The shifts worth trying for one pour: the smallest that takes it clear of the *other* pours in
 * the overlap, in each direction, capped by its float.
 *
 * Clear of the others rather than clear of the peak day, and the difference is the whole
 * arithmetic. A pour whose plant is held twelve days does not leave an overlap by moving one day
 * past the peak — it still stands beside the same pours for eleven of them, and the peak is
 * exactly where it was. What takes it clear is starting after the last of them releases, or
 * finishing before the first of them arrives.
 *
 * Two candidates rather than every day inside the float, because a sweep per day would be
 * hundreds of sweeps and the answer to "can this pour leave the overlap" only turns on the shift
 * that makes it leave. See the module docstring on why a shorter one may sometimes also do.
 */
function candidateShifts(
  window: { from: number; to: number },
  others: ReadonlyArray<{ from: number; to: number }>,
  pour: SequencedPour,
): number[] {
  if (others.length === 0) return []
  const othersFrom = Math.min(...others.map((other) => other.from))
  const othersTo = Math.max(...others.map((other) => other.to))
  const out: number[] = []
  const later = othersTo - window.from + 1
  const earlier = -(window.to - othersFrom + 1)
  if (later > 0 && later <= (pour.moveLaterDays ?? 0)) out.push(later)
  if (earlier < 0 && -earlier <= (pour.moveEarlierDays ?? 0)) out.push(earlier)
  return out
}

/**
 * Which pour to move, per short item.
 *
 * `quantities` and `schedule` are the same objects the set count was taken from, deliberately:
 * the peak this compares against has to be the peak the reader is looking at, and a sweep over
 * a second copy of the programme could differ from it.
 *
 * `committed` is the assembly ids nobody can move — `committedPourIds(pours)` from
 * `commitments.ts`. Optional, and absent means the caller has no commitments to state rather
 * than that every pour is free: the two read the same here, and the takeoff carries no
 * commitment at all until somebody makes one.
 */
export function formworkResequence(
  acquisition: FormworkAcquisition,
  schedule: FormworkSchedule,
  quantities: readonly PourQuantities[],
  sequence: FormworkSequence,
  committed?: ReadonlySet<string>,
): FormworkResequence {
  // The peaks as the reader is already looking at them. Off the acquisition's own lines rather
  // than re-swept, so a "raises props from 40 to 52" cannot disagree with the 40 printed above
  // it — `acquisition.lines` carries one entry per catalog id with a peak, which is the same
  // set the sweep produced.
  const beforePeaks = new Map(acquisition.lines.map((line) => [line.catalogId, line.peakQuantity]))
  const answers = acquisition.shortfalls.map((line) =>
    answerFor(line, schedule, quantities, sequence, beforePeaks, committed ?? new Set<string>()),
  )
  return {
    answers,
    clearable: answers
      .filter((answer) => answer.moves.some((move) => move.clearsShortage))
      .sort((a, b) => b.shortfall - a.shortfall),
    unavoidable: answers
      .filter((answer) => !answer.moves.some((move) => move.clearsShortage))
      .sort((a, b) => b.shortfall - a.shortfall),
  }
}

function answerFor(
  line: AcquireLine,
  schedule: FormworkSchedule,
  quantities: readonly PourQuantities[],
  sequence: FormworkSequence,
  beforePeaks: ReadonlyMap<string, number>,
  committed: ReadonlySet<string>,
): ResequenceAnswer {
  const base: ResequenceAnswer = {
    catalogId: line.catalogId,
    description: line.description,
    peakOn: line.peakOn,
    peakQuantity: line.peakQuantity,
    ownedQuantity: line.ownedQuantity,
    shortfall: line.shortfall,
    moves: [],
    pinnedPourIds: [],
    committedPourIds: [],
  }
  if (sequence.gaps.includes('nothing-sequenced')) {
    return { ...base, refusal: 'nothing-sequenced' }
  }
  const peakDay = calendarDayNumber(line.peakOn)
  if (peakDay === undefined) return { ...base, refusal: 'no-move-helps' }

  // Every pour standing on the peak day, contracted to the groups they are cast in — a
  // monolithic pour moves whole, so two members of one group are one candidate rather than two.
  const groups = new Map<string, SequencedPour>()
  let unsequenced = false
  for (const pourId of line.peakPourIds) {
    const group = floatForPourId(sequence, pourId)
    if (group === undefined) {
      unsequenced = true
      continue
    }
    groups.set(group.id, group)
  }
  if (groups.size === 0) {
    return { ...base, refusal: unsequenced ? 'pour-not-sequenced' : 'no-move-helps' }
  }

  // An unsequenced pour's float is the programme's whole span, so proposing a move for one would
  // be a free lunch off a graph that states nothing. Refused for the whole overlap rather than
  // per pour: the remedy is to sequence those elements, and it is one instruction.
  if ([...groups.values()].some((group) => group.gaps.includes('unsequenced'))) {
    return { ...base, refusal: 'overlap-unsequenced' }
  }

  const pinnedPourIds = [...groups.values()]
    .filter((group) => (group.moveEarlierDays ?? 0) <= 0 && (group.moveLaterDays ?? 0) <= 0)
    .map((group) => group.id)
    .sort()
  if (pinnedPourIds.length === groups.size) {
    return { ...base, pinnedPourIds, refusal: 'all-pinned' }
  }

  // A committed group on any member: a monolithic pour moves whole, so one booked member books
  // the operation. Named on every answer whether or not it is the reason there is no move,
  // because a reader looking at three candidates wants to know the fourth is booked rather than
  // absent.
  const committedPourIds = [...groups.values()]
    .filter((group) => group.members.some((member) => committed.has(member)))
    .map((group) => group.id)
    .sort()
  const pinnedOrCommitted = new Set([...pinnedPourIds, ...committedPourIds])
  if (pinnedOrCommitted.size === groups.size) {
    // Pinned pours exist and the rest are booked, so 'all-pinned' would send the reader to the
    // programme when the answer is a phone call. Reported as the commitment, because that is the
    // one of the two anybody can still undo today.
    return { ...base, pinnedPourIds, committedPourIds, refusal: 'overlap-committed' }
  }

  // Each group's occupancy, once. A candidate has to clear the *others* in the overlap, so every
  // window is needed before any move is tried.
  const windows = new Map<string, { from: number; to: number }>()
  for (const group of groups.values()) {
    const window = windowOf(schedule, group.members)
    if (window !== undefined) windows.set(group.id, window)
  }

  const booked = new Set(committedPourIds)
  const moves: ResequenceMove[] = []
  for (const group of groups.values()) {
    // Skipped as a candidate and left in `windows`, so it is still one of the `others` below: a
    // booked pour cannot move and has not gone anywhere, and a mover that only had to clear the
    // free pours would be proposed straight into the overlap it was meant to leave.
    if (booked.has(group.id)) continue
    const window = windows.get(group.id)
    if (window === undefined || group.pourAt === undefined) continue
    const others = [...windows.entries()]
      .filter(([id]) => id !== group.id)
      .map(([, entry]) => entry)
    for (const days of candidateShifts(window, others, group)) {
      const moved = formworkSetCount(scheduleWithMove(schedule, group.members, days), quantities)
      if (moved === undefined) continue
      const after = moved.peaks.find((peak) => peak.catalogId === line.catalogId)
      // No peak at all after the move means the item is no longer held anywhere the sweep can
      // see, which cannot happen from a shift — treated as no help rather than as a peak of
      // zero, because a zero would read as a shortage cured by moving one pour.
      if (after === undefined) continue
      if (after.peakQuantity >= line.peakQuantity) continue
      const shortfallAfter = Math.max(0, after.peakQuantity - line.ownedQuantity)
      moves.push({
        pourId: group.id,
        members: group.members,
        days,
        fromDate: group.pourAt,
        toDate: toDateString((calendarDayNumber(group.pourAt) as number) + days),
        peakBefore: line.peakQuantity,
        peakAfter: after.peakQuantity,
        reduction: line.peakQuantity - after.peakQuantity,
        shortfallAfter,
        clearsShortage: shortfallAfter === 0,
        raises: raisesFrom(line.catalogId, moved, beforePeaks),
        floatRemaining:
          days > 0
            ? (group.moveLaterDays ?? 0) - days
            : (group.moveEarlierDays ?? 0) - Math.abs(days),
      })
    }
  }
  moves.sort(
    (a, b) =>
      Number(b.clearsShortage) - Number(a.clearsShortage) ||
      a.raises.length - b.raises.length ||
      b.reduction - a.reduction ||
      Math.abs(a.days) - Math.abs(b.days) ||
      a.pourId.localeCompare(b.pourId),
  )

  return {
    ...base,
    moves,
    pinnedPourIds,
    committedPourIds,
    ...(moves.length === 0 ? { refusal: 'no-move-helps' as const } : {}),
  }
}

/**
 * What the move made worse, everywhere except the id it was asked about.
 *
 * An id absent from the stated programme's peaks is skipped rather than reported as a rise from
 * zero: it cannot happen from a shift, and if it ever did the honest reading is that the two
 * sweeps disagree about the scope rather than that the move created a new item.
 */
function raisesFrom(
  exceptCatalogId: string,
  moved: NonNullable<ReturnType<typeof formworkSetCount>>,
  beforePeaks: ReadonlyMap<string, number>,
): Array<{ catalogId: string; description: string; from: number; to: number }> {
  const raises: Array<{ catalogId: string; description: string; from: number; to: number }> = []
  for (const peak of moved.peaks) {
    if (peak.catalogId === exceptCatalogId) continue
    const before = beforePeaks.get(peak.catalogId)
    if (before === undefined || peak.peakQuantity <= before) continue
    raises.push({
      catalogId: peak.catalogId,
      description: peak.description,
      from: before,
      to: peak.peakQuantity,
    })
  }
  return raises.sort(
    (a, b) => b.to - b.from - (a.to - a.from) || a.catalogId.localeCompare(b.catalogId),
  )
}

/**
 * What makes a resequencing proposal wrong, in words.
 *
 * The last two are printed whenever there is any proposal at all, and they are the two things a
 * reader will otherwise assume: that the moves can be taken together, and that a feasible move
 * is a possible one.
 */
export function resequenceCaveats(resequence: FormworkResequence): string[] {
  const out: string[] = []
  if (resequence.answers.length === 0) return out

  if (resequence.clearable.length > 0) {
    const count = resequence.clearable.length
    out.push(
      `${count} ${count === 1 ? 'shortage' : 'shortages'} could be cleared by moving a pour instead of acquiring anything. The peaks after each move are a second run of the same sweep over the moved programme, so they include any new overlap the move creates.`,
    )
  }
  const pinned = resequence.answers.filter((answer) => answer.refusal === 'all-pinned')
  if (pinned.length > 0) {
    out.push(
      `${pinned.length} ${pinned.length === 1 ? 'shortage cannot' : 'shortages cannot'} be resequenced away: every pour in the overlap is pinned by the dates around it. Those have to be bought or hired.`,
    )
  }
  const loose = resequence.answers.filter((answer) => answer.refusal === 'overlap-unsequenced')
  if (loose.length > 0) {
    out.push(
      `${loose.length} ${loose.length === 1 ? 'shortage falls' : 'shortages fall'} on pours nothing states an order for, so there is no float to spend and no move proposed. Set a cast order on those elements — the dependency is what makes a move arguable rather than a guess.`,
    )
  }
  const booked = resequence.answers.filter((answer) => answer.refusal === 'overlap-committed')
  if (booked.length > 0) {
    out.push(
      `${booked.length} ${booked.length === 1 ? 'shortage falls' : 'shortages fall'} on an overlap where every pour with float is committed, so nothing here is a move anybody has left to make. Release a commitment first if the date is genuinely still open — otherwise this is a shortage to buy or hire.`,
    )
  }
  const withBookings = resequence.answers.filter(
    (answer) => answer.moves.length > 0 && answer.committedPourIds.length > 0,
  )
  if (withBookings.length > 0) {
    out.push(
      'Committed pours are left out of these proposals. They still stand in the overlap and still hold their plant, so the peak includes them — they are simply not offered as the pour to move, because their date has been agreed with somebody.',
    )
  }
  if (resequence.answers.some((answer) => answer.refusal === 'no-move-helps')) {
    out.push(
      'Some shortages survive every move inside the available float — the overlap re-forms elsewhere in the programme. Moving one of those pours changes when the peak falls and not how big it is.',
    )
  }
  if (resequence.answers.some((answer) => answer.moves.length > 0)) {
    out.push(
      'These moves cannot be taken together. Each one’s float was measured against the other pours’ stated dates, so the first move changes the allowance for every other. Take one, re-date the programme, and read this again.',
    )
    out.push(
      'A move that is feasible here is not necessarily possible. This knows about formwork precedence and nothing else — there is no gang, no crane, no batching plant and no concrete supply in it, and any of the four can rule out a move this calls free. It is an argument to take to the planner rather than a revised programme.',
    )
    out.push(
      'The days proposed take the whole pour clear of the peak day. An item struck early in that pour may come clear sooner, so a shorter move can sometimes do — the figure here is a move that certainly works rather than the smallest one that does.',
    )
  }
  return out
}
