// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { clearLevelMiterCache, getCachedLevelMiters, sameMiterInputs } from './level-miter-cache'

function wall(overrides: Record<string, unknown> = {}) {
  return WallNode.parse({ start: [0, 0], end: [4, 0], height: 2.5, thickness: 0.2, ...overrides })
}

describe('level miter cache', () => {
  test('reuses the solution when the wall data is unchanged', () => {
    clearLevelMiterCache()
    const walls = [wall({ id: 'wall_a' })]
    const first = getCachedLevelMiters('level_1', walls)
    // A progressive rebuild passes a freshly mapped array every frame, so
    // identity cannot be the hit condition — equal field values must be.
    expect(getCachedLevelMiters('level_1', [...walls])).toBe(first)
  })

  test('recomputes when a wall moves', () => {
    clearLevelMiterCache()
    const before = getCachedLevelMiters('level_1', [wall({ id: 'wall_a' })])
    const after = getCachedLevelMiters('level_1', [wall({ id: 'wall_a', end: [6, 0] })])
    expect(after).not.toBe(before)
    expect(after.junctions).not.toBe(before.junctions)
  })

  test('keys by level, so two levels do not share a solution', () => {
    clearLevelMiterCache()
    const walls = [wall({ id: 'wall_a' })]
    expect(getCachedLevelMiters('level_2', walls)).not.toBe(getCachedLevelMiters('level_1', walls))
  })

  test('clearing drops entries so a remount cannot serve a previous project', () => {
    clearLevelMiterCache()
    const walls = [wall({ id: 'wall_a' })]
    const first = getCachedLevelMiters('level_1', walls)
    clearLevelMiterCache()
    expect(getCachedLevelMiters('level_1', walls)).not.toBe(first)
  })

  describe('input comparison', () => {
    test('accepts identical field values across distinct objects', () => {
      expect(sameMiterInputs([wall({ id: 'wall_a' })], [wall({ id: 'wall_a' })])).toBe(true)
    })

    test.each([
      ['id', { id: 'wall_b' }],
      ['start', { start: [1, 0] }],
      ['end', { end: [5, 0] }],
      ['thickness', { thickness: 0.4 }],
      ['curveOffset', { curveOffset: 0.5 }],
    ])('rejects a change to %s', (_field, change) => {
      expect(sameMiterInputs([wall({ id: 'wall_a' })], [wall({ id: 'wall_a', ...change })])).toBe(
        false,
      )
    })

    test('rejects a differing wall count', () => {
      expect(
        sameMiterInputs([wall({ id: 'wall_a' })], [wall({ id: 'wall_a' }), wall({ id: 'wall_b' })]),
      ).toBe(false)
    })
  })
})
