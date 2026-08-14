import { calendarDayNumber, type FormworkSchedule, type PourSchedule } from './schedule'

/**
 * What has to happen before what, and how far a pour can move without breaking it.
 *
 * The last thing missing before a shortage could be answered rather than only reported.
 * `sets.ts` finds the day a rack is over-subscribed and names the pours standing together on
 * it; the obvious remedy is to move one of them out of the overlap, and nothing in the model
 * could say which one was free to move. Float is that answer, and float needs precedence.
 *
 * ## Precedence is already in the scene, three times over, so nothing new is stated here
 *
 * This module adds no schema. The project has always said what depends on what:
 *
 * - `liftIndex` — lift N's formwork bears on lift N−1, so N cannot be erected until N−1 is
 *   struck. Physical and never optional, which makes it the only precedence that exists on a
 *   job nobody has sequenced.
 * - `castOrder` — an explicit integer per element, already cycle-checked by `CAST_ORDER_CYCLE`.
 * - `pourId` — elements cast in one operation. Simultaneity rather than an edge: they contract
 *   to one node, and a node cannot precede itself.
 *
 * An unsequenced pair is therefore **concurrent**, which is the reading `castOrder`'s own
 * schema comment already commits to, and it is reported rather than assumed: a job with no
 * `castOrder` anywhere has one edge per lift chain and nothing else, and every figure below is
 * true of that graph rather than of the programme somebody has in their head.
 *
 * ## Float is measured against the stated dates, not instead of them
 *
 * `schedule.ts` refuses to derive a pour date, and says why: a derived date is a programme the
 * project never agreed to, printed beside geometry that *is* derived and carrying the same
 * authority. A classical forward pass would do exactly that — it starts from a project start
 * date and computes every pour's early start, which is a whole invented programme.
 *
 * So float here is local. Each pour's window is bounded by the **stated** dates of its own
 * neighbours: how far this one pour can move before it hits the pour it waits on or the pour
 * that waits on it. That is the question a shortage asks, and it is answerable in one pass
 * over the edges with no topological order and no derived calendar anywhere in it.
 *
 * What it is not is a critical path. A CPM critical path is a path through a derived
 * programme, and the pours with no float here do not form one — they are pours pinned by
 * their neighbours' stated dates, which is a different claim and a weaker one. They are
 * reported as `pinned` for that reason, and `formworkSequenceCaveats` says so out loud
 * because "critical path" is what a reader will call them anyway.
 *
 * The other thing local float is not is a pool. Two concurrent pours can each have a week of
 * float and moving both does not buy two weeks — the second one's window was computed against
 * the first one's *stated* date, which the first one just left. One move at a time, re-solved
 * after each, and that is in the caveats too.
 */

/** What puts one pour before another. */
export type PrecedenceReason =
  /** Lift N's formwork bears on lift N−1, so N−1 has to be struck first. */
  | 'lift'
  /** The project stated an explicit cast order across the two elements. */
  | 'cast-order'
  /** Alternate-bay construction — adjacent bays are cast in different intervals. */
  | 'alternate-bay'

export const PRECEDENCE_REASON_LABELS: Record<PrecedenceReason, string> = {
  lift: 'The upper lift’s formwork bears on the lift below, which has to be struck first',
  'cast-order': 'The project states an explicit cast order across these elements',
  'alternate-bay': 'Alternate-bay construction — the adjacent bay is cast in a later interval',
}

/**
 * Which bays of an alternate-bay element go first, in site bay numbering from 1.
 * Odd bays first is the usual practice: the infill bays key off the ones either side.
 */
export type AlternateBayParity = 'odd-bays-first' | 'even-bays-first'

export const ALTERNATE_BAY_PARITY_LABELS: Record<AlternateBayParity, string> = {
  'odd-bays-first': 'odd-numbered bays first, even bays as infill',
  'even-bays-first': 'even-numbered bays first, odd bays as infill',
}

/** One element's alternate-bay answer: what was stated and which bays it puts first. */
export interface AlternateBayPlan {
  elementId: string
  parity: AlternateBayParity
  /**
   * True when the parity came from the stated dates rather than the default. A parity
   * read off the programme is a claim the project made; a defaulted one is the usual
   * practice applied because nothing contradicted it.
   */
  fromDates: boolean
}

