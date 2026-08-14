import { describe, expect, test } from 'bun:test'
import type { StrikeTarget, StrikingTime } from './design/striking'
import { type FormworkSchedule, formworkSchedule, type SchedulablePour } from './schedule'
import {
  type FormworkSequence,
  floatForPourId,
  formworkSequence,
  formworkSequenceCaveats,
  type SequenceablePour,
} from './sequence'

/**
 * Precedence off the scene, and how far a pour can move.
 *
 * Every check here has a firing case and a passing case, because the failure mode of the last
 * suite in this feature was a check that could not fail: an assertion that a float exists is
 * satisfied by a module that returns the programme's whole span for every pour, which is the one
 * answer this module must not give.
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

/** A pour: an assembly on an element, at a lift, with a date and a strike period. */
function pour(
  id: string,
  elementId: string,
  options: {
    liftIndex?: number
    segmentIndex?: number
    castOrder?: number
    pourId?: string
    alternateBays?: boolean
    pourAt?: string
    strikeDays?: number
  } = {},
): { sequenceable: SequenceablePour; schedulable: SchedulablePour } {
  const strikeDays = options.strikeDays ?? 3
  return {
    sequenceable: {
      id,
      elementId,
      segmentIndex: options.segmentIndex ?? 0,
      liftIndex: options.liftIndex ?? 0,
      ...(options.castOrder === undefined ? {} : { castOrder: options.castOrder }),
      ...(options.pourId === undefined ? {} : { pourId: options.pourId }),
      ...(options.alternateBays === undefined ? {} : { alternateBays: options.alternateBays }),
    },
    schedulable: {
      id,
      ...(options.pourAt === undefined ? {} : { pourAt: options.pourAt }),
      striking: strikeDays === 0 ? [] : [striking('vertical-form', strikeDays)],
    },
  }
}

function sequenceOf(
  entries: ReadonlyArray<ReturnType<typeof pour>>,
  leads: { erectionLeadDays?: number; returnLeadDays?: number } = {},
): FormworkSequence {
  const schedule: FormworkSchedule = formworkSchedule(
    entries.map((entry) => entry.schedulable),
    leads,
  )
  return formworkSequence(
    entries.map((entry) => entry.sequenceable),
    schedule,
  )
}

