import { describe, expect, test } from 'bun:test'
import {
  getShedBandFacetCount,
  getShedFootprintPieces,
  getShedRenderOutlines,
  RoofSegmentNode,
  type ShedPlanPolygon,
  sanitizeRoofPlanPolygon,
} from '../index'

function segment(overrides: Record<string, unknown> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({ roofType: 'shed', width: 8, depth: 6, ...overrides })
}

function rectangle(minX: number, minZ: number, maxX: number, maxZ: number): ShedPlanPolygon {
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ]
}

function signedArea(polygon: ShedPlanPolygon): number {
  return (
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]!
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0) / 2
  )
}

function bounds(polygon: ShedPlanPolygon): number[] {
  return [
    Math.min(...polygon.map(([x]) => x)),
    Math.min(...polygon.map(([, z]) => z)),
    Math.max(...polygon.map(([x]) => x)),
    Math.max(...polygon.map(([, z]) => z)),
  ]
}

function expectBounds(polygon: ShedPlanPolygon, expected: number[]): void {
  bounds(polygon).forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, 9)
  })
}

// Compare geometry, not the non-contractual starting vertex or traversal order.
function expectVertices(polygon: ShedPlanPolygon, expected: ShedPlanPolygon): void {
  expect(polygon).toHaveLength(expected.length)
  const order = ([ax, az]: [number, number], [bx, bz]: [number, number]) => ax - bx || az - bz
  const actual = [...polygon].sort(order)
  const sorted = [...expected].sort(order)
  actual.forEach(([x, z], index) => {
    expect(x).toBeCloseTo(sorted[index]![0], 9)
    expect(z).toBeCloseTo(sorted[index]![1], 9)
  })
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

const arc = { centerX: 0, centerZ: 10, radius: 10 }

// Oracles are rectangles minus right triangles and integrated linear strips.
// Main's pre-extraction renderer establishes trim signs, facet count and flat frame;
// expected geometry below never calls the candidate's trim/split/sanitize helpers.
describe('shed footprints', () => {
  test('stored pieces win over managed trims without moving into world coordinates', () => {
    const stored = [rectangle(10, 20, 12, 23), rectangle(-7, -4, -6, -2)]
    const node = freeze(
      segment({
        managedByParent: true,
        trim: { left: 1, front: 1 },
        position: [30, 9, -12],
        rotation: Math.PI / 3,
        shedFootprintPieces: stored,
      }),
    )
    expect(getShedFootprintPieces(node)).toEqual(stored)
  })

  test('rejects an entire malformed piece rather than salvaging its remaining points', () => {
    const valid = rectangle(0, 0, 2, 3)
    const malformed: unknown[] = [
      null,
      'not a polygon',
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [Number.NaN, 2],
      ],
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [2, Number.POSITIVE_INFINITY],
      ],
      [
        [0, 0],
        [1, 0],
        [0, 1],
        ['2', 2],
      ],
      [[0, 0], [1, 0], [0, 1], [2]],
      [[0, 0], [1, 0], [0, 1], null],
    ]
    // Bypass schema validation only to exercise defensive reads of old/malformed data.
    const node = freeze({
      ...segment({ managedByParent: true }),
      shedFootprintPieces: [...malformed, valid],
    } as unknown as RoofSegmentNode)
    expect(getShedFootprintPieces(node)).toEqual([valid])
    expect(getShedFootprintPieces({ ...node, shedFootprintPieces: [] })).toEqual([
      rectangle(-4, -3, 4, 3),
    ])
    for (const value of [undefined, null, 'bad', malformed]) {
      const invalid = { ...node, shedFootprintPieces: value } as unknown as RoofSegmentNode
      expect(getShedFootprintPieces(invalid)).toEqual([rectangle(-4, -3, 4, 3)])
      expect(getShedFootprintPieces({ ...invalid, managedByParent: false })).toEqual([])
    }
  })

  test('does not invent unmanaged, banded or non-shed footprints', () => {
    expect(getShedFootprintPieces(segment())).toEqual([])
    expect(getShedFootprintPieces(segment({ arc }))).toEqual([])
    for (const roofType of [
      'gable',
      'hip',
      'flat',
      'mansard',
      'gambrel',
      'dutch',
      'barrel',
      'conical',
    ]) {
      const node = segment({
        roofType,
        managedByParent: true,
        shedFootprintPieces: [rectangle(0, 0, 1, 1)],
      })
      expect(getShedFootprintPieces(node)).toEqual([])
      expect(getShedRenderOutlines(node, [rectangle(0, 0, 1, 1)])).toEqual([])
    }
  })

  test('managed axis trims use structural bounds, not overhang or cutter epsilon', () => {
    const node = freeze(
      segment({
        managedByParent: true,
        trim: { left: 1, right: 2, back: 0.5, front: 1 },
        overhang: 2,
        gableOverhang: 3,
        wallThickness: 0.4,
      }),
    )
    const pieces = getShedFootprintPieces(node)
    expect(pieces).toHaveLength(1)
    expectVertices(pieces[0]!, rectangle(-3, -2.5, 2, 2))
    expectBounds(pieces[0]!, [-3, -2.5, 2, 2])
    expect(signedArea(pieces[0]!)).toBeCloseTo(22.5, 9)
  })

  const corners = [
    { name: 'frontLeft', x: -4, z: 3, dx: 2, dz: -1 },
    { name: 'frontRight', x: 4, z: 3, dx: -2, dz: -1 },
    { name: 'backLeft', x: -4, z: -3, dx: 2, dz: 1 },
    { name: 'backRight', x: 4, z: -3, dx: -2, dz: 1 },
  ]
  for (const { name, x, z, dx, dz } of corners) {
    test(`${name} cuts only its 2-by-1 right triangle`, () => {
      const node = segment({ managedByParent: true, trim: { [`${name}X`]: 2, [`${name}Z`]: 1 } })
      const expected = rectangle(-4, -3, 4, 3).filter(([px, pz]) => px !== x || pz !== z)
      expected.push([x + dx, z], [x, z + dz])
      const pieces = getShedFootprintPieces(freeze(node))
      expect(pieces).toHaveLength(1)
      expectVertices(pieces[0]!, expected)
      expect(signedArea(pieces[0]!)).toBeCloseTo(47, 9)
    })
  }

  test('scalar corner trims retain their legacy equal-leg interpretation', () => {
    const [polygon] = getShedFootprintPieces(
      segment({ managedByParent: true, trim: { frontLeft: 1 } }),
    )
    expectVertices(polygon!, [
      [-4, -3],
      [4, -3],
      [4, 3],
      [-3, 3],
      [-4, 2],
    ])
    expect(signedArea(polygon!)).toBeCloseTo(47.5, 9)
  })

  test('diagonal legs start at the axis-trimmed corner, not the original corner', () => {
    const [polygon] = getShedFootprintPieces(
      segment({
        managedByParent: true,
        trim: { left: 1, right: 2, back: 0.5, front: 1, frontLeftX: 2, frontLeftZ: 1 },
      }),
    )
    expectVertices(polygon!, [
      [-3, -2.5],
      [2, -2.5],
      [2, 2],
      [-1, 2],
      [-3, 1],
    ])
    expect(signedArea(polygon!)).toBeCloseTo(21.5, 9)
  })

  test('normalizes oversized axis trims to preserve the minimum 0.1 metre span', () => {
    const [polygon] = getShedFootprintPieces(
      segment({
        managedByParent: true,
        width: 2,
        depth: 2,
        trim: { left: 2, right: 2 },
      }),
    )
    expectBounds(polygon!, [-0.05, -1, 0.05, 1])
    expect(signedArea(polygon!)).toBeCloseTo(0.2, 9)
  })
})