/** One stated dependency between two pours, with the reason it exists. */
export interface PrecedenceEdge {
  /** The pour that comes first. */
  from: string
  /** The pour that waits on it. */
  to: string
  reason: PrecedenceReason
  /** Which elements said so, in words — an edge with no provenance is not arguable. */
  because: string
}

/** Why a pour, or the sequence, carries less than it looks like it should. */
export type SequenceGap =
  /** Nothing in the scope states any order at all, so every pour is concurrent. */
  | 'nothing-sequenced'
  /** Nothing orders this pour against anything, so it floats across the whole programme. */
  | 'unsequenced'
  /** Undated, so it has no float — there is no stated date for a window to be measured from. */
  | 'no-pour-date'
  /** The programme has no span to bound a move within, so no float is reported at all. */
  | 'no-programme-window'
  /** A neighbour is undated, so the constraint it would impose is not in this window. */
  | 'neighbour-undated'
  /** The lift below is never struck, so nothing here can say when this one may be erected. */
  | 'predecessor-never-struck'
  /** Members of one monolithic pour carry different dates, which one operation cannot. */
  | 'monolithic-dates-differ'
  /** An element in a monolithic pour is itself cast in several segments, so it is not one. */
  | 'monolithic-segmented'
  /** A monolithic pour's members disagree about cast order, which removes its precedence. */
  | 'monolithic-cast-order-spread'

export const SEQUENCE_GAP_LABELS: Record<SequenceGap, string> = {
  'nothing-sequenced':
    'Nothing in this scope states an order, so every pour is treated as concurrent with every other',
  unsequenced:
    'Nothing states this pour’s order against any other, so its float is the whole programme rather than a real allowance',
  'no-pour-date': 'No pour date, so there is nothing for a float to be measured from',
  'no-programme-window':
    'The programme has no first and last day, so there is no span for a pour to move within',
  'neighbour-undated':
    'A pour this one depends on is undated, so that dependency does not bound the move below',
  'predecessor-never-struck':
    'The lift below is never struck, so nothing says when this one could be erected',
  'monolithic-dates-differ':
    'Elements cast in one operation carry different pour dates, which is a contradiction in the programme rather than a pour',
  'monolithic-segmented':
    'An element in a monolithic pour is itself cast in more than one segment, so the group cannot be one operation and its members are sequenced separately',
  'monolithic-cast-order-spread':
    'Elements cast in one operation state different cast orders, so no order holds between this pour and the ones in between',
}

/** A pour, as this module needs it. Everything here is already on the scene. */
export interface SequenceablePour {
  /** The assembly id, matching `SchedulablePour.id` so the schedule joins to this. */
  id: string
  /** The element the shutter is on — precedence is stated on elements, not on shutters. */
  elementId: string
  /** Which segment along the element, for kinds that are cut into several. */
  segmentIndex: number
  /** Which lift up the element. Lift N bears on lift N−1. */
  liftIndex: number
  /** The element's stated cast order, where it has one. */
  castOrder?: number
  /** The element's monolithic pour group, where it has one. */
  pourId?: string
  /** The element is cast in alternate bays — resolved from the element or the project. */
  alternateBays?: boolean
}

/** One pour in the sequence: what it waits on, what waits on it, and how far it can move. */
export interface SequencedPour {
  /** The group's own id — an assembly id, or the `pourId` for a monolithic pour. */
  id: string
  /** The assembly ids cast in this one operation. More than one means monolithic. */
  members: string[]
  elementIds: string[]
  monolithic: boolean
  /** What the project stated, `YYYY-MM-DD`, or absent. */
  pourAt?: string
  castOrderFrom?: number
  castOrderTo?: number
  /** Pours this one waits on, and pours waiting on it — group ids. */
  predecessors: string[]
  successors: string[]
  /**
   * The earliest and latest day this pour could be placed on, given its neighbours' **stated**
   * dates and the programme's own span. Absent where either is undated.
   */
  earliestPourAt?: string
  latestPourAt?: string
  /**
   * `latestPourAt` − `earliestPourAt`, days.
   *
   * Negative means the stated programme already breaks its own precedence by that many days —
   * a pour dated before the lift under it comes off. `conflicts` names which edge.
   */
  totalFloat?: number
  /** Days this pour could be brought forward, and pushed back, on its own. */
  moveEarlierDays?: number
  moveLaterDays?: number
  gaps: SequenceGap[]
}

