import { describe, expect, test } from 'bun:test'
import type { FormworkProjectSettingsNode } from '../../schema/nodes/formwork-project-settings'
import {
  applyFormworkSettingsPatch,
  FormworkSettingsPatch,
  formworkSettingsReport,
} from './settings-patch'

/**
 * The write contract every AI surface shares.
 *
 * This module exists because the same logic was written twice and would have been
 * written a third time, so what is asserted here is not the arithmetic — `settings.test.ts`
 * owns the merges themselves. It is the *contract*: that `null` is a third state distinct
 * from absent, that a hallucinated catalog id is refused rather than silently falling back
 * to a default, that SCC is one fact rather than two, and that the answer is the same
 * whichever surface asks. Each of those fails silently on the surface that gets it wrong.
 */

const node = (fields: Partial<FormworkProjectSettingsNode> = {}) =>
  ({
    object: 'node',
    id: 'formwork-settings_1',
    type: 'formwork-settings',
    parentId: 'site_1',
    visible: true,
    metadata: {},
    children: [],
    ...fields,
  }) as FormworkProjectSettingsNode

const apply = (current: FormworkProjectSettingsNode | undefined, patch: Record<string, unknown>) =>
  applyFormworkSettingsPatch(current, FormworkSettingsPatch.parse(patch))

describe('the patch schema — null is a third state', () => {
  test('accepts a value, a null and an absence, and keeps the node’s bounds', () => {
    // Without the third state a model can state a figure and never retract it, and
    // every assumption in a project decays into a claim over a conversation.
    expect(FormworkSettingsPatch.parse({ curing: { surfaceTemperatureC: 5 } }).curing).toEqual({
      surfaceTemperatureC: 5,
    })
    expect(FormworkSettingsPatch.parse({ curing: { surfaceTemperatureC: null } }).curing).toEqual({
      surfaceTemperatureC: null,
    })
    expect(FormworkSettingsPatch.parse({ curing: {} }).curing).toEqual({})
    expect(FormworkSettingsPatch.safeParse({ curing: { surfaceTemperatureC: 999 } }).success).toBe(
      false,
    )
  })

  test('the curing temperature is its own field, not the placing one', () => {
    // The two move the design in opposite directions, so one field would be wrong for
    // one of the two answers whatever value it held.
    const patch = FormworkSettingsPatch.parse({
      placement: { concreteTemperatureC: 25 },
      curing: { surfaceTemperatureC: 5 },
    })

    expect(patch.placement?.concreteTemperatureC).toBe(25)
    expect(patch.curing?.surfaceTemperatureC).toBe(5)
  })
})

describe('applyFormworkSettingsPatch — refusals', () => {
  test('an empty call is refused rather than creating an empty statement', () => {
    const result = apply(undefined, {})

    expect(result.error).toStartWith('Error:')
    expect(result.writes).toBeUndefined()
  })

  test('a part id that names nothing is refused, since a bad id falls back silently', () => {
    // Not a loud failure downstream: the design chain resolves its default part, so the
    // project would believe it had specified a beam while every span used another one.
    const result = apply(undefined, { parts: { beamId: 'peri-h20' } })

    expect(result.error).toContain('peri-h20')
    expect(result.error).toContain('Pick one of')
    expect(result.writes).toBeUndefined()
  })

  test('a stock id that names nothing is refused, since it can never match a bill line', () => {
    const result = apply(undefined, { ownedStock: { 'doka-framax-panel-90x270': 200 } })

    expect(result.error).toContain('change nothing')
    expect(result.writes).toBeUndefined()
  })

  test('null still unstates a part without tripping the catalog check', () => {
    const result = apply(node({ parts: { beamId: 'h20-doka-permissible', doubledWalers: true } }), {
      parts: { beamId: null },
    })

    expect(result.error).toBeUndefined()
    expect(result.writes?.parts).toEqual({ doubledWalers: true })
  })
})

