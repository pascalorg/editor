import { describe, expect, test } from 'bun:test'
import type { StrikeTarget, StrikingStandardId, StrikingTime } from './design/striking'
import { strikingTime } from './design/striking'
import { formworkSchedule, type SchedulablePour } from './schedule'
import {
  formworkSetCaveats,
  formworkSetCount,
  type PourQuantities,
  SET_COUNT_COVERAGE_THRESHOLD,
} from './sets'

/**
 * How many sets, from when the pours are.
 *
 * `schedule.test.ts` owns the dates and `hire.test.ts` the periods, so nothing here
 * re-derives either. What is left to get wrong is the sweep: two sequential pours counted
 * as two sets when the same one serves both, a prop's peak reported on a panel's day, and
 * — the one that costs money — a plausible small number returned for a programme that is
 * three pours out of forty.
 */

function period(target: StrikeTarget, standard: StrikingStandardId = 'BS_8110'): StrikingTime {
  return strikingTime(standard, { target, temperatureC: 16 })
}

/** A schedule built the way the project solve builds one, so the intervals are real. */
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

describe('formworkSetCount — reuse is the whole point', () => {
  test('two pours a month apart share one set, so the peak is one pour’s worth', () => {
    // Vertical forms strike the day after, released the day after that — so a March pour
    // and an April pour cannot overlap however the leads are set.
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-04-02', ['vertical-form']),
    ])

    const count = formworkSetCount(schedule, [panels('a', 100), panels('b', 100)])

    expect(count?.peaks[0]?.peakQuantity).toBe(100)
    // 200 fitted over a peak of 100 is two uses of each panel — the figure that decides
    // buying against hiring, and the reason the bill's 200 is not what anybody orders.
    expect(count?.peaks[0]?.totalFitted).toBe(200)
    expect(count?.peaks[0]?.reuseFactor).toBe(2)
    expect(count?.peakConcurrentPours).toBe(1)
  })

  test('two pours on the same day need both sets standing at once', () => {
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-02', ['vertical-form']),
    ])

    const count = formworkSetCount(schedule, [panels('a', 100), panels('b', 60)])

    expect(count?.peaks[0]?.peakQuantity).toBe(160)
    expect(count?.peaks[0]?.reuseFactor).toBe(1)
    expect(count?.peakConcurrentPours).toBe(2)
    expect(count?.peakConcurrentOn).toBe('2026-03-01')
    expect(count?.peaks[0]?.peakPourIds).toEqual(['a', 'b'])
  })

  test('a set is free from its release date, so the next pour may reuse it that day', () => {
    // a: erect 1 Mar, pour 2 Mar, strike 3 Mar, free 4 Mar. b erects 4 Mar — the same day,
    // so one set serves both. The interval ends the day *before* the release for exactly
    // this reason, and the caveat is what says a gang cannot really refit in a day.
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-05', ['vertical-form']),
    ])
    expect(schedule.pours[0]?.releaseAt).toBe('2026-03-04')
    expect(schedule.pours[1]?.erectAt).toBe('2026-03-04')

    const count = formworkSetCount(schedule, [panels('a', 100), panels('b', 100)])

    expect(count?.peaks[0]?.peakQuantity).toBe(100)
    expect(formworkSetCaveats(count as NonNullable<typeof count>).at(-1)).toContain(
      'strike, clean and refit the same day',
    )
  })
})

