// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { type Point2D, unionPolygons } from './polygon-union'

function polygonArea(points: Point2D[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area / 2)
}

describe('unionPolygons', () => {
  test('collapses a contained polygon into the containing polygon', () => {
    const small: Point2D[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    const large: Point2D[] = [
      [-1, -1],
      [2, -1],
      [2, 2],
      [-1, 2],
    ]

    const result = unionPolygons([small, large])

    expect(result).toHaveLength(1)
    expect(polygonArea(result[0]!)).toBeCloseTo(9)
  })

  test('combines overlapping rectangles into one boundary', () => {
    const left: Point2D[] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]
    const right: Point2D[] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]

    const result = unionPolygons([left, right])

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(8)
    expect(polygonArea(result[0]!)).toBeCloseTo(7)
  })

  test('keeps disjoint polygons as separate boundaries', () => {
    const left: Point2D[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    const right: Point2D[] = [
      [2, 0],
      [3, 0],
      [3, 1],
      [2, 1],
    ]

    const result = unionPolygons([left, right])

    expect(result).toHaveLength(2)
    expect(result.map(polygonArea)).toEqual([1, 1])
  })
})
