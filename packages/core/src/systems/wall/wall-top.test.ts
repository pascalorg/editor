import { describe, expect, test } from 'bun:test'
import { resolveWallEffectiveHeight, resolveWallTop } from './wall-top'

describe('resolveWallTop', () => {
  test('explicit height on zero base keeps the stored top', () => {
    expect(resolveWallTop({ height: 2.5 }, 3, 0)).toBe(2.5)
  })

  test('explicit height on raised base rides the base', () => {
    expect(resolveWallTop({ height: 2.5 }, 3, 0.6)).toBeCloseTo(3.1)
  })

  test('explicit height on sunken base keeps the absolute top', () => {
    expect(resolveWallTop({ height: 2.5 }, 3, -0.4)).toBe(2.5)
  })

  test('plane-bound wall tops out at the storey plane regardless of base', () => {
    expect(resolveWallTop({}, 3, 0)).toBe(3)
    expect(resolveWallTop({}, 3, 0.6)).toBe(3)
    expect(resolveWallTop({}, 3, -0.4)).toBe(3)
  })
})

describe('resolveWallEffectiveHeight', () => {
  test('explicit on raised base extrudes the stored height', () => {
    expect(resolveWallEffectiveHeight({ height: 2.5 }, 3, 0.6)).toBeCloseTo(2.5)
  })

  test('explicit on zero base extrudes the stored height', () => {
    expect(resolveWallEffectiveHeight({ height: 2.5 }, 3, 0)).toBe(2.5)
  })

  test('plane-bound on raised base gets shorter, never taller', () => {
    expect(resolveWallEffectiveHeight({}, 3, 0.6)).toBeCloseTo(2.4)
    expect(resolveWallEffectiveHeight({}, 3, 0.6)).toBeLessThan(3)
  })

  test('plane-bound on zero base spans the full storey', () => {
    expect(resolveWallEffectiveHeight({}, 3, 0)).toBe(3)
  })

  test('plane-bound on sunken base fills down while the top stays at the plane', () => {
    expect(resolveWallEffectiveHeight({}, 3, -0.4)).toBeCloseTo(3.4)
  })
})
