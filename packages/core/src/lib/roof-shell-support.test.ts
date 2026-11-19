import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  getRoofSegmentShellSeat,
  getRoofSegmentShellSupport,
  RoofNode,
  RoofSegmentNode,
  type RoofShellSupport,
  type RoofSurfaceTriangle,
} from '../index'

type Point = [number, number]
const rootId = 'roof_support'
const pitch = (Math.atan(0.5) * 180) / Math.PI

function segment(patch: Record<string, unknown> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id: 'rseg_support',
    parentId: rootId,
    roofType: 'flat',
    width: 4,
    depth: 4,
    wallHeight: 2,
    pitch: 0,
    wallThickness: 0.01,
    overhang: 0,
    deckThickness: 0.2,
    shingleThickness: 0.05,
    fascia: false,
    wallShell: 'omit',
    ...patch,
  })
}

function rectangle(x0: number, z0: number, x1: number, z1: number): Point[] {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
}

function scene(node: RoofSegmentNode, others: AnyNode[] = []) {
  const children = [node, ...others].filter(
    (entry) => entry.type === 'roof-segment' && entry.parentId === rootId,
  )
  const roof = RoofNode.parse({ id: rootId, children: children.map((entry) => entry.id) })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [roof, node, ...others].map((entry) => [entry.id, entry]),
  )
  return { roof, nodes }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function area(triangles: readonly RoofSurfaceTriangle[]): number {
  return triangles.reduce(
    (sum, { vertices: [a, b, c] }) =>
      sum + Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2,
    0,
  )
}

function contains(polygon: Point[], [x, z]: Point): boolean {
  let inside = false
  for (let i = 0; i < polygon.length; i++) {
    const [ax, az] = polygon[i]!
    const [bx, bz] = polygon[(i + 1) % polygon.length]!
    if (
      Math.abs((bx - ax) * (z - az) - (bz - az) * (x - ax)) < 1e-9 &&
      x >= Math.min(ax, bx) - 1e-9 &&
      x <= Math.max(ax, bx) + 1e-9 &&
      z >= Math.min(az, bz) - 1e-9 &&
      z <= Math.max(az, bz) + 1e-9
    )
      return true
    if (az > z !== bz > z && x < ax + ((bx - ax) * (z - az)) / (bz - az)) inside = !inside
  }
  return inside
}

function supported(
  node: RoofSegmentNode,
  outline: Point[],
  others: AnyNode[] = [],
): RoofShellSupport {
  const { roof, nodes } = scene(node, others)
  const before = structuredClone({ roof, nodes, outline })
  const result = getRoofSegmentShellSupport(
    freeze(roof),
    freeze(node),
    freeze(outline),
    freeze(nodes),
  )
  expect({ roof, nodes, outline }).toEqual(before)
  expect(result.status).toBe('supported')
  if (result.status !== 'supported') throw new Error(JSON.stringify(result))
  expect(result.value.segment.id).toBe(node.id)
  return result.value
}

function expectCoverage(
  value: RoofShellSupport,
  outline: Point[],
  expectedArea: number,
  height?: (x: number, z: number) => number,
) {
  expect(value.triangles.length).toBeGreaterThan(0)
  expect(area(value.triangles)).toBeCloseTo(expectedArea, 8)
  expect(value.outline).toHaveLength(outline.length)
  for (const point of value.outline) expect(outline).toContainEqual(point)
  for (const {
    vertices: [a, b, c],
    normal,
  } of value.triangles) {
    expect((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])).toBeGreaterThan(0)
    expect(Math.hypot(...normal)).toBeCloseTo(1, 8)
    expect(normal[1]).toBeGreaterThan(0)
    for (const point of [a, b, c]) {
      expect(point.every(Number.isFinite)).toBe(true)
      expect(contains(outline, [point[0], point[2]])).toBe(true)
      if (height) expect(point[1]).toBeCloseTo(height(point[0], point[2]), 8)
    }
    expect(contains(outline, [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3])).toBe(true)
  }
  expect(value.patches.length).toBeGreaterThan(0)
  expect(area(value.patches.flatMap((patch) => patch.triangles))).toBeCloseTo(expectedArea, 8)
}

