import { describe, expect, it } from 'bun:test'
import { type BomCost, bomCost, bomCostCaveats, type RateTable } from './cost'
import type { BomHire, HireLine } from './hire'
import type { BomLine } from './parts'
import { bomSupply } from './supply'

/**
 * What the formwork costs to hold.
 *
 * The failure mode this guards is a money figure that reads as an answer and is not
 * one. Every other number in the takeoff is derived from a published code and can be
 * checked against it; a price can only be checked against the table the project
 * entered, so an unpriced line that totals as zero is indistinguishable from a line
 * that genuinely costs nothing — and it is the one number a reader quotes without
 * reading anything beside it.
 */

const line = (over: Partial<BomLine> = {}): BomLine => ({
  kind: 'panel',
  catalogId: 'framax-0.60x2.70',
  description: 'Framax Xlife panel 0.60 x 2.70 m',
  provenance: 'standard',
  quantity: 10,
  unit: 'no',
  totalWeightKg: 100,
  marks: ['P1'],
  ...over,
})

/** A hire result holding every line for the same period, which is the ordinary case. */
const heldFor = (lines: readonly BomLine[], hours: number | undefined): BomHire => {
  const hireLines: HireLine[] = lines.map((entry) =>
    hours === undefined ? { line: entry } : { line: entry, hours },
  )
  return {
    standard: 'BS_8110',
    basis: 'calendar',
    lines: hireLines,
    periods: [],
    longestHours: hours ?? 0,
    mixedLines: [],
    assumed: [],
    warnings: [],
    complete: hours !== undefined,
  }
}

const rates = (over: Partial<RateTable> = {}): RateTable => ({
  currency: 'GBP',
  byCatalogId: { 'framax-0.60x2.70': { purchasePerUnit: 200, rentalPercentPerMonth: 3 } },
  ...over,
})

