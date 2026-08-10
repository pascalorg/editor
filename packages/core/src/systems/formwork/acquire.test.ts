import { describe, expect, test } from 'bun:test'
import { acquireCaveats, formworkAcquisition } from './acquire'
import type { RateTable } from './cost'
import type { StrikeTarget, StrikingStandardId, StrikingTime } from './design/striking'
import { strikingTime } from './design/striking'
import { calendarDayNumber, formworkSchedule, type SchedulablePour } from './schedule'
import { type FormworkSetCount, formworkSetCount, type PourQuantities } from './sets'

/**
 * What to acquire, and whether to buy it.
 *
 * `sets.test.ts` owns the sweep, so nothing here re-derives a peak. What is left to get
 * wrong is the two claims this module adds. The first is a subtraction with a trap in it: a
 * shortfall against the *peak* rather than against the bill, which is the difference between
 * hiring nothing and hiring three hundred panels on a sequential job. The second is a
 * recommendation, which is the first figure in this whole feature that tells somebody what
 * to do rather than what they have — so the tests are keyed on the economics moving the
 * verdict, not on the fields existing.
 */

function period(target: StrikeTarget, standard: StrikingStandardId = 'BS_8110'): StrikingTime {
  return strikingTime(standard, { target, temperatureC: 16 })
}

function scheduleOf(pours: readonly SchedulablePour[]) {
  return formworkSchedule(pours, { erectionLeadDays: 1, returnLeadDays: 1 })
}

