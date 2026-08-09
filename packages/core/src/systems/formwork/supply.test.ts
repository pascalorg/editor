import { describe, expect, it } from 'bun:test'
import type { BomLine } from './parts'
import { bomSupply } from './supply'

/**
 * Whose rack the bill draws on.
 *
 * The failure mode this guards is a figure that looks like an answer and is not one.
 * A yard that has recorded nothing must not read as a yard that owns nothing, and a
 * pool consumed by an earlier line must not still be available to a later one — both
 * produce a plausible hire quantity that is wrong in the direction that costs money.
 */

const line = (over: Partial<BomLine> = {}): BomLine => ({
  kind: 'panel',
  catalogId: 'framax-0.60x2.70',
  description: 'Framax Xlife panel 0.60 x 2.70 m',
  provenance: 'standard',
  quantity: 10,
  unit: 'no',
  totalWeightKg: 100,
  marks: [],
  ...over,
})

describe('bomSupply', () => {
  it('draws on the rack first and hires the shortfall', () => {
    const supply = bomSupply([line({ quantity: 26 })], { 'framax-0.60x2.70': 20 })

    expect(supply.ownedQuantity).toBe(20)
    expect(supply.hiredQuantity).toBe(6)
  })

  it('hires nothing where the rack covers the bill', () => {
    const supply = bomSupply([line({ quantity: 10 })], { 'framax-0.60x2.70': 200 })

    expect(supply.ownedQuantity).toBe(10)
    expect(supply.hiredQuantity).toBe(0)
  })

  it('spends the pool across lines rather than offering it to each', () => {
    // The reason this is a pool rather than a flag per type. Two lines of one catalog
    // id — an untouched run and a drilled one — against 12 owned panels is 12 owned
    // and 8 hired. Answered per line against the same 12, it is 20 owned out of a
    // rack of 12: a bill the yard cannot fill and nothing in it says so.
    const supply = bomSupply(
      [line({ quantity: 10 }), line({ quantity: 10, provenance: 'modified' })],
      { 'framax-0.60x2.70': 12 },
    )

    expect(supply.ownedQuantity).toBe(12)
    expect(supply.hiredQuantity).toBe(8)
  })

  it('spends the yard’s own panels on the ones this pour will drill', () => {
    // A cost decision, not a tidy one. A hired panel drilled for a cast-in item comes
    // back with holes and is recharged at list, so the 10 owned go to the 10 modified
    // and the untouched run is hired clean. Allocated the other way the same job
    // returns 10 holed panels to a hire company.
    const supply = bomSupply(
      [line({ quantity: 10 }), line({ quantity: 10, provenance: 'modified' })],
      { 'framax-0.60x2.70': 10 },
    )

    const modified = supply.lines.find((entry) => entry.line.provenance === 'modified')
    const standard = supply.lines.find((entry) => entry.line.provenance === 'standard')
    expect(modified?.ownedQuantity).toBe(10)
    expect(standard?.hiredQuantity).toBe(10)
  })

  it('calls out hired stock this pour alters, which nothing else in the bill does', () => {
    // The number that costs money quietly: an ordinary hire charge and a recharge at
    // list for a drilled panel are the same line to every other figure here.
    const supply = bomSupply([line({ quantity: 10, provenance: 'modified' })], {})

    expect(supply.hiredQuantity).toBe(10)
    expect(supply.hiredModifiedQuantity).toBe(10)
  })

  it('does not count owned altered stock as a recharge', () => {
    // Drilling the yard's own panel is the yard's own business. Counting it here would
    // put a hire-company recharge against a panel no hire company will ever see.
    const supply = bomSupply([line({ quantity: 10, provenance: 'modified' })], {
      'framax-0.60x2.70': 10,
    })

    expect(supply.hiredModifiedQuantity).toBe(0)
  })

  it('treats a made-for-this-pour part as consumed even where it carries a catalog id', () => {
    // The catalog id on a bespoke part names the stock it was *cut from*, not a part a
    // yard racks: a deck sheet trimmed to the bay is emitted with the sheet-stock id on
    // it. Read as returnable, a soffit's worth of cut ply comes off the rack and goes
    // back on it, and the yard is told it still owns sheets it has already sawn up.
    const supply = bomSupply(
      [
        line({
          kind: 'ply-piece',
          provenance: 'bespoke',
          catalogId: 'ply-18-2440x1220',
          description: 'Birch ply 18 mm, 1830 × 900 mm',
        }),
      ],
      { 'ply-18-2440x1220': 200 },
    )

    expect(supply.consumedQuantity).toBe(10)
    expect(supply.ownedQuantity).toBe(0)
    expect(supply.hiredQuantity).toBe(0)
  })

  it('treats a part with no catalog id as consumed, because no rack can hold it', () => {
    // Nothing to match against a stock line, so there is no honest way to call it owned
    // and no id a hire agreement could name.
    const supply = bomSupply(
      [line({ catalogId: undefined, description: 'Timber soldier 100 x 75, site made' })],
      { 'framax-0.60x2.70': 200 },
    )

    expect(supply.consumedQuantity).toBe(10)
    expect(supply.hiredQuantity).toBe(0)
  })

  it('treats a consumable as consumed even where it is catalog stock with a rack', () => {
    // Release agent has a catalog id and a stated quantity, so it looks exactly like a
    // panel to the allocation. It is used up: hiring 40 litres of it is not a thing.
    const supply = bomSupply(
      [
        line({
          kind: 'consumable',
          catalogId: 'release-agent-25l',
          description: 'Release agent',
          quantity: 40,
          unit: 'l',
        }),
      ],
      { 'release-agent-25l': 100 },
    )

    expect(supply.consumedQuantity).toBe(40)
    expect(supply.hiredQuantity).toBe(0)
  })

  it('hires a catalog part the project has not recorded owning', () => {
    const supply = bomSupply([line({ quantity: 10 })], { 'some-other-panel': 500 })

    expect(supply.hiredQuantity).toBe(10)
    expect(supply.ownedQuantity).toBe(0)
  })

  it('apportions hired weight by quantity rather than by line', () => {
    // Hire is priced against tonnage or area held, so the figure has to be the weight
    // of the hired *share*. 26 panels at 10 kg with 20 owned is 60 kg on hire, not the
    // 260 kg the line totals.
    const supply = bomSupply([line({ quantity: 26, totalWeightKg: 260 })], {
      'framax-0.60x2.70': 20,
    })

    expect(supply.hiredWeightKg).toBeCloseTo(60, 6)
  })

  it('withholds the hired weight where a hired line has no published weight', () => {
    // Same discipline as `bomWeightKg`. A tonnage that silently omits an unweighed
    // line is the number a hire desk quotes and a crane is booked against.
    const supply = bomSupply([line({ quantity: 10, totalWeightKg: undefined })], {})

    expect(supply.hiredQuantity).toBe(10)
    expect(supply.hiredWeightKg).toBeUndefined()
  })

  it('ignores an unweighed line that is wholly owned', () => {
    // It is not on hire, so it cannot make the hire tonnage incomplete. Voiding the
    // figure here would report "cannot total the hire" for a job hiring one weighed
    // panel and owning everything else.
    const supply = bomSupply(
      [
        line({ quantity: 10, totalWeightKg: undefined }),
        line({
          catalogId: 'tie-dw15',
          description: 'DW 15 tie rod',
          kind: 'tie',
          quantity: 4,
          totalWeightKg: 8,
        }),
      ],
      { 'framax-0.60x2.70': 10 },
    )

    expect(supply.hiredWeightKg).toBeCloseTo(8, 6)
  })

  it('reports no hired weight at all where nothing is hired', () => {
    // Zero kg on hire and "cannot say" are different claims, and a 0 in the field
    // would be indistinguishable from the second one.
    const supply = bomSupply([line({ quantity: 10 })], { 'framax-0.60x2.70': 10 })

    expect(supply.hiredQuantity).toBe(0)
    expect(supply.hiredWeightKg).toBeUndefined()
  })

  it('keeps the lines in the bill’s own order, not the allocation’s', () => {
    // The allocation reorders to spend the rack on altered stock first. Returning that
    // order would move a CSV's rows between two downloads of an unchanged scene.
    const first = line({ quantity: 4, description: 'Zebra panel' })
    const second = line({ quantity: 4, provenance: 'modified', description: 'Alpha panel' })

    const supply = bomSupply([first, second], { 'framax-0.60x2.70': 4 })

    expect(supply.lines.map((entry) => entry.line.description)).toEqual([
      'Zebra panel',
      'Alpha panel',
    ])
    expect(supply.lines[1]?.ownedQuantity).toBe(4)
  })

  it('names owned stock the bill never draws on', () => {
    // The other half of a rack: a yard holding 300 props for a job that forms no soffit
    // is holding plant it could have released, and no quantity in the bill mentions it.
    const supply = bomSupply([line({ quantity: 10 })], {
      'framax-0.60x2.70': 20,
      'prop-eurex-20': 300,
      'framax-0.90x2.70': 40,
    })

    expect(supply.unusedOwnedIds).toEqual(['framax-0.90x2.70', 'prop-eurex-20'])
  })

  it('does not name a type the bill exhausted', () => {
    // Drawn to zero is drawn on. Listing it as unused would tell a yard to release the
    // panels this pour is standing on.
    const supply = bomSupply([line({ quantity: 20 })], { 'framax-0.60x2.70': 20 })

    expect(supply.unusedOwnedIds).toEqual([])
  })

  it('reads an empty rack as owning nothing rather than as unknown', () => {
    // The distinction the whole group carries, at this level: `{}` is a project that
    // has stated it owns nothing, and the honest split for it is everything on hire.
    // Whether a project that has stated *nothing* gets a split at all is the caller's
    // decision, not this function's.
    const supply = bomSupply([line({ quantity: 10 })], {})

    expect(supply.hiredQuantity).toBe(10)
    expect(supply.unusedOwnedIds).toEqual([])
  })

  it('splits one line into an owned share and a hired one, on the line itself', () => {
    // A per-line split rather than a per-scope total, because the order goes out per
    // line: "26 panels, 20 off our own rack, hire 6" is one row a yard can act on.
    const supply = bomSupply([line({ quantity: 26 })], { 'framax-0.60x2.70': 20 })

    expect(supply.lines[0]?.ownedQuantity).toBe(20)
    expect(supply.lines[0]?.hiredQuantity).toBe(6)
    expect(supply.lines[0]?.consumedQuantity).toBe(0)
  })
})
