import { describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  encodeTerrainField,
  persistedTerrainFieldOf,
  type TerrainField,
} from '@pascal-app/core'
import { SiteNode, TerrainBreakNode } from '@pascal-app/core/schema'
import { buildTerrainBreakMesh, buildTerrainGroundMesh } from '@pascal-app/nodes'

type Mesh = ReturnType<typeof buildTerrainGroundMesh>
type Point = [number, number, number]

function vertex(mesh: Mesh, index: number): Point {
  const x = mesh.positions[index * 3]
  const y = mesh.positions[index * 3 + 1]
  const z = mesh.positions[index * 3 + 2]
  if (x === undefined || y === undefined || z === undefined)
    throw new Error(`Incomplete terrain vertex at index ${index}`)
  return [x, y, z]
}

function triangles(mesh: Mesh): [Point, Point, Point][] {
  const result: [Point, Point, Point][] = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]
    const b = mesh.indices[i + 1]
    const c = mesh.indices[i + 2]
    if (a === undefined || b === undefined || c === undefined)
      throw new Error(`Incomplete terrain triangle at offset ${i}`)
    result.push([vertex(mesh, a), vertex(mesh, b), vertex(mesh, c)])
  }
  return result
}

function cross(a: Point, b: Point, c: Point): Point {
  const u: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v: Point = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
}

function area(mesh: Mesh): number {
  return triangles(mesh).reduce((sum, [a, b, c]) => sum + Math.hypot(...cross(a, b, c)) / 2, 0)
}

function float32PositionError(point: Point): number {
  return Math.hypot(
    ...point.map((value) => 2 ** Math.max(-150, Math.floor(Math.log2(Math.abs(value))) - 24)),
  )
}

function expectFaceDirection(a: Point, b: Point, c: Point, sign = 1) {
  const normal = cross(a, b, c)
  const length = Math.hypot(...normal)
  const expected: Point = [sign * 0.8, 0, sign * -0.6]
  expect(length).toBeGreaterThan(0)
  expect(normal[0] * expected[0] + normal[2] * expected[2]).toBeGreaterThan(0)
  const errorA = float32PositionError(a)
  const errorU = errorA + float32PositionError(b)
  const errorV = errorA + float32PositionError(c)
  const lengthU = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const lengthV = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])
  // Float32 endpoint rounding is amplified by short edges. Bound the cross-product
  // error, then its normalization; this does not relax winding or stored normals.
  const crossError = lengthU * errorV + lengthV * errorU + errorU * errorV
  const budget = Math.max(0.000005, (2 * crossError) / length)
  for (const axis of [0, 1, 2] as const)
    expect(Math.abs(normal[axis] / length - expected[axis])).toBeLessThanOrEqual(budget)
}

// Independent closure oracle: barycentric coordinates on the XZ projection of
// an actual emitted surface triangle, not a height query into production authority.
function surfaceDistance(point: Point, surfaces: [Point, Point, Point][]): number {
  let distance = Number.POSITIVE_INFINITY
  for (const [a, b, c] of surfaces) {
    const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
    if (Math.abs(denominator) < 1e-12) continue
    const u = ((b[2] - c[2]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[2] - c[2])) / denominator
    const v = ((c[2] - a[2]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[2] - c[2])) / denominator
    if (u < -1e-5 || v < -1e-5 || u + v > 1 + 1e-5) continue
    distance = Math.min(distance, Math.abs(point[1] - (u * a[1] + v * b[1] + (1 - u - v) * c[1])))
  }
  return distance
}

function fixture(left = 5, right = 2) {
  const ground = createTerrainField({ origin: [28, 0], cols: 17, rows: 17, spacing: 0.5 })
  const edge = TerrainBreakNode.parse({
    id: 'terrain-break_geometry',
    parentId: 'site_geometry',
    kind: 'cliff',
    line: [
      [29, 0],
      [35, 8],
    ],
    left,
    right,
  })
  const site = SiteNode.parse({
    id: 'site_geometry',
    children: [edge.id],
    terrain: encodeTerrainField(ground),
  })
  const field = persistedTerrainFieldOf(site, { [site.id]: site, [edge.id]: edge })
  if (!field) throw new Error('Expected break-aware terrain')
  // Two windows of the canonical half-metre lattice meet at the 32 m tile seam.
  const grids = [28, 32].map((x) =>
    createTerrainField({ origin: [x, 0], cols: 9, rows: 17, spacing: 0.5 }),
  )
  return { ground, edge, field, grids }
}

