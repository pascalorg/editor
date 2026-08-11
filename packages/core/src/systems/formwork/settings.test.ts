import { describe, expect, it } from 'bun:test'
import type { FormworkProjectSettingsNode } from '../../schema/nodes/formwork-project-settings'
import {
  DEFAULT_FORMWORK_SETTINGS,
  formworkSettings,
  mergeFormworkLabourNorms,
  mergeFormworkOwnedStock,
  mergeFormworkRates,
} from './settings'

/**
 * What the project stated, and what it merely has not said.
 *
 * Every case here is a way of losing that distinction, and each one loses it silently:
 * a merge that forgets the rest of the rack, a zero folded into absence, an emptied
 * group that reads as unstated. None of them fail — they all produce a stock list that
 * looks plausible and puts the wrong quantity on hire.
 */

const node = (overrides: Partial<FormworkProjectSettingsNode> = {}): FormworkProjectSettingsNode =>
  ({
    object: 'node',
    id: 'formwork-settings_test',
    type: 'formwork-settings',
    parentId: 'site_test',
    visible: true,
    metadata: {},
    children: [],
    ...overrides,
  }) as FormworkProjectSettingsNode

describe('mergeFormworkOwnedStock', () => {
  it('keeps the rest of the rack when one type is recorded', () => {
    // The failure the helper exists for. A stock list is edited one line at a time, and
    // the one-level merge would overwrite `owned` wholesale — so recording 40 of one
    // panel would tell the project it no longer owns the 200 it had.
    const merged = mergeFormworkOwnedStock(
      { owned: { 'panel-a': 200, 'prop-b': 300 } },
      {
        'panel-c': 40,
      },
    )

    expect(merged.owned).toEqual({ 'panel-a': 200, 'prop-b': 300, 'panel-c': 40 })
  })

  it('overwrites a type the rack already lists', () => {
    const merged = mergeFormworkOwnedStock({ owned: { 'panel-a': 200 } }, { 'panel-a': 260 })

    expect(merged.owned).toEqual({ 'panel-a': 260 })
  })

  it('removes a type on undefined', () => {
    // How a yard says it no longer owns the type at all — sold, scrapped, off the books.
    const merged = mergeFormworkOwnedStock(
      { owned: { 'panel-a': 200, 'prop-b': 300 } },
      { 'panel-a': undefined },
    )

    expect(merged.owned).toEqual({ 'prop-b': 300 })
  })

  it('keeps a stated zero rather than folding it into absence', () => {
    // "We own none of these" is a fact about a type a yard has run out of, and it is
    // the answer to a question somebody asked. Deleted, it becomes "nobody has said".
    const merged = mergeFormworkOwnedStock({ owned: { 'panel-a': 200 } }, { 'panel-a': 0 })

    expect(merged.owned).toEqual({ 'panel-a': 0 })
  })

  it('starts a rack from an absent group', () => {
    const merged = mergeFormworkOwnedStock(undefined, { 'panel-a': 200 })

    expect(merged.owned).toEqual({ 'panel-a': 200 })
  })

  it('leaves a stated-empty rack rather than deleting the group', () => {
    // Deliberately unlike `mergeFormworkCement`, which drops an emptied spec. A project
    // that has removed every line from its rack has *stated* it owns nothing; collapsing
    // that to an absent group turns the statement back into silence and the whole bill
    // back onto hire.
    const merged = mergeFormworkOwnedStock({ owned: { 'panel-a': 200 } }, { 'panel-a': undefined })

    expect(merged).toEqual({ owned: {} })
  })
})

