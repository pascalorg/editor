// @ts-expect-error — bun:test is provided by the Bun runtime; core does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { type Point2D, subtractPolygonsFromPolygon, unionPolygons } from './polygon-union'

function polygonArea(points: Point2D[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area / 2)
}

function hasRepeatedNonAdjacentPoint(points: Point2D[]) {
  return points.some((point, index) =>
    points.some(
      (candidate, candidateIndex) =>
        candidateIndex > index + 1 &&
        !(index === 0 && candidateIndex === points.length - 1) &&
        Math.hypot(point[0] - candidate[0], point[1] - candidate[1]) <= 1e-7,
    ),
  )
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

  test('does not stitch point-touching branches into a self-touching ring', () => {
    const lowerTip: Point2D[] = [
      [-4.4073, -1.383],
      [-4.2663, -1.383],
      [-4.4073, -1.22435],
    ]
    const upperTip: Point2D[] = [
      [-2.1038, 0.35056],
      [-0.9401, 1.385],
      [-3.0233, 1.385],
    ]
    const connectingBand: Point2D[] = [
      [-4.2663, -1.383],
      [-3.0233, 1.385],
      [-4.4073, 1.385],
      [-4.4073, -1.22435],
    ]

    const result = unionPolygons([lowerTip, upperTip, connectingBand])

    expect(result).toHaveLength(2)
    expect(result.some(hasRepeatedNonAdjacentPoint)).toBe(false)
  })

  test('keeps point-touching branches separate in every orientation and input order', () => {
    const polygons: Point2D[][] = [
      [
        [-4.4073, -1.383],
        [-4.2663, -1.383],
        [-4.4073, -1.22435],
      ],
      [
        [-2.1038, 0.35056],
        [-0.9401, 1.385],
        [-3.0233, 1.385],
      ],
      [
        [-4.2663, -1.383],
        [-3.0233, 1.385],
        [-4.4073, 1.385],
        [-4.4073, -1.22435],
      ],
    ]
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]
    const expectedArea = polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0)

    for (const order of orders) {
      for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++) {
        for (const reflection of [-1, 1]) {
          const transformed = order.map((index) =>
            polygons[index]!.map(([sourceX, sourceZ]): Point2D => {
              let x = sourceX * reflection
              let z = sourceZ
              for (let turn = 0; turn < quarterTurns; turn++) {
                const previousX = x
                x = -z
                z = previousX
              }
              return [x, z]
            }),
          )

          const result = unionPolygons(transformed)

          expect(result).toHaveLength(2)
          expect(result.some(hasRepeatedNonAdjacentPoint)).toBe(false)
          expect(result.reduce((sum, polygon) => sum + polygonArea(polygon), 0)).toBeCloseTo(
            expectedArea,
          )
        }
      }
    }
  })
})

describe('subtractPolygonsFromPolygon', () => {
  test('turns a boundary-overlapping cutter into an indentation', () => {
    const slab: Point2D[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const cutout: Point2D[] = [
      [1, -0.5],
      [3, -0.5],
      [3, 1],
      [1, 1],
    ]

    const result = subtractPolygonsFromPolygon(slab, [cutout])

    expect(result).toHaveLength(1)
    expect(result[0]).toContainEqual([1, 1])
    expect(result[0]).toContainEqual([3, 1])
    expect(polygonArea(result[0]!)).toBeCloseTo(10)
  })

  test('returns separate contours when a cutter splits the subject', () => {
    const slab: Point2D[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const cutout: Point2D[] = [
      [1.5, -1],
      [2.5, -1],
      [2.5, 4],
      [1.5, 4],
    ]

    const result = subtractPolygonsFromPolygon(slab, [cutout])

    expect(result).toHaveLength(2)
    expect(result.map(polygonArea).sort((a, b) => a - b)).toEqual([4.5, 4.5])
  })
})
