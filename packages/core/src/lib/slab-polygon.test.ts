import { describe, expect, test } from 'bun:test'
import { SlabNode, WallNode } from '../schema'
import { getRenderableSlabPolygon } from './slab-polygon'

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
})