describe('formworkSetCount — per catalog id, because the intervals are different lengths', () => {
  test('a prop outlives the deck it holds, so one is reused where the other is not', () => {
    // The case the per-id sweep exists for. Under BS 8110 at 16 °C a slab soffit form is
    // 4 d and its props are 10 d, so pour a's deck is off and back on the rack before pour
    // b needs it, while a's props are still down when b's go in. Swept as one pool — or
    // with one interval per pour rather than per item — the deck would be counted as held
    // for the props' ten days and both would read as needing two sets.
    const slab = (id: string): PourQuantities => ({
      id,
      quantities: [
        {
          catalogId: 'DECK_1200',
          kind: 'panel',
          description: 'deck panel',
          quantity: 40,
          target: 'slab-soffit-form',
        },
        {
          catalogId: 'PROP_3M',
          kind: 'prop',
          description: '3 m prop',
          quantity: 30,
          target: 'slab-props',
        },
      ],
    })
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['slab-soffit-form', 'slab-props']),
      pour('b', '2026-03-09', ['slab-soffit-form', 'slab-props']),
    ])

    const count = formworkSetCount(schedule, [slab('a'), slab('b')])

    const props = count?.peaks.find((peak) => peak.catalogId === 'PROP_3M')
    const deck = count?.peaks.find((peak) => peak.catalogId === 'DECK_1200')
    expect(props?.peakQuantity).toBe(60)
    expect(props?.reuseFactor).toBe(1)
    expect(deck?.peakQuantity).toBe(40)
    expect(deck?.reuseFactor).toBe(2)
    // And the two peaks fall on different days, which is the thing a single sweep cannot
    // represent at all.
    expect(props?.peakOn).not.toBe(deck?.peakOn)
  })

  test('a kind’s rack is the sum of its ids’ peaks, not a sweep of the kind as one pool', () => {
    // Two panel types peaking a week apart. A 2.4 m panel does not cover for a 1.2 m one,
    // so the rack needs both peaks — sweeping the kind as a pool reports the larger alone.
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-16', ['vertical-form']),
    ])
    const quantities: PourQuantities[] = [
      {
        id: 'a',
        quantities: [{ catalogId: 'P1200', kind: 'panel', description: '1200', quantity: 80 }],
      },
      {
        id: 'b',
        quantities: [{ catalogId: 'P2400', kind: 'panel', description: '2400', quantity: 50 }],
      },
    ]

    const count = formworkSetCount(schedule, quantities)

    expect(count?.peaks.map((peak) => peak.peakQuantity)).toEqual([80, 50])
    expect(count?.kinds).toEqual([{ kind: 'panel', label: 'Panel', peakQuantity: 130 }])
  })

  test('the same id at two provenances is one number per pour, because a rack does not care', () => {
    const schedule = scheduleOf([pour('a', '2026-03-02', ['vertical-form'])])
    const quantities: PourQuantities[] = [
      {
        id: 'a',
        quantities: [
          { catalogId: 'P1200', kind: 'panel', description: '1200', quantity: 10 },
          { catalogId: 'P1200', kind: 'panel', description: '1200 (drilled)', quantity: 4 },
        ],
      },
    ]

    const count = formworkSetCount(schedule, quantities)

    expect(count?.peaks).toHaveLength(1)
    expect(count?.peaks[0]?.peakQuantity).toBe(14)
  })
})

describe('formworkSetCount — a partial programme cannot be counted', () => {
  test('below the coverage threshold there is no count at all, because a low one looks right', () => {
    // Three dated pours of forty. They barely overlap, so a sweep reports one set — and one
    // set is what a reader orders. This is the only gap in the feature whose wrong answer is
    // a plausible number rather than an absence, which is why it is a refusal.
    const pours = [
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-03', ['vertical-form']),
      pour('c', '2026-03-04', ['vertical-form']),
      ...Array.from({ length: 37 }, (_, index) => pour(`u${index}`, undefined, ['vertical-form'])),
    ]

    const count = formworkSetCount(
      scheduleOf(pours),
      pours.map((entry) => panels(entry.id, 100)),
    )

    expect(count).toBeUndefined()
  })

  test('above the threshold the count is reported, and named as a floor', () => {
    // 19 of 20 dated is 95 %, over the 90 % threshold. An undated pour cannot subtract from
    // an overlap, so the peak can only be this or higher.
    const pours = [
      ...Array.from({ length: 19 }, (_, index) =>
        pour(`d${index}`, `2026-03-${String(index + 2).padStart(2, '0')}`, ['vertical-form']),
      ),
      pour('undated', undefined, ['vertical-form']),
    ]

    const count = formworkSetCount(
      scheduleOf(pours),
      pours.map((entry) => panels(entry.id, 10)),
    )

    expect(count?.countedPours).toBe(19)
    expect(count?.totalPours).toBe(20)
    expect(count?.coverage).toBeGreaterThan(SET_COUNT_COVERAGE_THRESHOLD)
    expect(count?.gaps).toContain('partial-programme')
    expect(formworkSetCaveats(count as NonNullable<typeof count>)[0]).toContain('never lower')
  })

  test('a dated pour with nothing struck has no interval, and says so rather than vanishing', () => {
    const pours = [
      ...Array.from({ length: 19 }, (_, index) =>
        pour(`d${index}`, `2026-03-${String(index + 2).padStart(2, '0')}`, ['vertical-form']),
      ),
      // Dated, but nothing in the shutter is ever struck — ties left in a wall. There is no
      // release, so no interval, and the gap distinguishes it from an undated pour.
      pour('nostrike', '2026-03-25', []),
    ]

    const count = formworkSetCount(
      scheduleOf(pours),
      pours.map((entry) => panels(entry.id, 10)),
    )

    expect(count?.gaps).toContain('no-release-date')
    expect(count?.countedPours).toBe(19)
  })

  test('no pours at all is no count, not a count of zero', () => {
    expect(formworkSetCount(scheduleOf([]), [])).toBeUndefined()
  })
})