/** Where the stated dates and the stated order disagree. */
export interface PrecedenceConflict {
  edge: PrecedenceEdge
  /** How many days the successor would have to move later for the edge to hold. */
  shortfallDays: number
  message: string
}

export interface FormworkSequence {
  pours: SequencedPour[]
  /** Every dependency, transitively reduced — the edges somebody would draw. */
  edges: PrecedenceEdge[]
  /** Pours nothing orders against anything. Concurrent by default, and that is a claim. */
  unsequenced: SequencedPour[]
  /**
   * Pours whose stated date cannot move at all without breaking a dependency.
   *
   * Not a critical path. See the module docstring: these are pinned by their neighbours'
   * stated dates rather than by a path through a derived programme.
   */
  pinned: SequencedPour[]
  /** Dependencies the stated dates already violate. */
  conflicts: PrecedenceConflict[]
  /** The span a move is measured within: the programme's own first and last day. */
  windowFrom?: string
  windowTo?: string
  /**
   * The alternate-bay plans, one per element that stated it (directly or through the
   * project's pours settings). Absent where no element is cast in alternate bays.
   */
  alternateBays?: AlternateBayPlan[]
  gaps: SequenceGap[]
}

/** One pour's dates, in day numbers, as the float pass needs them. */
interface NodeDates {
  pourDay: number
  /** The day the plant is wanted on site — the pour day where no lead is recorded. */
  erectDay: number
  /** The day the last of it comes off, where anything is struck at all. */
  strikeDay?: number
  /** The day it is free again, or the strike day. */
  releaseDay: number
}

/** A pour group under construction. */
interface Group {
  id: string
  members: SequenceablePour[]
  monolithic: boolean
}

/**
 * The pours, contracted into the operations they are actually cast in.
 *
 * `pourId` groups *elements*, and an element cut into lifts is cast in several operations, so
 * the group is per lift: lift 0 of both walls is one pour and lift 1 of the taller one is
 * another. Lifts correspond across elements — the bottom of one wall is the bottom of the
 * other — and segments do not, so an element cut along its length cannot be grouped with
 * anything and is reported rather than quietly split.
 */
function groupPours(pours: readonly SequenceablePour[]): {
  groups: Group[]
  groupIdByPour: Map<string, string>
  gaps: Set<SequenceGap>
} {
  const gaps = new Set<SequenceGap>()
  const segmentsPerElement = new Map<string, Set<number>>()
  for (const pour of pours) {
    const seen = segmentsPerElement.get(pour.elementId) ?? new Set<number>()
    seen.add(pour.segmentIndex)
    segmentsPerElement.set(pour.elementId, seen)
  }

  const byKey = new Map<string, SequenceablePour[]>()
  const order: string[] = []
  for (const pour of pours) {
    const segmented = (segmentsPerElement.get(pour.elementId)?.size ?? 1) > 1
    if (pour.pourId !== undefined && segmented) gaps.add('monolithic-segmented')
    const key =
      pour.pourId === undefined || segmented ? pour.id : `${pour.pourId}#${pour.liftIndex}`
    const existing = byKey.get(key)
    if (existing) existing.push(pour)
    else {
      byKey.set(key, [pour])
      order.push(key)
    }
  }

  const groups: Group[] = []
  const groupIdByPour = new Map<string, string>()
  for (const key of order) {
    const members = byKey.get(key) as SequenceablePour[]
    const monolithic = members.length > 1
    // The `pourId` alone where a group has one lift, because `P1#0` on a panel reads as a
    // second identifier rather than as the pour the project already named.
    const lifts = new Set(members.map((member) => member.liftIndex))
    const first = members[0] as SequenceablePour
    const id =
      monolithic && first.pourId !== undefined
        ? lifts.size === 1 && countLifts(pours, first.pourId) === 1
          ? first.pourId
          : `${first.pourId} lift ${first.liftIndex + 1}`
        : first.id
    groups.push({ id, members, monolithic })
    for (const member of members) groupIdByPour.set(member.id, id)
  }
  return { groups, groupIdByPour, gaps }
}

