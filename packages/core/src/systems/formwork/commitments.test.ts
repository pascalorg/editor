import { describe, expect, test } from 'bun:test'
import {
  type CommittablePour,
  committedPourIds,
  formworkCommitmentCaveats,
  formworkCommitments,
} from './commitments'
import type { StrikeTarget, StrikingStandardId, StrikingTime } from './design/striking'
import { strikingTime } from './design/striking'
import { formworkSchedule, type SchedulablePour } from './schedule'
import type { PourQuantities } from './sets'

/**
 * What is spoken for, over the pours somebody has actually agreed to.
 *
 * `sets.test.ts` owns the sweep and `schedule.test.ts` the dates, so nothing here
 * re-derives either. What is left to get wrong is the restriction and the drift: a window
 * over every pour rather than the committed ones reads as a booking nobody made, and a
 * committed pour whose date has since moved is invisible in every other output this feature
 * produces — the programme prints the new day and the hire company holds the old one.
 */

function period(target: StrikeTarget, standard: StrikingStandardId = 'BS_8110'): StrikingTime {
  return strikingTime(standard, { target, temperatureC: 16 })
}

function scheduleOf(pours: readonly SchedulablePour[]) {
  return formworkSchedule(pours, { erectionLeadDays: 1, returnLeadDays: 1 })
}

function pour(id: string, pourAt: string | undefined, targets: StrikeTarget[]): SchedulablePour {
  return {
    id,
    ...(pourAt === undefined ? {} : { pourAt }),
    striking: targets.map((target) => period(target)),
  }
}

function panels(id: string, quantity: number, catalogId = 'PANEL_1200'): PourQuantities {
  return {
    id,
    quantities: [
      {
        catalogId,
        kind: 'panel',
        description: '1200 mm panel',
        quantity,
        target: 'vertical-form',
      },
    ],
  }
}

function committable(
  id: string,
  pourAt: string | undefined,
  committedPourAt?: string,
): CommittablePour {
  return {
    id,
    ...(pourAt === undefined ? {} : { pourAt }),
    ...(committedPourAt === undefined ? {} : { committedPourAt }),
  }
}

describe('formworkCommitments — a window is a claim about a plan', () => {
  test('a programme nobody has committed to has no windows at all', () => {
    // The refusal the module is built around, and the same one `sets.ts` makes: an empty
    // windows list and a job with no bookings read identically on a panel, and only one of
    // them is a state somebody should act on.
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-04', ['vertical-form']),
    ])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100), panels('b', 100)],
      [committable('a', '2026-03-02'), committable('b', '2026-03-04')],
    )

    expect(commitments).toBeUndefined()
  })

  test('the window covers the committed pours only, and is smaller than the job needs', () => {
    // The whole point of the restriction. Two pours overlap and hold 100 each, so the job
    // needs 200 — but only one is booked, so 100 is what anybody has promised.
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-02', ['vertical-form']),
    ])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100), panels('b', 100)],
      [committable('a', '2026-03-02', '2026-03-02'), committable('b', '2026-03-02')],
    )

    expect(commitments?.windows[0]?.committedQuantity).toBe(100)
    expect(commitments?.windows[0]?.pourIds).toEqual(['a'])
    expect(commitments?.committedPours).toBe(1)
    expect(commitments?.totalPours).toBe(2)
    expect(commitments?.gaps).toContain('partly-committed')
  })

  test('two committed pours on one day are spoken for together', () => {
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-02', ['vertical-form']),
    ])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100), panels('b', 60)],
      [committable('a', '2026-03-02', '2026-03-02'), committable('b', '2026-03-02', '2026-03-02')],
    )

    expect(commitments?.windows[0]?.committedQuantity).toBe(160)
    expect(commitments?.windows[0]?.pourIds).toEqual(['a', 'b'])
    expect(commitments?.gaps).not.toContain('partly-committed')
  })

  test('sequential committed pours share a set, so the window is one pour’s worth over the span', () => {
    // The same reuse the set count reports, and the reason a window carries days as well as
    // a quantity: 100 panels spoken for over five weeks is a different booking from 200.
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-04-02', ['vertical-form']),
    ])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100), panels('b', 100)],
      [committable('a', '2026-03-02', '2026-03-02'), committable('b', '2026-04-02', '2026-04-02')],
    )

    expect(commitments?.windows[0]?.committedQuantity).toBe(100)
    expect(commitments?.windows[0]?.from).toBe('2026-03-01')
    expect(commitments?.windows[0]?.days).toBeGreaterThan(30)
  })

  test('a kind’s committed rack sums its catalog ids rather than sweeping them as one pool', () => {
    const schedule = scheduleOf([pour('a', '2026-03-02', ['vertical-form'])])
    const quantities: PourQuantities[] = [
      {
        id: 'a',
        quantities: [
          ...panels('a', 100, 'PANEL_1200').quantities,
          ...panels('a', 40, 'PANEL_600').quantities,
        ],
      },
    ]

    const commitments = formworkCommitments(schedule, quantities, [
      committable('a', '2026-03-02', '2026-03-02'),
    ])

    expect(commitments?.kinds[0]?.committedQuantity).toBe(140)
    expect(commitments?.windows.map((window) => window.catalogId)).toEqual([
      'PANEL_1200',
      'PANEL_600',
    ])
  })
})

