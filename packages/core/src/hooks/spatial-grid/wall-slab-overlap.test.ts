import { describe, expect, it } from 'bun:test'
import { SlabNode, WallNode } from '../../schema'
import {
  computeWallSlabElevation,
  computeWallSlabSupport,
  wallOverlapsPolygon,
} from './spatial-grid-manager'

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
    const slab = SlabNode.parse({ polygon: SLAB, elevation: 0.1, thickness: 0.1 })

    const bottom = walls[0]!
    expect(
      computeWallSlabElevation(
        { start: bottom.start, end: bottom.end, thickness: bottom.thickness },
        [slab],
        walls,
      ),
    ).toBeCloseTo(0.1)
  })

  it('elects a floating deck for a wall standing on its drawn footprint', () => {
    // Wall ON a deck: no band adoption needed — the wall body lies inside
    // the deck's drawn polygon, which is exactly what a floating slab
    // renders.
    const deck = SlabNode.parse({ polygon: SLAB, elevation: 1.5 })
    const wallOnDeck = parseWall([1, 2], [3, 2])

    expect(
      computeWallSlabElevation(
        { start: [1, 2], end: [3, 2], thickness: 0.1 },
        [deck],
        [wallOnDeck],
      ),
    ).toBeCloseTo(1.5)
  })

  it('a wall in the adoption band beside a floating deck does not stand on it', () => {
    // Centerline 6cm below the deck's bottom edge — inside the adoption
    // band (half-thickness + 0.06) but the body never reaches the drawn
    // footprint. A grounded slab adopts the band and carries the wall; the
    // deck keeps its drawn polygon and offers no support.
    const bandWall = parseWall([0, -0.06], [4, -0.06])
    const wallLike = { start: bandWall.start, end: bandWall.end, thickness: bandWall.thickness }

    const deck = SlabNode.parse({ polygon: SLAB, elevation: 1.5 })
    expect(computeWallSlabElevation(wallLike, [deck], [bandWall])).toBe(0)

    const grounded = SlabNode.parse({ polygon: SLAB, elevation: 0.1, thickness: 0.1 })
    expect(computeWallSlabElevation(wallLike, [grounded], [bandWall])).toBeCloseTo(0.1)
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
    // Grounded (thickness = elevation): band adoption only applies to
    // grounded room floors under the vertical model.
    const slab = SlabNode.parse({
      polygon: [
        [0.06, 0.06],
        [3.94, 0.06],
        [3.94, 3.94],
        [0.06, 3.94],
      ],
      elevation: 0.1,
      thickness: 0.1,
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

  it('keeps a wall on the lower slab when a higher slab only reaches one endpoint', () => {
    // The floating-wall bug: a wall standing on the low room whose far
    // endpoint pokes 0.2m onto a raised platform must NOT lift wholesale.
    const low = SlabNode.parse({ polygon: SLAB, elevation: 0.05 })
    const high = SlabNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 4],
        [4, 4],
      ],
      elevation: 0.6,
    })

    expect(
      computeWallSlabElevation({ start: [0.5, 2], end: [4.2, 2], thickness: 0.1 }, [low, high], []),
    ).toBeCloseTo(0.05)
  })

  it('keeps a curved wall on the lower slab when a higher slab only reaches its end', () => {
    const low = SlabNode.parse({ polygon: SLAB, elevation: 0.05 })
    const high = SlabNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 4],
        [4, 4],
      ],
      elevation: 0.6,
    })

    expect(
      computeWallSlabElevation(
        { start: [0.5, 2], end: [4.2, 2], curveOffset: 0.5, thickness: 0.1 },
        [low, high],
        [],
      ),
    ).toBeCloseTo(0.05)
  })

  it('lifts a wall standing fully on a raised platform', () => {
    const platform = SlabNode.parse({ polygon: SLAB, elevation: 0.6 })

    expect(
      computeWallSlabElevation({ start: [1, 2], end: [3, 2], thickness: 0.1 }, [platform], []),
    ).toBeCloseTo(0.6)
  })

  it('lifts a wall half on a raised platform, half in the air, onto the platform', () => {
    // No elevation reaches majority (only 39% supported), so the
    // best-covered slab wins — the only alternative would bury the
    // supported half inside the platform.
    const platform = SlabNode.parse({ polygon: SLAB, elevation: 0.6 })

    expect(
      computeWallSlabElevation({ start: [0.1, 2], end: [10.1, 2], thickness: 0.1 }, [platform], []),
    ).toBeCloseTo(0.6)
  })

  it('pools same-elevation slabs so a shared wall follows their common level', () => {
    // Rooms A and B at the same elevation each cover exactly half the
    // wall (interior edges seam at the x=2 midline); a raised slab covers
    // just under half. Pooled, the common level covers 100% and must
    // win — without pooling the raised slab's 0.4975 would beat either
    // half alone.
    const roomA = SlabNode.parse({
      polygon: [
        [0, 0],
        [2, 0],
        [2, 4],
        [0, 4],
      ],
      elevation: 0.1,
    })
    const roomB = SlabNode.parse({
      polygon: [
        [2, 0],
        [4, 0],
        [4, 4],
        [2, 4],
      ],
      elevation: 0.1,
    })
    const raised = SlabNode.parse({
      polygon: [
        [1.0, 1],
        [2.99, 1],
        [2.99, 3],
        [1.0, 3],
      ],
      elevation: 0.6,
    })

    expect(
      computeWallSlabElevation(
        { start: [0, 2], end: [4, 2], thickness: 0.1 },
        [roomA, roomB, raised],
        [],
      ),
    ).toBeCloseTo(0.1)
  })

  it('prefers the higher of two majority-supporting slabs (platform stacked on a floor)', () => {
    const floor = SlabNode.parse({
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ],
      elevation: 0.05,
    })
    const platform = SlabNode.parse({
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
      elevation: 0.6,
    })

    // Wall 6m long: floor covers all of it, platform covers ~2/3 — both
    // majorities, and the wall physically rests on the platform.
    expect(
      computeWallSlabElevation(
        { start: [1, 2], end: [7, 2], thickness: 0.1 },
        [floor, platform],
        [],
      ),
    ).toBeCloseTo(0.6)
  })

  it('keeps a wall pushed up on a raised platform above a coincident floor', () => {
    const floor = SlabNode.parse({ polygon: SLAB, elevation: 0.05 })
    const platform = SlabNode.parse({ polygon: SLAB, elevation: 0.6 })

    expect(
      computeWallSlabSupport({ start: [1, 2], end: [3, 2], thickness: 0.1 }, [floor, platform], []),
    ).toEqual({
      elevation: 0.6,
      electedSlabId: platform.id,
      baseElevation: 0.6,
      baseSegments: [{ start: 0, end: 1, elevation: 0.6 }],
    })
  })

  it('fills down only when a lower support is exposed beyond a partial platform', () => {
    const floor = SlabNode.parse({ polygon: SLAB, elevation: 0.05 })
    const platform = SlabNode.parse({
      polygon: [
        [0, 0],
        [2.5, 0],
        [2.5, 4],
        [0, 4],
      ],
      elevation: 0.6,
    })

    expect(
      computeWallSlabSupport(
        { start: [0.5, 2], end: [3.5, 2], thickness: 0.1 },
        [floor, platform],
        [],
      ),
    ).toEqual({
      elevation: 0.6,
      electedSlabId: platform.id,
      baseElevation: 0.05,
      baseSegments: [
        { start: 0, end: 2 / 3, elevation: 0.6 },
        { start: 2 / 3, end: 1, elevation: 0.05 },
      ],
    })
  })

  it('keeps a shared wall on the higher slab that carries the full wall band', () => {
    const sharedWall = parseWall([4, 0], [4, 4])
    const low = SlabNode.parse({ polygon: SLAB, elevation: 0.05 })
    // Raised room floor: grounded (thickness = elevation) so the band-carry
    // rule applies — a floating deck would keep its drawn polygon instead.
    const high = SlabNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 4],
        [4, 4],
      ],
      elevation: 0.6,
      thickness: 0.6,
    })

    expect(
      computeWallSlabSupport(
        { start: sharedWall.start, end: sharedWall.end, thickness: sharedWall.thickness },
        [low, high],
        [sharedWall],
      ),
    ).toEqual({
      elevation: 0.6,
      electedSlabId: high.id,
      baseElevation: 0.6,
      baseSegments: [{ start: 0, end: 1, elevation: 0.6 }],
    })
  })

  it('profiles an offset-room wall as high-only, shared, then low-only', () => {
    const sharedWall = parseWall([4, 0], [4, 4.5])
    const walls = [
      parseWall([0, 0], [4, 0]),
      parseWall([0, 3], [0, 0]),
      parseWall([0, 3], [4, 3]),
      sharedWall,
      parseWall([4, 1.5], [8, 1.5]),
      parseWall([8, 1.5], [8, 4.5]),
      parseWall([8, 4.5], [4, 4.5]),
    ]
    // Grounded raised room floor (see the shared-wall test above).
    const high = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      elevation: 0.6,
      thickness: 0.6,
    })
    const low = SlabNode.parse({
      polygon: [
        [4, 1.5],
        [8, 1.5],
        [8, 4.5],
        [4, 4.5],
      ],
      elevation: 0.05,
    })

    expect(
      computeWallSlabSupport(
        { start: sharedWall.start, end: sharedWall.end, thickness: sharedWall.thickness },
        [high, low],
        walls,
      ),
    ).toEqual({
      elevation: 0.6,
      electedSlabId: high.id,
      baseElevation: 0.05,
      baseSegments: [
        { start: 0, end: 3.05 / 4.5, elevation: 0.6 },
        { start: 3.05 / 4.5, end: 1, elevation: 0.05 },
      ],
    })
  })

  it('lifts a tiny stub wall standing fully on a slab', () => {
    const slab = SlabNode.parse({ polygon: SLAB, elevation: 0.3 })

    expect(
      computeWallSlabElevation({ start: [2, 2], end: [2.08, 2], thickness: 0.1 }, [slab], []),
    ).toBeCloseTo(0.3)
  })

  it('does not lift a wall whose run over a higher slab is mostly inside a hole', () => {
    const low = SlabNode.parse({
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ],
      elevation: 0.05,
    })
    const high = SlabNode.parse({
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ],
      elevation: 0.6,
      holes: [
        [
          [0.5, 0],
          [8, 0],
          [8, 4],
          [0.5, 4],
        ],
      ],
    })

    // Net high support is only x ∈ [0, 0.5]; the low slab carries the wall.
    expect(
      computeWallSlabElevation({ start: [0, 2], end: [8, 2], thickness: 0.1 }, [low, high], []),
    ).toBeCloseTo(0.05)
  })

  it('keeps support for a wall running along a hole rim', () => {
    // Hole boundaries count as solid: the wall ringing a stairwell sits
    // on the rim, its outer face on solid slab.
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [6, 0],
        [6, 6],
        [0, 6],
      ],
      elevation: 0.4,
      holes: [
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 4],
        ],
      ],
    })

    expect(
      computeWallSlabElevation({ start: [2, 2], end: [4, 2], thickness: 0.1 }, [slab], []),
    ).toBeCloseTo(0.4)
  })
})