describe('formworkSettings owned stock', () => {
  it('leaves the stock unresolved where the project has not stated one', () => {
    // The one resolved field with no default, against the rule every other field here
    // follows. `{}` would be the claim "owns nothing", which no unconfigured project has
    // made and which puts an entire bill on hire.
    expect(formworkSettings(node()).ownedStock).toBeUndefined()
    expect(DEFAULT_FORMWORK_SETTINGS.ownedStock).toBeUndefined()
  })

  it('resolves a stated-empty rack to an empty record, not to unstated', () => {
    // The distinction has to survive resolution or nothing downstream can act on it.
    expect(formworkSettings(node({ stock: { owned: {} } })).ownedStock).toEqual({})
  })

  it('passes the stated rack through', () => {
    expect(formworkSettings(node({ stock: { owned: { 'panel-a': 200 } } })).ownedStock).toEqual({
      'panel-a': 200,
    })
  })

  it('reads a stock group holding no owned record as unstated', () => {
    // `stock: {}` is a group that exists with nothing in it — reached by a patch that
    // set some future sibling field. Nobody has said what the yard owns.
    expect(formworkSettings(node({ stock: {} })).ownedStock).toBeUndefined()
  })
})

describe('mergeFormworkRates', () => {
  it('keeps the rest of the table when one part is priced', () => {
    // The rack's failure again: a rate table is filled in one line at a time, and a
    // one-level merge would replace `byCatalogId` wholesale.
    const merged = mergeFormworkRates(
      { byCatalogId: { 'panel-a': { purchasePerUnit: 200 } } },
      { byCatalogId: { 'prop-b': { purchasePerUnit: 40 } } },
    )

    expect(merged.byCatalogId).toEqual({
      'panel-a': { purchasePerUnit: 200 },
      'prop-b': { purchasePerUnit: 40 },
    })
  })

  it('merges the fields of one part rather than replacing the rate', () => {
    // The difference from the rack, where the value is a single number. Here a list
    // price and a hire term are entered at different times by different people, so
    // replacing the object would make filling in the second delete the first.
    const merged = mergeFormworkRates(
      { byCatalogId: { 'panel-a': { purchasePerUnit: 200 } } },
      { byCatalogId: { 'panel-a': { rentalPercentPerMonth: 3 } } },
    )

    expect(merged.byCatalogId).toEqual({
      'panel-a': { purchasePerUnit: 200, rentalPercentPerMonth: 3 },
    })
  })

  it('clears one field of a rate without removing the part', () => {
    const merged = mergeFormworkRates(
      { byCatalogId: { 'panel-a': { purchasePerUnit: 200, rentalPercentPerMonth: 3 } } },
      { byCatalogId: { 'panel-a': { rentalPercentPerMonth: undefined } } },
    )

    expect(merged.byCatalogId).toEqual({ 'panel-a': { purchasePerUnit: 200 } })
  })

  it('removes a part on undefined', () => {
    const merged = mergeFormworkRates(
      { byCatalogId: { 'panel-a': { purchasePerUnit: 200 }, 'prop-b': { purchasePerUnit: 40 } } },
      { byCatalogId: { 'panel-a': undefined } },
    )

    expect(merged.byCatalogId).toEqual({ 'prop-b': { purchasePerUnit: 40 } })
  })

  it('drops a part whose last figure was cleared', () => {
    // An id with no figures against it is a row nothing can price and nothing reports,
    // so leaving `{}` behind would make the table claim a rate it does not hold.
    const merged = mergeFormworkRates(
      { byCatalogId: { 'panel-a': { purchasePerUnit: 200 } } },
      { byCatalogId: { 'panel-a': { purchasePerUnit: undefined } } },
    )

    expect(merged.byCatalogId).toEqual({})
  })

  it('keeps the group when the table empties, rather than dropping to unstated', () => {
    // Same as the rack and for the same reason: a project that has removed every rate
    // has stated it prices nothing, and collapsing that to absent takes the money off
    // the takeoff entirely.
    const merged = mergeFormworkRates(
      { currency: 'GBP', byCatalogId: { 'panel-a': { purchasePerUnit: 200 } } },
      { byCatalogId: { 'panel-a': undefined } },
    )

    expect(merged).toEqual({ currency: 'GBP', byCatalogId: {} })
  })

  it('keeps an unmentioned currency and minimum period', () => {
    const merged = mergeFormworkRates(
      { currency: 'GBP', minHireDays: 28, byCatalogId: {} },
      { byCatalogId: { 'panel-a': { purchasePerUnit: 200 } } },
    )

    expect(merged.currency).toBe('GBP')
    expect(merged.minHireDays).toBe(28)
  })

  it('clears a group field only where the caller says it named it', () => {
    // `undefined` alone cannot carry the difference: an absent key in a patch object and
    // a key holding undefined look the same to a spread, and one means "leave the
    // minimum hire period alone" while the other means "we have no minimum".
    const skipped = mergeFormworkRates({ minHireDays: 28, byCatalogId: {} }, {})
    const cleared = mergeFormworkRates(
      { minHireDays: 28, byCatalogId: {} },
      { minHireDays: undefined },
      { minHireDays: true },
    )

    expect(skipped.minHireDays).toBe(28)
    expect(cleared.minHireDays).toBeUndefined()
  })

  it('starts a table from an absent group', () => {
    const merged = mergeFormworkRates(undefined, {
      currency: 'AED',
      byCatalogId: { 'panel-a': { purchasePerUnit: 200 } },
    })

    expect(merged).toEqual({
      currency: 'AED',
      byCatalogId: { 'panel-a': { purchasePerUnit: 200 } },
    })
  })
})

