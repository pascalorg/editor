import { describe, expect, test } from 'bun:test'
import { formworkAcquisition } from './acquire'
import type { StrikeTarget, StrikingTime } from './design/striking'
import { formworkResequence, resequenceCaveats } from './resequence'
import { type FormworkSchedule, formworkSchedule, type SchedulablePour } from './schedule'
import { formworkSequence, type SequenceablePour } from './sequence'
import { formworkSetCount, type PourQuantities } from './sets'
import type { OwnedStock } from './supply'

/**
 * Which pour to move, to stop being short.
 *
 * The whole chain in one call per test — schedule, sweep, acquisition, sequence, then the
 * proposal — because that is the only way to know the peak a move is compared against is the
 * peak the reader is shown. A fixture that stated a peak directly would let the module pass
 * while disagreeing with the sweep above it.
 */

function striking(target: StrikeTarget, days: number): StrikingTime {
  return {
    standard: 'bs-8110',
    target,
    hours: days * 24,
    days,
    basis: 'calendar',
    criterion: 'elapsed-time',
    governingRule: 'test',
    assumed: [],
    warnings: [],
  }
}

interface Spec {
  id: string
  elementId: string
  pourAt: string
  /** Catalog id → how many this pour has standing. */
  quantities: Record<string, number>
  liftIndex?: number
  segmentIndex?: number
  castOrder?: number
  pourId?: string
  strikeDays?: number
}

const PANEL = 'doka-framax-0.90x2.70'
const PROP = 'eurex-20-300'

function describeId(catalogId: string): string {
  return catalogId === PANEL ? 'Framax panel 0.90 × 2.70' : 'Eurex 20 prop'
}

/** The whole chain, so nothing here can disagree with anything else. */
function chainFor(specs: readonly Spec[], owned: OwnedStock, committed?: readonly string[]) {
  const schedulable: SchedulablePour[] = specs.map((spec) => ({
    id: spec.id,
    pourAt: spec.pourAt,
    striking: [striking('vertical-form', spec.strikeDays ?? 3)],
  }))
  const sequenceable: SequenceablePour[] = specs.map((spec) => ({
    id: spec.id,
    elementId: spec.elementId,
    segmentIndex: spec.segmentIndex ?? 0,
    liftIndex: spec.liftIndex ?? 0,
    ...(spec.castOrder === undefined ? {} : { castOrder: spec.castOrder }),
    ...(spec.pourId === undefined ? {} : { pourId: spec.pourId }),
  }))
  const quantities: PourQuantities[] = specs.map((spec) => ({
    id: spec.id,
    quantities: Object.entries(spec.quantities).map(([catalogId, quantity]) => ({
      catalogId,
      kind: catalogId === PANEL ? ('panel' as const) : ('prop' as const),
      description: describeId(catalogId),
      quantity,
      target: 'vertical-form' as const,
    })),
  }))

  const schedule: FormworkSchedule = formworkSchedule(schedulable, { returnLeadDays: 1 })
  const sets = formworkSetCount(schedule, quantities)
  if (sets === undefined) throw new Error('the fixture programme is too partial to sweep')
  const acquisition = formworkAcquisition(sets, owned, undefined)
  const sequence = formworkSequence(sequenceable, schedule)
  return {
    schedule,
    sets,
    acquisition,
    sequence,
    resequence: formworkResequence(
      acquisition,
      schedule,
      quantities,
      sequence,
      committed === undefined ? undefined : new Set(committed),
    ),
  }
}