describe('applyFormworkSettingsPatch — unset stays unset', () => {
  test('writes only the stated field', () => {
    const result = apply(undefined, { placement: { riseRateMH: 2 } })

    expect(result.writes?.placement).toEqual({ riseRateMH: 2 })
    expect(result.changed).toEqual(['placement'])
  })

  test('a second field merges instead of replacing the group', () => {
    const result = apply(node({ placement: { riseRateMH: 2 } }), {
      placement: { concreteTemperatureC: 30 },
    })

    expect(result.writes?.placement).toEqual({ riseRateMH: 2, concreteTemperatureC: 30 })
  })

  test('an emptied group is undefined, which the write paths delete', () => {
    // Not `{}`: a stated empty group and an absent one are the same claim, and only one
    // of them should be representable.
    const result = apply(node({ placement: { riseRateMH: 2 } }), {
      placement: { riseRateMH: null },
    })

    expect(result.writes).toHaveProperty('placement')
    expect(result.writes?.placement).toBeUndefined()
  })

  test('null unstates a top-level standard', () => {
    const result = apply(node({ pressureStandard: 'ACI_347' }), { pressureStandard: null })

    expect(result.writes).toHaveProperty('pressureStandard')
    expect(result.writes?.pressureStandard).toBeUndefined()
  })
})

describe('applyFormworkSettingsPatch — the binder is a second level', () => {
  test('a binder field does not drop a stated sibling of concrete', () => {
    const result = apply(node({ concrete: { unitWeightKnM3: 25 } }), {
      cement: { retarder: true },
    })

    expect(result.writes?.concrete).toEqual({ unitWeightKnM3: 25, cement: { retarder: true } })
  })

  test('a binder and a concrete sibling in one call both survive', () => {
    // The binder merges onto the concrete this same call produced, not onto the
    // original. Chained through the earlier merge, `unitWeightKnM3` would be discarded
    // by whichever of the two was applied second.
    const result = apply(undefined, {
      concrete: { unitWeightKnM3: 25 },
      cement: { retarder: true },
    })

    expect(result.writes?.concrete).toEqual({ unitWeightKnM3: 25, cement: { retarder: true } })
  })

  test('emptying the binder removes it rather than leaving a stated empty spec', () => {
    const result = apply(node({ concrete: { cement: { retarder: true } } }), {
      cement: { retarder: null },
    })

    expect(result.writes).toHaveProperty('concrete')
    expect(result.writes?.concrete).toBeUndefined()
  })
})

describe('applyFormworkSettingsPatch — SCC is one fact', () => {
  test('picking SCC sets the flag the pressure codes branch on', () => {
    const result = apply(undefined, { concrete: { consistencyClass: 'SCC' } })

    expect(result.writes?.concrete).toEqual({ consistencyClass: 'SCC', selfCompacting: true })
  })

  test('picking an F class clears the flag, or the class would be ignored', () => {
    // ACI has no SCC provisions and reads only the flag, so an F class beside a stale
    // flag is not a slower pour — it is the SCC pressure under another name.
    const result = apply(node({ concrete: { consistencyClass: 'SCC', selfCompacting: true } }), {
      concrete: { consistencyClass: 'F4' },
    })

    expect(result.writes?.concrete).toEqual({ consistencyClass: 'F4' })
  })

  test('a concrete patch silent about consistency leaves the flag alone', () => {
    const result = apply(node({ concrete: { consistencyClass: 'SCC', selfCompacting: true } }), {
      concrete: { unitWeightKnM3: 25 },
    })

    expect(result.writes?.concrete).toEqual({
      consistencyClass: 'SCC',
      selfCompacting: true,
      unitWeightKnM3: 25,
    })
  })
})