describe('formworkSettings rates', () => {
  it('leaves the rates unresolved where the project has recorded none', () => {
    // The sharpest version of the rack's rule. A rate is the only input in the model
    // with no conservative fallback: zero prices the job at nothing, and anything else
    // invents a price.
    expect(formworkSettings(node()).rates).toBeUndefined()
    expect(DEFAULT_FORMWORK_SETTINGS.rates).toBeUndefined()
  })

  it('resolves a stated group with no table to an empty table', () => {
    // A priced answer of nothing recorded, which is not the same as no money at all.
    expect(formworkSettings(node({ rates: {} })).rates).toEqual({ byCatalogId: {} })
  })

  it('passes the currency and the minimum hire period through', () => {
    const resolved = formworkSettings(
      node({
        rates: {
          currency: 'GBP',
          minHireDays: 28,
          byCatalogId: { 'panel-a': { purchasePerUnit: 200 } },
        },
      }),
    )

    expect(resolved.rates).toEqual({
      currency: 'GBP',
      minHireDays: 28,
      byCatalogId: { 'panel-a': { purchasePerUnit: 200 } },
    })
  })
})

describe('mergeFormworkLabourNorms', () => {
  it('keeps the rest of the table when one kind is normed', () => {
    // The rate table's failure in a smaller table: a norm table is filled in one row at
    // a time by whoever knows that trade, and a one-level merge would replace
    // `byPartKind` wholesale.
    const merged = mergeFormworkLabourNorms(
      { byPartKind: { panel: { erectHours: 0.4 }, prop: { erectHours: 0.1 } } },
      { tie: { erectHours: 0.05 } },
    )

    expect(merged.byPartKind).toEqual({
      panel: { erectHours: 0.4 },
      prop: { erectHours: 0.1 },
      tie: { erectHours: 0.05 },
    })
  })

  it('merges the two hours of one kind rather than replacing the norm', () => {
    // The case the erect-only gap exists to report, and the one a replace would create
    // silently: the strike time arrives after the erect time and must not delete it.
    const merged = mergeFormworkLabourNorms(
      { byPartKind: { panel: { erectHours: 0.4 } } },
      { panel: { strikeHours: 0.25 } },
    )

    expect(merged.byPartKind).toEqual({ panel: { erectHours: 0.4, strikeHours: 0.25 } })
  })

  it('drops a kind whose last figure was cleared', () => {
    // An empty norm and no norm price the same, and only one of them should be
    // representable — `bomLabour` treats `{}` as unnormed either way.
    const merged = mergeFormworkLabourNorms(
      { byPartKind: { panel: { erectHours: 0.4 } } },
      { panel: { erectHours: undefined } },
    )

    expect(merged.byPartKind).toEqual({})
  })

  it('removes a kind on undefined and keeps the group when the table empties', () => {
    const merged = mergeFormworkLabourNorms(
      { byPartKind: { panel: { erectHours: 0.4 } } },
      { panel: undefined },
    )

    expect(merged).toEqual({ byPartKind: {} })
  })
})