describe('formworkSetCount — what the numbers mean', () => {
  test('a peak reached on several days reports the earliest, because it is a procurement date', () => {
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-20', ['vertical-form']),
    ])

    const count = formworkSetCount(schedule, [panels('a', 50), panels('b', 50)])

    // Both pours reach 50 on their own erection days. The first is the answer: the reader is
    // asking when the stock has to be there.
    expect(count?.peaks[0]?.peakOn).toBe('2026-03-01')
  })

  test('nothing poolable is reported rather than counted as zero sets', () => {
    const schedule = scheduleOf([pour('a', '2026-03-02', ['vertical-form'])])

    const count = formworkSetCount(schedule, [{ id: 'a', quantities: [] }])

    expect(count?.peaks).toEqual([])
    expect(count?.gaps).toContain('nothing-poolable')
    expect(formworkSetCaveats(count as NonNullable<typeof count>)).toContain(
      'Nothing in scope has a catalog id, so there is no reusable stock to count sets of',
    )
  })

  test('a scope with no reuse says so, rather than leaving two identical numbers to be compared', () => {
    const schedule = scheduleOf([pour('a', '2026-03-02', ['vertical-form'])])

    const count = formworkSetCount(schedule, [panels('a', 100)])

    expect(count?.peaks[0]?.reuseFactor).toBe(1)
    expect(formworkSetCaveats(count as NonNullable<typeof count>).join(' ')).toContain(
      'these numbers are the bill rather than a set count',
    )
  })

  test('a set used five times is on the rack once and fitted five times over', () => {
    // The figure that decides owning against hiring. Five sequential pours a fortnight
    // apart: the bill says 500 panels and the yard needs 100.
    const pours = Array.from({ length: 5 }, (_, index) =>
      pour(`p${index}`, `2026-0${index + 3}-02`, ['vertical-form']),
    )

    const count = formworkSetCount(
      scheduleOf(pours),
      pours.map((entry) => panels(entry.id, 100)),
    )

    expect(count?.peaks[0]?.peakQuantity).toBe(100)
    expect(count?.peaks[0]?.totalFitted).toBe(500)
    expect(count?.peaks[0]?.reuseFactor).toBe(5)
    expect(count?.peakConcurrentPours).toBe(1)
    expect(count?.coverage).toBe(1)
  })

  test('an item with no strike target falls back to the pour’s own release', () => {
    // A tie is never struck, so it has no target of its own. It is spent on the pour rather
    // than returned, and the pour's last release is the only interval there is for it —
    // which is the honest answer, not a reason to leave it out of the sweep.
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['slab-soffit-form', 'slab-props']),
      pour('b', '2026-03-09', ['slab-soffit-form', 'slab-props']),
    ])
    const withTie = (id: string): PourQuantities => ({
      id,
      quantities: [{ catalogId: 'TIE_15', kind: 'tie', description: 'tie bar', quantity: 20 }],
    })

    const count = formworkSetCount(schedule, [withTie('a'), withTie('b')])

    // Held to the props' release, which is 10 d — so the two pours a week apart overlap.
    expect(count?.peaks[0]?.peakQuantity).toBe(40)
  })

  test('a pour holding none of an item is not in that item’s peak pours', () => {
    const schedule = scheduleOf([
      pour('a', '2026-03-02', ['vertical-form']),
      pour('b', '2026-03-02', ['vertical-form']),
    ])
    const quantities: PourQuantities[] = [
      panels('a', 100),
      {
        id: 'b',
        quantities: [{ catalogId: 'OTHER', kind: 'prop', description: 'prop', quantity: 5 }],
      },
    ]

    const count = formworkSetCount(schedule, quantities)

    const panelPeak = count?.peaks.find((peak) => peak.catalogId === 'PANEL_1200')
    expect(panelPeak?.peakPourIds).toEqual(['a'])
    // Both pours are concurrent even though they share no stock — the concurrency figure is
    // about gangs and the peaks are about racks.
    expect(count?.peakConcurrentPours).toBe(2)
  })
})