// Analytical oracle: 6-8-10 line across an 8×8 square, two constant planes,
// exposed area 10×3. Any tessellation is valid if its coverage, closure and
// winding agree; no triangulation order or vertex count is prescribed.
describe('exact terrain break surfaces and faces', () => {
  test('clips both flat surfaces exactly at an oblique edge crossing the tile seam', () => {
    const { field, grids } = fixture()
    const surfaces = grids.map((grid) => buildTerrainGroundMesh(grid, field))
    expect(surfaces.reduce((sum, mesh) => sum + area(mesh), 0)).toBeCloseTo(64, 5)
    for (const mesh of surfaces) {
      expect(mesh.indices.length).toBeGreaterThan(0)
      for (const [a, b, c] of triangles(mesh)) {
        expect(cross(a, b, c)[1]).toBeGreaterThan(0)
        const centreX = (a[0] + b[0] + c[0]) / 3
        const centreZ = (a[2] + b[2] + c[2]) / 3
        const side = 6 * centreZ - 8 * (centreX - 29)
        const expected = side >= 0 ? 5 : 2
        for (const point of [a, b, c]) {
          expect(Math.abs(point[1] - expected)).toBeLessThanOrEqual(0.001)
          const vertexSide = 6 * point[2] - 8 * (point[0] - 29)
          expect(side >= 0 ? vertexSide : -vertexSide).toBeGreaterThanOrEqual(-1e-4)
        }
      }
      for (let i = 0; i < mesh.normals.length; i += 3) {
        expect(mesh.normals[i]).toBeCloseTo(0, 6)
        expect(mesh.normals[i + 1]).toBeCloseTo(1, 6)
        expect(mesh.normals[i + 2]).toBeCloseTo(0, 6)
      }
    }
  })

  for (const [left, right, sign] of [
    [5, 2, 1],
    [2, 5, -1],
  ] as const) {
    test(`face area, outward normals and two-sided closure with left=${left}, right=${right}`, () => {
      const { edge, field, grids } = fixture(left, right)
      const mesh = buildTerrainBreakMesh(edge, field, grids)
      const surfaces = grids.flatMap((grid) => triangles(buildTerrainGroundMesh(grid, field)))
      expect(area(mesh)).toBeCloseTo(30, 4)
      expect(mesh.indices.length).toBeGreaterThan(0)
      for (const [a, b, c] of triangles(mesh)) {
        expectFaceDirection(a, b, c, sign)
        for (const point of [a, b, c]) {
          expect(Math.abs(6 * point[2] - 8 * (point[0] - 29))).toBeLessThanOrEqual(1e-4)
          expect(Math.min(Math.abs(point[1] - 2), Math.abs(point[1] - 5))).toBeLessThanOrEqual(
            0.001,
          )
          expect(surfaceDistance(point, surfaces)).toBeLessThanOrEqual(0.01)
        }
        for (const [p, q] of [
          [a, b],
          [b, c],
          [c, a],
        ] as const) {
          if (Math.abs(p[1] - q[1]) > 0.001) continue
          const midpoint: Point = [(p[0] + q[0]) / 2, p[1], (p[2] + q[2]) / 2]
          expect(surfaceDistance(midpoint, surfaces)).toBeLessThanOrEqual(0.01)
        }
      }
      for (let i = 0; i < mesh.normals.length; i += 3) {
        expect(mesh.normals[i]).toBeCloseTo(sign * 0.8, 5)
        expect(mesh.normals[i + 1]).toBeCloseTo(0, 5)
        expect(mesh.normals[i + 2]).toBeCloseTo(sign * -0.6, 5)
      }
      // Both levels must close at the exact seam point, independently of how
      // either tile or the face is triangulated.
      for (const y of [2, 5])
        expect(surfaceDistance([32, y, 4], surfaces)).toBeLessThanOrEqual(0.01)
    })
  }

  test('an oblique face closes against a sloping keep-ground side across the tile seam', () => {
    const { ground, edge: numericEdge, grids } = fixture()
    for (let row = 0; row < ground.rows; row++)
      for (let col = 0; col < ground.cols; col++) ground.heights[row * ground.cols + col] = row * 25
    const edge = TerrainBreakNode.parse({ ...numericEdge, right: 'ground' })
    const site = SiteNode.parse({
      id: 'site_geometry',
      children: [edge.id],
      terrain: encodeTerrainField(ground),
    })
    const field = persistedTerrainFieldOf(site, {
      [site.id]: site,
      [edge.id]: edge,
    }) as TerrainField
    const surfaces = grids.flatMap((grid) => triangles(buildTerrainGroundMesh(grid, field)))
    const face = buildTerrainBreakMesh(edge, field, grids)
    // Lower ground y=.5z: the 10 m edge's average drop is 3 m.
    expect(area(face)).toBeCloseTo(30, 4)
    for (const [a, b, c] of triangles(face)) {
      expectFaceDirection(a, b, c)
      for (const point of [a, b, c]) {
        expect(
          Math.min(Math.abs(point[1] - 5), Math.abs(point[1] - 0.5 * point[2])),
        ).toBeLessThanOrEqual(0.001)
        expect(surfaceDistance(point, surfaces)).toBeLessThanOrEqual(0.01)
      }
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const bothTop = Math.abs(p[1] - 5) < 0.001 && Math.abs(q[1] - 5) < 0.001
        const bothBottom =
          Math.abs(p[1] - 0.5 * p[2]) < 0.001 && Math.abs(q[1] - 0.5 * q[2]) < 0.001
        if (bothTop || bothBottom)
          expect(
            surfaceDistance([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], surfaces),
          ).toBeLessThanOrEqual(0.01)
      }
    }
    expect(surfaceDistance([32, 2, 4], surfaces)).toBeLessThanOrEqual(0.01)
    expect(surfaceDistance([32, 5, 4], surfaces)).toBeLessThanOrEqual(0.01)
  })

  test('a retaining terrace closes to the composed upper cliff, not the underlying legacy samples', () => {
    const { ground, edge: cliff, grids } = fixture()
    const terrace = TerrainBreakNode.parse({
      id: 'terrain-break_terrace',
      parentId: 'site_geometry',
      kind: 'retaining',
      line: [
        [29, 4],
        [30, 4],
        [30, 6],
        [29, 6],
        [29, 4],
      ],
      left: 7,
      right: 'ground',
    })
    const site = SiteNode.parse({
      id: 'site_geometry',
      children: [cliff.id, terrace.id],
      terrain: encodeTerrainField(ground),
    })
    const field = persistedTerrainFieldOf(site, {
      [site.id]: site,
      [cliff.id]: cliff,
      [terrace.id]: terrace,
    }) as TerrainField
    const surfaces = grids.flatMap((grid) => triangles(buildTerrainGroundMesh(grid, field)))
    const face = buildTerrainBreakMesh(terrace, field, grids)
    expect(area(face)).toBeCloseTo(12, 4)
    expect(surfaceDistance([29.5, 7, 5], surfaces)).toBeLessThanOrEqual(0.001)
    expect(surfaceDistance([30.25, 5, 5], surfaces)).toBeLessThanOrEqual(0.001)
    expect(surfaceDistance([35, 2, 5], surfaces)).toBeLessThanOrEqual(0.001)
    for (const triangle of triangles(face))
      for (const point of triangle) {
        expect(Math.min(Math.abs(point[1] - 5), Math.abs(point[1] - 7))).toBeLessThanOrEqual(0.001)
        expect(surfaceDistance(point, surfaces)).toBeLessThanOrEqual(0.01)
      }
  })

  test('a closed retaining terrace has a flat top, unchanged outside and a closed perimeter face', () => {
    const ground = createTerrainField({ origin: [0, 0], cols: 17, rows: 17, spacing: 0.5 })
    ground.heights.fill(100)
    const edge = TerrainBreakNode.parse({
      id: 'terrain-break_closed',
      parentId: 'site_closed',
      kind: 'retaining',
      line: [
        [2.13, 2.27],
        [5.13, 2.27],
        [5.13, 4.27],
        [2.13, 4.27],
        [2.13, 2.27],
      ],
      left: 4,
      right: 'ground',
    })
    const site = SiteNode.parse({
      id: 'site_closed',
      children: [edge.id],
      terrain: encodeTerrainField(ground),
    })
    const field = persistedTerrainFieldOf(site, {
      [site.id]: site,
      [edge.id]: edge,
    }) as TerrainField
    const surface = buildTerrainGroundMesh(ground, field)
    const face = buildTerrainBreakMesh(edge, field, [ground])
    expect(area(surface)).toBeCloseTo(64, 4)
    expect(area(face)).toBeCloseTo(30, 4)
    const surfaces = triangles(surface)
    expect(surfaceDistance([3, 4, 3], surfaces)).toBeLessThanOrEqual(0.001)
    expect(surfaceDistance([6, 1, 3], surfaces)).toBeLessThanOrEqual(0.001)
    for (const triangle of triangles(face))
      for (const point of triangle)
        expect(surfaceDistance(point, surfaces)).toBeLessThanOrEqual(0.01)
  })
})