describe('shed outline sanitization', () => {
  test('removes closing/consecutive repeats and collinear wraparound without changing area', () => {
    const polygon: ShedPlanPolygon = [
      [1, 0],
      [2, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 1],
      [0, 0],
      [1, 0],
    ]
    const before = structuredClone(polygon)
    const result = sanitizeRoofPlanPolygon(freeze(polygon))
    expectVertices(result, rectangle(0, 0, 2, 2))
    expect(signedArea(result)).toBe(4)
    expect(polygon).toEqual(before)
  })

  test('keeps real concave corners and their input winding', () => {
    const polygon: ShedPlanPolygon = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ]
    const clockwise = polygon.reverse()
    const result = sanitizeRoofPlanPolygon(freeze(clockwise))
    expectVertices(result, clockwise)
    expect(signedArea(result)).toBe(-7)
    expect(sanitizeRoofPlanPolygon([])).toEqual([])
  })

  test('render outlines discard collapsed pieces and orient surviving outlines counterclockwise', () => {
    const valid = rectangle(0, 0, 2, 3).reverse()
    const pieces: ShedPlanPolygon[] = [
      [],
      [[0, 0]],
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      valid,
    ]
    const before = structuredClone(pieces)
    const result = getShedRenderOutlines(freeze(segment()), freeze(pieces))
    expect(result).toHaveLength(1)
    expectVertices(result[0]!, rectangle(0, 0, 2, 3))
    expect(signedArea(result[0]!)).toBe(6)
    expect(pieces).toEqual(before)
  })
})