describe('applyFormworkSettingsPatch — the yard’s own rack', () => {
  const PANEL = 'doka-framax-panel-588104500'
  const OTHER = 'doka-framax-panel-588223500'

  test('a second type merges instead of replacing the rack', () => {
    const result = apply(node({ stock: { owned: { [PANEL]: 200 } } }), {
      ownedStock: { [OTHER]: 40 },
    })

    expect(result.writes?.stock).toEqual({ owned: { [PANEL]: 200, [OTHER]: 40 } })
  })

  test('a stated zero is kept, because owning none of a type is a fact', () => {
    const result = apply(undefined, { ownedStock: { [PANEL]: 0 } })

    expect(result.writes?.stock).toEqual({ owned: { [PANEL]: 0 } })
  })

  test('an emptied rack stays stated rather than reverting to nobody having said', () => {
    // Against the rule every other group here follows. A project that removed its last
    // line has said it owns nothing and its bill prices as hire; an absent group shows
    // no split at all.
    const result = apply(node({ stock: { owned: { [PANEL]: 200 } } }), {
      ownedStock: { [PANEL]: null },
    })

    expect(result.writes?.stock).toEqual({ owned: {} })
  })

  test('a rack write on its own is a real call, not an empty one', () => {
    const result = apply(undefined, { ownedStock: { [PANEL]: 200 } })

    expect(result.error).toBeUndefined()
    expect(result.changed).toEqual(['ownedStock'])
  })
})

describe('applyFormworkSettingsPatch — what the project pays', () => {
  const PANEL = 'doka-framax-panel-588104500'
  const OTHER = 'doka-framax-panel-588223500'

  test('a rate against an id that names nothing is refused', () => {
    // Same consequence as the rack's: it would be stored, reported as recorded, and
    // never match a bill line — so a model that was told "ok" tells the user the panel
    // is priced.
    const result = apply(undefined, {
      rates: { byCatalogId: { 'doka-framax-panel-90x270': { purchasePerUnit: 200 } } },
    })

    expect(result.error).toContain('price nothing')
    expect(result.writes).toBeUndefined()
  })

  test('a hire percentage with nothing to be a percentage of is refused', () => {
    const result = apply(undefined, {
      rates: { byCatalogId: { [PANEL]: { rentalPercentPerMonth: 3 } } },
    })

    expect(result.error).toContain('percentage of')
    expect(result.writes).toBeUndefined()
  })

  test('a hire percentage is accepted against a list price already recorded', () => {
    // The ordinary way this table gets filled in — the two fields are entered at
    // different times, and validating the patch in isolation would make them
    // impossible to state in either order.
    const result = apply(node({ rates: { byCatalogId: { [PANEL]: { purchasePerUnit: 200 } } } }), {
      rates: { byCatalogId: { [PANEL]: { rentalPercentPerMonth: 3 } } },
    })

    expect(result.error).toBeUndefined()
    expect(result.writes?.rates?.byCatalogId?.[PANEL]).toEqual({
      purchasePerUnit: 200,
      rentalPercentPerMonth: 3,
    })
  })

  test('a hire percentage is accepted beside a flat rate, which needs no list price', () => {
    const result = apply(undefined, {
      rates: { byCatalogId: { [PANEL]: { rentalPercentPerMonth: 3, rentalPerUnitPerMonth: 6 } } },
    })

    expect(result.error).toBeUndefined()
  })

  test('a second part merges instead of replacing the table', () => {
    const result = apply(node({ rates: { byCatalogId: { [PANEL]: { purchasePerUnit: 200 } } } }), {
      rates: { byCatalogId: { [OTHER]: { purchasePerUnit: 260 } } },
    })

    expect(result.writes?.rates?.byCatalogId).toEqual({
      [PANEL]: { purchasePerUnit: 200 },
      [OTHER]: { purchasePerUnit: 260 },
    })
  })

  test('null against a field clears it without removing the part', () => {
    const result = apply(
      node({
        rates: { byCatalogId: { [PANEL]: { purchasePerUnit: 200, rentalPercentPerMonth: 3 } } },
      }),
      { rates: { byCatalogId: { [PANEL]: { rentalPercentPerMonth: null } } } },
    )

    expect(result.writes?.rates?.byCatalogId).toEqual({ [PANEL]: { purchasePerUnit: 200 } })
  })

  test('null against a whole part removes it', () => {
    const result = apply(
      node({
        rates: {
          byCatalogId: { [PANEL]: { purchasePerUnit: 200 }, [OTHER]: { purchasePerUnit: 260 } },
        },
      }),
      { rates: { byCatalogId: { [PANEL]: null } } },
    )

    expect(result.writes?.rates?.byCatalogId).toEqual({ [OTHER]: { purchasePerUnit: 260 } })
  })

  test('an emptied table stays stated rather than reverting to nobody having said', () => {
    const result = apply(node({ rates: { byCatalogId: { [PANEL]: { purchasePerUnit: 200 } } } }), {
      rates: { byCatalogId: { [PANEL]: null } },
    })

    expect(result.writes?.rates).toEqual({ byCatalogId: {} })
  })

  test('null against the minimum hire period clears it rather than being skipped', () => {
    // The one place an absent key and a null diverge at the group's own level: skipped,
    // a project that has dropped its minimum keeps being charged 28 days a line.
    const result = apply(node({ rates: { minHireDays: 28, byCatalogId: {} } }), {
      rates: { minHireDays: null },
    })

    expect(result.writes?.rates).toEqual({ byCatalogId: {} })
  })

  test('a currency and a minimum period on their own are a real call', () => {
    const result = apply(undefined, { rates: { currency: 'GBP', minHireDays: 28 } })

    expect(result.error).toBeUndefined()
    expect(result.changed).toEqual(['rates'])
    expect(result.writes?.rates).toEqual({ currency: 'GBP', minHireDays: 28, byCatalogId: {} })
  })

  test('a lower-case currency is refused, because ISO 4217 is what a surface formats against', () => {
    expect(FormworkSettingsPatch.safeParse({ rates: { currency: 'gbp' } }).success).toBe(false)
  })
})

