import { describe, expect, test } from 'bun:test'
import {
  BASE_RUN_SPEED,
  BASE_WALK_SPEED,
  CROUCH_RUN_SPEED,
  CROUCH_WALK_SPEED,
  MAX_SPEED_SCALE,
  REFERENCE_SCENE_RADIUS_M,
  resolveSpeedScale,
  resolveWalkthroughSpeeds,
} from './walkthrough-speed'

const AUTO = { autoScale: true, multiplier: 1 }

describe('resolveSpeedScale', () => {
  /**
   * The constraint that shaped the whole function. Walkthrough in a house must
   * feel exactly as it does today; a change that made small scenes faster would
   * be a regression in the only scenes nobody complained about.
   */
  test('a house-sized scene is left exactly alone', () => {
    expect(resolveSpeedScale(16)).toBe(1)
    expect(resolveSpeedScale(REFERENCE_SCENE_RADIUS_M)).toBe(1)
  })

  test('a warehouse gets faster, a huge one stops at the cap', () => {
    // 100 × 120 m building → ~78 m bounding radius.
    expect(resolveSpeedScale(78)).toBeCloseTo(1.97, 2)
    expect(resolveSpeedScale(10_000)).toBe(MAX_SPEED_SCALE)
  })

  /**
   * Sub-linear growth is the design, so it is asserted rather than left to the
   * formula. Quadrupling the building must NOT quadruple the pace — at ×4 the
   * player overshoots whatever they were walking towards.
   */
  test('growth is sub-linear', () => {
    const small = resolveSpeedScale(REFERENCE_SCENE_RADIUS_M * 4)
    expect(small).toBeCloseTo(2, 5)
    expect(small).toBeLessThan(4)
  })

  /**
   * A single node with a NaN transform poisons the union box the radius comes
   * from — the same failure `lights.tsx` guards its shadow sphere against. A
   * NaN speed does not throw; it freezes the player with nothing in the console.
   */
  test.each([
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['negative', -5],
  ])('an unusable radius (%s) falls back to 1', (_label, radius) => {
    expect(resolveSpeedScale(radius)).toBe(1)
  })
})

describe('resolveWalkthroughSpeeds', () => {
  test('a house walks and runs at the numbers walkthrough has always used', () => {
    expect(resolveWalkthroughSpeeds(16, AUTO, false)).toEqual({
      walk: BASE_WALK_SPEED,
      run: BASE_RUN_SPEED,
    })
  })

  /** Crouching is a precision move; no multiplier may touch it. */
  test('crouching ignores every multiplier', () => {
    const crouched = resolveWalkthroughSpeeds(10_000, { autoScale: true, multiplier: 4 }, true)
    expect(crouched).toEqual({ walk: CROUCH_WALK_SPEED, run: CROUCH_RUN_SPEED })
  })

  test('turning auto-scale off leaves the base speeds in a warehouse', () => {
    expect(resolveWalkthroughSpeeds(78, { autoScale: false, multiplier: 1 }, false)).toEqual({
      walk: BASE_WALK_SPEED,
      run: BASE_RUN_SPEED,
    })
  })

  test('the manual multiplier compounds with the automatic one', () => {
    const auto = resolveWalkthroughSpeeds(78, AUTO, false)
    const doubled = resolveWalkthroughSpeeds(78, { autoScale: true, multiplier: 2 }, false)

    expect(doubled.walk).toBeCloseTo(auto.walk * 2, 5)
    expect(doubled.run).toBeCloseTo(auto.run * 2, 5)
  })

  /**
   * A persisted preference is user data read back from localStorage, so it can
   * be anything. Zero is the dangerous one: it does not throw, it just makes
   * the player unable to move, and the cause is invisible.
   */
  test.each([0, -1, Number.NaN])('a corrupt multiplier (%p) is ignored, not obeyed', (bad) => {
    const speeds = resolveWalkthroughSpeeds(16, { autoScale: true, multiplier: bad }, false)
    expect(speeds).toEqual({ walk: BASE_WALK_SPEED, run: BASE_RUN_SPEED })
  })
})
