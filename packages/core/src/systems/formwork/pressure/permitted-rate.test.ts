import { describe, expect, test } from 'bun:test'
import type { ConcreteMix, Placement } from './index'
import { riseRateLimit, supplyRiseRate } from './index'

const mix: ConcreteMix = { densityKgM3: 2400, consistency: 'F3' }

const wall = (over: Partial<Placement> = {}): Placement => ({
  riseRateMH: 2,
  concreteTemperatureC: 20,
  pourHeightM: 3,
  elementKind: 'wall',
  vibration: 'internal',
  ...over,
})

describe('riseRateLimit', () => {
  test('names the rate that brings the pour inside a panel rating', () => {
    const limit = riseRateLimit('DIN_18218', mix, wall({ riseRateMH: 4 }), 60, 78)
    expect(limit.maxRateMH).toBeGreaterThan(0)
    // Slower than what was stated, or the check would be reporting a pass as a fault.
    expect(limit.maxRateMH ?? 0).toBeLessThan(4)
    expect(limit.refusal).toBeUndefined()
    expect(limit.statedRateMH).toBe(4)
  })

  test('answers under ACI too, and differently — the equations are not the same', () => {
    const din = riseRateLimit('DIN_18218', mix, wall(), 40, 55)
    const aci = riseRateLimit('ACI_347', mix, wall(), 40, 55)
    expect(aci.maxRateMH).toBeGreaterThan(0)
    expect(aci.maxRateMH).not.toBe(din.maxRateMH)
  })

  test('refuses under the two standards that cannot be inverted', () => {
    for (const standard of ['BS_5975_SHORTCUT', 'CIRIA_108'] as const) {
      const limit = riseRateLimit(standard, mix, wall(), 40, 55)
      expect(limit.refusal).toBe('standard-does-not-invert')
      expect(limit.maxRateMH).toBeUndefined()
      // The figures it does hold still travel, so a surface can state the overload.
      expect(limit.designKnM2).toBe(55)
      expect(limit.permissibleKnM2).toBe(40)
    }
  })

  test('refuses a rating the constant term alone exceeds', () => {
    // Under 7.2 kPa on ACI: no rate of rise reaches it, so there is no rate to report.
    const limit = riseRateLimit('ACI_347', mix, wall(), 5, 55)
    expect(limit.refusal).toBe('no-rate-is-slow-enough')
    expect(limit.maxRateMH).toBeUndefined()
  })
})

describe('supplyRiseRate', () => {
  test('turns an output into a rate of rise through the plan area', () => {
    // 12 m³/h into 6 m² of plan is 2 m/h; into a 0.36 m² column it would be 33.
    expect(supplyRiseRate({ batchPlantOutputM3PerHour: 12 }, 6)?.sustainableRateMH).toBe(2)
    expect(supplyRiseRate({ batchPlantOutputM3PerHour: 12 }, 0.36)?.sustainableRateMH).toBe(33.33)
  })

  test('takes the narrower end and names which it was', () => {
    const limited = supplyRiseRate({ batchPlantOutputM3PerHour: 40, pumpRateM3PerHour: 15 }, 5)
    expect(limited?.governing).toBe('pump')
    expect(limited?.outputM3PerHour).toBe(15)
    // The remedy differs, which is why two fields are asked for rather than one figure.
    const starved = supplyRiseRate({ batchPlantOutputM3PerHour: 15, pumpRateM3PerHour: 40 }, 5)
    expect(starved?.governing).toBe('batch-plant')
  })

  test('has no answer without a stated figure or a plan area', () => {
    expect(supplyRiseRate(undefined, 6)).toBeUndefined()
    expect(supplyRiseRate({}, 6)).toBeUndefined()
    expect(supplyRiseRate({ pumpRateM3PerHour: 10 }, 0)).toBeUndefined()
  })
})

describe('which of the three governs', () => {
  test('the stated rate, where it is inside both ceilings', () => {
    const limit = riseRateLimit(
      'DIN_18218',
      mix,
      wall(),
      60,
      40,
      supplyRiseRate({ pumpRateM3PerHour: 20 }, 1),
    )
    expect(limit.governing).toBe('stated')
    expect(limit.effectiveRateMH).toBe(2)
  })

  test('the supply, where it is slower than the pour anybody intended', () => {
    const limit = riseRateLimit(
      'DIN_18218',
      mix,
      wall(),
      60,
      40,
      supplyRiseRate({ pumpRateM3PerHour: 1 }, 1),
    )
    expect(limit.governing).toBe('concrete-supply')
    expect(limit.effectiveRateMH).toBe(1)
  })

  test('the rating, and only where the pour actually exceeds it', () => {
    // Over the rating: the inverse solve is the ceiling, and it governs.
    const over = riseRateLimit('DIN_18218', mix, wall({ riseRateMH: 4 }), 60, 78)
    expect(over.governing).toBe('panel-rating')
    expect(over.effectiveRateMH).toBe(over.maxRateMH)
    // Inside it: a panel rated well above this pressure still inverts to some rate, and
    // that rate is not what the pour is doing.
    const inside = riseRateLimit('DIN_18218', mix, wall(), 90, 40)
    expect(inside.governing).toBe('stated')
    expect(inside.effectiveRateMH).toBe(2)
  })

  test('a rating and a supply on one pour: the slower of the two', () => {
    const limit = riseRateLimit(
      'DIN_18218',
      mix,
      wall({ riseRateMH: 4 }),
      60,
      78,
      supplyRiseRate({ batchPlantOutputM3PerHour: 0.5 }, 1),
    )
    expect(limit.governing).toBe('concrete-supply')
    expect(limit.effectiveRateMH).toBe(0.5)
  })

  test('answers for a shutter with no rating at all', () => {
    const limit = riseRateLimit(
      'DIN_18218',
      mix,
      wall(),
      undefined,
      40,
      supplyRiseRate({ pumpRateM3PerHour: 1 }, 1),
    )
    expect(limit.permissibleKnM2).toBeUndefined()
    expect(limit.maxRateMH).toBeUndefined()
    // Not a refusal: there is nothing to invert, rather than a code that cannot invert.
    expect(limit.refusal).toBeUndefined()
    expect(limit.governing).toBe('concrete-supply')
  })
})
