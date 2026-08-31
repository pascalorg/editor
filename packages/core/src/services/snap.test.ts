import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_ANGLE_STEP,
  DEFAULT_GRID_STEP,
  snapAngleToList,
  snapPointAlongAngleRay,
  snapPointToAngle,
  snapPointToGrid,
  snapScalar,
  snapServices,
  snapVec3ToGrid,
  type Vec2,
} from './snap'

describe('snapScalar', () => {
  test('rounds to multiples of step', () => {
    expect(snapScalar(0.27, 0.25)).toBe(0.25)
    expect(snapScalar(0.13, 0.25)).toBe(0.25)
    expect(snapScalar(0.12, 0.25)).toBe(0)
    expect(snapScalar(1.7, 0.25)).toBeCloseTo(1.75)
  })

  test('returns input unchanged when step is non-positive', () => {
    expect(snapScalar(0.42, 0)).toBe(0.42)
    expect(snapScalar(0.42, -1)).toBe(0.42)
  })

  test('default step is 0.25m', () => {
    expect(snapScalar(0.3)).toBe(0.25)
    expect(snapScalar(0.4)).toBe(0.5)
    expect(DEFAULT_GRID_STEP).toBe(0.25)
  })
})

describe('snapPointToGrid', () => {
  test('snaps both components independently', () => {
    expect(snapPointToGrid([0.3, 0.6], 0.25)).toEqual([0.25, 0.5])
  })

  test('preserves exact-grid points', () => {
    expect(snapPointToGrid([1, 2], 0.5)).toEqual([1, 2])
  })
})

describe('snapVec3ToGrid', () => {
  test('snaps X and Z, leaves Y untouched', () => {
    expect(snapVec3ToGrid([0.3, 1.7, 0.6], 0.25)).toEqual([0.25, 1.7, 0.5])
  })
})

describe('snapPointToAngle', () => {
  test('snaps to axis (0°) when cursor is near horizontal', () => {
    const from: Vec2 = [0, 0]
    const cursor: Vec2 = [1, 0.05] // near 0°
    const snapped = snapPointToAngle(from, cursor, Math.PI / 4)
    expect(snapped[0]).toBeCloseTo(1, 1)
    expect(snapped[1]).toBeCloseTo(0, 5)
  })

  test('snaps to 45° at π/4 step', () => {
    const from: Vec2 = [0, 0]
    const cursor: Vec2 = [1, 0.9] // near 45°
    const snapped = snapPointToAngle(from, cursor, Math.PI / 4)
    // distance preserved (≈ √(1² + 0.9²) ≈ 1.345), angle locked to 45°
    const expectedDist = Math.hypot(1, 0.9)
    expect(snapped[0]).toBeCloseTo(expectedDist * Math.cos(Math.PI / 4))
    expect(snapped[1]).toBeCloseTo(expectedDist * Math.sin(Math.PI / 4))
  })

  test('default angle step is π/12 (15°)', () => {
    expect(DEFAULT_ANGLE_STEP).toBeCloseTo(Math.PI / 12)
  })

  test('grid-snaps the projected point when gridStep is provided', () => {
    const from: Vec2 = [0, 0]
    const cursor: Vec2 = [1.05, 0.02] // ~horizontal, slightly off grid
    const snapped = snapPointToAngle(from, cursor, Math.PI / 4, 0.25)
    // After 0° lock + 0.25m grid, X must be a 0.25 multiple.
    expect(snapped[0] / 0.25).toBeCloseTo(Math.round(snapped[0] / 0.25))
  })

  test('preserves distance from `from`', () => {
    const from: Vec2 = [2, 3]
    const cursor: Vec2 = [3, 4]
    const distance = Math.hypot(1, 1)
    const snapped = snapPointToAngle(from, cursor, Math.PI / 4)
    expect(Math.hypot(snapped[0] - 2, snapped[1] - 3)).toBeCloseTo(distance)
  })
})