/** How many distinct lifts a monolithic group spans, across all its elements. */
function countLifts(pours: readonly SequenceablePour[], pourId: string): number {
  return new Set(pours.filter((pour) => pour.pourId === pourId).map((pour) => pour.liftIndex)).size
}

/**
 * The cast-order edges, transitively reduced.
 *
 * A group's cast order is the *range* over its members, and A precedes B only where every
 * element of A is stated before every element of B — `A.to < B.from`. Ranges that overlap
 * leave the two concurrent, which is the honest answer and is exactly the case
 * `CAST_ORDER_CYCLE` already reports as a contradiction: a monolithic pour whose members
 * straddle another pour's position cannot be placed in one operation at all.
 *
 * Reduced because the unreduced relation is quadratic — forty sequential pours are 780 edges
 * and 39 dependencies — and a `predecessors` list nobody can read is not provenance. The
 * reduction is sound while the programme agrees with its own order: a dropped edge A→C is
 * implied by A→B→C, so it cannot bind a float that B does not already bind. Where the
 * programme *disagrees* with its order the two differ, and that disagreement is reported as a
 * conflict on the edge that states it rather than absorbed into a float figure.
 */
function castOrderEdges(
  ranges: ReadonlyArray<{ id: string; from: number; to: number; label: string }>,
): PrecedenceEdge[] {
  if (ranges.length < 2) return []
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id))
  // Suffix minimum of `to`, so the nearest successor of any group is one lookup rather than a
  // scan: `minTo[i]` is the earliest any group from `i` onwards finishes.
  const minTo: number[] = new Array(sorted.length)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const own = (sorted[i] as { to: number }).to
    minTo[i] = i === sorted.length - 1 ? own : Math.min(own, minTo[i + 1] as number)
  }

  const edges: PrecedenceEdge[] = []
  for (const group of sorted) {
    // The first group that starts after this one ends: everything before it overlaps.
    let low = 0
    let high = sorted.length
    while (low < high) {
      const mid = (low + high) >> 1
      if ((sorted[mid] as { from: number }).from > group.to) high = mid
      else low = mid + 1
    }
    if (low >= sorted.length) continue
    const nearest = minTo[low] as number
    for (let i = low; i < sorted.length; i++) {
      const next = sorted[i] as { id: string; from: number; label: string }
      // Beyond the nearest successor's finish there is always a group in between, so the edge
      // is implied rather than stated.
      if (next.from > nearest) break
      edges.push({
        from: group.id,
        to: next.id,
        reason: 'cast-order',
        because: `${group.label} is cast at order ${group.from === group.to ? group.from : `${group.from}–${group.to}`}, ${next.label} at ${next.from}`,
      })
    }
  }
  return edges
}

/** Days since the epoch → `YYYY-MM-DD`. */
function toDateString(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10)
}

/**
 * One group's dates, from its members' programmes.
 *
 * The earliest erection and the latest release across the members, because the group is one
 * operation: its plant is wanted when the first of it is wanted and free when the last of it
 * comes off. Members disagreeing about the *pour* date is different — one operation has one
 * date — so that is a gap rather than a minimum.
 */
