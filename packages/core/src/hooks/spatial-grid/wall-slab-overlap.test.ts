import { describe, expect, it } from 'bun:test'
import { wallOverlapsPolygon } from './spatial-grid-manager'

// 4×4 square slab, like an auto-slab derived from a room's wall centerlines.
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
  it('excludes perpendicular walls butting into the slab, on every side', () => {
    // Regression: side-dependent ray-cast tie-breaking used to push some of
    // these walls (depending on which slab edge they touched) but not others.
    expect(wallOverlapsPolygon(wall([2, 4], [2, 7]), SLAB)).toBe(false) // top
    expect(wallOverlapsPolygon(wall([2, 0], [2, -3]), SLAB)).toBe(false) // bottom
    expect(wallOverlapsPolygon(wall([0, 2], [-3, 2]), SLAB)).toBe(false) // left
    expect(wallOverlapsPolygon(wall([4, 2], [7, 2]), SLAB)).toBe(false) // right
    // Reversed direction (endpoint order must not matter)
    expect(wallOverlapsPolygon(wall([2, 7], [2, 4]), SLAB)).toBe(false)
    expect(wallOverlapsPolygon(wall([-3, 2], [0, 2]), SLAB)).toBe(false)
  })

  it('includes walls lying on the slab boundary, on every side', () => {
    expect(wallOverlapsPolygon(wall([0, 0], [4, 0]), SLAB)).toBe(true) // bottom
    expect(wallOverlapsPolygon(wall([4, 0], [4, 4]), SLAB)).toBe(true) // right
    expect(wallOverlapsPolygon(wall([4, 4], [0, 4]), SLAB)).toBe(true) // top
    expect(wallOverlapsPolygon(wall([0, 4], [0, 0]), SLAB)).toBe(true) // left
    // Partial edge coverage still counts
    expect(wallOverlapsPolygon(wall([1, 0], [3, 0]), SLAB)).toBe(true)
  })

  it('includes a wall running past the slab if enough of it lies on the edge', () => {
    // 4m on the edge + 6m beyond: whole wall follows the slab.
    expect(wallOverlapsPolygon(wall([0, 0], [10, 0]), SLAB)).toBe(true)
  })

  it('excludes corner-only contact', () => {
    expect(wallOverlapsPolygon(wall([4, 4], [6, 6]), SLAB)).toBe(false)
    expect(wallOverlapsPolygon(wall([0, 0], [-2, -2]), SLAB)).toBe(false)
  })

  it('includes walls inside or crossing through the slab', () => {
    expect(wallOverlapsPolygon(wall([1, 1], [3, 3]), SLAB)).toBe(true) // fully inside
    expect(wallOverlapsPolygon(wall([-1, 2], [5, 2]), SLAB)).toBe(true) // crossing
  })

  it('uses wall thickness: a face grazing the slab counts, clear separation does not', () => {
    // Centerline 4cm outside, body (half thickness 5cm) reaches the slab.
    expect(wallOverlapsPolygon(wall([0, -0.04], [4, -0.04]), SLAB)).toBe(true)
    // Centerline 1m outside: no contact.
    expect(wallOverlapsPolygon(wall([0, -1], [4, -1]), SLAB)).toBe(false)
  })

  it('handles curved walls by their sampled body', () => {
    // Chord below the slab, bowing into the slab interior (negative offset
    // bows toward +z here).
    expect(wallOverlapsPolygon(wall([0, -0.5], [4, -0.5], -1), SLAB)).toBe(true)
    // Same chord bowing away from the slab: never touches it.
    expect(wallOverlapsPolygon(wall([0, -0.5], [4, -0.5], 1), SLAB)).toBe(false)
  })

  it('supports the legacy (start, end, polygon) call shape', () => {
    expect(wallOverlapsPolygon([1, 1], [3, 3], SLAB)).toBe(true)
    expect(wallOverlapsPolygon([2, 4], [2, 7], SLAB)).toBe(false)
  })
})