describe('bomCost', () => {
  it('charges hire for the period held, on the hired quantity alone', () => {
    // 10 panels, 4 owned, so 6 on hire. £200 at 3 %/month is £6/month, held 15 days:
    // 6 × £6 × 0.5 = £18. The owned 4 are not in it.
    const bom = [line({ quantity: 10 })]
    const supply = bomSupply(bom, { 'framax-0.60x2.70': 4 })

    const cost = bomCost(bom, rates(), heldFor(bom, 15 * 24), supply)

    expect(cost.hireCost).toBeCloseTo(18, 6)
    expect(cost.lines[0]?.chargedDays).toBeCloseTo(15, 6)
  })

  it('prefers a stated flat rate over a percentage of new value', () => {
    // A quote beats a rule of thumb: £6/month is what the percentage would give and
    // £11 is what a desk actually said, so the desk wins.
    const bom = [line({ quantity: 1 })]

    const cost = bomCost(
      bom,
      rates({
        byCatalogId: {
          'framax-0.60x2.70': {
            purchasePerUnit: 200,
            rentalPercentPerMonth: 3,
            rentalPerUnitPerMonth: 11,
          },
        },
      }),
      heldFor(bom, 30 * 24),
      bomSupply(bom, {}),
    )

    expect(cost.hireCost).toBeCloseTo(11, 6)
  })

  it('charges the minimum hire period where the form is struck sooner, and names the line', () => {
    // The single commonest reason a hire invoice does not match a programme. A wall
    // form struck in 12 hours against a 28-day minimum is charged for 28 days — not a
    // rounding, a 56× difference on that line.
    const bom = [line({ quantity: 1 })]

    const cost = bomCost(bom, rates({ minHireDays: 28 }), heldFor(bom, 12), bomSupply(bom, {}))

    expect(cost.lines[0]?.chargedDays).toBe(28)
    expect(cost.lines[0]?.atMinimumPeriod).toBe(true)
    expect(cost.linesAtMinimum).toHaveLength(1)
    expect(cost.hireCost).toBeCloseTo(((200 * 3) / 100 / 30) * 28, 6)
  })

  it('does not flag a line held longer than the minimum', () => {
    // Only the lines the minimum actually caught, because the remedy is a planning
    // decision and a list that includes every line is not a decision to act on.
    const bom = [line({ quantity: 1 })]

    const cost = bomCost(bom, rates({ minHireDays: 7 }), heldFor(bom, 40 * 24), bomSupply(bom, {}))

    expect(cost.lines[0]?.chargedDays).toBeCloseTo(40, 6)
    expect(cost.lines[0]?.atMinimumPeriod).toBeUndefined()
    expect(cost.linesAtMinimum).toEqual([])
  })

  it('charges an altered hired part at list price as well as hiring it', () => {
    // Both, and that is the point of splitting them. The panel is held and charged for
    // the period, and it comes back drilled so it does not go back as stock — the hire
    // company invoices the panel too.
    const bom = [line({ quantity: 5, provenance: 'modified' })]

    const cost = bomCost(bom, rates(), heldFor(bom, 30 * 24), bomSupply(bom, {}))

    expect(cost.rechargeCost).toBeCloseTo(1000, 6)
    expect(cost.hireCost).toBeCloseTo(30, 6)
    expect(cost.lines[0]?.totalCost).toBeCloseTo(1030, 6)
  })

  it('does not recharge a part the yard alters off its own rack', () => {
    // Drilling your own panel is your own business. A recharge here would invoice the
    // project for a panel no hire company will ever see.
    const bom = [line({ quantity: 5, provenance: 'modified' })]

    const cost = bomCost(
      bom,
      rates(),
      heldFor(bom, 30 * 24),
      bomSupply(bom, {
        'framax-0.60x2.70': 5,
      }),
    )

    expect(cost.rechargeCost).toBe(0)
    expect(cost.hireCost).toBe(0)
  })

  it('buys what is spent rather than hiring it', () => {
    // Release agent is used up. There is no period and no return, so it is a purchase
    // at list even though the catalog id looks exactly like a panel's.
    const bom = [
      line({
        kind: 'consumable',
        catalogId: 'release-agent-25l',
        description: 'Release agent',
        quantity: 40,
        unit: 'l',
      }),
    ]

    const cost = bomCost(
      bom,
      rates({ byCatalogId: { 'release-agent-25l': { purchasePerUnit: 3 } } }),
      heldFor(bom, undefined),
      bomSupply(bom, {}),
    )

    expect(cost.consumedCost).toBeCloseTo(120, 6)
    expect(cost.hireCost).toBe(0)
    expect(cost.complete).toBe(true)
  })

  it('charges owned stock at the project’s own hire rate, outside the total', () => {
    // Owning formwork is not free, and this used to report it as costing nothing at all.
    // £200 at 3 %/month is £6/month; 10 panels held a month is £60 of the yard's own
    // plant consumed by this job — real enough to charge internally, and not cash, so it
    // stays out of the total a tender is built from.
    const bom = [line({ quantity: 10 })]

    const cost = bomCost(
      bom,
      rates(),
      heldFor(bom, 30 * 24),
      bomSupply(bom, {
        'framax-0.60x2.70': 10,
      }),
    )

    expect(cost.ownedCost).toBeCloseTo(60, 6)
    expect(cost.totalCost).toBe(0)
    expect(cost.ownedQuantityExcluded).toBe(0)
    expect(cost.complete).toBe(true)
  })

  it('does not apply the minimum hire period to the yard’s own stock', () => {
    // A minimum period is a term of an agreement with a hire company. A yard does not
    // charge itself a penalty for striking early, so the internal recharge is the days
    // held — where the same line on hire would be charged for the full 28.
    const bom = [line({ quantity: 10 })]
    const table = rates({ minHireDays: 28 })

    const owned = bomCost(
      bom,
      table,
      heldFor(bom, 2 * 24),
      bomSupply(bom, { 'framax-0.60x2.70': 10 }),
    )
    const hired = bomCost(bom, table, heldFor(bom, 2 * 24), bomSupply(bom, {}))

    expect(owned.ownedCost).toBeCloseTo(6 * (2 / 30) * 10, 6)
    expect(hired.hireCost).toBeCloseTo(6 * (28 / 30) * 10, 6)
    expect(hired.linesAtMinimum).toHaveLength(1)
    expect(owned.linesAtMinimum).toEqual([])
  })

  it('reports owned parts it could not charge, rather than passing them as charged', () => {
    // A rack with a list price and no hire rate has nothing to charge an internal recharge
    // at. Those parts are in this job at nothing, and a zero `ownedQuantityExcluded` has to
    // keep meaning "the recharge is complete".
    const bom = [line({ quantity: 10 })]

    const cost = bomCost(
      bom,
      rates({ byCatalogId: { 'framax-0.60x2.70': { purchasePerUnit: 200 } } }),
      heldFor(bom, 30 * 24),
      bomSupply(bom, { 'framax-0.60x2.70': 10 }),
    )

    expect(cost.ownedCost).toBe(0)
    expect(cost.ownedQuantityExcluded).toBe(10)
    expect(cost.gaps).toContain('no-rental-rate')
    expect(cost.complete).toBe(false)
  })

  it('amortises the yard’s own stock where the project stated a life for it', () => {
    // £200 new, £20 back as scrap, 100 uses: £1.80 a fitting. Ten fittings owned is £18,
    // and the days held do not enter it — that is the whole difference between a life and
    // a hire term, and the reason the basis is named rather than the figure summed.
    const bom = [line({ quantity: 10 })]
    const table = rates({
      minHireDays: 28,
      byCatalogId: {
        'framax-0.60x2.70': {
          purchasePerUnit: 200,
          rentalPercentPerMonth: 3,
          expectedUses: 100,
          residualPerUnit: 20,
        },
      },
    })

    const cost = bomCost(
      bom,
      table,
      heldFor(bom, 2 * 24),
      bomSupply(bom, {
        'framax-0.60x2.70': 10,
      }),
    )

    expect(cost.ownedCost).toBeCloseTo(18, 6)
    expect(cost.ownedAmortisedCost).toBeCloseTo(18, 6)
    expect(cost.ownedRechargeCost).toBe(0)
    expect(cost.lines[0]?.ownedBasis).toBe('amortised')
    // Still outside the cash total, because a share of a purchase already made is not
    // money this job spends either.
    expect(cost.totalCost).toBe(0)
    expect(cost.complete).toBe(true)
  })

  it('falls back to the internal hire rate where a life is stated with no price to spread', () => {
    // A life is a divisor and nothing else: with no list price there is nothing to divide,
    // so the line charges as it did before lives existed rather than at nothing.
    const bom = [line({ quantity: 10 })]
    const table = rates({
      byCatalogId: { 'framax-0.60x2.70': { rentalPerUnitPerMonth: 6, expectedUses: 100 } },
    })

    const cost = bomCost(
      bom,
      table,
      heldFor(bom, 30 * 24),
      bomSupply(bom, {
        'framax-0.60x2.70': 10,
      }),
    )

    expect(cost.ownedCost).toBeCloseTo(60, 6)
    expect(cost.ownedRechargeCost).toBeCloseTo(60, 6)
    expect(cost.lines[0]?.ownedBasis).toBe('recharge')
    expect(cost.ownedQuantityExcluded).toBe(0)
  })

  it('never charges an owned part at nothing under either basis', () => {
    // The failure this whole block exists to prevent: an owned part in the job at zero,
    // which reads as plant that costs nothing to use. Under a life, under a hire rate, or
    // under neither — the third case has to be a reported exclusion rather than a zero.
    const bom = [line({ quantity: 10 })]
    const rack = { 'framax-0.60x2.70': 10 }
    const held = heldFor(bom, 30 * 24)
    const withLife = rates({
      byCatalogId: { 'framax-0.60x2.70': { purchasePerUnit: 200, expectedUses: 50 } },
    })

    const amortised = bomCost(bom, withLife, held, bomSupply(bom, rack))
    const recharged = bomCost(bom, rates(), held, bomSupply(bom, rack))
    const neither = bomCost(
      bom,
      rates({ byCatalogId: { 'framax-0.60x2.70': { purchasePerUnit: 200 } } }),
      held,
      bomSupply(bom, rack),
    )

    expect(amortised.ownedCost).toBeGreaterThan(0)
    expect(recharged.ownedCost).toBeGreaterThan(0)
    expect(neither.ownedCost).toBe(0)
    expect(neither.ownedQuantityExcluded).toBe(10)
  })

  it('states both bases in the caveat where a table holds a life for some parts only', () => {
    // A yard fills a rate table a part at a time, so one job charges its panels over a life
    // and its ties at a transfer price. One owned figure made of two bases is a number a
    // reader cannot reconcile against either, so the sentence has to name both.
    const bom = [
      line({ quantity: 10 }),
      line({
        catalogId: 'framax-0.90x2.70',
        description: 'Framax Xlife panel 0.90 x 2.70 m',
        marks: ['P2'],
        quantity: 10,
      }),
    ]
    const table = rates({
      byCatalogId: {
        'framax-0.60x2.70': { purchasePerUnit: 200, expectedUses: 100 },
        'framax-0.90x2.70': { purchasePerUnit: 300, rentalPercentPerMonth: 3 },
      },
    })

    const cost = bomCost(
      bom,
      table,
      heldFor(bom, 30 * 24),
      bomSupply(bom, {
        'framax-0.60x2.70': 10,
        'framax-0.90x2.70': 10,
      }),
    )

    expect(cost.ownedAmortisedCost).toBeCloseTo(20, 6)
    expect(cost.ownedRechargeCost).toBeCloseTo(90, 6)
    expect(cost.ownedCost).toBeCloseTo(110, 6)
    expect(bomCostCaveats(cost).some((entry) => entry.includes('combines two bases'))).toBe(true)
  })

  it('charges a part-owned line on both sides, at the same rate', () => {
    // 4 owned and 6 hired, held a month: £24 internally and £36 in cash. The split is
    // `bomSupply`'s and the rate is one table, so the two cannot disagree about the part.
    const bom = [line({ quantity: 10 })]

    const cost = bomCost(
      bom,
      rates(),
      heldFor(bom, 30 * 24),
      bomSupply(bom, { 'framax-0.60x2.70': 4 }),
    )

    expect(cost.ownedCost).toBeCloseTo(24, 6)
    expect(cost.hireCost).toBeCloseTo(36, 6)
    expect(cost.totalCost).toBeCloseTo(36, 6)
  })

  it('hires everything returnable where no rack is recorded', () => {
    // A project that states rates and no stock list has said it owns none of this,
    // which is a claim rather than a silence — so the fallback is not an assumption.
    const bom = [line({ quantity: 10 })]

    const cost = bomCost(bom, rates(), heldFor(bom, 30 * 24), undefined)

    expect(cost.hireCost).toBeCloseTo(60, 6)
    expect(cost.ownedQuantityExcluded).toBe(0)
  })

  it('buys the bespoke and consumable lines where no rack is recorded', () => {
    // The other half of the same fallback: without a split there is nothing to say a
    // cut sheet is consumed, and hiring a sawn-up board is not a thing.
    const bom = [
      line({
        kind: 'ply-piece',
        provenance: 'bespoke',
        catalogId: 'ply-18-2440x1220',
        description: 'Birch ply 18 mm, 1830 × 900 mm',
        quantity: 4,
      }),
    ]

    const cost = bomCost(
      bom,
      rates({ byCatalogId: { 'ply-18-2440x1220': { purchasePerUnit: 30 } } }),
      heldFor(bom, undefined),
      undefined,
    )

    expect(cost.consumedCost).toBeCloseTo(120, 6)
    expect(cost.hireCost).toBe(0)
  })

  it('reports a line with no rate as unpriced rather than as free', () => {
    // The failure this whole module is shaped around. A zero here totals cleanly and
    // reads as an answer, and the reader has no way to see the line was skipped.
    const bom = [line({ quantity: 10 }), line({ catalogId: 'tie-dw15', description: 'DW 15 tie' })]

    const cost = bomCost(bom, rates(), heldFor(bom, 30 * 24), bomSupply(bom, {}))

    expect(cost.lines[1]?.gaps).toEqual(['no-rate'])
    expect(cost.lines[1]?.totalCost).toBeUndefined()
    expect(cost.complete).toBe(false)
    expect(cost.gaps).toEqual(['no-rate'])
  })

  it('reports a site-made part as permanently unpriceable', () => {
    // A cut timber soldier has no id a rate could be keyed by, so this is a gap in the
    // answer rather than a table somebody can fill in — and the caveat has to say so,
    // or a reader goes looking for a rate to enter.
    const bom = [line({ catalogId: undefined, description: 'Timber soldier 100 x 75, site made' })]

    const cost = bomCost(bom, rates(), heldFor(bom, undefined), bomSupply(bom, {}))

    expect(cost.lines[0]?.gaps).toEqual(['no-catalog-id'])
    expect(cost.totalCost).toBe(0)
    expect(cost.complete).toBe(false)
  })

  it('reports a hired line whose rate is purchase-only as having no hire rate', () => {
    // A list price is not a hire rate. Charging the purchase price for a month's hire
    // would be roughly thirty times the answer.
    const bom = [line({ quantity: 10 })]

    const cost = bomCost(
      bom,
      rates({ byCatalogId: { 'framax-0.60x2.70': { purchasePerUnit: 200 } } }),
      heldFor(bom, 30 * 24),
      bomSupply(bom, {}),
    )

    expect(cost.lines[0]?.gaps).toEqual(['no-rental-rate'])
    expect(cost.lines[0]?.hireCost).toBeUndefined()
  })

  it('reports a consumed line with no list price as unpriceable', () => {
    const bom = [
      line({
        kind: 'consumable',
        catalogId: 'release-agent-25l',
        description: 'Release agent',
        quantity: 40,
        unit: 'l',
      }),
    ]

    const cost = bomCost(
      bom,
      rates({ byCatalogId: { 'release-agent-25l': { rentalPerUnitPerMonth: 2 } } }),
      heldFor(bom, undefined),
      bomSupply(bom, {}),
    )

    expect(cost.lines[0]?.gaps).toEqual(['no-purchase-price'])
    expect(cost.consumedCost).toBe(0)
  })

  it('reports a hired part nothing ever strikes rather than charging it as a same-day hire', () => {
    // A tie carries a catalog id and is standard stock, so the split puts it on the
    // hired side; nothing strikes it because it is cut off inside the wall. Neither
    // answer is wrong alone and together they leave a real cost unpriceable — a bill
    // missing every tie in a job still totals cleanly.
    const bom = [
      line({ kind: 'tie', catalogId: 'tie-dw15', description: 'DW 15 tie', quantity: 40 }),
    ]

    const cost = bomCost(
      bom,
      rates({
        byCatalogId: { 'tie-dw15': { purchasePerUnit: 4, rentalPercentPerMonth: 3 } },
      }),
      heldFor(bom, undefined),
      bomSupply(bom, {}),
    )

    expect(cost.lines[0]?.gaps).toEqual(['hired-but-never-struck'])
    expect(cost.hireCost).toBe(0)
    expect(cost.complete).toBe(false)
  })

  it('keeps the three costs apart as well as totalling them', () => {
    // Three different events with three different remedies: the hire is negotiable on
    // programme, the recharge is avoidable by allocating owned stock to the drilled
    // work, and the purchase is fixed by the design.
    const bom = [
      line({ quantity: 10 }),
      line({ quantity: 5, provenance: 'modified' }),
      line({
        kind: 'consumable',
        catalogId: 'release-agent-25l',
        description: 'Release agent',
        quantity: 40,
        unit: 'l',
      }),
    ]

    const cost = bomCost(
      bom,
      rates({
        byCatalogId: {
          'framax-0.60x2.70': { purchasePerUnit: 200, rentalPercentPerMonth: 3 },
          'release-agent-25l': { purchasePerUnit: 3 },
        },
      }),
      heldFor(bom, 30 * 24),
      bomSupply(bom, {}),
    )

    expect(cost.hireCost).toBeCloseTo(90, 6)
    expect(cost.rechargeCost).toBeCloseTo(1000, 6)
    expect(cost.consumedCost).toBeCloseTo(120, 6)
    expect(cost.totalCost).toBeCloseTo(1210, 6)
  })

  it('keeps the lines in the bill’s own order', () => {
    // The supply split reorders internally to spend the rack on altered stock first.
    // A cost that followed that order would move a CSV's rows between two downloads.
    const first = line({ quantity: 4, description: 'Zebra panel' })
    const second = line({ quantity: 4, provenance: 'modified', description: 'Alpha panel' })
    const bom = [first, second]

    const cost = bomCost(bom, rates(), heldFor(bom, 24), bomSupply(bom, {}))

    expect(cost.lines.map((entry) => entry.line.description)).toEqual([
      'Zebra panel',
      'Alpha panel',
    ])
  })

  it('carries the currency through so no figure is a bare number', () => {
    const bom = [line({ quantity: 1 })]

    const cost = bomCost(bom, rates({ currency: 'AED' }), heldFor(bom, 24), bomSupply(bom, {}))

    expect(cost.currency).toBe('AED')
  })

  it('prices nothing where the project has opened the table and entered no rate', () => {
    // The stated-but-empty case, which is a different claim from having said nothing:
    // the takeoff carries a priced answer of nothing recorded rather than no money.
    const bom = [line({ quantity: 10 })]

    const cost = bomCost(bom, { byCatalogId: {} }, heldFor(bom, 24), bomSupply(bom, {}))

    expect(cost.totalCost).toBe(0)
    expect(cost.complete).toBe(false)
    expect(cost.gaps).toEqual(['no-rate'])
  })
})