function datesFor(
  members: readonly SequenceablePour[],
  scheduleById: Map<string, PourSchedule>,
  gaps: SequenceGap[],
): NodeDates | undefined {
  const pourDays: number[] = []
  const erectDays: number[] = []
  const strikeDays: number[] = []
  const releaseDays: number[] = []
  for (const member of members) {
    const pour = scheduleById.get(member.id)
    const pourDay = pour?.pourAt === undefined ? undefined : calendarDayNumber(pour.pourAt)
    if (pour === undefined || pourDay === undefined) return undefined
    pourDays.push(pourDay)
    const erect = pour.erectAt === undefined ? undefined : calendarDayNumber(pour.erectAt)
    erectDays.push(erect ?? pourDay)
    const strike = pour.strikeAt === undefined ? undefined : calendarDayNumber(pour.strikeAt)
    if (strike !== undefined) strikeDays.push(strike)
    const release = pour.releaseAt === undefined ? undefined : calendarDayNumber(pour.releaseAt)
    releaseDays.push(release ?? strike ?? pourDay)
  }
  if (new Set(pourDays).size > 1) gaps.push('monolithic-dates-differ')
  const pourDay = Math.min(...pourDays)
  const strikeDay = strikeDays.length === 0 ? undefined : Math.max(...strikeDays)
  return {
    pourDay,
    erectDay: Math.min(...erectDays, pourDay),
    ...(strikeDay === undefined ? {} : { strikeDay }),
    releaseDay: Math.max(...releaseDays, pourDay),
  }
}

/**
 * What has to happen before what, and how far each pour can move.
 *
 * The schedule is passed in rather than re-derived for the reason the set sweep takes it: a
 * float measured against dates this module parsed itself could disagree with the programme
 * printed above it about which day a pour falls on.
 */