describe('snapPointAlongAngleRay', () => {
  test('stays exactly on the 15° ray while distance-snapping to the grid step', () => {
    const from: Vec2 = [0, 0]
    const cursor: Vec2 = [2, 0.5] // ≈14° — snaps to 15°
    const snapped = snapPointAlongAngleRay(from, cursor, Math.PI / 12, 0.25)
    expect(Math.atan2(snapped[1], snapped[0])).toBeCloseTo(Math.PI / 12, 10)
    const distance = Math.hypot(snapped[0], snapped[1])
    expect(distance / 0.25).toBeCloseTo(Math.round(distance / 0.25), 10)
  })

  test('grid-snapping after the angle projection would pull the point off the ray', () => {
    const from: Vec2 = [0, 0]
    const cursor: Vec2 = [2, 0.5]
    const offRay = snapPointToAngle(from, cursor, Math.PI / 12, 0.25)
    expect(Math.atan2(offRay[1], offRay[0])).not.toBeCloseTo(Math.PI / 12, 4)
  })

  test('45° back-compat: locks to the diagonal with grid-multiple distance', () => {
    const from: Vec2 = [1, 1]
    const cursor: Vec2 = [2.1, 1.9] // near 45° from `from`
    const snapped = snapPointAlongAngleRay(from, cursor, Math.PI / 4, 0.25)
    expect(Math.atan2(snapped[1] - 1, snapped[0] - 1)).toBeCloseTo(Math.PI / 4, 10)
    const distance = Math.hypot(snapped[0] - 1, snapped[1] - 1)
    expect(distance / 0.25).toBeCloseTo(Math.round(distance / 0.25), 10)
  })

  test('preserves the projected distance when no distanceStep is given', () => {
    const from: Vec2 = [0, 0]
    const cursor: Vec2 = [1, 0.05] // near 0°
    const snapped = snapPointAlongAngleRay(from, cursor, Math.PI / 12)
    expect(snapped[0]).toBeCloseTo(1, 10) // projection of (1, 0.05) onto 0° ray
    expect(snapped[1]).toBeCloseTo(0, 10)
  })

  test('returns `from` for a zero-length segment', () => {
    expect(snapPointAlongAngleRay([2, 3], [2, 3], Math.PI / 12, 0.25)).toEqual([2, 3])
  })

  test('is idempotent on its own output', () => {
    const from: Vec2 = [0.5, -1]
    const cursor: Vec2 = [3.2, 0.4]
    const once = snapPointAlongAngleRay(from, cursor, Math.PI / 12, 0.5)
    const twice = snapPointAlongAngleRay(from, once, Math.PI / 12, 0.5)
    expect(twice[0]).toBeCloseTo(once[0], 10)
    expect(twice[1]).toBeCloseTo(once[1], 10)
  })
})

describe('snapAngleToList', () => {
  test('snaps to the nearest entry within tolerance', () => {
    const targets = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
    expect(snapAngleToList(0.05, targets, Math.PI / 36)).toBe(0)
    expect(snapAngleToList(Math.PI / 2 + 0.02, targets, Math.PI / 36)).toBe(Math.PI / 2)
  })

  test('returns original angle when no target is within tolerance', () => {
    const targets = [0, Math.PI / 2]
    expect(snapAngleToList(0.5, targets, Math.PI / 36)).toBe(0.5)
  })

  test('handles wrap-around near ±π', () => {
    const targets = [Math.PI]
    expect(snapAngleToList(-Math.PI + 0.01, targets, Math.PI / 36)).toBe(Math.PI)
  })
})

describe('snapServices facade', () => {
  test('grid.snap matches snapPointToGrid', () => {
    expect(snapServices.grid.snap([0.3, 0.6], 0.25)).toEqual(snapPointToGrid([0.3, 0.6], 0.25))
  })

  test('grid.snapScalar matches snapScalar', () => {
    expect(snapServices.grid.snapScalar(0.3, 0.25)).toBe(snapScalar(0.3, 0.25))
  })

  test('angle.snapTo matches snapPointToAngle', () => {
    const from: Vec2 = [0, 0]
    const cursor: Vec2 = [1, 0.9]
    expect(snapServices.angle.snapTo(from, cursor, Math.PI / 4)).toEqual(
      snapPointToAngle(from, cursor, Math.PI / 4),
    )
  })
})