describe('formworkResequence', () => {
  test('names the pour to move, and clears the shortage by moving it', () => {
    // Two pours overlapping on the 9th need 60 panels at once against a rack of 40. wall_2 is
    // cast third, so it has a week of float before wall_3 — enough to leave the overlap.
    const { acquisition, resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-23',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
    )

    expect(acquisition.shortfalls[0]?.shortfall).toBe(20)
    const answer = resequence.answers[0]
    expect(answer?.catalogId).toBe(PANEL)
    expect(answer?.refusal).toBeUndefined()
    const move = answer?.moves[0]
    expect(move?.pourId).toBe('b')
    expect(move?.days).toBeGreaterThan(0)
    expect(move?.peakBefore).toBe(60)
    expect(move?.peakAfter).toBe(30)
    expect(move?.clearsShortage).toBe(true)
    expect(move?.shortfallAfter).toBe(0)
    expect(resequence.clearable).toHaveLength(1)
    expect(resequence.unavoidable).toHaveLength(0)
  })

  test('refuses where every pour in the overlap is pinned', () => {
    // The refusal that matters. Three pours in stated order all on one day: the middle one is
    // fixed by both neighbours and neither end can leave the overlap without passing the middle.
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-09',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
    )

    expect(resequence.answers[0]?.refusal).toBe('all-pinned')
    expect(resequence.answers[0]?.pinnedPourIds).toEqual(['a', 'b', 'c'])
    expect(resequence.answers[0]?.moves).toEqual([])
    expect(resequence.unavoidable).toHaveLength(1)
  })

  test('refuses where the job states no order at all, rather than proposing a free move', () => {
    // An unsequenced job's float is the programme's own span, so every pour looks movable. That
    // is the answer this module must not give.
    const { resequence, sequence } = chainFor(
      [
        { id: 'a', elementId: 'wall_1', pourAt: '2026-03-09', quantities: { [PANEL]: 30 } },
        { id: 'b', elementId: 'wall_2', pourAt: '2026-03-09', quantities: { [PANEL]: 30 } },
      ],
      { [PANEL]: 40 },
    )

    expect(sequence.gaps).toContain('nothing-sequenced')
    expect(resequence.answers[0]?.refusal).toBe('nothing-sequenced')
    expect(resequence.answers[0]?.moves).toEqual([])
  })

  test('reports what the move makes worse, not only what it fixes', () => {
    // The half that makes a proposal arguable. Moving wall_2 off the panel peak lands it beside
    // wall_3, and the two together need more props than the programme had at once.
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30, [PROP]: 20 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-16',
          castOrder: 3,
          quantities: { [PROP]: 20 },
        },
      ],
      { [PANEL]: 40 },
    )
    const move = resequence.answers.find((answer) => answer.catalogId === PANEL)?.moves[0]

    expect(move?.clearsShortage).toBe(true)
    expect(move?.raises).toHaveLength(1)
    expect(move?.raises[0]).toMatchObject({ catalogId: PROP, from: 20, to: 40 })
  })

  test('a move that costs nothing elsewhere raises nothing', () => {
    // The passing half of the same check: a lone item cannot be made worse by a move.
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-23',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
    )

    expect(resequence.answers[0]?.moves[0]?.raises).toEqual([])
  })

  test('a monolithic pour moves whole, as one candidate', () => {
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          pourId: 'P1',
          castOrder: 2,
          quantities: { [PANEL]: 15 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-09',
          pourId: 'P1',
          castOrder: 2,
          quantities: { [PANEL]: 15 },
        },
        {
          id: 'd',
          elementId: 'wall_4',
          pourAt: '2026-03-23',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
    )
    const move = resequence.answers[0]?.moves[0]

    expect(move?.pourId).toBe('P1')
    expect(move?.members.sort()).toEqual(['b', 'c'])
    expect(move?.peakAfter).toBe(30)
  })

  test('a move is never proposed beyond the float, so the proposal keeps precedence', () => {
    // wall_2 is boxed in: one day either side of it and both neighbours' dates are in the way.
    // The overlap it is in cannot be left, and the answer is a refusal rather than a move that
    // breaks the order the project stated.
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-08',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-10',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
    )
    const answer = resequence.answers[0]

    expect(answer?.moves).toEqual([])
    expect(answer?.refusal).toBe('no-move-helps')
  })

  test('a peak that clears only partly is reported with what is left short', () => {
    // Not every move is a cure. Moving one of three overlapping pours off the peak day takes 25
    // out of 75, leaving 50 against a rack of 40 — still 10 short, and that is the useful figure.
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 25 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 25 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-09',
          castOrder: 3,
          quantities: { [PANEL]: 25 },
        },
        {
          id: 'd',
          elementId: 'wall_4',
          pourAt: '2026-03-30',
          castOrder: 4,
          quantities: { [PANEL]: 25 },
        },
      ],
      { [PANEL]: 40 },
    )
    const move = resequence.answers[0]?.moves[0]

    expect(move?.peakAfter).toBe(50)
    expect(move?.shortfallAfter).toBe(10)
    expect(move?.clearsShortage).toBe(false)
    expect(resequence.clearable).toHaveLength(0)
    expect(resequence.unavoidable).toHaveLength(1)
  })

  test('nothing short means nothing to propose', () => {
    const { acquisition, resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 100 },
    )

    expect(acquisition.shortfalls).toEqual([])
    expect(resequence.answers).toEqual([])
    expect(resequenceCaveats(resequence)).toEqual([])
  })

  test('the float left after the move is reported, so a reader knows what is spent', () => {
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-04-20',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
    )
    const move = resequence.answers[0]?.moves[0]

    expect(move?.floatRemaining).toBeGreaterThan(0)
    expect(move?.toDate).toBe(
      new Date((Date.UTC(2026, 2, 9) / 86_400_000 + (move?.days as number)) * 86_400_000)
        .toISOString()
        .slice(0, 10),
    )
  })
})