export function formworkSequence(
  pours: readonly SequenceablePour[],
  schedule: FormworkSchedule,
): FormworkSequence {
  const scheduleById = new Map(schedule.pours.map((pour) => [pour.id, pour]))
  const { groups, groupIdByPour, gaps: groupGaps } = groupPours(pours)
  const gaps = groupGaps

  const perGroupGaps = new Map<string, SequenceGap[]>()
  for (const group of groups) perGroupGaps.set(group.id, [])

  // Lift chains, per element *segment*: lift N of a segment bears on the lift below it in that
  // same segment. Consecutive present lifts rather than N−1 exactly, because an unformed lift
  // in the middle does not remove the bearing — it only removes the shutter.
  const chains = new Map<string, SequenceablePour[]>()
  for (const pour of pours) {
    const key = `${pour.elementId}#${pour.segmentIndex}`
    chains.set(key, [...(chains.get(key) ?? []), pour])
  }
  const edges: PrecedenceEdge[] = []
  for (const chain of chains.values()) {
    const ordered = [...chain].sort((a, b) => a.liftIndex - b.liftIndex)
    for (let i = 1; i < ordered.length; i++) {
      const lower = ordered[i - 1] as SequenceablePour
      const upper = ordered[i] as SequenceablePour
      const from = groupIdByPour.get(lower.id) as string
      const to = groupIdByPour.get(upper.id) as string
      if (from === to) continue
      edges.push({
        from,
        to,
        reason: 'lift',
        because: `${upper.elementId} lift ${upper.liftIndex + 1} bears on lift ${lower.liftIndex + 1}, which has to be struck first`,
      })
    }
  }

  const ranges: Array<{ id: string; from: number; to: number; label: string }> = []
  for (const group of groups) {
    const orders = group.members
      .map((member) => member.castOrder)
      .filter((order): order is number => order !== undefined)
    if (orders.length === 0) continue
    const from = Math.min(...orders)
    const to = Math.max(...orders)
    if (from !== to) {
      gaps.add('monolithic-cast-order-spread')
      perGroupGaps.get(group.id)?.push('monolithic-cast-order-spread')
    }
    ranges.push({ id: group.id, from, to, label: group.id })
  }
  edges.push(...castOrderEdges(ranges))

  const datesByGroup = new Map<string, NodeDates>()
  for (const group of groups) {
    const own = perGroupGaps.get(group.id) as SequenceGap[]
    const dates = datesFor(group.members, scheduleById, own)
    if (dates === undefined) own.push('no-pour-date')
    else datesByGroup.set(group.id, dates)
  }

  // Alternate-bay construction. Adjacent bays of one element are ordered so no two of
  // them share a pour interval, which is an ordering this module states as edges — the
  // same shape cast order takes — rather than as dates. The parity is read off the
  // stated dates where they decide it, and otherwise the site's usual practice: odd
  // bays first, the even ones keyed off the cast either side of them.
  const alternateBays: AlternateBayPlan[] = []
  const byElement = new Map<string, SequenceablePour[]>()
  for (const pour of pours) {
    if (pour.alternateBays !== true) continue
    byElement.set(pour.elementId, [...(byElement.get(pour.elementId) ?? []), pour])
  }
  for (const [elementId, elementPours] of byElement) {
    // Per lift: bays are adjacent within a lift, and a lift of one bay needs no ordering.
    const byLift = new Map<number, SequenceablePour[]>()
    for (const pour of elementPours) {
      byLift.set(pour.liftIndex, [...(byLift.get(pour.liftIndex) ?? []), pour])
    }
    const adjacent: Array<[SequenceablePour, SequenceablePour]> = []
    for (const lift of byLift.values()) {
      const ordered = [...lift].sort((a, b) => a.segmentIndex - b.segmentIndex)
      for (let i = 1; i < ordered.length; i++) {
        adjacent.push([ordered[i - 1] as SequenceablePour, ordered[i] as SequenceablePour])
      }
    }
    if (adjacent.length === 0) continue

    let parity: AlternateBayParity = 'odd-bays-first'
    let fromDates = false
    for (const [lower, upper] of adjacent) {
      const before = datesByGroup.get(groupIdByPour.get(lower.id) as string)
      const after = datesByGroup.get(groupIdByPour.get(upper.id) as string)
      if (before === undefined || after === undefined || before.pourDay === after.pourDay) continue
      const earlierOdd =
        before.pourDay < after.pourDay ? lower.segmentIndex % 2 === 0 : upper.segmentIndex % 2 === 0
      parity = earlierOdd ? 'odd-bays-first' : 'even-bays-first'
      fromDates = true
      break
    }

    for (const [lower, upper] of adjacent) {
      const oddFirst = lower.segmentIndex % 2 === 0
      const first =
        parity === 'odd-bays-first' ? (oddFirst ? lower : upper) : oddFirst ? upper : lower
      const second = first === lower ? upper : lower
      const from = groupIdByPour.get(first.id) as string
      const to = groupIdByPour.get(second.id) as string
      if (from === to) continue
      edges.push({
        from,
        to,
        reason: 'alternate-bay',
        because: `${elementId} is cast in alternate bays — bay ${first.segmentIndex + 1} is cast before the adjacent bay ${second.segmentIndex + 1}`,
      })
    }
    alternateBays.push({ elementId, parity, fromDates })
  }

  const predecessors = new Map<string, PrecedenceEdge[]>()
  const successors = new Map<string, PrecedenceEdge[]>()
  for (const edge of edges) {
    predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge])
    successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge])
  }
  if (edges.length === 0 && groups.length > 1) gaps.add('nothing-sequenced')

  for (const own of perGroupGaps.values()) for (const gap of own) gaps.add(gap)

  // The span a move is measured inside: the stated programme's own first and last day. A pour
  // with no successor can slip to the end of the programme and no further, which is a bound
  // the project stated rather than a completion date this module invented.
  const windowFrom = schedule.firstErectAt ?? schedule.firstPourAt
  const windowTo = schedule.lastReleaseAt ?? schedule.lastStrikeAt ?? schedule.lastPourAt
  const windowStart = windowFrom === undefined ? undefined : calendarDayNumber(windowFrom)
  const windowEnd = windowTo === undefined ? undefined : calendarDayNumber(windowTo)
  if (windowStart === undefined || windowEnd === undefined) gaps.add('no-programme-window')

  const conflicts: PrecedenceConflict[] = []
  for (const edge of edges) {
    const before = datesByGroup.get(edge.from)
    const after = datesByGroup.get(edge.to)
    if (before === undefined || after === undefined) continue
    // What the edge requires of the successor, in its own terms: a lift waits on a strike and
    // a cast order waits on a pour. At day resolution two pours in stated order may share a
    // day, so the cast-order test is not strict — requiring a day between them would invent a
    // constraint the calendar cannot see.
    const required =
      edge.reason === 'lift'
        ? before.strikeDay === undefined
          ? undefined
          : before.strikeDay + (after.pourDay - after.erectDay)
        : before.pourDay
    if (required === undefined) continue
    if (after.pourDay >= required) continue
    conflicts.push({
      edge,
      shortfallDays: required - after.pourDay,
      message:
        edge.reason === 'lift'
          ? `${edge.to} is poured ${required - after.pourDay} ${required - after.pourDay === 1 ? 'day' : 'days'} before ${edge.from} is struck, and its formwork bears on it`
          : `${edge.to} is poured before ${edge.from}, which ${
              edge.reason === 'alternate-bay'
                ? 'alternate-bay construction'
                : 'the stated cast order'
            } puts first`,
    })
  }

  const sequenced: SequencedPour[] = groups.map((group) => {
    const own = perGroupGaps.get(group.id) as SequenceGap[]
    const preds = predecessors.get(group.id) ?? []
    const succs = successors.get(group.id) ?? []
    if (preds.length === 0 && succs.length === 0 && groups.length > 1) own.push('unsequenced')
    const dates = datesByGroup.get(group.id)
    const first = group.members[0] as SequenceablePour
    const orders = group.members
      .map((member) => member.castOrder)
      .filter((order): order is number => order !== undefined)

    const base: SequencedPour = {
      id: group.id,
      members: group.members.map((member) => member.id),
      elementIds: [...new Set(group.members.map((member) => member.elementId))].sort(),
      monolithic: group.monolithic,
      ...(dates === undefined ? {} : { pourAt: toDateString(dates.pourDay) }),
      ...(orders.length === 0
        ? {}
        : { castOrderFrom: Math.min(...orders), castOrderTo: Math.max(...orders) }),
      predecessors: [...new Set(preds.map((edge) => edge.from))].sort(),
      successors: [...new Set(succs.map((edge) => edge.to))].sort(),
      gaps: own,
    }
    if (dates === undefined || windowStart === undefined || windowEnd === undefined) return base

    // The pour's own shape, so a move carries its lead and its tail with it: bringing a pour
    // forward brings the delivery forward by the same days, and pushing it back pushes the
    // release back. Without these the window would allow a move whose plant arrives before
    // the job starts.
    const leadDays = dates.pourDay - dates.erectDay
    const tailDays = dates.releaseDay - dates.pourDay
    let earliest = windowStart + leadDays
    let latest = windowEnd - tailDays
    for (const edge of preds) {
      const before = datesByGroup.get(edge.from)
      if (before === undefined) {
        if (!own.includes('neighbour-undated')) own.push('neighbour-undated')
        continue
      }
      if (edge.reason === 'cast-order' || edge.reason === 'alternate-bay')
        earliest = Math.max(earliest, before.pourDay)
      else if (before.strikeDay === undefined) {
        if (!own.includes('predecessor-never-struck')) own.push('predecessor-never-struck')
      } else earliest = Math.max(earliest, before.strikeDay + leadDays)
    }
    for (const edge of succs) {
      const after = datesByGroup.get(edge.to)
      if (after === undefined) {
        if (!own.includes('neighbour-undated')) own.push('neighbour-undated')
        continue
      }
      if (edge.reason === 'cast-order' || edge.reason === 'alternate-bay')
        latest = Math.min(latest, after.pourDay)
      else if (dates.strikeDay === undefined) {
        // Nothing here is struck, so this pour never releases the lift above. The successor's
        // own gap says so; there is no bound to add from this side.
      } else latest = Math.min(latest, after.erectDay - (dates.strikeDay - dates.pourDay))
    }

    return {
      ...base,
      earliestPourAt: toDateString(earliest),
      latestPourAt: toDateString(latest),
      totalFloat: latest - earliest,
      moveEarlierDays: dates.pourDay - earliest,
      moveLaterDays: latest - dates.pourDay,
    }
  })

  for (const pour of sequenced) for (const gap of pour.gaps) gaps.add(gap)

  return {
    pours: sequenced,
    edges,
    unsequenced: sequenced.filter((pour) => pour.gaps.includes('unsequenced')),
    pinned: sequenced.filter((pour) => pour.totalFloat !== undefined && pour.totalFloat <= 0),
    conflicts,
    ...(windowFrom === undefined ? {} : { windowFrom }),
    ...(windowTo === undefined ? {} : { windowTo }),
    ...(alternateBays.length === 0 ? {} : { alternateBays }),
    gaps: [...gaps],
  }
}