describe('formworkSequence — precedence', () => {
  test('a lift above bears on the lift below, with no cast order stated anywhere', () => {
    // The precedence that exists on a job nobody has sequenced. Physical, so it is never
    // absent, and it is the whole reason an unsequenced project still has a graph.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { liftIndex: 0, pourAt: '2026-03-02' }),
      pour('a_1', 'wall_1', { liftIndex: 1, pourAt: '2026-03-10' }),
    ])

    expect(sequence.edges).toHaveLength(1)
    expect(sequence.edges[0]).toMatchObject({ from: 'a_0', to: 'a_1', reason: 'lift' })
    expect(sequence.edges[0]?.because).toContain('bears on lift 1')
  })

  test('two lifts of different segments do not bear on each other', () => {
    // The passing half of the lift check. A wall cut along its length into two segments has two
    // independent stacks: segment 2's bottom lift does not sit on segment 1's.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { segmentIndex: 0, liftIndex: 0, pourAt: '2026-03-02' }),
      pour('b_0', 'wall_1', { segmentIndex: 1, liftIndex: 0, pourAt: '2026-03-04' }),
    ])

    expect(sequence.edges).toHaveLength(0)
    expect(sequence.gaps).toContain('nothing-sequenced')
  })

  test('a missing middle lift does not remove the bearing', () => {
    // Lift 2 formed and lift 1 not: the concrete of lift 0 is still what lift 2 stands on, so
    // consecutive *present* lifts rather than N−1 exactly.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { liftIndex: 0, pourAt: '2026-03-02' }),
      pour('a_2', 'wall_1', { liftIndex: 2, pourAt: '2026-03-20' }),
    ])

    expect(sequence.edges).toHaveLength(1)
    expect(sequence.edges[0]).toMatchObject({ from: 'a_0', to: 'a_2' })
  })

  test('a stated cast order puts one element before another', () => {
    const sequence = sequenceOf([
      pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-16' }),
    ])

    expect(sequence.edges).toHaveLength(1)
    expect(sequence.edges[0]).toMatchObject({ from: 'a', to: 'b', reason: 'cast-order' })
  })

  test('elements at the same cast order are concurrent rather than ordered', () => {
    // The passing half. Equal integers say "these two together", and an edge either way would be
    // an order nobody stated.
    const sequence = sequenceOf([
      pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { castOrder: 1, pourAt: '2026-03-02' }),
    ])

    expect(sequence.edges).toHaveLength(0)
    expect(sequence.unsequenced.map((entry) => entry.id).sort()).toEqual(['a', 'b'])
  })

  test('cast-order edges are transitively reduced, so a chain is a chain', () => {
    // Four sequential pours are three dependencies, not six. An unreduced relation makes a
    // `predecessors` list nobody can read, and it cannot bind a float the nearest one does not.
    const sequence = sequenceOf([
      pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-09' }),
      pour('c', 'wall_3', { castOrder: 3, pourAt: '2026-03-16' }),
      pour('d', 'wall_4', { castOrder: 4, pourAt: '2026-03-23' }),
    ])

    expect(sequence.edges.filter((edge) => edge.reason === 'cast-order')).toHaveLength(3)
    expect(sequence.pours.find((entry) => entry.id === 'd')?.predecessors).toEqual(['c'])
  })

  test('a monolithic pour is one node, not two nodes with an edge', () => {
    const sequence = sequenceOf([
      pour('a', 'wall_1', { pourId: 'P1', castOrder: 1, pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { pourId: 'P1', castOrder: 1, pourAt: '2026-03-02' }),
    ])

    expect(sequence.pours).toHaveLength(1)
    expect(sequence.pours[0]).toMatchObject({ id: 'P1', monolithic: true })
    expect(sequence.pours[0]?.members.sort()).toEqual(['a', 'b'])
    expect(sequence.edges).toHaveLength(0)
  })

  test('a monolithic group is per lift, because one group is not one operation', () => {
    // `pourId` groups elements and an element cut into lifts is cast several times over. Lift 0
    // of both walls is one operation and lift 1 is another, with the bearing between them.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { pourId: 'P1', liftIndex: 0, pourAt: '2026-03-02' }),
      pour('b_0', 'wall_2', { pourId: 'P1', liftIndex: 0, pourAt: '2026-03-02' }),
      pour('a_1', 'wall_1', { pourId: 'P1', liftIndex: 1, pourAt: '2026-03-16' }),
      pour('b_1', 'wall_2', { pourId: 'P1', liftIndex: 1, pourAt: '2026-03-16' }),
    ])

    expect(sequence.pours).toHaveLength(2)
    expect(sequence.pours.map((entry) => entry.id)).toEqual(['P1 lift 1', 'P1 lift 2'])
    // Two lift edges, one per element, both between the same two groups.
    expect(sequence.edges.filter((edge) => edge.reason === 'lift')).toHaveLength(2)
    expect(sequence.pours[1]?.predecessors).toEqual(['P1 lift 1'])
  })

  test('a segmented element cannot join a monolithic pour, and says so', () => {
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { pourId: 'P1', segmentIndex: 0, pourAt: '2026-03-02' }),
      pour('a_1', 'wall_1', { pourId: 'P1', segmentIndex: 1, pourAt: '2026-03-04' }),
    ])

    expect(sequence.gaps).toContain('monolithic-segmented')
    expect(sequence.pours.map((entry) => entry.id).sort()).toEqual(['a_0', 'a_1'])
  })

  test('a monolithic pour whose members straddle another states no order at all', () => {
    // The contradiction `CAST_ORDER_CYCLE` reports, seen from the programme side: P1 is cast at
    // 1–3 and wall_3 at 2, so P1 is both before and after it. Overlapping ranges are concurrent
    // rather than an edge in either direction.
    const sequence = sequenceOf([
      pour('a', 'wall_1', { pourId: 'P1', castOrder: 1, pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { pourId: 'P1', castOrder: 3, pourAt: '2026-03-02' }),
      pour('c', 'wall_3', { castOrder: 2, pourAt: '2026-03-09' }),
    ])

    expect(sequence.gaps).toContain('monolithic-cast-order-spread')
    expect(sequence.edges).toHaveLength(0)
  })

  test('nothing-sequenced is only reported where nothing orders anything', () => {
    // The passing half: one lift chain is an order, so a job with one is not unsequenced.
    const ordered = sequenceOf([
      pour('a_0', 'wall_1', { liftIndex: 0, pourAt: '2026-03-02' }),
      pour('a_1', 'wall_1', { liftIndex: 1, pourAt: '2026-03-10' }),
    ])
    const bare = sequenceOf([
      pour('a', 'wall_1', { pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { pourAt: '2026-03-09' }),
    ])

    expect(ordered.gaps).not.toContain('nothing-sequenced')
    expect(bare.gaps).toContain('nothing-sequenced')
  })

  test('a single pour is neither unsequenced nor concurrent with anything', () => {
    const sequence = sequenceOf([pour('a', 'wall_1', { pourAt: '2026-03-02' })])

    expect(sequence.gaps).not.toContain('nothing-sequenced')
    expect(sequence.unsequenced).toHaveLength(0)
  })
})

