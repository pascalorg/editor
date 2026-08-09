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