describe('formworkSettings labour', () => {
  it('leaves the norms unresolved where the project has stated none', () => {
    // The least-supported field in the whole resolver. A rate at least has a market; an
    // output norm is a fact about a crew, and the published constants are per m² of a
    // whole trade operation rather than per part.
    expect(formworkSettings(node()).labour).toBeUndefined()
    expect(DEFAULT_FORMWORK_SETTINGS.labour).toBeUndefined()
  })

  it('joins the gang rate and the currency onto the norms', () => {
    // Two stated groups, one resolved answer: hours and the rate that prices them are
    // one thing, and a consumer holding only half of it would either report hours it
    // could not cost or reach back into the settings node for the rate.
    const resolved = formworkSettings(
      node({
        rates: { currency: 'GBP', gangRatePerHour: 32, byCatalogId: {} },
        labour: { byPartKind: { panel: { erectHours: 0.4 } } },
      }),
    )

    expect(resolved.labour).toEqual({
      byPartKind: { panel: { erectHours: 0.4 } },
      gangRatePerHour: 32,
      currency: 'GBP',
    })
  })

  it('resolves norms with no gang rate to hours with no money', () => {
    const resolved = formworkSettings(
      node({ labour: { byPartKind: { panel: { erectHours: 0.4 } } } }),
    )

    expect(resolved.labour?.gangRatePerHour).toBeUndefined()
    expect(resolved.labour?.byPartKind).toEqual({ panel: { erectHours: 0.4 } })
  })

  it('gives a rate with no norms no labour at all', () => {
    // A gang rate on its own prices nothing, and resolving an empty norm table off it
    // would put a labour block on the takeoff with zero hours in it — which reads as a
    // job with no labour rather than as a project that has not stated its outputs.
    expect(formworkSettings(node({ rates: { gangRatePerHour: 32 } })).labour).toBeUndefined()
  })
})

describe('formworkSettings schedule', () => {
  it('leaves the lead times unresolved where the project has stated none', () => {
    // The rates' rule rather than the pressure inputs'. A lead time has no published
    // table behind it, and a default of zero says the shutter appears on the morning of
    // the pour — the one answer that is certainly wrong.
    expect(formworkSettings(node()).schedule).toBeUndefined()
    expect(DEFAULT_FORMWORK_SETTINGS.schedule).toBeUndefined()
  })

  it('keeps a stated group with one field, so the other reads as still unstated', () => {
    const resolved = formworkSettings(node({ schedule: { erectionLeadDays: 3 } }))

    expect(resolved.schedule).toEqual({ erectionLeadDays: 3 })
    expect(resolved.schedule?.returnLeadDays).toBeUndefined()
  })

  it('keeps a stated zero, because a same-day erection is a real answer', () => {
    // Unlike an absent field: a yard that erects on the morning of the pour has said so,
    // and folding that into absence would lose the one case where zero is right.
    expect(formworkSettings(node({ schedule: { erectionLeadDays: 0 } })).schedule).toEqual({
      erectionLeadDays: 0,
    })
  })
})

describe('formworkSettings curing', () => {
  it('leaves every field unstated rather than resolving a default into it', () => {
    // Against the rule the pressure inputs follow, and deliberately. The striking tables
    // print their own conservative column and report what they took in `assumed`, so a
    // number resolved here would arrive indistinguishable from one the job stated.
    expect(formworkSettings(node()).curing).toEqual({})
    expect(DEFAULT_FORMWORK_SETTINGS.curing).toEqual({})
  })

  it('passes the curing temperature through without touching the placing one', () => {
    // The two move the design in opposite directions — a colder mix pushes harder, a
    // colder cure holds longer — so a resolver that read one for the other would be
    // wrong for one of the two answers whichever value it held.
    const resolved = formworkSettings(
      node({ placement: { concreteTemperatureC: 25 }, curing: { surfaceTemperatureC: 5 } }),
    )

    expect(resolved.curing.surfaceTemperatureC).toBe(5)
    expect(resolved.concreteTemperatureC).toBe(25)
  })

  it('passes the two strike-shortening flags through', () => {
    const resolved = formworkSettings(
      node({ curing: { highEarlyStrength: true, shoresRemain: true } }),
    )

    expect(resolved.curing).toEqual({ highEarlyStrength: true, shoresRemain: true })
  })
})
