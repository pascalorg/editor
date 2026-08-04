import { describe, expect, test } from 'bun:test'
import { SlabNode, WallNode } from '../schema'
import { pointInPolygon } from './polygon-relations'
import { getRenderableSlabPolygon, snapSlabEdgeToWallBand } from './slab-polygon'

function wallOf(start: [number, number], end: [number, number], thickness = 0.1) {
  return WallNode.parse({ start, end, thickness })
}

function slabOf(
  polygon: Array<[number, number]>,
  autoFromWalls = true,
  elevation?: number,
  thickness?: number,
) {
  return SlabNode.parse({
    polygon,
    autoFromWalls,
    ...(elevation === undefined ? {} : { elevation }),
    // Raised ROOM FLOOR fixtures pass thickness = elevation so the slab
    // stays grounded (underside 0) — adoption/seam rules only apply to
    // grounded slabs; the schema-default 0.05 thickness would make an
    // elevated fixture a floating deck.
    ...(thickness === undefined ? {} : { thickness }),
  })
}

function xs(polygon: Array<[number, number]>) {
  return polygon.map((point) => point[0])
}

function zs(polygon: Array<[number, number]>) {
  return polygon.map((point) => point[1])
}

/** Assert the ring contains every expected vertex (order-independent). */
function expectRingToInclude(polygon: Array<[number, number]>, points: Array<[number, number]>) {
  const missing = points.filter(
    ([x, z]) => !polygon.some((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - z) < 1e-6),
  )
  expect(missing).toEqual([])
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
  test('adjacent room slabs share the exact centerline seam without gap or overlap', () => {
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
    // edge exactly on the wall centerline x=4.
    expect(Math.min(...xs(polyA))).toBeCloseTo(-0.05)
    expect(Math.max(...xs(polyA))).toBeCloseTo(4)
    expect(Math.min(...zs(polyA))).toBeCloseTo(-0.05)
    expect(Math.max(...zs(polyA))).toBeCloseTo(3.05)

    expect(Math.min(...xs(polyB))).toBeCloseTo(4)
    expect(Math.max(...xs(polyB))).toBeCloseTo(8.05)

    // No overlap across the shared wall (FP noise only)...
    expect(Math.max(...xs(polyA))).toBeLessThanOrEqual(Math.min(...xs(polyB)) + 1e-9)

    // ...and the seam is EXACTLY shared: both rings project the shared
    // edge onto the same centerline x=4 with matching endpoints.
    const seamZs = (poly: Array<[number, number]>) =>
      poly
        .filter((point) => point[0] === 4)
        .map((point) => point[1])
        .sort((left, right) => left - right)
    const seamA = seamZs(polyA)
    const seamB = seamZs(polyB)
    expect(seamA).toHaveLength(2)
    expect(seamB).toHaveLength(2)
    expect(seamA[0]!).toBeCloseTo(seamB[0]!, 12)
    expect(seamA[1]!).toBeCloseTo(seamB[1]!, 12)

    // Grid-sample the strip under the shared wall band: every point is
    // inside at least one slab — the old relief slit is gone, so deleting
    // the wall would expose a continuous floor.
    for (let x = 3.95; x <= 4.0501; x += 0.01) {
      for (let z = 0; z <= 3.001; z += 0.15) {
        expect(pointInPolygon([x, z], polyA) || pointInPolygon([x, z], polyB)).toBe(true)
      }
    }
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

    expect(Math.max(...xs(poly))).toBeCloseTo(4)
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
    // edge — interior, seamed on the shared wall centerline z=0, while
    // its free-standing sides stay on-wall.
    const bayPoly = getRenderableSlabPolygon(bay, { walls, siblingSlabs: [big] })
    expect(Math.max(...zs(bayPoly))).toBeCloseTo(0)
    expect(Math.min(...zs(bayPoly))).toBeCloseTo(-2.05)
    expect(Math.min(...xs(bayPoly))).toBeCloseTo(0.95)
    expect(Math.max(...xs(bayPoly))).toBeCloseTo(3.05)

    // The big slab's bottom edge is backed differently along its span:
    // centerline seam across the bay (z=0), facade-flush elsewhere
    // (z=-0.05), joined by step connectors at the bay junction walls
    // x=1 and x=3 (the old whole-edge rule pulled the entire edge back).
    const bigPoly = getRenderableSlabPolygon(big, { walls, siblingSlabs: [bay] })
    expect(Math.min(...zs(bigPoly))).toBeCloseTo(-0.05)
    expect(Math.max(...zs(bigPoly))).toBeCloseTo(5.05)
    expectRingToInclude(bigPoly, [
      [1, -0.05],
      [1, 0],
      [3, 0],
      [3, -0.05],
    ])
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
    // classify interior and land exactly on the CENTERLINE instead of
    // projecting to opposite outer faces (which would overlap by a full
    // thickness).
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

    expect(Math.max(...xs(polyA))).toBeCloseTo(4)
    expect(Math.min(...xs(polyB))).toBeCloseTo(4)
    expect(Math.max(...xs(polyA))).toBeLessThanOrEqual(Math.min(...xs(polyB)) + 1e-9)
  })

  test('the higher room carries the wall band to the lower room face', () => {
    // Real user repro shape: two rooms in an L/offset arrangement share the
    // z=0 wall over x ∈ [-1, 0.5] only; the north room's floor is raised
    // (0.34) above the south room's (0.05). Slabs extrude 0 → elevation and
    // the higher slab closes the full wall band while the lower slab meets
    // it at its own wall face. The reach comes from the matched wall's real
    // thickness, not a default-width expansion.
    const walls = [
      wallOf([-1, 3], [-1, 0]),
      wallOf([-1, 0], [0.5, 0]),
      wallOf([0.5, 0], [2, 0]),
      wallOf([2, 0], [2, 3]),
      wallOf([2, 3], [-1, 3]),
      wallOf([0.5, 0], [0.5, -4]),
      wallOf([0.5, -4], [-1, -4]),
      wallOf([-1, -4], [-1, 0]),
    ]
    const high = slabOf(
      [
        [-1, 3],
        [-1, 0],
        [2, 0],
        [2, 3],
      ],
      false,
      0.34,
      0.34,
    )
    const low = slabOf(
      [
        [0.5, 0],
        [-1, 0],
        [-1, -4],
        [0.5, -4],
      ],
      true,
      0.05,
    )

    const polyHigh = getRenderableSlabPolygon(high, { walls, siblingSlabs: [low] })
    const polyLow = getRenderableSlabPolygon(low, { walls, siblingSlabs: [high] })

    // The shared and facade spans fuse because both land on z=-0.05.
    expectRingToInclude(polyHigh, [
      [0.5, -0.05],
      [2.05, -0.05],
    ])
    expect(Math.min(...zs(polyHigh))).toBeCloseTo(-0.05)
    expect(Math.max(...zs(polyLow))).toBeCloseTo(-0.05)

    // The high slab owns the entire band; the lower room begins at its face.
    for (let x = -0.95; x <= 0.4501; x += 0.05) {
      for (let z = -0.045; z <= 0.0451; z += 0.015) {
        expect(pointInPolygon([x, z], polyHigh, { includeBoundary: false })).toBe(true)
      }
    }
  })

  test('legacy face-aligned unequal rooms self-heal to the lower room face', () => {
    // Same stored-at-inner-faces legacy data as above (edges a full 0.3
    // apart across the t=0.3 wall at x=4), but with the west room raised.
    // Both edges classify interior through the band-sibling rule and adopt
    // the east/lower room face despite being stored at opposite faces.
    const walls = [
      wallOf([0, 0], [8, 0]),
      wallOf([8, 0], [8, 3]),
      wallOf([8, 3], [0, 3]),
      wallOf([0, 3], [0, 0]),
      wallOf([4, 0], [4, 3], 0.3),
    ]
    const legacyHigh = slabOf(
      [
        [0, 0],
        [3.85, 0],
        [3.85, 3],
        [0, 3],
      ],
      false,
      0.4,
      0.4,
    )
    const legacyLow = slabOf(
      [
        [4.15, 0],
        [8, 0],
        [8, 3],
        [4.15, 3],
      ],
      false,
      0.05,
    )

    const polyHigh = getRenderableSlabPolygon(legacyHigh, { walls, siblingSlabs: [legacyLow] })
    const polyLow = getRenderableSlabPolygon(legacyLow, { walls, siblingSlabs: [legacyHigh] })

    expect(Math.max(...xs(polyHigh))).toBeCloseTo(4.15)
    expect(Math.min(...xs(polyLow))).toBeCloseTo(4.15)
    expect(Math.max(...xs(polyHigh))).toBeLessThanOrEqual(Math.min(...xs(polyLow)) + 1e-9)
  })

  test('stacked slabs are not mistaken for rooms across a wall', () => {
    // The platform is a grounded raised floor (thickness = elevation); the
    // floating-deck variant of this shape is covered by the adoption-gate
    // tests below.
    const floor = slabOf(roomA, false, 0.05)
    const platform = slabOf(roomA, false, 0.4, 0.4)
    const walls = [
      wallOf([0, 0], [4, 0]),
      wallOf([4, 0], [4, 3]),
      wallOf([4, 3], [0, 3]),
      wallOf([0, 3], [0, 0]),
    ]

    const floorPolygon = getRenderableSlabPolygon(floor, {
      walls,
      siblingSlabs: [platform],
    })
    const platformPolygon = getRenderableSlabPolygon(platform, {
      walls,
      siblingSlabs: [floor],
    })

    for (const polygon of [floorPolygon, platformPolygon]) {
      expect(Math.min(...xs(polygon))).toBeCloseTo(-0.05)
      expect(Math.max(...xs(polygon))).toBeCloseTo(4.05)
      expect(Math.min(...zs(polygon))).toBeCloseTo(-0.05)
      expect(Math.max(...zs(polygon))).toBeCloseTo(3.05)
    }
  })

  test('sibling winding does not change a shared seam decision', () => {
    const slabA = slabOf(roomA)
    const slabB = slabOf([...roomB].reverse())

    const polyA = getRenderableSlabPolygon(slabA, {
      walls: twoRoomWalls,
      siblingSlabs: [slabB],
    })
    const polyB = getRenderableSlabPolygon(slabB, {
      walls: twoRoomWalls,
      siblingSlabs: [slabA],
    })

    expect(Math.max(...xs(polyA))).toBeCloseTo(4)
    expect(Math.min(...xs(polyB))).toBeCloseTo(4)
  })

  test('wall-less butted slabs at different elevations keep the midline seam', () => {
    // No wall backs the seam, so there is no band to hide a pocket under —
    // the exposed step face at the joint is correct. Elevation must not
    // move a wall-less seam off the midline.
    const stepHigh = slabOf(
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      false,
      0.3,
      0.3,
    )
    const stepLow = slabOf(
      [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      false,
      0.05,
    )

    const polyHigh = getRenderableSlabPolygon(stepHigh, { walls: [], siblingSlabs: [stepLow] })
    const polyLow = getRenderableSlabPolygon(stepLow, { walls: [], siblingSlabs: [stepHigh] })

    expect(Math.max(...xs(polyHigh))).toBeCloseTo(4)
    expect(Math.min(...xs(polyLow))).toBeCloseTo(4)
  })

  test('offset rooms sharing a partial wall span: interior beside the sibling, facade elsewhere', () => {
    // Rooms offset diagonally share the x=4 wall only for z ∈ [1.5, 3].
    // Each room's long edge is interior for the shared span and exterior
    // (its own facade) for the rest — the case sub-edge classification
    // exists for.
    const offsetA = slabOf([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    const offsetB = slabOf([
      [4, 1.5],
      [8, 1.5],
      [8, 4.5],
      [4, 4.5],
    ])
    const walls = [
      wallOf([0, 0], [4, 0]),
      wallOf([0, 3], [0, 0]),
      wallOf([0, 3], [4, 3]),
      wallOf([4, 0], [4, 4.5]),
      wallOf([4, 1.5], [8, 1.5]),
      wallOf([8, 1.5], [8, 4.5]),
      wallOf([8, 4.5], [4, 4.5]),
    ]

    const polyA = getRenderableSlabPolygon(offsetA, { walls, siblingSlabs: [offsetB] })
    const polyB = getRenderableSlabPolygon(offsetB, { walls, siblingSlabs: [offsetA] })

    // A's right edge: facade-flush below the junction, exactly on the
    // centerline beside B, joined by the step connector at the junction z=1.5.
    expectRingToInclude(polyA, [
      [4.05, -0.05],
      [4.05, 1.5],
      [4, 1.5],
      [4, 3.05],
    ])
    // B's left edge mirrors it: centerline seam beside A, facade-flush
    // above, step at the junction z=3.
    expectRingToInclude(polyB, [
      [4, 1.45],
      [4, 3],
      [3.95, 3],
      [3.95, 4.55],
    ])

    // Along the shared span both slabs reach exactly the wall centerline:
    // the strip under the shared wall is fully covered with no interior
    // overlap — deleting the wall would expose a continuous floor...
    for (let z = 1.6; z <= 2.95; z += 0.1) {
      expect(pointInPolygon([3.99, z], polyA, { includeBoundary: false })).toBe(true)
      expect(pointInPolygon([4.01, z], polyB, { includeBoundary: false })).toBe(true)
      expect(pointInPolygon([4.01, z], polyA, { includeBoundary: false })).toBe(false)
      expect(pointInPolygon([3.99, z], polyB, { includeBoundary: false })).toBe(false)
      for (let x = 3.96; x <= 4.0401; x += 0.01) {
        expect(pointInPolygon([x, z], polyA) || pointInPolygon([x, z], polyB)).toBe(true)
      }
    }
    // ...while each unshared portion reaches its own facade face.
    expect(pointInPolygon([4.04, 0.75], polyA, { includeBoundary: false })).toBe(true)
    expect(pointInPolygon([3.96, 3.75], polyB, { includeBoundary: false })).toBe(true)

    // Any residual overlap is confined to the shared wall's footprint
    // right at the junction corners — hidden under the wall bodies, the
    // same corner pockets the outer-face projection has always produced
    // where two rooms' facades meet a wall junction.
    for (let x = 3.5; x <= 4.5; x += 0.02) {
      for (let z = -0.2; z <= 4.7; z += 0.02) {
        const overlapping =
          pointInPolygon([x, z], polyA, { includeBoundary: false }) &&
          pointInPolygon([x, z], polyB, { includeBoundary: false })
        if (!overlapping) continue
        expect(Math.abs(x - 4)).toBeLessThanOrEqual(0.05 + 1e-9)
        expect(Math.min(Math.abs(z - 1.5), Math.abs(z - 3))).toBeLessThanOrEqual(0.05 + 1e-9)
      }
    }
  })

  test('offset unequal rooms give the higher slab the full shared wall band', () => {
    const high = slabOf(
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      true,
      0.4,
      0.4,
    )
    const low = slabOf(
      [
        [4, 1.5],
        [8, 1.5],
        [8, 4.5],
        [4, 4.5],
      ],
      true,
      0.05,
    )
    const walls = [
      wallOf([0, 0], [4, 0]),
      wallOf([0, 3], [0, 0]),
      wallOf([0, 3], [4, 3]),
      wallOf([4, 0], [4, 4.5]),
      wallOf([4, 1.5], [8, 1.5]),
      wallOf([8, 1.5], [8, 4.5]),
      wallOf([8, 4.5], [4, 4.5]),
    ]

    const highPolygon = getRenderableSlabPolygon(high, { walls, siblingSlabs: [low] })
    const lowPolygon = getRenderableSlabPolygon(low, { walls, siblingSlabs: [high] })

    expect(Math.max(...xs(highPolygon))).toBeCloseTo(4.05)
    expectRingToInclude(lowPolygon, [
      [4.05, 1.45],
      [4.05, 3],
      [3.95, 3],
    ])

    for (let z = 1.6; z <= 2.95; z += 0.1) {
      expect(pointInPolygon([3.975, z], highPolygon, { includeBoundary: false })).toBe(true)
      expect(pointInPolygon([3.975, z], lowPolygon, { includeBoundary: false })).toBe(false)
      expect(pointInPolygon([4.025, z], highPolygon, { includeBoundary: false })).toBe(true)
      expect(pointInPolygon([4.025, z], lowPolygon, { includeBoundary: false })).toBe(false)
      expect(pointInPolygon([4.075, z], lowPolygon, { includeBoundary: false })).toBe(true)
      expect(pointInPolygon([4.075, z], highPolygon, { includeBoundary: false })).toBe(false)
    }
  })

  test('a wall backing only part of an edge: flush over the wall, as drawn beyond it', () => {
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
      { walls: [wallOf([0, 0], [2, 0])], siblingSlabs: [] },
    )

    expectRingToInclude(poly, [
      [0, -0.05],
      [2, -0.05],
      [2, 0],
      [4, 0],
    ])
    expect(Math.min(...zs(poly))).toBeCloseTo(-0.05)
    expect(Math.max(...xs(poly))).toBeCloseTo(4)
  })

  test('two collinear walls of different thickness along one edge: each face wins its own span', () => {
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
      { walls: [wallOf([0, 0], [2, 0]), wallOf([2, 0], [4, 0], 0.3)], siblingSlabs: [] },
    )

    // Thin-wall face for x < 2, thick-wall face beyond, stepped at x=2
    // (the old whole-edge rule let one wall win the entire edge).
    expectRingToInclude(poly, [
      [0, -0.05],
      [2, -0.05],
      [2, -0.15],
      [4, -0.15],
    ])
  })

  test('breakpoints within the minimum sub-edge length merge into one step', () => {
    // The wall ends at x=2; the sibling starts at x=2.02 — the two
    // breakpoints are 2cm apart, under the 5cm minimum, so they collapse
    // into a single step at x=2 instead of leaving a sliver sub-edge.
    const sibling = slabOf([
      [2.02, -2],
      [4, -2],
      [4, 0],
      [2.02, 0],
    ])
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
      { walls: [wallOf([0, 0], [2, 0])], siblingSlabs: [sibling] },
    )

    expectRingToInclude(poly, [
      [2, -0.05],
      [2, 0],
    ])
    expect(poly).toHaveLength(6)
  })

  test('nearly collinear corners do not create unbounded wall-offset miters', () => {
    const stored = [
      [3.1318685080276216, -4.3412497001265],
      [11.261660174864861, -4.341249992437693],
      [11.26165987489183, -1.3166851233565569],
      [3.131868208054532, -1.3166857310453555],
      [1.7318390128066048, -1.3166857522417288],
      [1.7318388127796835, -4.341249921322843],
    ] as Array<[number, number]>
    const poly = getRenderableSlabPolygon(slabOf(stored, false), {
      walls: [
        wallOf([1.7318387751077626, -4.323741654294752], [11.300000049514956, -4.341249931281993]),
      ],
      siblingSlabs: [],
    })

    const storedExtent = Math.max(...stored.flat().map(Math.abs))
    const renderedExtent = Math.max(...poly.flat().map(Math.abs))
    const longestEdge = Math.max(
      ...poly.map((point, index) => {
        const next = poly[(index + 1) % poly.length]!
        return Math.hypot(point[0] - next[0], point[1] - next[1])
      }),
    )

    expect(renderedExtent - storedExtent).toBeLessThan(0.2)
    expect(longestEdge).toBeLessThan(8.4)
  })
})

