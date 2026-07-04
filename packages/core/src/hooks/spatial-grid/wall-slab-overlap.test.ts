import { describe, expect, test } from 'bun:test'
import { wallOverlapsPolygon } from './spatial-grid-manager'

const SLAB: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

const wall = (start: [number, number], end: [number, number], curveOffset = 0) => ({
  start,
  end,
  curveOffset,
  thickness: 0.1,
})

describe('wallOverlapsPolygon', () => {
  test('excludes perpendicular walls butting into the slab on every side', () => {
    expect(wallOverlapsPolygon(wall([2, 4], [2, 7]), SLAB)).toBe(false)
    expect(wallOverlapsPolygon(wall([2, 0], [2, -3]), SLAB)).toBe(false)
    expect(wallOverlapsPolygon(wall([0, 2], [-3, 2]), SLAB)).toBe(false)
    expect(wallOverlapsPolygon(wall([4, 2], [7, 2]), SLAB)).toBe(false)
    expect(wallOverlapsPolygon(wall([2, 7], [2, 4]), SLAB)).toBe(false)
    expect(wallOverlapsPolygon(wall([-3, 2], [0, 2]), SLAB)).toBe(false)
  })

  test('includes walls lying on the slab boundary', () => {
    expect(wallOverlapsPolygon(wall([0, 0], [4, 0]), SLAB)).toBe(true)
    expect(wallOverlapsPolygon(wall([4, 0], [4, 4]), SLAB)).toBe(true)
    expect(wallOverlapsPolygon(wall([4, 4], [0, 4]), SLAB)).toBe(true)
    expect(wallOverlapsPolygon(wall([0, 4], [0, 0]), SLAB)).toBe(true)
    expect(wallOverlapsPolygon(wall([1, 0], [3, 0]), SLAB)).toBe(true)
  })

  test('excludes corner-only contact', () => {
    expect(wallOverlapsPolygon(wall([4, 4], [6, 6]), SLAB)).toBe(false)
    expect(wallOverlapsPolygon(wall([0, 0], [-2, -2]), SLAB)).toBe(false)
  })

  test('includes walls inside or crossing through the slab', () => {
    expect(wallOverlapsPolygon(wall([1, 1], [3, 3]), SLAB)).toBe(true)
    expect(wallOverlapsPolygon(wall([-1, 2], [5, 2]), SLAB)).toBe(true)
  })

  test('uses wall thickness for grazing overlap', () => {
    expect(wallOverlapsPolygon(wall([0, -0.04], [4, -0.04]), SLAB)).toBe(true)
    expect(wallOverlapsPolygon(wall([0, -1], [4, -1]), SLAB)).toBe(false)
  })

  test('handles curved walls by their sampled body', () => {
    expect(wallOverlapsPolygon(wall([0, -0.5], [4, -0.5], -1), SLAB)).toBe(true)
    expect(wallOverlapsPolygon(wall([0, -0.5], [4, -0.5], 1), SLAB)).toBe(false)
  })

  test('supports the legacy start/end call shape', () => {
    expect(wallOverlapsPolygon([1, 1], [3, 3], SLAB)).toBe(true)
    expect(wallOverlapsPolygon([2, 4], [2, 7], SLAB)).toBe(false)
  })
})
