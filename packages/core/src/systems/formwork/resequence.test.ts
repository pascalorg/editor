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
function chainFor(specs: readonly Spec[], owned: OwnedStock) {
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
    resequence: formworkResequence(acquisition, schedule, quantities, sequence),
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
})