// Expectations frozen before c2 production: requested-polygon area/containment is independent
// of any producer's triangulation. Planes use y = a*x + b*z + c, in segment-local coordinates.
describe('complete structural footprint support', () => {
  test('clips a flat structural surface to the request, excluding build-up and parent transforms', () => {
    const node = segment({ position: [20, 7, -30], rotation: 0.7 })
    const outline = rectangle(-1, -0.5, 1, 0.5)
    const value = supported(node, outline)
    expectCoverage(value, outline, 2, () => 2)
    expect(value.plane).toEqual([0, 0, 2])
    expect(value.normal).toEqual([0, 1, 0])
    for (const patch of value.patches) {
      expect(patch.sourcePieceIndex).toBeNull()
      expect(patch.neighborIds).toEqual([])
    }
  })

  test('a concave request is not replaced by its rectangle or convex hull, in either winding', () => {
    const polygon: Point[] = [
      [-1, -1],
      [1, -1],
      [1, 0],
      [0, 0],
      [0, 1],
      [-1, 1],
    ]
    for (const outline of [polygon, [...polygon].reverse()]) {
      const value = supported(segment(), outline)
      expectCoverage(value, outline, 3, () => 2)
    }
  })

  test('a single native slope reports its local plane and upward geometric normal', () => {
    const node = segment({ roofType: 'gable', depth: 6, pitch })
    const outline = rectangle(-1, 0.5, 1, 1.5)
    const value = supported(node, outline)
    expectCoverage(value, outline, 2, (_x, z) => 3.5 - 0.5 * z)
    expect(value.plane).not.toBeNull()
    for (const [axis, expected] of [0, -0.5, 3.5].entries())
      expect(value.plane![axis]).toBeCloseTo(expected, 8)
    expect(value.normal).not.toBeNull()
    for (const [axis, expected] of [0, 2 / Math.sqrt(5), 1 / Math.sqrt(5)].entries())
      expect(value.normal![axis]).toBeCloseTo(expected, 8)
  })

  test('refuses a hole crossed by the polygon despite supported corners and center', () => {
    // The missing square [-1.5,-.5] x [-.5,.5] lies away from the center and all outer vertices.
    const node = segment({
      roofType: 'shed',
      shedFootprintPieces: [
        rectangle(-2, -2, -1.5, 2),
        rectangle(-0.5, -2, 2, 2),
        rectangle(-1.5, -2, -0.5, -0.5),
        rectangle(-1.5, 0.5, -0.5, 2),
      ],
    })
    const { roof, nodes } = scene(node)
    const outline = rectangle(-1.9, -1.9, 1.9, 1.9)
    for (const point of [...outline, [0, 0] as Point]) {
      expect(getRoofSegmentShellSeat(roof, node, point, nodes).status).toBe('supported')
    }
    expect(getRoofSegmentShellSeat(roof, node, [-1, 0], nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
    expect(getRoofSegmentShellSupport(roof, node, outline, nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
    const clear = rectangle(0.2, -0.4, 1.2, 0.4)
    expectCoverage(supported(node, clear), clear, 0.8, () => 2)
  })

  test('overlapping triangles cannot pay for a missing interior region by summed area', () => {
    const node = segment({
      roofType: 'shed',
      shedFootprintPieces: [
        rectangle(-2, -2, -1.5, 2),
        rectangle(-0.5, -2, 2, 2),
        rectangle(-1.5, -2, -0.5, -0.5),
        rectangle(-1.5, 0.5, -0.5, 2),
        rectangle(-0.5, -2, 2, 2),
      ],
    })
    const { roof, nodes } = scene(node)
    const outline = rectangle(-1.9, -1.9, 1.9, 1.9)
    // The duplicated right-hand piece adds >9 m² of triangles, but cannot fill the 1 m² hole.
    for (const point of [...outline, [0, 0] as Point]) {
      expect(getRoofSegmentShellSeat(roof, node, point, nodes).status).toBe('supported')
    }
    expect(getRoofSegmentShellSupport(roof, node, outline, nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
  })

  test('a glazed interior empty cell also invalidates a footprint whose corners and center hit', () => {
    const node = segment({
      roofType: 'gable',
      roofSystem: 'glazed',
      width: 6,
      depth: 6,
      pitch,
      glazing: {
        across: { layout: 'count', count: 3 },
        along: { layout: 'count', count: 3 },
        panels: [{ face: 'front', column: 0, row: 1, type: 'empty' }],
      },
    })
    const { roof, nodes } = scene(node)
    const outline = rectangle(-2.8, 0.1, 2.8, 2.9)
    for (const point of [...outline, [0, 1.5] as Point]) {
      expect(getRoofSegmentShellSeat(roof, node, point, nodes).status).toBe('supported')
    }
    expect(getRoofSegmentShellSeat(roof, node, [-2, 1.5], nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
    expect(getRoofSegmentShellSupport(roof, node, outline, nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
  })

  test('a footprint extending beyond the shell is not clipped and reported as complete', () => {
    const node = segment({ overhang: 1 })
    const { roof, nodes } = scene(node)
    expect(getRoofSegmentShellSupport(roof, node, rectangle(1.8, -0.2, 2.2, 0.2), nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
  })

  test('a cut corner or a micrometre-wide unsupported strip cannot be hidden by center sampling', () => {
    const node = segment({ width: 8, depth: 6, trim: { frontRightX: 1, frontRightZ: 1 } })
    const { roof, nodes } = scene(node)
    expect(getRoofSegmentShellSeat(roof, node, [3.35, 2.35], nodes).status).toBe('supported')
    expect(getRoofSegmentShellSupport(roof, node, rectangle(2.8, 1.8, 3.9, 2.9), nodes)).toEqual({
      status: 'miss',
      reason: 'outside-surface',
    })
    const clear = rectangle(2.9, 1.9, 3.1, 2.1)
    expectCoverage(supported(node, clear), clear, 0.04, () => 2)
    const plain = segment()
    const next = scene(plain)
    expect(
      getRoofSegmentShellSupport(next.roof, plain, rectangle(1.8, -0.2, 2 + 1e-6, 0.2), next.nodes),
    ).toEqual({ status: 'miss', reason: 'outside-surface' })
  })

  test('invalid polygons return invalid-query rather than fabricated support', () => {
    const node = segment()
    const { roof, nodes } = scene(node)
    const invalid: Point[][] = [
      [],
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      [
        [0, 0],
        [1, 0],
        [0, Number.NaN],
      ],
      [
        [0, 0],
        [1, 0],
        [0, Number.POSITIVE_INFINITY],
      ],
      [
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 0],
        [1.5, 0.5],
      ],
    ]
    for (const outline of invalid) {
      expect(getRoofSegmentShellSupport(roof, node, outline, nodes)).toEqual({
        status: 'miss',
        reason: 'invalid-query',
      })
    }
  })
})

describe('physical curved support is not a coplanarity or architectural admission test', () => {
  test('configured native barrel support crosses the crown with nullable plane and normal', () => {
    const node = segment({ roofType: 'barrel', depth: 6, barrelRise: 1, barrelSegments: 4 })
    const outline = rectangle(-0.5, -0.8, 0.5, 0.8)
    const value = supported(node, outline)
    // Radius five, crown y=3; the adjacent native bay has slope sqrt(10)-3.
    expectCoverage(value, outline, 1.6, (_x, z) => 3 - Math.abs(z) * (Math.sqrt(10) - 3))
    expect(value.plane).toBeNull()
    expect(value.normal).toBeNull()
    for (const patch of value.patches) expect(patch.sourcePieceIndex).toBeNull()
  })

  test('a conical apex may be fully supported even though no single plane describes it', () => {
    const node = segment({ roofType: 'conical', width: 6, depth: 6, pitch })
    const outline = rectangle(-0.2, -0.2, 0.2, 0.2)
    const value = supported(node, outline)
    expectCoverage(value, outline, 0.16)
    expect(value.plane).toBeNull()
    expect(value.normal).toBeNull()
  })

  test('bare bent shed bands have support without inventing a stored-piece identity', () => {
    const node = segment({
      roofType: 'shed',
      width: 4,
      depth: 2,
      pitch,
      arc: { centerX: 0, centerZ: 10, radius: 10 },
    })
    const outline = rectangle(-0.8, -0.2, 0.8, 0.2)
    const value = supported(node, outline)
    expectCoverage(value, outline, 0.64)
    expect(value.plane).toBeNull()
    expect(value.normal).toBeNull()
    for (const patch of value.patches) {
      expect(patch.sourcePieceIndex).toBeNull()
      expect(patch.neighborIds).toEqual([])
    }
  })
})

describe('construction provenance is not triangle identity', () => {
  test('original stored indices survive malformed entries, reversed winding and footprint clipping', () => {
    // Deliberately bypass schema validation to model the malformed persisted data handled by c1.
    const node = {
      ...segment({ roofType: 'shed' }),
      shedFootprintPieces: [
        [],
        rectangle(-2, -1, 0, 1).reverse(),
        [
          [0, 0],
          [1, 0],
          ['bad', 1],
        ],
        rectangle(0, -1, 2, 1),
      ],
    } as unknown as RoofSegmentNode
    const outline = rectangle(-1.5, -0.5, 1.5, 0.5)
    const value = supported(node, outline)
    expectCoverage(value, outline, 3, () => 2)
    expect([...new Set(value.patches.map((patch) => patch.sourcePieceIndex))].sort()).toEqual([
      1, 3,
    ])
    for (const index of [1, 3]) {
      const triangles = value.patches
        .filter((patch) => patch.sourcePieceIndex === index)
        .flatMap((patch) => patch.triangles)
      expect(area(triangles)).toBeCloseTo(1.5, 8)
      for (const triangle of triangles)
        for (const [x] of triangle.vertices) {
          if (index === 1) expect(x).toBeLessThanOrEqual(1e-9)
          else expect(x).toBeGreaterThanOrEqual(-1e-9)
        }
    }
    for (const patch of value.patches) expect(patch.neighborIds).toEqual([])
  })

  test('first-valid band faceting remains distinct from the original persisted index', () => {
    const node = {
      ...segment({
        roofType: 'shed',
        width: 4,
        depth: 2,
        pitch,
        arc: { centerX: 0, centerZ: 10, radius: 10 },
      }),
      shedFootprintPieces: [[], rectangle(-2, -1, 2, 1)],
    } as RoofSegmentNode
    const outline = rectangle(-0.8, -0.2, 0.8, 0.2)
    const value = supported(node, outline)
    expectCoverage(value, outline, 0.64)
    expect(value.plane).toBeNull()
    expect(value.normal).toBeNull()
    expect([...new Set(value.patches.map((patch) => patch.sourcePieceIndex))]).toEqual([1])
    for (const patch of value.patches) expect(patch.neighborIds).toEqual([])
  })

  test('later area filtering does not promote the next stored piece into the native band slot', () => {
    const node = segment({
      roofType: 'shed',
      width: 4,
      depth: 2,
      pitch,
      arc: { centerX: 0, centerZ: 10, radius: 10 },
      shedFootprintPieces: [
        [
          [-1, 0],
          [0, 0],
          [1, 0],
        ],
        rectangle(-2, -1, 2, 1),
      ],
    })
    const outline = rectangle(-0.8, -0.2, 0.8, 0.2)
    const value = supported(node, outline)
    // First entry has finite tuples but zero area. Native dispatch facets it, drops it, then
    // bends the SECOND entry as one quad. Its corners all have angle magnitude .2 radians.
    const slope = -0.5 / Math.cos(0.2)
    const intercept = 5 / Math.cos(0.2) - 2.5
    expectCoverage(value, outline, 0.64, (_x, z) => slope * z + intercept)
    expect(value.plane).not.toBeNull()
    for (const [axis, expected] of [0, slope, intercept].entries())
      expect(value.plane![axis]).toBeCloseTo(expected, 8)
    expect([...new Set(value.patches.map((patch) => patch.sourcePieceIndex))]).toEqual([1])
  })

  test('managed synthesized footprints have no persisted construction-piece index', () => {
    const node = segment({ roofType: 'shed', managedByParent: true, trim: { left: 1 } })
    const outline = rectangle(-0.5, -0.5, 0.5, 0.5)
    const value = supported(node, outline)
    expectCoverage(value, outline, 1, () => 2)
    for (const patch of value.patches) {
      expect(patch.sourcePieceIndex).toBeNull()
      expect(patch.neighborIds).toEqual([])
    }
  })

  test('records only the curved neighbor that actually pins a straight triangular seam', () => {
    const node = segment({
      roofType: 'shed',
      shedJointNeighborIds: ['curved-owner', 'straight-owner', 'absent-owner'],
      shedFootprintPieces: [
        [
          [0, -1],
          [0, 1],
          [-2, 0],
        ],
      ],
    })
    const curved = segment({
      id: 'rseg_curved',
      roofType: 'shed',
      wallHeight: 5,
      arc: { centerX: 0, centerZ: 10, radius: 10 },
      shedJointOwnerId: 'curved-owner',
      shedFootprintPieces: [rectangle(0, -2, 2, 2)],
    })
    const straight = segment({
      id: 'rseg_straight',
      roofType: 'shed',
      wallHeight: 7,
      shedJointOwnerId: 'straight-owner',
      shedFootprintPieces: [
        [
          [0, 1],
          [-2, 0],
          [-2, 2],
          [0, 2],
        ],
      ],
    })
    const outline = rectangle(-1.2, -0.1, -0.8, 0.1)
    const value = supported(node, outline, [curved, straight])
    expectCoverage(value, outline, 0.08, (x) => 5 + 1.5 * x)
    expect(value.plane).not.toBeNull()
    for (const [i, expected] of [1.5, 0, 5].entries())
      expect(value.plane![i]).toBeCloseTo(expected, 8)
    expect(value.normal).not.toBeNull()
    for (const [i, expected] of [-1.5 / Math.sqrt(3.25), 1 / Math.sqrt(3.25), 0].entries()) {
      expect(value.normal![i]).toBeCloseTo(expected, 8)
    }
    for (const patch of value.patches) {
      expect(patch.sourcePieceIndex).toBe(0)
      expect(patch.neighborIds).toEqual([curved.id])
    }
  })
})