function pour(id: string, pourAt: string, targets: StrikeTarget[] = ['vertical-form']) {
  return { id, pourAt, striking: targets.map((target) => period(target)) }
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

/**
 * `count` pours a fortnight apart, each needing 100 panels.
 *
 * A fortnight because vertical forms strike the next day: the pours cannot overlap however
 * the leads are set, so the peak is one pour's worth and the reuse factor is the pour count.
 * That makes the reuse factor the *only* thing varying between the buy and hire cases below.
 */
function sequential(count: number): FormworkSetCount {
  const first = calendarDayNumber('2026-03-02') as number
  const dates = Array.from({ length: count }, (_, index) =>
    new Date((first + index * 14) * 86_400_000).toISOString().slice(0, 10),
  )
  const schedule = scheduleOf(dates.map((date, index) => pour(`p${index}`, date)))
  const solved = formworkSetCount(
    schedule,
    dates.map((_, index) => panels(`p${index}`, 100)),
  )
  if (solved === undefined) throw new Error('fixture produced no count')
  return solved
}

/** £210 list, 3 %/month hire — the band the trade actually quotes in. */
const RATES: RateTable = {
  currency: 'GBP',
  byCatalogId: { PANEL_1200: { purchasePerUnit: 210, rentalPercentPerMonth: 3 } },
}

describe('formworkAcquisition — the shortfall is against the peak, not the bill', () => {
  test('a yard owning its peak has nothing to acquire, however large the bill', () => {
    // Four pours of 100 panels is a 400-panel bill. The supply split would report 300 on
    // hire against a rack of 100; the peak is 100 and the honest answer is that the yard
    // buys nothing at all. This is the module's whole reason for existing.
    const count = sequential(4)
    expect(count.peaks[0]?.totalFitted).toBe(400)

    const acquisition = formworkAcquisition(count, { PANEL_1200: 100 }, RATES)

    expect(acquisition.shortfallQuantity).toBe(0)
    expect(acquisition.shortfalls).toEqual([])
    expect(acquisition.lines[0]?.peakQuantity).toBe(100)
    // No verdict against a purchase nobody is making.
    expect(acquisition.lines[0]?.verdict).toBeUndefined()
    expect(acquisition.complete).toBe(true)
  })

  test('an empty rack is short the peak, and only the peak', () => {
    const acquisition = formworkAcquisition(sequential(4), {}, RATES)

    expect(acquisition.shortfallQuantity).toBe(100)
    expect(acquisition.shortfalls[0]?.ownedQuantity).toBe(0)
  })

  test('a partly stocked rack is short the difference', () => {
    const acquisition = formworkAcquisition(sequential(4), { PANEL_1200: 60 }, RATES)

    expect(acquisition.shortfalls[0]?.shortfall).toBe(40)
    expect(acquisition.shortfalls[0]?.surplus).toBe(0)
    expect(acquisition.purchaseCost).toBe(40 * 210)
  })

  test('stock beyond the peak is a surplus, never a negative shortfall', () => {
    const acquisition = formworkAcquisition(sequential(2), { PANEL_1200: 250 }, RATES)

    expect(acquisition.shortfalls).toEqual([])
    expect(acquisition.surpluses[0]?.surplus).toBe(150)
    expect(acquisition.lines[0]?.shortfall).toBe(0)
  })

  test('an id the yard has never heard of counts as none owned, not as absent stock', () => {
    // The caller decides whether the project has stated a rack at all. Reaching this
    // function, an unlisted id is a real zero.
    const acquisition = formworkAcquisition(sequential(2), { SOMETHING_ELSE: 500 }, RATES)

    expect(acquisition.shortfalls[0]?.catalogId).toBe('PANEL_1200')
    expect(acquisition.shortfalls[0]?.shortfall).toBe(100)
  })
})

describe('formworkAcquisition — buy or hire, on the job’s own figures', () => {
  test('hiring wins on one job at a trade hire rate, however many times the set is reused', () => {
    // The assertion that earns its place, because it contradicts the trade's own rule of
    // thumb. "Buy it if you use it more than five times" is about uses, and uses do not
    // enter this: hire is per unit per month, so eight pours inside one span cost the same
    // to hire as one. At 3 %/month a purchase needs some 33 months of holding to pay back,
    // and no single job holds a set that long — so both verdicts are 'hire'.
    const many = formworkAcquisition(sequential(8), {}, RATES)
    const once = formworkAcquisition(sequential(1), {}, RATES)

    expect(many.shortfalls[0]?.reuseFactor).toBe(8)
    expect(once.shortfalls[0]?.reuseFactor).toBe(1)
    expect(many.shortfalls[0]?.verdict).toBe('hire')
    expect(once.shortfalls[0]?.verdict).toBe('hire')

    // What does move is the span, and it moves the payback rather than the verdict: eight
    // pours hold the set longer, so the purchase is closer to paying for itself.
    expect(many.shortfalls[0]?.hireCost).toBeGreaterThan(once.shortfalls[0]?.hireCost ?? 0)
    expect(many.shortfalls[0]?.paybackJobs).toBeLessThan(
      once.shortfalls[0]?.paybackJobs ?? Infinity,
    )
    // Same list price both ways — a purchase does not get dearer because the job is longer.
    expect(many.shortfalls[0]?.purchaseCost).toBe(once.shortfalls[0]?.purchaseCost)
  })

  test('a long enough span buys outright, and the payback is what says so', () => {
    // Twenty-six fortnightly pours is a year on site. Held that long at 3 %/month the hire
    // is a third of the list price, which is still a hire — the payback is what shows how
    // far off it is, and it is the figure a yard settles against its order book.
    const year = formworkAcquisition(sequential(26), {}, RATES).shortfalls[0]
    expect(year?.committedDays).toBeGreaterThan(350)
    expect(year?.paybackJobs).toBeLessThan(3)
    expect(year?.verdict).toBe('hire')

    // A punitive minimum period is the other way to reach the list price, and it is the
    // realistic one: a set wanted for three days against a five-year minimum is a purchase.
    const punitive = formworkAcquisition(sequential(1), {}, { ...RATES, minHireDays: 2000 })
      .shortfalls[0]
    expect(punitive?.verdict).toBe('buy')
    expect(punitive?.paybackJobs).toBeLessThan(1)
  })

  test('a minimum hire period moves the payback rather than rounding it', () => {
    // A single pour is committed about three days. Against a 28-day minimum it is charged
    // for 28, and on a fast cycle that is most of the cost of hiring at all.
    const count = sequential(1)
    expect(count.peaks[0]?.committedDays).toBeLessThan(10)

    const short = formworkAcquisition(count, {}, RATES).shortfalls[0]
    const withMinimum = formworkAcquisition(count, {}, { ...RATES, minHireDays: 28 }).shortfalls[0]

    expect(withMinimum?.hireCost).toBeGreaterThan(short?.hireCost ?? 0)
    expect(withMinimum?.paybackJobs).toBeLessThan(short?.paybackJobs ?? Infinity)
  })

  test('a flat hire quote beats the percentage, matching bomCost', () => {
    const flat = formworkAcquisition(
      sequential(4),
      {},
      {
        byCatalogId: {
          PANEL_1200: { purchasePerUnit: 210, rentalPercentPerMonth: 3, rentalPerUnitPerMonth: 1 },
        },
      },
    ).shortfalls[0]
    const percentage = formworkAcquisition(sequential(4), {}, RATES).shortfalls[0]

    expect(flat?.hireCost).toBeLessThan(percentage?.hireCost ?? 0)
    expect(flat?.verdict).toBe('hire')
    expect(flat?.paybackJobs).toBeGreaterThan(percentage?.paybackJobs ?? 0)
  })

  test('the committed span is the whole programme, not the sum of the strike periods', () => {
    // Five pours a fortnight apart hold the set two days each. The yard invoices the nine
    // weeks it is on site, and a hire priced off the ten days is out by a factor of six.
    const count = sequential(5)
    const line = formworkAcquisition(count, {}, RATES).shortfalls[0]

    expect(line?.committedDays).toBeGreaterThan(55)
    // Two days per fitting over a nine-week span is a set that is idle most of the time.
    expect(line?.utilisation).toBeLessThan(0.3)
  })
})

describe('formworkAcquisition — what it will not say', () => {
  test('no rates means a shortfall with no recommendation, rather than a defaulted one', () => {
    const acquisition = formworkAcquisition(sequential(4), {}, undefined)

    expect(acquisition.shortfalls[0]?.shortfall).toBe(100)
    expect(acquisition.shortfalls[0]?.verdict).toBeUndefined()
    expect(acquisition.shortfalls[0]?.hireCost).toBeUndefined()
    expect(acquisition.currency).toBeUndefined()
    // Absent rates are the caller's decision, not a gap in the table.
    expect(acquisition.complete).toBe(true)
  })

  test('a rate table with no entry for the part is a gap, and both totals become floors', () => {
    const acquisition = formworkAcquisition(sequential(4), {}, { byCatalogId: {} })

    expect(acquisition.gaps).toEqual(['no-rate'])
    expect(acquisition.complete).toBe(false)
    expect(acquisition.shortfalls[0]?.verdict).toBeUndefined()
  })

  test('a list price with no hire rate cannot be compared either way', () => {
    const acquisition = formworkAcquisition(
      sequential(4),
      {},
      {
        byCatalogId: { PANEL_1200: { purchasePerUnit: 210 } },
      },
    )

    expect(acquisition.gaps).toEqual(['no-rental-rate'])
    expect(acquisition.shortfalls[0]?.purchaseCost).toBe(40 * 210 + 60 * 210)
    expect(acquisition.shortfalls[0]?.hireCost).toBeUndefined()
    expect(acquisition.shortfalls[0]?.verdict).toBeUndefined()
  })

  test('a hire rate with no list price cannot be compared either', () => {
    const acquisition = formworkAcquisition(
      sequential(4),
      {},
      {
        byCatalogId: { PANEL_1200: { rentalPerUnitPerMonth: 6 } },
      },
    )

    expect(acquisition.gaps).toEqual(['no-purchase-price'])
    expect(acquisition.shortfalls[0]?.hireCost).toBeGreaterThan(0)
    expect(acquisition.shortfalls[0]?.verdict).toBeUndefined()
  })

  test('two courses within a tenth of each other are marginal rather than called', () => {
    // Priced so the hire over the span lands on the list price — which takes a rate an order
    // of magnitude above the trade's, and that is the point of the test rather than a flaw in
    // it. A model that called this either way would report arithmetic noise as a decision.
    const count = sequential(4)
    const days = count.peaks[0]?.committedDays ?? 0
    const monthly = (210 * 30) / days

    const acquisition = formworkAcquisition(
      count,
      {},
      {
        byCatalogId: { PANEL_1200: { purchasePerUnit: 210, rentalPerUnitPerMonth: monthly } },
      },
    )

    expect(acquisition.shortfalls[0]?.verdict).toBe('marginal')
  })
})

describe('acquireCaveats', () => {
  test('the bill-is-not-the-list caveat is printed always, because it is the likeliest misread', () => {
    const caveats = acquireCaveats(formworkAcquisition(sequential(4), { PANEL_1200: 100 }, RATES))

    expect(caveats[0]).toContain('not the bill over what the yard owns')
    expect(caveats.some((line) => line.includes('Nothing is short'))).toBe(true)
  })

  test('a recommendation always brings the omission that would change it', () => {
    const caveats = acquireCaveats(formworkAcquisition(sequential(8), {}, RATES))

    expect(caveats.some((line) => line.includes('no resale value'))).toBe(true)
    // The verdict is 'hire' on almost any single job, so the caveat has to say why rather
    // than letting a reader take it as an argument against ever owning formwork.
    expect(caveats.some((line) => line.includes('Read the payback rather than the verdict'))).toBe(
      true,
    )
  })

  test('a surplus is not offered as a saving', () => {
    const caveats = acquireCaveats(formworkAcquisition(sequential(2), { PANEL_1200: 250 }, RATES))

    expect(caveats.some((line) => line.includes('rather than a saving'))).toBe(true)
  })

  test('an idle set is named as a programme with gaps rather than a design fault', () => {
    const caveats = acquireCaveats(formworkAcquisition(sequential(5), {}, RATES))

    expect(caveats.some((line) => line.includes('standing idle'))).toBe(true)
  })

  test('an empty acquisition says nothing at all', () => {
    const empty = formworkAcquisition(
      {
        peaks: [],
        kinds: [],
        peakConcurrentPours: 0,
        countedPours: 0,
        totalPours: 0,
        coverage: 0,
        gaps: [],
      },
      {},
      RATES,
    )

    expect(acquireCaveats(empty)).toEqual([])
  })
})