/** The float on one assembly, for a caller holding a schedule id rather than a group id. */
export function floatForPourId(
  sequence: FormworkSequence,
  pourId: string,
): SequencedPour | undefined {
  return sequence.pours.find((pour) => pour.members.includes(pourId))
}

/**
 * What makes a float figure wrong, in words.
 *
 * The first two are printed whenever there is any float at all, because both are things a
 * reader will otherwise assume: that these numbers are a critical-path analysis, and that
 * float belongs to the pour it is printed against.
 */
export function formworkSequenceCaveats(sequence: FormworkSequence): string[] {
  const out: string[] = []
  if (sequence.pours.length === 0) return out
  const floated = sequence.pours.filter((pour) => pour.totalFloat !== undefined)

  if (sequence.gaps.includes('nothing-sequenced')) {
    out.push(
      `Nothing in this scope states an order — no element carries a cast order and no element is cast in more than one lift — so every pour below is treated as concurrent with every other. The float shown is the whole programme, which is not an allowance anybody can spend.`,
    )
  } else if (sequence.unsequenced.length > 0) {
    const count = sequence.unsequenced.length
    out.push(
      `${count} of ${sequence.pours.length} ${count === 1 ? 'pour has' : 'pours have'} nothing ordering ${count === 1 ? 'it' : 'them'} against anything else, so ${count === 1 ? 'its' : 'their'} float is the programme's own span rather than a real allowance. Set a cast order on those elements to sequence them.`,
    )
  }

  if (floated.length > 0) {
    out.push(
      'This is not a critical path. Every bound here comes from a neighbour’s stated pour date, so a pour with no float is pinned by the dates around it rather than lying on a path through a computed programme — and adding a date elsewhere can change it.',
    )
    out.push(
      'Float is not slack a gang can spend. Two pours with a week each do not have two weeks between them: the second one’s window was measured against the first one’s stated date, and the first one moving changes it. Move one pour, then read this again.',
    )
  }

  if (sequence.conflicts.length > 0) {
    const worst = [...sequence.conflicts].sort((a, b) => b.shortfallDays - a.shortfallDays)[0]
    out.push(
      `${sequence.conflicts.length} stated ${sequence.conflicts.length === 1 ? 'dependency is' : 'dependencies are'} already broken by the programme’s own dates — ${worst?.message}. Those pours show negative float, which is how many days the programme is infeasible by rather than an allowance.`,
    )
  }
  for (const plan of sequence.alternateBays ?? []) {
    out.push(
      `${plan.elementId} is cast in alternate bays, ${ALTERNATE_BAY_PARITY_LABELS[plan.parity]}${
        plan.fromDates
          ? ' — the parity read off the stated pour dates.'
          : ' — the default practice, because no stated date decides it.'
      } No two adjacent bays are poured in the same interval.`,
    )
  }
  if (sequence.gaps.includes('monolithic-dates-differ')) {
    out.push(
      `${SEQUENCE_GAP_LABELS['monolithic-dates-differ']}. The earliest of them is used, so the float for that pour is the tightest reading of it.`,
    )
  }
  if (sequence.gaps.includes('monolithic-segmented')) {
    out.push(SEQUENCE_GAP_LABELS['monolithic-segmented'])
  }
  if (sequence.gaps.includes('monolithic-cast-order-spread')) {
    out.push(
      `${SEQUENCE_GAP_LABELS['monolithic-cast-order-spread']} — the same contradiction the cast-order cycle check reports, seen from the programme side.`,
    )
  }
  if (sequence.gaps.includes('predecessor-never-struck')) {
    out.push(
      `${SEQUENCE_GAP_LABELS['predecessor-never-struck']}. A lift whose formwork is left in is the usual reason, and the lift above it carries no earliest date because of it.`,
    )
  }
  const undated = sequence.pours.filter((pour) => pour.gaps.includes('no-pour-date'))
  if (undated.length > 0) {
    out.push(
      `${undated.length} of ${sequence.pours.length} pours ${undated.length === 1 ? 'is' : 'are'} undated and carry no float. They still appear in the dependencies above, so a pour waiting on one of them is shown as freer than it is.`,
    )
  }
  return out
}