describe('applyFormworkSettingsPatch — the site’s crane', () => {
  const CURVE = [
    { radiusM: 14, capacityKg: 8000 },
    { radiusM: 40, capacityKg: 2200 },
  ]

  test('a capacity that rises with radius is refused, because it passes every gang', () => {
    // The error worth refusing hardest: the pairs are plausible on their own, store
    // fine, and report every gang on the job as liftable — so it reads as a check that
    // ran. A chart with the columns fully swapped is caught a layer earlier, by the
    // schema's own bounds: no crane has a 2200 m radius.
    const result = apply(undefined, {
      crane: {
        capacityCurve: [
          { radiusM: 14, capacityKg: 2200 },
          { radiusM: 40, capacityKg: 8000 },
        ],
      },
    })

    expect(result.error).toContain('the wrong way round')
    expect(result.writes).toBeUndefined()
    expect(
      FormworkSettingsPatch.safeParse({
        crane: { capacityCurve: [{ radiusM: 2200, capacityKg: 40 }] },
      }).success,
    ).toBe(false)
  })

  test('two capacities at one radius are refused, since there is no rule for which wins', () => {
    const result = apply(undefined, {
      crane: {
        capacityCurve: [
          { radiusM: 20, capacityKg: 5600 },
          { radiusM: 20, capacityKg: 4000 },
        ],
      },
    })

    expect(result.error).toContain('two capacities')
    expect(result.writes).toBeUndefined()
  })

  test('an empty curve is refused rather than stored as a crane that lifts nothing', () => {
    const result = apply(undefined, { crane: { capacityCurve: [] } })

    expect(result.error).toContain('pass null to remove')
    expect(result.writes).toBeUndefined()
  })

  test('a flat outer section is accepted, because real charts have one', () => {
    const result = apply(undefined, {
      crane: {
        capacityCurve: [
          { radiusM: 14, capacityKg: 8000 },
          { radiusM: 35, capacityKg: 2200 },
          { radiusM: 40, capacityKg: 2200 },
        ],
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.changed).toEqual(['crane'])
  })

  test('a second call replaces the chart rather than merging point by point', () => {
    // Against the merge rule every other table here follows, deliberately: half of a
    // 40 m jib's chart merged with half of a 55 m one is a machine that does not exist.
    const result = apply(node({ crane: { capacityCurve: CURVE, hookHeightM: 40 } }), {
      crane: { capacityCurve: [{ radiusM: 55, capacityKg: 1600 }] },
    })

    expect(result.writes?.crane?.capacityCurve).toEqual([{ radiusM: 55, capacityKg: 1600 }])
    expect(result.writes?.crane?.hookHeightM).toBe(40)
  })

  test('null against the chart removes it without removing the rest of the crane', () => {
    const result = apply(node({ crane: { capacityCurve: CURVE, maxGangWidthMm: 3000 } }), {
      crane: { capacityCurve: null },
    })

    expect(result.writes?.crane).toEqual({ maxGangWidthMm: 3000 })
  })

  test('a road width on its own is a real call — the lorry is a limit without a chart', () => {
    const result = apply(undefined, { crane: { maxGangWidthMm: 3000 } })

    expect(result.error).toBeUndefined()
    expect(result.writes?.crane).toEqual({ maxGangWidthMm: 3000 })
  })

  test('a sling angle outside the workable band is refused by the schema', () => {
    expect(FormworkSettingsPatch.safeParse({ crane: { minSlingAngleDeg: 5 } }).success).toBe(false)
    expect(FormworkSettingsPatch.safeParse({ crane: { minSlingAngleDeg: 60 } }).success).toBe(true)
  })
})

describe('applyFormworkSettingsPatch — the deliveries and the crane hours', () => {
  test('the quantities merge into logistics and the money into rates', () => {
    // Two groups in one call, because that is how a user states it: "8 t lorries at £400 a
    // load". The split is the single-currency rule — one place says what money this is.
    const result = apply(undefined, {
      logistics: { lorryPayloadKg: 8000, minutesPerPick: 25 },
      rates: { currency: 'GBP', transportPerLoad: 400, cranePerHour: 120 },
    })

    expect(result.error).toBeUndefined()
    expect(result.writes?.logistics).toEqual({ lorryPayloadKg: 8000, minutesPerPick: 25 })
    expect(result.writes?.rates?.transportPerLoad).toBe(400)
    expect(result.writes?.rates?.cranePerHour).toBe(120)
    expect(result.changed).toContain('logistics')
  })

  test('a cycle time arriving later does not delete the payload stated before it', () => {
    const result = apply(node({ logistics: { lorryPayloadKg: 8000 } }), {
      logistics: { minutesPerPick: 25 },
    })

    expect(result.writes?.logistics).toEqual({ lorryPayloadKg: 8000, minutesPerPick: 25 })
  })

  test('null unstates one figure and leaves the other where it is', () => {
    // The third state doing its work on the half of this that is money: a crane hire
    // that ends does not retract the haulier's quote.
    const result = apply(
      node({
        logistics: { lorryPayloadKg: 8000, minutesPerPick: 25 },
        rates: { transportPerLoad: 400, cranePerHour: 120 },
      }),
      { logistics: { minutesPerPick: null }, rates: { cranePerHour: null } },
    )

    expect(result.writes?.logistics).toEqual({ lorryPayloadKg: 8000 })
    expect(result.writes?.rates?.transportPerLoad).toBe(400)
    expect(result.writes?.rates?.cranePerHour).toBeUndefined()
  })

  test('a return fraction over one is refused — more lorries come back than went out', () => {
    expect(
      FormworkSettingsPatch.safeParse({ logistics: { returnLoadFraction: 1.4 } }).success,
    ).toBe(false)
    expect(FormworkSettingsPatch.safeParse({ logistics: { returnLoadFraction: 0 } }).success).toBe(
      true,
    )
  })

  test('a lorry that carries a hundred tonnes is refused by the schema', () => {
    expect(
      FormworkSettingsPatch.safeParse({ logistics: { lorryPayloadKg: 200_000 } }).success,
    ).toBe(false)
    // Ten hours for one pick is not a cycle time either.
    expect(FormworkSettingsPatch.safeParse({ logistics: { minutesPerPick: 900 } }).success).toBe(
      false,
    )
  })
})

describe('applyFormworkSettingsPatch — the sheets the ply comes out of', () => {
  test('the stated sheets and the offcut policy are one group', () => {
    const result = apply(undefined, {
      sheets: {
        stockIds: ['ply-1220x2440x18-plain'],
        minKeepWidthMm: 150,
        handlingWasteFraction: 0.08,
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.writes?.sheets).toEqual({
      stockIds: ['ply-1220x2440x18-plain'],
      minKeepWidthMm: 150,
      handlingWasteFraction: 0.08,
    })
    expect(result.changed).toContain('sheets')
  })

  test('a threshold arriving later does not delete the sheet stated before it', () => {
    const result = apply(node({ sheets: { stockIds: ['ply-1220x2440x18-plain'] } }), {
      sheets: { minKeepLengthMm: 600 },
    })

    expect(result.writes?.sheets).toEqual({
      stockIds: ['ply-1220x2440x18-plain'],
      minKeepLengthMm: 600,
    })
  })

  test('a stated list replaces the sheets rather than merging into them', () => {
    // Which sizes a yard buys is one fact, like the crane's chart: two sizes stated and one
    // restated is a yard that has dropped a size, not one that still buys both.
    const result = apply(
      node({ sheets: { stockIds: ['ply-1220x2440x18-plain', 'ply-1250x2500x18-birch-wbp'] } }),
      { sheets: { stockIds: ['ply-1250x2500x18-birch-wbp'] } },
    )

    expect(result.writes?.sheets).toEqual({ stockIds: ['ply-1250x2500x18-birch-wbp'] })
  })

  test('a sheathing grade stated as a sheet is refused, and told where it belongs', () => {
    // The refusal this group most needs, because the id is a real catalog id: a model
    // reaching for the face material it already knows would have it accepted by any check
    // built on the stockable catalog, stored, and nest not one board — a grade carries no
    // width and no length.
    const result = apply(undefined, { sheets: { stockIds: ['film-faced-ply-18'] } })

    expect(result.error).toContain('sheathing grade')
    expect(result.error).toContain('parts.sheathingId')
    expect(result.writes).toBeUndefined()
  })

  test('an invented sheet size is refused with the catalog in the message', () => {
    const result = apply(undefined, { sheets: { stockIds: ['ply-1200x2400x18'] } })

    expect(result.error).toContain('no sheet stock')
    expect(result.error).toContain('ply-1220x2440x18-plain')
  })

  test('null unstates a threshold and leaves the sheet where it is', () => {
    const result = apply(
      node({ sheets: { stockIds: ['ply-1220x2440x18-plain'], minKeepWidthMm: 150 } }),
      { sheets: { minKeepWidthMm: null } },
    )

    expect(result.writes?.sheets).toEqual({ stockIds: ['ply-1220x2440x18-plain'] })
  })

  test('a handling waste of half the order is refused by the schema', () => {
    // Above 50 % is a figure entered as a percentage rather than a fraction, and it would
    // double a ply order without looking wrong on a panel.
    expect(FormworkSettingsPatch.safeParse({ sheets: { handlingWasteFraction: 8 } }).success).toBe(
      false,
    )
    expect(
      FormworkSettingsPatch.safeParse({ sheets: { handlingWasteFraction: 0.08 } }).success,
    ).toBe(true)
  })

  test('a sheet size the length of a lorry is refused by the schema', () => {
    expect(FormworkSettingsPatch.safeParse({ sheets: { minKeepWidthMm: 12_000 } }).success).toBe(
      false,
    )
  })
})

describe('formworkSettingsReport', () => {
  test('reports the assumed defaults as assumed on an untouched project', () => {
    const report = formworkSettingsReport(undefined)

    expect(report.anythingStated).toBe(false)
    expect(report.stated).toBeNull()
    expect(report.resolved.riseRateMH).toBe(report.assumedDefaults.riseRateMH)
    expect(report.resolved.concreteTemperatureC).toBe(report.assumedDefaults.concreteTemperatureC)
  })

  test('separates what the project stated from what resolved around it', () => {
    const report = formworkSettingsReport(node({ placement: { riseRateMH: 2 } }))

    expect(report.stated?.placement).toEqual({ riseRateMH: 2 })
    expect(report.resolved.riseRateMH).toBe(2)
    // Stated nothing about the temperature, so it is still an assumption.
    expect(report.stated?.placement?.concreteTemperatureC).toBeUndefined()
    expect(report.resolved.concreteTemperatureC).toBe(report.assumedDefaults.concreteTemperatureC)
  })

  test('an unrecorded rack reads as null, not as a yard that owns nothing', () => {
    const report = formworkSettingsReport(node({ placement: { riseRateMH: 2 } }))

    expect(report.resolved.ownedStock).toBeNull()
    expect(report.stated?.stock).toBeNull()
  })

  test('a recorded but emptied rack reads as empty, which is a different claim', () => {
    const report = formworkSettingsReport(node({ stock: { owned: {} } }))

    expect(report.resolved.ownedStock).toEqual({})
  })

  test('unrecorded rates read as null, which is what "no money on the takeoff" means', () => {
    const report = formworkSettingsReport(node({ placement: { riseRateMH: 2 } }))

    expect(report.resolved.rates).toBeNull()
    expect(report.stated?.rates).toBeNull()
  })

  test('a stated table with nothing in it reads as an empty table', () => {
    const report = formworkSettingsReport(node({ rates: { currency: 'GBP' } }))

    expect(report.resolved.rates).toEqual({ currency: 'GBP', byCatalogId: {} })
  })

  test('an unrecorded crane reads as null, which means no gang was checked against a lift', () => {
    const report = formworkSettingsReport(node({ placement: { riseRateMH: 2 } }))

    expect(report.resolved.crane).toBeNull()
    expect(report.stated?.crane).toBeNull()
  })

  test('a recorded crane is reported as stated, chart and all', () => {
    const crane = { capacityCurve: [{ radiusM: 40, capacityKg: 2200 }], hookHeightM: 44 }
    const report = formworkSettingsReport(node({ crane }))

    expect(report.resolved.crane).toEqual(crane)
    expect(report.stated?.crane).toEqual(crane)
  })

  test('an unrecorded payload reads as null, which is a takeoff with no transport in it', () => {
    const report = formworkSettingsReport(node({ placement: { riseRateMH: 2 } }))

    expect(report.resolved.logistics).toBeNull()
    expect(report.stated?.logistics).toBeNull()
  })

  test('the quantities and the money for them are reported in the two groups they live in', () => {
    // The split this group exists on: a payload and a cycle time are quantities, and
    // their prices are money, so the currency is stated once beside every other rate.
    const report = formworkSettingsReport(
      node({
        logistics: { lorryPayloadKg: 24_000, minutesPerPick: 20 },
        rates: { currency: 'GBP', transportPerLoad: 400, cranePerHour: 120 },
      }),
    )

    expect(report.resolved.logistics).toEqual({ lorryPayloadKg: 24_000, minutesPerPick: 20 })
    expect(report.resolved.rates?.transportPerLoad).toBe(400)
    expect(report.resolved.rates?.cranePerHour).toBe(120)
    expect(report.resolved.rates?.currency).toBe('GBP')
  })

  test('an unrecorded sheet reads as null, which is a takeoff with no cut list in it', () => {
    // And the sheathing grade beside it is not an answer to this: it is the face material,
    // and a nest needs a width and a length.
    const report = formworkSettingsReport(node({ parts: { sheathingId: 'film-faced-ply-18' } }))

    expect(report.resolved.sheets).toBeNull()
    expect(report.stated?.sheets).toBeNull()
    expect(report.resolved.parts.sheathingId).toBe('film-faced-ply-18')
  })

  test('a recorded sheet is reported as stated, policy and all', () => {
    const sheets = {
      stockIds: ['ply-1220x2440x18-plain'],
      minKeepAreaM2: 0.5,
      handlingWasteFraction: 0.05,
    }
    const report = formworkSettingsReport(node({ sheets }))

    expect(report.resolved.sheets).toEqual(sheets)
    expect(report.stated?.sheets).toEqual(sheets)
  })

  test('curing is reported unstated rather than resolved to a default', () => {
    // Against the rule every pressure input follows, deliberately: the striking tables
    // print their own conservative column and name what they took in the takeoff's
    // `hire.assumed`, so a number resolved here would be indistinguishable from a
    // stated one.
    const report = formworkSettingsReport(undefined)

    expect(report.resolved.curing).toEqual({})
    expect(report.assumedDefaults).not.toHaveProperty('surfaceTemperatureC')
  })
})