describe('formworkSequence — float', () => {
  test('a pour between two stated neighbours can move within them, and no further', () => {
    // The figure the whole module exists for. wall_2 is cast after wall_1 and before wall_3, so
    // its window runs from wall_1's pour date to wall_3's — 14 days of allowance for a pour
    // sitting in the middle of them.
    const sequence = sequenceOf([
      pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-09' }),
      pour('c', 'wall_3', { castOrder: 3, pourAt: '2026-03-16' }),
    ])
    const middle = sequence.pours.find((entry) => entry.id === 'b')

    expect(middle?.earliestPourAt).toBe('2026-03-02')
    expect(middle?.latestPourAt).toBe('2026-03-16')
    expect(middle?.totalFloat).toBe(14)
    expect(middle?.moveEarlierDays).toBe(7)
    expect(middle?.moveLaterDays).toBe(7)
  })

  test('the neighbour bounds the move, not the programme’s own end', () => {
    // The test that separates the two bounds. A pour far in the future stretches the window to
    // June, so a `latestPourAt` of the programme's end would be a move past the pour that waits
    // on this one. Without the successor edge in the arithmetic this reads as three months of
    // float instead of one week.
    const sequence = sequenceOf([
      pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-09' }),
      pour('c', 'wall_3', { castOrder: 3, pourAt: '2026-03-16' }),
      pour('far', 'wall_9', { pourAt: '2026-06-01' }),
    ])
    const middle = sequence.pours.find((entry) => entry.id === 'b')

    expect(sequence.windowTo).toBe('2026-06-04')
    expect(middle?.latestPourAt).toBe('2026-03-16')
    expect(middle?.moveLaterDays).toBe(7)
    // And the unsequenced pour does get the whole span, which is the contrast.
    expect(sequence.pours.find((entry) => entry.id === 'far')?.moveEarlierDays).toBeGreaterThan(80)
  })

  test('a lift waits for the strike below rather than for the pour below', () => {
    // The difference between the two reasons, and it is days: a cast order waits on concrete
    // going in and a lift waits on the form coming off. A 5-day period puts lift 2's earliest at
    // the 7th, not the 2nd.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { liftIndex: 0, pourAt: '2026-03-02', strikeDays: 5 }),
      pour('a_1', 'wall_1', { liftIndex: 1, pourAt: '2026-03-20', strikeDays: 5 }),
    ])
    const upper = sequence.pours.find((entry) => entry.id === 'a_1')

    expect(upper?.earliestPourAt).toBe('2026-03-07')
    expect(upper?.predecessors).toEqual(['a_0'])
  })

  test('a move carries its own delivery with it, so float stops at the programme start', () => {
    // Without the lead in the arithmetic the window would allow a pour whose plant arrives four
    // days before the job's own first day.
    const sequence = sequenceOf(
      [
        pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-02' }),
        pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-30' }),
      ],
      { erectionLeadDays: 4 },
    )
    const first = sequence.pours.find((entry) => entry.id === 'a')

    // The programme's first day is a's own delivery, so a cannot come forward at all.
    expect(sequence.windowFrom).toBe('2026-02-26')
    expect(first?.earliestPourAt).toBe('2026-03-02')
    expect(first?.moveEarlierDays).toBe(0)
  })

  test('a pour dated before the lift under it is struck is a conflict, with negative float', () => {
    // The programme breaking its own precedence. Reported as the days it is infeasible by rather
    // than clamped to zero, because a zero reads as a tight programme rather than a wrong one.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { liftIndex: 0, pourAt: '2026-03-10', strikeDays: 5 }),
      pour('a_1', 'wall_1', { liftIndex: 1, pourAt: '2026-03-12', strikeDays: 5 }),
    ])

    expect(sequence.conflicts).toHaveLength(1)
    expect(sequence.conflicts[0]).toMatchObject({ shortfallDays: 3 })
    expect(sequence.conflicts[0]?.message).toContain('before')
    expect(sequence.pours.find((entry) => entry.id === 'a_1')?.totalFloat).toBeLessThan(0)
  })

  test('a feasible programme raises no conflict', () => {
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { liftIndex: 0, pourAt: '2026-03-02', strikeDays: 5 }),
      pour('a_1', 'wall_1', { liftIndex: 1, pourAt: '2026-03-09', strikeDays: 5 }),
    ])

    expect(sequence.conflicts).toHaveLength(0)
    expect(sequence.pours.every((entry) => (entry.totalFloat ?? 0) >= 0)).toBe(true)
  })

  test('a pour pinned by both neighbours is pinned, and a loose one is not', () => {
    const sequence = sequenceOf([
      pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-09' }),
      pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-09' }),
      pour('c', 'wall_3', { castOrder: 3, pourAt: '2026-03-09' }),
    ])

    // b's window is a's date to c's date, and all three are the same day.
    expect(sequence.pinned.map((entry) => entry.id)).toContain('b')
    expect(sequence.pours.find((entry) => entry.id === 'b')?.totalFloat).toBe(0)
  })

  test('an undated pour has no float, and its successor is told a neighbour is undated', () => {
    const sequence = sequenceOf([
      pour('a', 'wall_1', { castOrder: 1 }),
      pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-09' }),
    ])
    const undated = sequence.pours.find((entry) => entry.id === 'a')
    const successor = sequence.pours.find((entry) => entry.id === 'b')

    expect(undated?.totalFloat).toBeUndefined()
    expect(undated?.gaps).toContain('no-pour-date')
    expect(successor?.gaps).toContain('neighbour-undated')
  })

  test('a lift below that is never struck leaves the lift above with no earliest date from it', () => {
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { liftIndex: 0, pourAt: '2026-03-02', strikeDays: 0 }),
      pour('a_1', 'wall_1', { liftIndex: 1, pourAt: '2026-03-20', strikeDays: 3 }),
    ])
    const upper = sequence.pours.find((entry) => entry.id === 'a_1')

    expect(upper?.gaps).toContain('predecessor-never-struck')
    // Bounded by the programme's own span rather than by the lift, which is the honest floor.
    expect(upper?.earliestPourAt).toBe(sequence.windowFrom)
  })

  test('an unsequenced pour floats across the programme, and that is reported as a gap', () => {
    // The answer this module must not give silently. The float is the span, and `unsequenced` is
    // what stops a reader spending it.
    const sequence = sequenceOf([
      pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-09' }),
      pour('loose', 'wall_9', { pourAt: '2026-03-05' }),
    ])
    const loose = sequence.pours.find((entry) => entry.id === 'loose')

    expect(loose?.gaps).toContain('unsequenced')
    expect(sequence.unsequenced.map((entry) => entry.id)).toEqual(['loose'])
    expect((loose?.totalFloat ?? 0) > 0).toBe(true)
  })

  test('members of one monolithic pour with different dates is a contradiction, tightest reading used', () => {
    const sequence = sequenceOf([
      pour('a', 'wall_1', { pourId: 'P1', pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { pourId: 'P1', pourAt: '2026-03-09' }),
    ])

    expect(sequence.gaps).toContain('monolithic-dates-differ')
    expect(sequence.pours[0]?.pourAt).toBe('2026-03-02')
  })

  test('floatForPourId reaches a monolithic group through any of its members', () => {
    const sequence = sequenceOf([
      pour('a', 'wall_1', { pourId: 'P1', pourAt: '2026-03-02' }),
      pour('b', 'wall_2', { pourId: 'P1', pourAt: '2026-03-02' }),
    ])

    expect(floatForPourId(sequence, 'b')?.id).toBe('P1')
    expect(floatForPourId(sequence, 'nothing')).toBeUndefined()
  })
})

