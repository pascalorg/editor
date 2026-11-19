import { describe, expect, test } from 'bun:test'
import {
  clipRoofTrianglesByTrim,
  getRoofSegmentTrimCuts,
  ROOF_TRIM_CUT_EPSILON,
  RoofSegmentNode,
  type RoofSurfaceTriangle,
} from '../index'

function segment(trim: Record<string, number> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    roofType: 'flat',
    width: 8,
    depth: 6,
    wallHeight: 2,
    pitch: 0,
    wallThickness: 0.2,
    overhang: 0.5,
    gableOverhang: 0,
    deckThickness: 0.2,
    shingleThickness: 0.1,
    trim,
  })
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function planArea(triangles: readonly RoofSurfaceTriangle[]): number {
  return triangles.reduce(
    (sum, { vertices: [a, b, c] }) =>
      sum + Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2,
    0,
  )
}

function rectangle(y = 1): RoofSurfaceTriangle[] {
  return [
    {
      vertices: [
        [-4, y, -3],
        [-4, y, 3],
        [4, y, 3],
      ],
      normal: [0, 1, 0],
    },
    {
      vertices: [
        [-4, y, -3],
        [4, y, 3],
        [4, y, -3],
      ],
      normal: [0, 1, 0],
    },
  ]
}

function close(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, 9)
  })
}

// These finite-box oracles come from the native renderer before extraction.
// A half-plane proxy would incorrectly erase vertices above/below the actual cutters.
describe('native roof trim cuboids', () => {
  test('axis cut centers and sizes include the exact inward .002 metre allowance', () => {
    expect(ROOF_TRIM_CUT_EPSILON).toBe(0.002)
    expect(getRoofSegmentTrimCuts(segment())).toEqual([])
    const cases: { trim: Record<string, number>; center: number[]; size: number[] }[] = [
      { trim: { left: 1 }, center: [-4.999, 1.15, 0], size: [4.002, 6.3, 12] },
      { trim: { right: 2 }, center: [4.499, 1.15, 0], size: [5.002, 6.3, 12] },
      { trim: { front: 1 }, center: [0, 1.15, 3.999], size: [14, 6.3, 4.002] },
      { trim: { back: 0.5 }, center: [0, 1.15, -4.249], size: [14, 6.3, 3.502] },
    ]
    for (const { trim, center, size } of cases) {
      const cuts = getRoofSegmentTrimCuts(freeze(segment(trim)))
      expect(cuts).toHaveLength(1)
      close(cuts[0]!.center, center)
      close(cuts[0]!.size, size)
      expect(cuts[0]!.rotation).toBe(0)
    }
  })

  test('a diagonal cut expands both endpoints and shifts its near face along the unit normal', () => {
    const cuts = getRoofSegmentTrimCuts(segment({ frontLeftX: 1, frontLeftZ: 1 }))
    expect(cuts).toHaveLength(1)
    const cut = cuts[0]!
    const diagonal = Math.sqrt(340) // expanded bounding rectangle: 14 by 12
    const shift = (diagonal - 0.002) / Math.sqrt(2)
    close(cut.center, [-3.499 - shift, 1.15, 2.499 + shift])
    close(cut.size, [2 * diagonal, 6.3, 2 * diagonal])
    expect(Math.cos(cut.rotation)).toBeCloseTo(Math.SQRT1_2, 9)
    expect(Math.sin(cut.rotation)).toBeCloseTo(-Math.SQRT1_2, 9)
  })
})

