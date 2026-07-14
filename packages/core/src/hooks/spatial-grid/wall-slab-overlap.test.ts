import { describe, expect, it } from 'bun:test'
import { SlabNode, WallNode } from '../../schema'
import { computeWallSlabElevation, wallOverlapsPolygon } from './spatial-grid-manager'

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

describe('computeWallSlabElevation', () => {
  const parseWall = (start: [number, number], end: [number, number], thickness = 0.1) =>
    WallNode.parse({ start, end, thickness })

  it('lifts a wall standing on an auto slab stored at the centerlines', () => {
    const walls = [
      parseWall([0, 0], [4, 0]),
      parseWall([4, 0], [4, 4]),
      parseWall([4, 4], [0, 4]),
      parseWall([0, 4], [0, 0]),
    ]
    const slab = SlabNode.parse({ polygon: SLAB, elevation: 0.1 })

    const bottom = walls[0]!
    expect(
      computeWallSlabElevation(
        { start: bottom.start, end: bottom.end, thickness: bottom.thickness },
        [slab],
        walls,
      ),
    ).toBeCloseTo(0.1)
  })

  it('lifts a wall whose body a legacy stored polygon falls short of', () => {
    // Legacy hand-adjusted slab: edges 6cm inside the wall centerlines —
    // 1cm short of even the inner faces, so the STORED polygon never
    // touches the wall body and the old stored-polygon test returned 0.
    // The rendered footprint band-adopts the edges out to the outer
    // faces, so the wall stands on the slab.
    const walls = [
      parseWall([0, 0], [4, 0]),
      parseWall([4, 0], [4, 4]),
      parseWall([4, 4], [0, 4]),
      parseWall([0, 4], [0, 0]),
    ]
    const slab = SlabNode.parse({
      polygon: [
        [0.06, 0.06],
        [3.94, 0.06],
        [3.94, 3.94],
        [0.06, 3.94],
      ],
      elevation: 0.1,
    })

    const bottom = walls[0]!
    expect(
      computeWallSlabElevation(
        { start: bottom.start, end: bottom.end, thickness: bottom.thickness },
        [slab],
        walls,
      ),
    ).toBeCloseTo(0.1)
  })

  it('does not lift a wall clearly off the slab', () => {
    const walls = [parseWall([0, 0], [4, 0])]
    const slab = SlabNode.parse({ polygon: SLAB, elevation: 0.1 })

    expect(
      computeWallSlabElevation({ start: [0, -1], end: [4, -1], thickness: 0.1 }, [slab], walls),
    ).toBe(0)
  })

  it('ignores a slab when the wall runs entirely inside a hole', () => {
    const walls = [parseWall([1, 2], [3, 2])]
    const slab = SlabNode.parse({
      polygon: SLAB,
      elevation: 0.1,
      holes: [
        [
          [0.5, 0.5],
          [3.5, 0.5],
          [3.5, 3.5],
          [0.5, 3.5],
        ],
      ],
    })

    expect(
      computeWallSlabElevation({ start: [1, 2], end: [3, 2], thickness: 0.1 }, [slab], walls),
    ).toBe(0)
  })
})