describe('formworkResequence — a booked pour is not a candidate', () => {
  /**
   * The one fixture in this file, three ways: two pours on the 9th need 60 panels against a rack
   * of 40, and wall_2 has a fortnight of float before wall_3. Without a commitment it is the
   * move; the tests below commit it, commit the other one, and commit both.
   */
  const OVERLAP: Spec[] = [
    {
      id: 'a',
      elementId: 'wall_1',
      pourAt: '2026-03-09',
      castOrder: 1,
      quantities: { [PANEL]: 30 },
    },
    {
      id: 'b',
      elementId: 'wall_2',
      pourAt: '2026-03-09',
      castOrder: 2,
      quantities: { [PANEL]: 30 },
    },
    {
      id: 'c',
      elementId: 'wall_3',
      pourAt: '2026-03-23',
      castOrder: 3,
      quantities: { [PANEL]: 30 },
    },
  ]

  /**
   * The same overlap with the booked pour holding its plant for a month, so the pour that moves
   * has something substantial to clear. `strikeDays` is what makes the hold long: the shutter is
   * struck five weeks after the pour, and a move of one day past the peak leaves the mover
   * standing beside it for the rest of them.
   */
  const BOOKED_HOLD: Spec[] = [
    {
      id: 'a',
      elementId: 'wall_1',
      pourAt: '2026-03-09',
      castOrder: 1,
      strikeDays: 35,
      quantities: { [PANEL]: 30 },
    },
    {
      id: 'b',
      elementId: 'wall_2',
      pourAt: '2026-03-09',
      castOrder: 2,
      quantities: { [PANEL]: 30 },
    },
    {
      id: 'c',
      elementId: 'wall_3',
      pourAt: '2026-06-01',
      castOrder: 3,
      quantities: { [PANEL]: 30 },
    },
  ]

  test('the pour that would have been proposed is not proposed once it is booked', () => {
    // Named rather than silently dropped, which is the whole difference between a refusal and
    // an answer that has nothing in it: a reader who saw this move on Monday is owed the reason
    // it has gone.
    const free = chainFor(OVERLAP, { [PANEL]: 40 })
    const booked = chainFor(OVERLAP, { [PANEL]: 40 }, ['b'])

    expect(free.resequence.answers[0]?.moves.map((move) => move.pourId)).toContain('b')
    expect(booked.resequence.answers[0]?.moves.map((move) => move.pourId)).not.toContain('b')
    expect(booked.resequence.answers[0]?.committedPourIds).toEqual(['b'])
  })

  test('a booked pour is still an obstacle, so the pour that does move has to clear it', () => {
    // Excluded as a candidate and kept in the sweep. wall_1 is booked and holds its plant for a
    // month, and wall_2 — the one pour with float — has to land clear of that hold rather than
    // clear of the peak day. A booked pour dropped from the sweep as well as from the candidates
    // would leave nothing for wall_2 to clear and no move at all.
    const { resequence } = chainFor(BOOKED_HOLD, { [PANEL]: 40 }, ['a'])
    const move = resequence.answers[0]?.moves[0]

    expect(resequence.answers[0]?.committedPourIds).toEqual(['a'])
    expect(move?.pourId).toBe('b')
    expect(move?.days).toBeGreaterThan(30)
    expect(move?.peakBefore).toBe(60)
    expect(move?.peakAfter).toBe(30)
  })

  test('an overlap where every movable pour is booked is refused, not left empty', () => {
    const { resequence } = chainFor(OVERLAP, { [PANEL]: 40 }, ['a', 'b'])

    expect(resequence.answers[0]?.refusal).toBe('overlap-committed')
    expect(resequence.answers[0]?.committedPourIds).toEqual(['a', 'b'])
    expect(resequence.answers[0]?.moves).toEqual([])
    expect(resequence.unavoidable).toHaveLength(1)
  })

  test('one committed member commits the whole monolithic pour', () => {
    // Half a monolithic pour cannot be moved, so a booking on either member books the operation.
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          pourId: 'P1',
          castOrder: 2,
          quantities: { [PANEL]: 15 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-09',
          pourId: 'P1',
          castOrder: 2,
          quantities: { [PANEL]: 15 },
        },
        {
          id: 'd',
          elementId: 'wall_4',
          pourAt: '2026-03-23',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
      ['c'],
    )

    expect(resequence.answers[0]?.committedPourIds).toEqual(['P1'])
    expect(resequence.answers[0]?.moves.map((move) => move.pourId)).not.toContain('P1')
  })

  test('no commitments passed is a job nobody has booked, not a job entirely booked', () => {
    // The default the whole feature runs on today, said as a test because the opposite reading
    // would silence every proposal in it.
    const { resequence } = chainFor(OVERLAP, { [PANEL]: 40 })

    expect(resequence.answers[0]?.committedPourIds).toEqual([])
    expect(resequence.answers[0]?.refusal).toBeUndefined()
    expect(resequence.clearable).toHaveLength(1)
  })
})

