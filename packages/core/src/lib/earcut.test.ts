import { describe, expect, test } from 'bun:test'
import { ShapeUtils, Vector2 } from 'three'
import { triangulatePlanPolygon } from '../index'

type Point = [number, number]

// The installed Three outer-ring triangulator is the renderer's independent oracle.
// Exact index order is contractual; analytic area also rejects a shared wrong outline.
const concave: Point[] = [
  [0, 0],
  [4, 0],
  [4, 1],
  [1, 1],
  [1, 4],
  [0, 4],
]

function radialRing(count: number): Point[] {
  return Array.from({ length: count }, (_, index): Point => {
    const angle = (index * 2 * Math.PI) / count
    const radius = index % 2 === 0 ? 5 : 3
    return [17 + radius * Math.cos(angle), -23 + radius * Math.sin(angle)]
  })
}

const cases: { name: string; polygon: Point[] }[] = [
  { name: 'empty ring', polygon: [] },
  { name: 'one point', polygon: [[2, 3]] },
  {
    name: 'two points',
    polygon: [
      [0, 0],
      [2, 0],
    ],
  },
  {
    name: 'triangle',
    polygon: [
      [0, 0],
      [4, 0],
      [0, 3],
    ],
  },
  {
    name: 'rectangle',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  },
  { name: 'concave L', polygon: concave },
  { name: 'reversed concave L', polygon: [...concave].reverse() },
  { name: 'closed concave L', polygon: [...concave, [0, 0]] },
  {
    name: 'consecutive repeats',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  },
  { name: 'repeated closure', polygon: [...concave, [0, 0], [0, 0]] },
  {
    name: 'collinear edge vertex',
    polygon: [
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  },
  {
    name: 'all collinear',
    polygon: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  },
  {
    name: 'all coincident',
    polygon: [
      [2, 3],
      [2, 3],
      [2, 3],
    ],
  },
  { name: '80 vertices before spatial indexing', polygon: radialRing(80) },
  { name: '81 vertices using spatial indexing', polygon: radialRing(81) },
  { name: 'large concave ring', polygon: radialRing(128) },
  { name: 'reversed large concave ring', polygon: radialRing(128).reverse() },
]

describe('triangulatePlanPolygon', () => {
  for (const { name, polygon } of cases) {
    test(`${name}: renderer index triples without mutating the supplied ring`, () => {
      const before = structuredClone(polygon)
      for (const point of polygon) Object.freeze(point)
      const input: readonly Point[] = Object.freeze(polygon)
      // Three removes a closing vertex in place, so it receives its own copy.
      const expected = ShapeUtils.triangulateShape(
        input.map(([x, z]) => new Vector2(x, z)),
        [],
      )
      const triangles = triangulatePlanPolygon(input)
      expect(triangles).toEqual(expected)
      for (const triangle of triangles) {
        expect(triangle).toHaveLength(3)
        for (const index of triangle) {
          expect(Number.isInteger(index)).toBe(true)
          expect(index).toBeGreaterThanOrEqual(0)
          expect(index).toBeLessThan(input.length)
        }
      }
      expect(input).toEqual(before)
    })
  }

  test('covers the L-shaped area without filling its missing upper-right corner', () => {
    // 4x4 square minus a 3x3 corner: area 7, not the convex hull or a triangle fan.
    const triangles = triangulatePlanPolygon(concave)
    expect(triangles).toHaveLength(4)
    let area = 0
    for (const [i, j, k] of triangles) {
      const a = concave[i]!
      const b = concave[j]!
      const c = concave[k]!
      const twiceArea = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      expect(twiceArea).toBeGreaterThan(0)
      area += twiceArea / 2
      // Interior samples must stay in the union of the two rectangular arms.
      for (const weights of [
        [1, 1, 1],
        [6, 3, 1],
        [1, 6, 3],
        [3, 1, 6],
      ]) {
        const total = weights[0]! + weights[1]! + weights[2]!
        const x = (a[0] * weights[0]! + b[0] * weights[1]! + c[0] * weights[2]!) / total
        const z = (a[1] * weights[0]! + b[1] * weights[1]! + c[1] * weights[2]!) / total
        expect(x <= 1 || z <= 1).toBe(true)
      }
    }
    expect(area).toBe(7)
  })

  test('large-ring triangles preserve the independently computed polygon area', () => {
    const polygon = radialRing(128)
    // Alternating radii 5 and 3: each central wedge has area 15*sin(2pi/n)/2.
    const expectedArea = (128 * 15 * Math.sin((2 * Math.PI) / 128)) / 2
    const triangles = triangulatePlanPolygon(polygon)
    expect(triangles).toHaveLength(126)
    const area = triangles.reduce((sum, [i, j, k]) => {
      const a = polygon[i]!
      const b = polygon[j]!
      const c = polygon[k]!
      return sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
    }, 0)
    expect(area).toBeCloseTo(expectedArea, 9)
  })
})