describe('formworkCommitments — the drift is the answer', () => {
  test('a pour moved later than its booking reports both days and a positive drift', () => {
    const schedule = scheduleOf([pour('a', '2026-03-10', ['vertical-form'])])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100)],
      [committable('a', '2026-03-10', '2026-03-02')],
    )

    expect(commitments?.drifts).toHaveLength(1)
    expect(commitments?.drifts[0]?.committedAt).toBe('2026-03-02')
    expect(commitments?.drifts[0]?.pourAt).toBe('2026-03-10')
    expect(commitments?.drifts[0]?.driftDays).toBe(8)
    expect(commitments?.gaps).toContain('drifted-off-booking')
  })

  test('a pour moved earlier drifts negative, because it is a different problem', () => {
    // Later means a set stands idle at the booked rate. Earlier means the pour is due before
    // the plant is, which stops the job — so an absolute figure would merge two answers.
    const schedule = scheduleOf([pour('a', '2026-02-26', ['vertical-form'])])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100)],
      [committable('a', '2026-02-26', '2026-03-02')],
    )

    expect(commitments?.drifts[0]?.driftDays).toBe(-4)
  })

  test('a commitment whose date was cleared is its own gap, with no drift days', () => {
    // There is no new day to negotiate towards: the pour is unprogrammed and the plant is
    // still reserved, which is not the same conversation as "it moved to the 10th".
    const schedule = scheduleOf([pour('a', undefined, ['vertical-form'])])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100)],
      [committable('a', undefined, '2026-03-02')],
    )

    expect(commitments?.gaps).toContain('committed-without-date')
    expect(commitments?.drifts[0]?.pourAt).toBeUndefined()
    expect(commitments?.drifts[0]?.driftDays).toBeUndefined()
    // No date, so no interval and nothing to sweep — but the commitment is still reported.
    expect(commitments?.windows).toHaveLength(0)
  })

  test('the window is swept over where the pour now is, not where it was booked', () => {
    // The only defensible reading once the two disagree: the plant is wanted when the pour
    // happens, and the booking is a promise about a day that has moved. The drift is what
    // says the promise needs renegotiating.
    const schedule = scheduleOf([pour('a', '2026-06-10', ['vertical-form'])])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100)],
      [committable('a', '2026-06-10', '2026-03-02')],
    )

    expect(commitments?.windows[0]?.from).toBe('2026-06-09')
    expect(commitments?.windows[0]?.to.startsWith('2026-06')).toBe(true)
  })

  test('a pour committed to the day it is dated raises no drift', () => {
    const schedule = scheduleOf([pour('a', '2026-03-02', ['vertical-form'])])

    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100)],
      [committable('a', '2026-03-02', '2026-03-02')],
    )

    expect(commitments?.drifts).toHaveLength(0)
    expect(commitments?.gaps).not.toContain('drifted-off-booking')
  })
})

describe('committedPourIds', () => {
  test('names the booked pours and nothing else', () => {
    const ids = committedPourIds([
      committable('a', '2026-03-02', '2026-03-02'),
      committable('b', '2026-03-04'),
      committable('c', undefined, '2026-03-06'),
    ])

    expect([...ids].sort()).toEqual(['a', 'c'])
  })
})

describe('formworkCommitmentCaveats', () => {
  test('leads with the one wrong reading the figure invites', () => {
    // A committed quantity is smaller than the set count's peak on almost every job, and a
    // reader who takes it for the requirement under-orders by every uncommitted pour.
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-02', ['vertical-form']),
    ])
    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100), panels('b', 100)],
      [committable('a', '2026-03-02', '2026-03-02'), committable('b', '2026-03-02')],
    )

    const caveats = formworkCommitmentCaveats(commitments as never)

    expect(caveats[0]).toContain('not the quantities the job needs')
    expect(caveats.some((line) => line.includes('1 of 2 pours'))).toBe(true)
    expect(caveats.some((line) => line.includes('not that it cannot change'))).toBe(true)
  })

  test('names the drift in days and in a direction', () => {
    const schedule = scheduleOf([pour('a', '2026-03-10', ['vertical-form'])])
    const commitments = formworkCommitments(
      schedule,
      [panels('a', 100)],
      [committable('a', '2026-03-10', '2026-03-02')],
    )

    const caveats = formworkCommitmentCaveats(commitments as never)

    const drift = caveats.find((line) => line.includes('moved off the day'))
    expect(drift).toContain('8 days later')
    expect(drift).toContain('stands idle')
  })
})