describe('banded shed render outlines', () => {
  test('facet counts preserve the renderer spacing and lower/upper limits', () => {
    // Literal renderer-formula control; counts also drive independent strip geometry below.
    for (const [width, expected] of [
      [0.5, 4],
      [1.6, 4],
      [1.6001, 5],
      [8, 20],
      [12.8, 32],
      [20, 32],
    ]) {
      expect(getShedBandFacetCount(width!)).toBe(expected)
    }
  })

  test('only the first piece is split, all coordinates remain flat and inputs stay unchanged', () => {
    const pieces = [rectangle(-0.8, -1, 0.8, 1).reverse(), rectangle(-0.6, 2, 0.6, 3).reverse()]
    const before = structuredClone(pieces)
    const node = freeze(segment({ width: 1.6, depth: 2, arc, position: [20, 7, -9], rotation: 1 }))
    const outlines = getShedRenderOutlines(node, freeze(pieces))
    expect(outlines).toHaveLength(5)
    const ranges = [
      [-0.8, -0.4],
      [-0.4, 0],
      [0, 0.4],
      [0.4, 0.8],
    ]
    ranges.forEach(([minX, maxX], index) => {
      expectVertices(outlines[index]!, rectangle(minX!, -1, maxX!, 1))
      expect(signedArea(outlines[index]!)).toBeCloseTo(0.8, 9)
    })
    expectVertices(outlines[4]!, rectangle(-0.6, 2, 0.6, 3))
    expect(signedArea(outlines[4]!)).toBeCloseTo(1.2, 9)
    expect(pieces).toEqual(before)
    expect(getShedRenderOutlines(node, [])).toEqual([])
    const straight = getShedRenderOutlines(segment({ width: 1.6, depth: 2 }), pieces)
    expect(straight).toHaveLength(2)
    expectVertices(straight[0]!, rectangle(-0.8, -1, 0.8, 1))
    expectVertices(straight[1]!, rectangle(-0.6, 2, 0.6, 3))
  })

  test('sloped clipping intersections preserve triangle area rather than expanding to boxes', () => {
    // Region 0 <= z <= x + .8, -.8 <= x <= .8. Strip areas integrate x + .8.
    const triangle: ShedPlanPolygon = [
      [-0.8, 0],
      [0.8, 0],
      [0.8, 1.6],
    ]
    const outlines = getShedRenderOutlines(segment({ width: 1.6, depth: 2, arc }), [triangle])
    expect(outlines).toHaveLength(4)
    const expectedAreas = [0.08, 0.24, 0.4, 0.56]
    const expected: ShedPlanPolygon[] = [
      [
        [-0.8, 0],
        [-0.4, 0],
        [-0.4, 0.4],
      ],
      [
        [-0.4, 0],
        [0, 0],
        [0, 0.8],
        [-0.4, 0.4],
      ],
      [
        [0, 0],
        [0.4, 0],
        [0.4, 1.2],
        [0, 0.8],
      ],
      [
        [0.4, 0],
        [0.8, 0],
        [0.8, 1.6],
        [0.4, 1.2],
      ],
    ]
    outlines.forEach((polygon, index) => {
      expectVertices(polygon, expected[index]!)
      expect(signedArea(polygon)).toBeCloseTo(expectedAreas[index]!, 9)
    })
    expect(outlines.reduce((sum, polygon) => sum + signedArea(polygon), 0)).toBeCloseTo(1.28, 9)
  })

  test('drops empty strips and clips only the primary band to the segment width', () => {
    const outlines = getShedRenderOutlines(segment({ width: 1.6, depth: 2, arc }), [
      rectangle(-0.2, -1, 1.2, 1),
      rectangle(2, 2, 3, 3),
    ])
    expect(outlines).toHaveLength(4)
    expectVertices(outlines[0]!, rectangle(-0.2, -1, 0, 1))
    expectVertices(outlines[1]!, rectangle(0, -1, 0.4, 1))
    expectVertices(outlines[2]!, rectangle(0.4, -1, 0.8, 1))
    expectVertices(outlines[3]!, rectangle(2, 2, 3, 3))
    expect(outlines.map(signedArea).reduce((sum, area) => sum + area, 0)).toBeCloseTo(3, 9)
  })
})
