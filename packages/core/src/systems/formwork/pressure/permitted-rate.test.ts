import { describe, expect, test } from 'bun:test'
import type { ConcreteMix, Placement } from './index'
import { riseRateLimit } from './index'

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
