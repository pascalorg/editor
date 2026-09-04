import { describe, expect, test } from 'bun:test'
import {
  clampWallEndHeightOffset,
  MIN_WALL_END_HEIGHT,
  resolveWallEffectiveHeight,
  resolveWallTop,
} from './wall-top'

describe('clampWallEndHeightOffset', () => {
  test('returns 0 when offset is undefined or 0', () => {
    expect(clampWallEndHeightOffset(undefined, 3)).toBe(0)
    expect(clampWallEndHeightOffset(0, 3)).toBe(0)
  })

  test('preserves positive offsets without modification', () => {
    expect(clampWallEndHeightOffset(1.5, 3)).toBe(1.5)
    expect(clampWallEndHeightOffset(10, 3)).toBe(10)
  })

  test('allows safe negative offsets that leave at least minEndHeight', () => {
    expect(clampWallEndHeightOffset(-1.5, 3)).toBe(-1.5)
    expect(clampWallEndHeightOffset(-2.99, 3)).toBeCloseTo(-2.99)
  })

  test('clamps steep negative offsets to maintain minEndHeight (0.01m)', () => {
    // Body height 3m -> minimum end height 0.01m -> max negative offset -2.99m
    expect(clampWallEndHeightOffset(-5, 3)).toBeCloseTo(-2.99)
    expect(clampWallEndHeightOffset(-100, 2.5)).toBeCloseTo(-2.49)
  })

  test('clamps negative offsets when bodyHeight is already at or below minEndHeight', () => {
    expect(clampWallEndHeightOffset(-1, 0.01)).toBe(0)
    expect(clampWallEndHeightOffset(-1, 0.005)).toBe(0)
  })

  test('respects custom minEndHeight argument', () => {
    expect(clampWallEndHeightOffset(-2.5, 3, 1.0)).toBe(-2.0)
  })
})

describe('resolveWallTop', () => {
  test('explicit height on zero base keeps the stored top', () => {
    expect(resolveWallTop({ height: 2.5 }, 3, 0, 0)).toBe(2.5)
  })

  test('explicit height on raised base rides the base', () => {
    expect(resolveWallTop({ height: 2.5 }, 3, 0.6, 0)).toBeCloseTo(3.1)
  })

  test('explicit height on sunken base keeps the absolute top', () => {
    expect(resolveWallTop({ height: 2.5 }, 3, -0.4, 0)).toBe(2.5)
  })

  test('ground-hosted explicit height remains body-relative in a terrain depression', () => {
    expect(resolveWallTop({ height: 2.5, supportSlabId: 'ground' }, 3, -0.4, 0)).toBeCloseTo(2.1)
    expect(
      resolveWallEffectiveHeight({ height: 2.5, supportSlabId: 'ground' }, 3, -0.4, 0),
    ).toBeCloseTo(2.5)
  })

  test('plane-bound wall tops out at the storey plane regardless of base', () => {
    expect(resolveWallTop({}, 3, 0, 0)).toBe(3)
    expect(resolveWallTop({}, 3, 0.6, 0)).toBe(3)
    expect(resolveWallTop({}, 3, -0.4, 0)).toBe(3)
  })

  test('positive endHeightOffset slopes the top upwards linearly from start to end', () => {
    const wall = { height: 2.5, endHeightOffset: 1.0 }
    expect(resolveWallTop(wall, 3, 0, 0)).toBe(2.5)
    expect(resolveWallTop(wall, 3, 0, 0.5)).toBeCloseTo(3.0)
    expect(resolveWallTop(wall, 3, 0, 1)).toBeCloseTo(3.5)
  })

  test('negative endHeightOffset slopes the top downwards linearly', () => {
    const wall = { height: 3.0, endHeightOffset: -1.0 }
    expect(resolveWallTop(wall, 3, 0, 0)).toBe(3.0)
    expect(resolveWallTop(wall, 3, 0, 0.5)).toBeCloseTo(2.5)
    expect(resolveWallTop(wall, 3, 0, 1)).toBeCloseTo(2.0)
  })

  test('excessive negative endHeightOffset clamps so top at end stays at base + MIN_WALL_END_HEIGHT', () => {
    const wall = { height: 2.5, endHeightOffset: -5.0 }
    expect(resolveWallTop(wall, 3, 0, 0)).toBe(2.5)
    // Clamped offset = -2.49 -> top at t=1 is 2.5 - 2.49 = 0.01 (MIN_WALL_END_HEIGHT)
    expect(resolveWallTop(wall, 3, 0, 1)).toBeCloseTo(MIN_WALL_END_HEIGHT)
  })

  test('plane-bound sloped wall on raised base computes body relative to electedBase', () => {
    // storeyHeight = 3, base = 0.6 -> unsloped top = 3, bodyHeight = 2.4
    const wall = { endHeightOffset: 1.0 }
    expect(resolveWallTop(wall, 3, 0.6, 0)).toBe(3.0)
    expect(resolveWallTop(wall, 3, 0.6, 0.5)).toBeCloseTo(3.5)
    expect(resolveWallTop(wall, 3, 0.6, 1)).toBeCloseTo(4.0)
  })

  test('explicit sloped wall on raised base rides the base across t', () => {
    // height = 2.0, base = 0.5 -> unsloped top = 2.5, bodyHeight = 2.0
    const wall = { height: 2.0, endHeightOffset: 1.0 }
    expect(resolveWallTop(wall, 3, 0.5, 0)).toBeCloseTo(2.5)
    expect(resolveWallTop(wall, 3, 0.5, 1)).toBeCloseTo(3.5)
  })

  test('ground-hosted sloped wall in depression applies slope relative to base top', () => {
    // height = 2.5, ground base = -0.5 -> unsloped top = 2.0, bodyHeight = 2.5
    const wall = { height: 2.5, supportSlabId: 'ground', endHeightOffset: 1.0 }
    expect(resolveWallTop(wall, 3, -0.5, 0)).toBeCloseTo(2.0)
    expect(resolveWallTop(wall, 3, -0.5, 0.5)).toBeCloseTo(2.5)
    expect(resolveWallTop(wall, 3, -0.5, 1)).toBeCloseTo(3.0)
  })
})