describe('roof triangle trim subtraction', () => {
  test('without cuts preserves geometry and never mutates triangle vertices or normals', () => {
    const input = freeze(rectangle())
    const before = structuredClone(input)
    const result = clipRoofTrianglesByTrim(freeze(segment()), input)
    expect(planArea(result)).toBe(48)
    const outputVertices = result.flatMap((triangle) => triangle.vertices)
    for (const vertex of input.flatMap((triangle) => triangle.vertices)) {
      expect(
        outputVertices.some(
          (point) =>
            Math.hypot(point[0] - vertex[0], point[1] - vertex[1], point[2] - vertex[2]) < 1e-9,
        ),
      ).toBe(true)
    }
    expect(input).toEqual(before)
    expect(clipRoofTrianglesByTrim(segment({ left: 1 }), [])).toEqual([])
  })

  test('combined axis cuts preserve the independently calculated remaining rectangle area', () => {
    const result = clipRoofTrianglesByTrim(
      segment({ left: 1, right: 2, front: 1, back: 0.5 }),
      freeze(rectangle()),
    )
    expect(planArea(result)).toBeCloseTo(4.996 * 4.496, 9)
    for (const triangle of result) {
      close(triangle.normal, [0, 1, 0])
      for (const [x, y, z] of triangle.vertices) {
        expect(x).toBeGreaterThanOrEqual(-2.998 - 1e-9)
        expect(x).toBeLessThanOrEqual(1.998 + 1e-9)
        expect(z).toBeGreaterThanOrEqual(-2.498 - 1e-9)
        expect(z).toBeLessThanOrEqual(1.998 + 1e-9)
        expect(y).toBeCloseTo(1, 9)
      }
    }
  })

  for (const [corner, sx, sz] of [
    ['frontLeft', -1, 1],
    ['frontRight', 1, 1],
    ['backLeft', -1, -1],
    ['backRight', 1, -1],
  ] as const) {
    test(`${corner} removes the expanded right triangle, not the opposite half-plane`, () => {
      const result = clipRoofTrianglesByTrim(
        segment({ [`${corner}X`]: 1, [`${corner}Z`]: 1 }),
        rectangle(),
      )
      const leg = 1.002 + 0.002 * Math.sqrt(2)
      expect(planArea(result)).toBeCloseTo(48 - (leg * leg) / 2, 8)
      for (const [x, , z] of result.flatMap((triangle) => triangle.vertices)) {
        expect(sx * x + sz * z).toBeLessThanOrEqual(7 - leg + 1e-9)
      }
    })
  }

  test('keeps triangles outside finite cutter height and clips partial height intersections', () => {
    const node = segment({ left: 1 })
    for (const y of [-3, 5]) {
      expect(planArea(clipRoofTrianglesByTrim(node, rectangle(y)))).toBeCloseTo(48, 9)
    }
    const beyondBox: RoofSurfaceTriangle[] = [
      {
        vertices: [
          [-9, 1, -1],
          [-9, 1, 1],
          [-8, 1, 0],
        ],
        normal: [0, 1, 0],
      },
    ]
    expect(planArea(clipRoofTrianglesByTrim(node, beyondBox))).toBeCloseTo(1, 9)
    // Entire triangle is left of the trim plane, but only its low corner lies below maxY=4.3.
    const input: RoofSurfaceTriangle[] = [
      {
        vertices: [
          [-6, 4, -1],
          [-5, 5, 1],
          [-5, 5, -1],
        ],
        normal: [-Math.SQRT1_2, Math.SQRT1_2, 0],
      },
    ]
    const result = clipRoofTrianglesByTrim(node, freeze(input))
    expect(planArea(result)).toBeCloseTo(0.91, 9)
    for (const triangle of result) {
      close(triangle.normal, input[0]!.normal)
      for (const [x, y] of triangle.vertices) {
        expect(y).toBeGreaterThanOrEqual(4.3 - 1e-9)
        expect(y).toBeCloseTo(x + 10, 9)
      }
    }
  })

  test('removes wholly covered support without replacing it with nominal triangles', () => {
    const input: RoofSurfaceTriangle[] = [
      {
        vertices: [
          [-3.9, 1, -1],
          [-3.9, 1, 1],
          [-3.5, 1, 0],
        ],
        normal: [0, 1, 0],
      },
    ]
    expect(clipRoofTrianglesByTrim(segment({ left: 1 }), input)).toEqual([])
  })
})