describe('bomCostCaveats', () => {
  const priced = (over: Partial<BomCost> = {}): BomCost => ({
    lines: [{ line: line(), gaps: [] }],
    hireCost: 100,
    rechargeCost: 0,
    consumedCost: 0,
    totalCost: 100,
    linesAtMinimum: [],
    ownedQuantityExcluded: 0,
    complete: true,
    gaps: [],
    ...over,
  })

  it('leads with what the figure is not', () => {
    // The caveat that matters most, because it is the one a reader assumes away: there
    // is no labour in this, and labour is normally the largest cost of forming a job.
    const out = bomCostCaveats(priced())

    expect(out[0]).toContain('not the cost of forming the job')
    expect(out[0]).toContain('labour')
  })

  it('says nothing about a bill with no lines', () => {
    // An empty scope has no cost to caveat, and a warning about labour against no
    // formwork at all is noise that trains a reader to skip the list.
    expect(bomCostCaveats(priced({ lines: [] }))).toEqual([])
  })

  it('names the total as a floor where a line went unpriced', () => {
    const out = bomCostCaveats(priced({ complete: false, gaps: ['no-rate'] }))

    expect(out.some((message) => message.includes('floor rather than a price'))).toBe(true)
  })

  it('names the owned quantity it left out', () => {
    const out = bomCostCaveats(priced({ ownedQuantityExcluded: 120 }))

    expect(out.some((message) => message.includes('120 parts'))).toBe(true)
  })

  it('says striking sooner saves nothing on a line at the minimum period', () => {
    // The remedy is the point: the money is not saved by stripping earlier, it is
    // saved by pouring more with the same set.
    const out = bomCostCaveats(
      priced({ linesAtMinimum: [{ line: line(), atMinimumPeriod: true, gaps: [] }] }),
    )

    expect(out.some((message) => message.includes('minimum hire period'))).toBe(true)
  })

  it('says a recharge is avoidable', () => {
    const out = bomCostCaveats(priced({ rechargeCost: 400 }))

    expect(out.some((message) => message.includes('do not go back as stock'))).toBe(true)
  })
})