describe('resequenceCaveats', () => {
  test('a proposal says the moves cannot be taken together, and is not a plan', () => {
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-23',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
    )
    const text = resequenceCaveats(resequence).join(' ')

    expect(text).toContain('cannot be taken together')
    expect(text).toContain('argument to take to the planner')
    expect(text).toContain('smallest one')
  })

  test('a pinned shortage is told it has to be bought or hired', () => {
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-09',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
    )
    const text = resequenceCaveats(resequence).join(' ')

    expect(text).toContain('pinned by the dates around it')
    expect(text).toContain('bought or hired')
    expect(text).not.toContain('cannot be taken together')
  })

  test('a booked overlap is sent to the phone rather than to the programme', () => {
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-03-23',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
      ['a', 'b'],
    )
    const text = resequenceCaveats(resequence).join(' ')

    expect(text).toContain('every pour with float is committed')
    expect(text).toContain('Release a commitment')
  })

  test('where a move survives beside a booking, the exclusion is said out loud', () => {
    // The reader is looking at one proposal where they might have expected two, and the peak
    // includes a pour that is not on the list. Unsaid, that reads as an arithmetic error.
    const { resequence } = chainFor(
      [
        {
          id: 'a',
          elementId: 'wall_1',
          pourAt: '2026-03-09',
          castOrder: 1,
          strikeDays: 35,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'b',
          elementId: 'wall_2',
          pourAt: '2026-03-09',
          castOrder: 2,
          quantities: { [PANEL]: 30 },
        },
        {
          id: 'c',
          elementId: 'wall_3',
          pourAt: '2026-06-01',
          castOrder: 3,
          quantities: { [PANEL]: 30 },
        },
      ],
      { [PANEL]: 40 },
      ['a'],
    )
    const text = resequenceCaveats(resequence).join(' ')

    expect(text).toContain('Committed pours are left out of these proposals')
    expect(text).toContain('still stand in the overlap')
  })
})
