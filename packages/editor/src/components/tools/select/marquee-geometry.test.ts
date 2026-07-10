import { describe, expect, test } from 'bun:test'
import {
  convexHull2D,
  type Point2,
  polygonsIntersect,
  rectIntersectsHull,
  type ScreenRect,
  segmentIntersectsPolygon,
} from './marquee-geometry'

const rect = (minX: number, minY: number, maxX: number, maxY: number): ScreenRect => ({
  minX,
  minY,
  maxX,
  maxY,
})

describe('convexHull2D', () => {
  test('drops interior points and keeps the hull', () => {
    const hull = convexHull2D([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2],
      [1, 3],
    ])
    expect(hull).toHaveLength(4)
    const set = new Set(hull.map((p) => p.join(',')))
    expect(set).toEqual(new Set(['0,0', '4,0', '4,4', '0,4']))
  })

  test('passes degenerate inputs through', () => {
    expect(convexHull2D([])).toEqual([])
    expect(convexHull2D([[1, 2]])).toEqual([[1, 2]])
    expect(
      convexHull2D([
        [0, 0],
        [2, 2],
      ]),
    ).toHaveLength(2)
  })
})

describe('rectIntersectsHull', () => {
  // The regression case: a thin diagonal wall. Its world AABB spans the full
  // square, so the old AABB test matched a marquee sitting in the empty
  // corner; the hull test must not.
  const diagonalWall: Point2[] = convexHull2D([
    [0, 0],
    [1, 0.6],
    [10, 9.4],
    [10, 10],
    [9, 9.4],
    [0, 0.6],
  ])

  test('marquee in the empty corner of a diagonal shape does not match', () => {
    expect(rectIntersectsHull(rect(7, 0, 9, 2), diagonalWall)).toBe(false)
    expect(rectIntersectsHull(rect(0, 7, 2, 9), diagonalWall)).toBe(false)
  })

  test('marquee crossing the diagonal matches', () => {
    expect(rectIntersectsHull(rect(4, 4, 6, 6), diagonalWall)).toBe(true)
  })

  test('hull vertex inside the marquee matches', () => {
    expect(rectIntersectsHull(rect(-1, -1, 0.5, 0.5), diagonalWall)).toBe(true)
  })

  test('marquee fully inside a large hull matches', () => {
    const square: Point2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    expect(rectIntersectsHull(rect(4, 4, 5, 5), square)).toBe(true)
  })

  test('edge-only crossing (no vertices contained either way) matches', () => {
    // Tall thin rect crossing a wide thin hull like a plus sign.
    const bar: Point2[] = [
      [0, 4],
      [10, 4],
      [10, 6],
      [0, 6],
    ]
    expect(rectIntersectsHull(rect(4, 0, 6, 10), bar)).toBe(true)
  })

  test('disjoint shapes do not match', () => {
    const tri: Point2[] = [
      [0, 0],
      [2, 0],
      [1, 2],
    ]
    expect(rectIntersectsHull(rect(5, 5, 7, 7), tri)).toBe(false)
  })

  test('single projected point matches only when inside the rect', () => {
    expect(rectIntersectsHull(rect(0, 0, 2, 2), [[1, 1]])).toBe(true)
    expect(rectIntersectsHull(rect(0, 0, 2, 2), [[3, 3]])).toBe(false)
  })
})

describe('segmentIntersectsPolygon', () => {
  const quad: Point2[] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  test('crossing segment matches', () => {
    expect(segmentIntersectsPolygon([-1, 2], [5, 2], quad)).toBe(true)
  })
  test('fully inside matches', () => {
    expect(segmentIntersectsPolygon([1, 1], [2, 2], quad)).toBe(true)
  })
  test('outside segment does not match', () => {
    expect(segmentIntersectsPolygon([5, 5], [7, 8], quad)).toBe(false)
  })
})

describe('polygonsIntersect', () => {
  const quad: Point2[] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  test('overlapping polygons match', () => {
    expect(
      polygonsIntersect(quad, [
        [3, 3],
        [6, 3],
        [6, 6],
        [3, 6],
      ]),
    ).toBe(true)
  })
  test('containment matches both ways', () => {
    const inner: Point2[] = [
      [1, 1],
      [2, 1],
      [2, 2],
    ]
    expect(polygonsIntersect(quad, inner)).toBe(true)
    expect(polygonsIntersect(inner, quad)).toBe(true)
  })
  test('a rotated diamond beside the quad does not match', () => {
    expect(
      polygonsIntersect(quad, [
        [7, 2],
        [9, 0],
        [11, 2],
        [9, 4],
      ]),
    ).toBe(false)
  })
})
