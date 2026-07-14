import { describe, expect, test } from 'bun:test'
import { SlabNode, WallNode } from '../schema'
import { getRenderableSlabPolygon, snapSlabEdgeToWallBand } from './slab-polygon'

function wallOf(start: [number, number], end: [number, number], thickness = 0.1) {
  return WallNode.parse({ start, end, thickness })
}

function slabOf(polygon: Array<[number, number]>, autoFromWalls = true) {
  return SlabNode.parse({ polygon, autoFromWalls })
}

function xs(polygon: Array<[number, number]>) {
  return polygon.map((point) => point[0])
}

function zs(polygon: Array<[number, number]>) {
  return polygon.map((point) => point[1])
}

const roomA: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]
const roomB: Array<[number, number]> = [
  [4, 0],
  [8, 0],
  [8, 3],
  [4, 3],
]

// Two rooms side by side sharing the centerline wall at x=4.
const twoRoomWalls = [
  wallOf([0, 0], [4, 0]),
  wallOf([4, 0], [8, 0]),
  wallOf([8, 0], [8, 3]),
  wallOf([8, 3], [4, 3]),
  wallOf([4, 3], [0, 3]),
  wallOf([0, 3], [0, 0]),
  wallOf([4, 0], [4, 3]),
]

describe('getRenderableSlabPolygon', () => {
  test('adjacent room slabs tile without overlapping', () => {
    const slabA = slabOf(roomA)
    const slabB = slabOf(roomB)

    const polyA = getRenderableSlabPolygon(slabA, {
      walls: twoRoomWalls,
      siblingSlabs: [slabB],
    })
    const polyB = getRenderableSlabPolygon(slabB, {
      walls: twoRoomWalls,
      siblingSlabs: [slabA],
    })

    // A: exterior edges flush with the 0.1-thick facade (+0.05), shared
    // edge relieved off the centerline (-0.02).
    expect(Math.min(...xs(polyA))).toBeCloseTo(-0.05)
    expect(Math.max(...xs(polyA))).toBeCloseTo(3.98)
    expect(Math.min(...zs(polyA))).toBeCloseTo(-0.05)
    expect(Math.max(...zs(polyA))).toBeCloseTo(3.05)

    expect(Math.min(...xs(polyB))).toBeCloseTo(4.02)
    expect(Math.max(...xs(polyB))).toBeCloseTo(8.05)

    // No overlap across the shared wall.
    expect(Math.max(...xs(polyA))).toBeLessThan(Math.min(...xs(polyB)))
  })

  test('exterior edge expands by half of THAT wall thickness', () => {
    const walls = [
      wallOf([0, 0], [4, 0]),
      wallOf([4, 0], [4, 3]),
      wallOf([4, 3], [0, 3]),
      // Non-default thickness on the left facade only.
      wallOf([0, 3], [0, 0], 0.3),
    ]

    const poly = getRenderableSlabPolygon(slabOf(roomA), { walls, siblingSlabs: [] })

    expect(Math.min(...xs(poly))).toBeCloseTo(-0.15)
    expect(Math.max(...xs(poly))).toBeCloseTo(4.05)
    expect(Math.min(...zs(poly))).toBeCloseTo(-0.05)
    expect(Math.max(...zs(poly))).toBeCloseTo(3.05)
  })

  test('freehand edges away from any wall render exactly as drawn', () => {
    const drawn: Array<[number, number]> = [
      [10, 10],
      [12, 10],
      [12, 12],
      [10, 12],
    ]

    const poly = getRenderableSlabPolygon(slabOf(drawn, false), {
      walls: twoRoomWalls,
      siblingSlabs: [],
    })

    expect(poly).toEqual(drawn)
  })

  test('manual slabs follow the same per-edge rule as auto slabs', () => {
    const poly = getRenderableSlabPolygon(slabOf(roomA, false), {
      walls: twoRoomWalls,
      siblingSlabs: [slabOf(roomB)],
    })

    expect(Math.max(...xs(poly))).toBeCloseTo(3.98)
    expect(Math.min(...xs(poly))).toBeCloseTo(-0.05)
  })

  test('T-junction: a neighbour edge that is a sub-segment still reads as interior', () => {
    // Big 6×5 room; a 2×2 bay hangs below, sealed against the interior of
    // the big room's bottom wall between x=1 and x=3.
    const big = slabOf([
      [0, 0],
      [6, 0],
      [6, 5],
      [0, 5],
    ])
    const bay = slabOf([
      [1, -2],
      [3, -2],
      [3, 0],
      [1, 0],
    ])
    const walls = [
      wallOf([0, 0], [6, 0]),
      wallOf([6, 0], [6, 5]),
      wallOf([6, 5], [0, 5]),
      wallOf([0, 5], [0, 0]),
      wallOf([1, 0], [1, -2]),
      wallOf([1, -2], [3, -2]),
      wallOf([3, -2], [3, 0]),
    ]

    // The bay's top edge lies on a sub-segment of the big slab's bottom
    // edge — interior relief, while its free-standing sides stay on-wall.
    const bayPoly = getRenderableSlabPolygon(bay, { walls, siblingSlabs: [big] })
    expect(Math.max(...zs(bayPoly))).toBeCloseTo(-0.02)
    expect(Math.min(...zs(bayPoly))).toBeCloseTo(-2.05)
    expect(Math.min(...xs(bayPoly))).toBeCloseTo(0.95)
    expect(Math.max(...xs(bayPoly))).toBeCloseTo(3.05)

    // The big slab's bottom edge has a partial neighbour across it — the
    // whole edge classifies interior (v1 majority rule) and pulls back.
    const bigPoly = getRenderableSlabPolygon(big, { walls, siblingSlabs: [bay] })
    expect(Math.min(...zs(bigPoly))).toBeCloseTo(0.02)
    expect(Math.max(...zs(bigPoly))).toBeCloseTo(5.05)
  })

  test('an edge on a wall longer than itself still reaches the facade', () => {
    // Slab edge [1,0]→[3,0] sits mid-span on a 6m wall.
    const poly = getRenderableSlabPolygon(
      slabOf([
        [1, 0],
        [3, 0],
        [3, 2],
        [1, 2],
      ]),
      { walls: [wallOf([0, 0], [6, 0])], siblingSlabs: [] },
    )

    expect(Math.min(...zs(poly))).toBeCloseTo(-0.05)
    // The other three edges are free — rendered as drawn.
    expect(Math.max(...zs(poly))).toBeCloseTo(2)
    expect(Math.min(...xs(poly))).toBeCloseTo(1)
    expect(Math.max(...xs(poly))).toBeCloseTo(3)
  })

  test('legacy edge stored at the inner wall face projects to the outer face', () => {
    // Wall centerline z=0, thickness 0.1 — the legacy slab edge sits at the
    // inner face z=0.05. Absolute projection must land the rendered edge on
    // the OUTER face (-0.05), not at inner face + t/2 (= centerline).
    const poly = getRenderableSlabPolygon(
      slabOf(
        [
          [0, 0.05],
          [4, 0.05],
          [4, 3],
          [0, 3],
        ],
        false,
      ),
      { walls: [wallOf([0, 0], [4, 0])], siblingSlabs: [] },
    )

    expect(Math.min(...zs(poly))).toBeCloseTo(-0.05)
  })

  test('legacy edge stored at the outer wall face stays at the face (no overshoot)', () => {
    const poly = getRenderableSlabPolygon(
      slabOf(
        [
          [0, -0.05],
          [4, -0.05],
          [4, 3],
          [0, 3],
        ],
        false,
      ),
      { walls: [wallOf([0, 0], [4, 0])], siblingSlabs: [] },
    )

    expect(Math.min(...zs(poly))).toBeCloseTo(-0.05)
  })

  test('a thick wall adopts a face-aligned edge beyond the old fixed tolerance', () => {
    // t=0.3: inner face is 0.15 off the centerline — past the old fixed 0.1
    // tolerance, so this edge used to classify FREE and never expand.
    const poly = getRenderableSlabPolygon(
      slabOf(
        [
          [0, 0.15],
          [4, 0.15],
          [4, 3],
          [0, 3],
        ],
        false,
      ),
      { walls: [wallOf([0, 0], [4, 0], 0.3)], siblingSlabs: [] },
    )

    expect(Math.min(...zs(poly))).toBeCloseTo(-0.15)
  })

  test('edges outside the adoption band stay free', () => {
    // Band for t=0.1 is half + 0.06 = 0.11 — an edge 0.12 away is kept as drawn.
    const poly = getRenderableSlabPolygon(
      slabOf(
        [
          [0, 0.12],
          [4, 0.12],
          [4, 3],
          [0, 3],
        ],
        false,
      ),
      { walls: [wallOf([0, 0], [4, 0])], siblingSlabs: [] },
    )

    expect(Math.min(...zs(poly))).toBeCloseTo(0.12)
  })

  test('two parallel close walls: the nearest centerline wins', () => {
    // Thin wall at z=0 (band 0.11) and thick wall at z=0.3 (t=0.3, band
    // 0.21). An edge at z=0.1 is inside BOTH bands (laterals 0.1 and 0.2);
    // it must adopt the nearer thin wall and land on ITS outer face.
    const poly = getRenderableSlabPolygon(
      slabOf(
        [
          [0, 0.1],
          [4, 0.1],
          [4, 3],
          [0, 3],
        ],
        false,
      ),
      {
        walls: [wallOf([0, 0], [4, 0]), wallOf([0, 0.3], [4, 0.3], 0.3)],
        siblingSlabs: [],
      },
    )

    expect(Math.min(...zs(poly))).toBeCloseTo(-0.05)
  })

  test('span overlap below the minimum leaves the edge free', () => {
    // The wall only overlaps the last 2cm of the edge span — under the 5cm
    // classification minimum.
    const poly = getRenderableSlabPolygon(
      slabOf(
        [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        false,
      ),
      { walls: [wallOf([3.98, 0], [4.5, 0])], siblingSlabs: [] },
    )

    expect(Math.min(...zs(poly))).toBeCloseTo(0)
  })

  test('legacy face-aligned rooms across a thick wall still tile without overlap', () => {
    // Both rooms stored at the INNER faces of the shared t=0.3 wall at x=4
    // (edges 0.3 apart — far beyond the direct sibling tolerance). Each edge
    // is inside the wall band with the sibling across the same band, so both
    // classify interior and relieve off the CENTERLINE instead of projecting
    // to opposite outer faces (which would overlap by a full thickness).
    const walls = [
      wallOf([0, 0], [8, 0]),
      wallOf([8, 0], [8, 3]),
      wallOf([8, 3], [0, 3]),
      wallOf([0, 3], [0, 0]),
      wallOf([4, 0], [4, 3], 0.3),
    ]
    const legacyA = slabOf(
      [
        [0, 0],
        [3.85, 0],
        [3.85, 3],
        [0, 3],
      ],
      false,
    )
    const legacyB = slabOf(
      [
        [4.15, 0],
        [8, 0],
        [8, 3],
        [4.15, 3],
      ],
      false,
    )

    const polyA = getRenderableSlabPolygon(legacyA, { walls, siblingSlabs: [legacyB] })
    const polyB = getRenderableSlabPolygon(legacyB, { walls, siblingSlabs: [legacyA] })

    expect(Math.max(...xs(polyA))).toBeCloseTo(3.98)
    expect(Math.min(...xs(polyB))).toBeCloseTo(4.02)
    expect(Math.max(...xs(polyA))).toBeLessThan(Math.min(...xs(polyB)))
  })
})

describe('snapSlabEdgeToWallBand', () => {
  test('an edge inside the band snaps onto the wall centerline', () => {
    const snap = snapSlabEdgeToWallBand([0.5, 0.08], [3.5, 0.08], [wallOf([0, 0], [4, 0])])

    expect(snap).not.toBeNull()
    expect(snap!.edge[0][1]).toBeCloseTo(0)
    expect(snap!.edge[1][1]).toBeCloseTo(0)
    // Tangential positions are preserved — pure perpendicular translation.
    expect(snap!.edge[0][0]).toBeCloseTo(0.5)
    expect(snap!.edge[1][0]).toBeCloseTo(3.5)
  })

  test('an edge outside the band does not snap', () => {
    const snap = snapSlabEdgeToWallBand([0.5, 0.2], [3.5, 0.2], [wallOf([0, 0], [4, 0])])
    expect(snap).toBeNull()
  })

  test('maxLateral tightens the stick distance', () => {
    const walls = [wallOf([0, 0], [4, 0])]
    expect(snapSlabEdgeToWallBand([0.5, 0.08], [3.5, 0.08], walls, { maxLateral: 0.05 })).toBeNull()
    expect(
      snapSlabEdgeToWallBand([0.5, 0.04], [3.5, 0.04], walls, { maxLateral: 0.05 }),
    ).not.toBeNull()
  })

  test('the nearest of two candidate walls wins', () => {
    const near = wallOf([0, 0], [4, 0])
    const far = wallOf([0, 0.3], [4, 0.3], 0.3)
    const snap = snapSlabEdgeToWallBand([0.5, 0.1], [3.5, 0.1], [far, near])

    expect(snap).not.toBeNull()
    expect(snap!.wallId).toBe(near.id)
    expect(snap!.edge[0][1]).toBeCloseTo(0)
  })
})