describe('formworkSequenceCaveats', () => {
  test('an unsequenced job is told its float is not an allowance', () => {
    const caveats = formworkSequenceCaveats(
      sequenceOf([
        pour('a', 'wall_1', { pourAt: '2026-03-02' }),
        pour('b', 'wall_2', { pourAt: '2026-03-09' }),
      ]),
    )

    expect(caveats.join(' ')).toContain('not an allowance')
  })

  test('a sequenced job is told this is not a critical path and float is not slack', () => {
    // The two claims a reader will otherwise make on this module's behalf.
    const caveats = formworkSequenceCaveats(
      sequenceOf([
        pour('a', 'wall_1', { castOrder: 1, pourAt: '2026-03-02' }),
        pour('b', 'wall_2', { castOrder: 2, pourAt: '2026-03-16' }),
      ]),
    )

    expect(caveats.join(' ')).toContain('not a critical path')
    expect(caveats.join(' ')).toContain('not slack a gang can spend')
  })

  test('a broken dependency is named with its worst offender', () => {
    const caveats = formworkSequenceCaveats(
      sequenceOf([
        pour('a_0', 'wall_1', { liftIndex: 0, pourAt: '2026-03-10', strikeDays: 5 }),
        pour('a_1', 'wall_1', { liftIndex: 1, pourAt: '2026-03-12', strikeDays: 5 }),
      ]),
    )

    expect(caveats.join(' ')).toContain('already broken by the programme')
    expect(caveats.join(' ')).toContain('negative float')
  })

  test('an empty scope has nothing to say', () => {
    expect(formworkSequenceCaveats(sequenceOf([]))).toEqual([])
  })
})