describe('grounded adoption gate', () => {
  // Owner rule: wall adoption / per-edge extension exists so ROOM FLOORS
  // tile with the walls standing on them. It applies only to grounded
  // slabs (underside ≈ 0) and recessed pools; a floating deck keeps its
  // drawn polygon exactly.

  test('a floating deck near walls keeps its drawn polygon exactly', () => {
    // Same footprint as roomA — every edge inside a wall adoption band —
    // but floating at 1.5m: no edge may extend to a wall face.
    const deck = slabOf(roomA, false, 1.5, 0.05)

    const poly = getRenderableSlabPolygon(deck, { walls: twoRoomWalls, siblingSlabs: [] })

    expect(poly).toEqual(roomA)
  })

  test('boundary case: underside 0.005 still counts as grounded and adopts', () => {
    const nearlyGrounded = slabOf(roomA, false, 0.055, 0.05)

    const poly = getRenderableSlabPolygon(nearlyGrounded, {
      walls: [wallOf([0, 0], [4, 0])],
      siblingSlabs: [],
    })

    expect(Math.min(...zs(poly))).toBeCloseTo(-0.05)
  })

  test('a slab floated just past the epsilon stops adopting', () => {
    // Underside 0.02 > 0.01 epsilon — already a deck.
    const justFloating = slabOf(roomA, false, 0.07, 0.05)

    const poly = getRenderableSlabPolygon(justFloating, {
      walls: [wallOf([0, 0], [4, 0])],
      siblingSlabs: [],
    })

    expect(Math.min(...zs(poly))).toBeCloseTo(0)
  })

  test('a recessed pool keeps band adoption (unchanged)', () => {
    // Recessed slabs are sunk into the ground, never floating — their
    // negative elevation encodes depth, so the gate must not strip the
    // wall-face extension a sunken room floor relies on.
    const pool = SlabNode.parse({ polygon: roomA, elevation: -0.15, recessed: true })

    const poly = getRenderableSlabPolygon(pool, {
      walls: [wallOf([0, 0], [4, 0])],
      siblingSlabs: [],
    })

    expect(Math.min(...zs(poly))).toBeCloseTo(-0.05)
  })

  test('a grounded floor ignores a floating deck sibling as a seam target', () => {
    // Deck butted across the x=4 wall band: were it a room floor, the
    // grounded (lower) floor would terminate at its own wall face (3.95).
    // As a deck it is no seam partner — the floor adopts the wall's outer
    // face (4.05) as if alone, and the deck itself stays as drawn.
    const floor = slabOf(roomA, false, 0.05)
    const deck = slabOf(roomB, false, 1.5, 0.05)
    const walls = [wallOf([4, 0], [4, 3])]

    const floorPoly = getRenderableSlabPolygon(floor, { walls, siblingSlabs: [deck] })
    const deckPoly = getRenderableSlabPolygon(deck, { walls, siblingSlabs: [floor] })

    expect(Math.max(...xs(floorPoly))).toBeCloseTo(4.05)
    expect(deckPoly).toEqual(roomB)
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