describe('resolveWallEffectiveHeight', () => {
  test('explicit on raised base extrudes the stored height', () => {
    expect(resolveWallEffectiveHeight({ height: 2.5 }, 3, 0.6, 0)).toBeCloseTo(2.5)
  })

  test('explicit on zero base extrudes the stored height', () => {
    expect(resolveWallEffectiveHeight({ height: 2.5 }, 3, 0, 0)).toBe(2.5)
  })

  test('plane-bound on raised base gets shorter, never taller', () => {
    expect(resolveWallEffectiveHeight({}, 3, 0.6, 0)).toBeCloseTo(2.4)
    expect(resolveWallEffectiveHeight({}, 3, 0.6, 0)).toBeLessThan(3)
  })

  test('plane-bound on zero base spans the full storey', () => {
    expect(resolveWallEffectiveHeight({}, 3, 0, 0)).toBe(3)
  })

  test('plane-bound on sunken base fills down while the top stays at the plane', () => {
    expect(resolveWallEffectiveHeight({}, 3, -0.4, 0)).toBeCloseTo(3.4)
  })

  test('sloped explicit wall computes effective height at any parametric t', () => {
    const wall = { height: 2.5, endHeightOffset: 0.8 }
    expect(resolveWallEffectiveHeight(wall, 3, 0.6, 0)).toBeCloseTo(2.5)
    expect(resolveWallEffectiveHeight(wall, 3, 0.6, 0.5)).toBeCloseTo(2.9)
    expect(resolveWallEffectiveHeight(wall, 3, 0.6, 1)).toBeCloseTo(3.3)
  })

  test('sloped plane-bound wall computes effective height with positive tilt', () => {
    const wall = { endHeightOffset: 1.2 }
    expect(resolveWallEffectiveHeight(wall, 3, 0, 0)).toBeCloseTo(3.0)
    expect(resolveWallEffectiveHeight(wall, 3, 0, 0.5)).toBeCloseTo(3.6)
    expect(resolveWallEffectiveHeight(wall, 3, 0, 1)).toBeCloseTo(4.2)
  })

  test('sloped plane-bound wall computes effective height with clamped negative tilt', () => {
    const wall = { endHeightOffset: -4.0 }
    expect(resolveWallEffectiveHeight(wall, 3, 0, 0)).toBeCloseTo(3.0)
    // Clamped offset = -2.99 -> effective height at t=1 is 0.01 (MIN_WALL_END_HEIGHT)
    expect(resolveWallEffectiveHeight(wall, 3, 0, 1)).toBeCloseTo(MIN_WALL_END_HEIGHT)
  })
})