describe('formworkSequence — alternate bays', () => {
  test('adjacent bays are ordered so no two share an interval, odd bays first by default', () => {
    // The spec's own scenario: alternate-bay construction stated, three bays in one lift,
    // and the sequence orders bay 1 before bay 2 and bay 3 before bay 2 — bay 2 is the
    // infill pour between the two either side of it.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { segmentIndex: 0, alternateBays: true, pourAt: '2026-03-02' }),
      pour('a_1', 'wall_1', { segmentIndex: 1, alternateBays: true, pourAt: '2026-03-16' }),
      pour('a_2', 'wall_1', { segmentIndex: 2, alternateBays: true, pourAt: '2026-03-04' }),
    ])

    const bayEdges = sequence.edges.filter((edge) => edge.reason === 'alternate-bay')
    expect(bayEdges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual([
      'a_0->a_1',
      'a_2->a_1',
    ])
    expect(sequence.alternateBays).toEqual([
      { elementId: 'wall_1', parity: 'odd-bays-first', fromDates: true },
    ])
  })

  test('the parity is reported when nothing is dated and the default practice applies', () => {
    // Undated bays still get their order — the edges exist without dates — and the plan
    // says the parity is the default rather than read off the programme.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { segmentIndex: 0, alternateBays: true, pourAt: '2026-03-02' }),
      pour('a_1', 'wall_1', { segmentIndex: 1, alternateBays: true, pourAt: '2026-03-16' }),
      pour('a_2', 'wall_1', { segmentIndex: 2, alternateBays: true, pourAt: '2026-03-04' }),
      pour('b_0', 'wall_2', { segmentIndex: 0, alternateBays: true, pourAt: '2026-03-02' }),
      pour('b_1', 'wall_2', { segmentIndex: 1, alternateBays: true, pourAt: '2026-03-02' }),
    ])

    const wall2 = sequence.alternateBays?.find((plan) => plan.elementId === 'wall_2')
    expect(wall2).toMatchObject({ parity: 'odd-bays-first', fromDates: false })
    const caveats = formworkSequenceCaveats(sequence)
    expect(caveats.join(' ')).toContain('wall_2 is cast in alternate bays')
    expect(caveats.join(' ')).toContain('odd-numbered bays first')
    expect(caveats.join(' ')).toContain('default practice')
  })

  test('the stated dates decide the parity when they run the other way', () => {
    // Bay 2 dated before bays 1 and 3: the programme has even bays first, and the plan
    // reports that parity rather than the default.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { segmentIndex: 0, alternateBays: true, pourAt: '2026-03-10' }),
      pour('a_1', 'wall_1', { segmentIndex: 1, alternateBays: true, pourAt: '2026-03-02' }),
      pour('a_2', 'wall_1', { segmentIndex: 2, alternateBays: true, pourAt: '2026-03-12' }),
    ])

    expect(sequence.alternateBays).toEqual([
      { elementId: 'wall_1', parity: 'even-bays-first', fromDates: true },
    ])
    const bayEdges = sequence.edges.filter((edge) => edge.reason === 'alternate-bay')
    expect(bayEdges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual([
      'a_1->a_0',
      'a_1->a_2',
    ])
  })

  test('a programme that pours the later bay first is a conflict, not a re-parity', () => {
    // The dates decide the parity, and then contradict it on the other pair: bay 2 is
    // dated before bay 1, so bay 2 goes first, but bay 3 is dated before bay 2 as well —
    // an odd bay before an even one, which no parity admits. That pair is a conflict.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { segmentIndex: 0, alternateBays: true, pourAt: '2026-03-10' }),
      pour('a_1', 'wall_1', { segmentIndex: 1, alternateBays: true, pourAt: '2026-03-08' }),
      pour('a_2', 'wall_1', { segmentIndex: 2, alternateBays: true, pourAt: '2026-03-06' }),
    ])

    expect(sequence.alternateBays?.[0]?.parity).toBe('even-bays-first')
    const bayConflicts = sequence.conflicts.filter(
      (conflict) => conflict.edge.reason === 'alternate-bay',
    )
    expect(bayConflicts).toHaveLength(1)
    expect(bayConflicts[0]?.message).toContain('alternate-bay construction')
  })

  test('an element that does not state it is untouched', () => {
    // The unchanged-figure half of the contract: no flag, no edges, no plan — the same
    // sequence an unconfigured project gets today.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { segmentIndex: 0, pourAt: '2026-03-02' }),
      pour('a_1', 'wall_1', { segmentIndex: 1, pourAt: '2026-03-04' }),
      pour('b_0', 'wall_2', { segmentIndex: 0, alternateBays: true, pourAt: '2026-03-02' }),
      pour('b_1', 'wall_2', { segmentIndex: 1, alternateBays: true, pourAt: '2026-03-16' }),
    ])

    expect(sequence.alternateBays?.map((plan) => plan.elementId)).toEqual(['wall_2'])
    expect(
      sequence.edges.filter((edge) => edge.reason === 'alternate-bay' && edge.to === 'a_1'),
    ).toEqual([])
  })

  test('a one-bay element states nothing to order', () => {
    // One bay has no adjacent bay, so the statement produces no plan — reporting a parity
    // for it would be claiming an order that does not exist.
    const sequence = sequenceOf([
      pour('a_0', 'wall_1', { segmentIndex: 0, alternateBays: true, pourAt: '2026-03-02' }),
      pour('b_0', 'wall_2', { segmentIndex: 0, pourAt: '2026-03-04' }),
    ])

    expect(sequence.alternateBays).toBeUndefined()
    expect(sequence.edges).toHaveLength(0)
  })
})
