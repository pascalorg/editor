import {
  containsPoint,
  difference,
  floorStepRole,
  intersection,
  type MultiPolygon,
  type PlateSurfacePartition,
  plateSideRuns,
  type Ring,
  type SlabNode,
  union,
} from '@pascal-app/core'
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'

/**
 * Cuts the merged slab buffer into one sub-geometry per rendered role.
 *
 * A plain slab keeps the original two buckets (`surface` / `side`) split by
 * face normal. A floor plate additionally has its TOP re-cut against the
 * partition cells (room finishes, regions, manual-slab masks) and its VERTICAL
 * faces cut at every exposure boundary, so one plate draws several finishes and
 * an `edge` / `riser` / `underside` split without a second node.
 *
 * Everything is de-indexed into standalone triangles first — slabs are
 * flat-shaded, so no vertex is shared across a seam and the cut costs nothing
 * in normals. UVs are carried through by barycentric interpolation of the
 * source triangle, which is what keeps a finish tiling continuously across a
 * room at the plate's own world scale.
 */

type Vertex = { x: number; y: number; z: number; u: number; v: number }
type Triangle = [Vertex, Vertex, Vertex]

export type SplitBucket = { role: string; geometry: BufferGeometry }

const TOP_NORMAL_THRESHOLD = 0.5

function readTriangles(geometry: BufferGeometry): Triangle[] {
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const index = geometry.getIndex()
  // A collapsed slab builds an empty geometry with no position attribute.
  const count = index ? index.count / 3 : (position?.count ?? 0) / 3
  const triangles: Triangle[] = []
  for (let t = 0; t < count; t += 1) {
    const corners = [0, 1, 2].map((offset) => {
      const i = index ? index.getX(t * 3 + offset) : t * 3 + offset
      return {
        x: position.getX(i),
        y: position.getY(i),
        z: position.getZ(i),
        u: uv ? uv.getX(i) : 0,
        v: uv ? uv.getY(i) : 0,
      }
    }) as Triangle
    triangles.push(corners)
  }
  return triangles
}

function faceNormalY(triangle: Triangle): number {
  const [a, b, c] = triangle
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const acx = c.x - a.x
  const acy = c.y - a.y
  const acz = c.z - a.z
  const nx = aby * acz - abz * acy
  const ny = abz * acx - abx * acz
  const nz = abx * acy - aby * acx
  const length = Math.hypot(nx, ny, nz)
  return length > 1e-12 ? ny / length : 0
}

function buildGeometry(triangles: readonly Triangle[], withUv: boolean): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  for (const triangle of triangles) {
    for (const vertex of triangle) {
      positions.push(vertex.x, vertex.y, vertex.z)
      if (withUv) uvs.push(vertex.u, vertex.v)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  if (uvs.length > 0) {
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('uv2', new Float32BufferAttribute(uvs.slice(), 2))
  }
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Rebuild a point of the source triangle from its XZ position. Height and UV
 * come from the triangle's own plane, so a clipped piece sits exactly where the
 * original did and keeps the plate's UV mapping.
 */
function sampleTriangle(triangle: Triangle, x: number, z: number): Vertex {
  const [a, b, c] = triangle
  const v0x = b.x - a.x
  const v0z = b.z - a.z
  const v1x = c.x - a.x
  const v1z = c.z - a.z
  const denominator = v0x * v1z - v1x * v0z
  if (Math.abs(denominator) < 1e-18) return { x, y: a.y, z, u: a.u, v: a.v }
  const px = x - a.x
  const pz = z - a.z
  const beta = (px * v1z - v1x * pz) / denominator
  const gamma = (v0x * pz - px * v0z) / denominator
  const alpha = 1 - beta - gamma
  return {
    x,
    z,
    y: alpha * a.y + beta * b.y + gamma * c.y,
    u: alpha * a.u + beta * b.u + gamma * c.u,
    v: alpha * a.v + beta * b.v + gamma * c.v,
  }
}

function triangleRing(triangle: Triangle): Ring {
  return triangle.map((vertex): [number, number] => [vertex.x, vertex.z])
}

function bounds(ring: Ring) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of ring) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}

function polygonBounds(polygons: MultiPolygon) {
  return bounds(polygons.flatMap((polygon) => polygon.outer))
}

function disjoint(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) {
  return a.minX > b.maxX || a.maxX < b.minX || a.minZ > b.maxZ || a.maxZ < b.minZ
}

/** Triangles of `triangle` that fall inside `polygons`, re-triangulated in 2D. */
function clipTriangleToPolygons(triangle: Triangle, polygons: MultiPolygon): Triangle[] {
  const ring = triangleRing(triangle)
  const pieces = intersection(union([ring]), polygons)
  const result: Triangle[] = []
  for (const piece of pieces) {
    const contour = piece.outer.map(([x, z]) => new Vector2(x, z))
    const holes = piece.holes
      .filter((hole) => hole.length >= 3)
      .map((hole) => hole.map(([x, z]) => new Vector2(x, z)))
    const points = [...contour, ...holes.flat()]
    for (const face of ShapeUtils.triangulateShape(contour, holes)) {
      const corners = face.map((cornerIndex) => {
        const point = points[cornerIndex]!
        return sampleTriangle(triangle, point.x, point.y)
      }) as Triangle
      // triangulateShape returns the input winding; the source triangle's
      // orientation is what the renderer culls against, so restore it.
      result.push(faceNormalY(corners) * faceNormalY(triangle) < 0 ? reverse(corners) : corners)
    }
  }
  return result
}

function reverse(triangle: Triangle): Triangle {
  return [triangle[0], triangle[2], triangle[1]]
}

/**
 * Clip a triangle to `s >= limit` (or `s <= limit`), where `s` is the distance
 * along `(dirX, dirZ)` from `origin`. Vertical faces project onto a line, so
 * this is how one side quad is cut at an exposure boundary.
 */
function clipTriangleBySlab(
  triangle: Triangle,
  origin: readonly [number, number],
  dirX: number,
  dirZ: number,
  from: number,
  to: number,
): Triangle[] {
  let polygon: Vertex[] = [...triangle]
  for (const [limit, keepGreater] of [
    [from, true],
    [to, false],
  ] as const) {
    const next: Vertex[] = []
    for (const [index, current] of polygon.entries()) {
      const previous = polygon[(index + polygon.length - 1) % polygon.length]!
      const sPrevious = (previous.x - origin[0]) * dirX + (previous.z - origin[1]) * dirZ - limit
      const sCurrent = (current.x - origin[0]) * dirX + (current.z - origin[1]) * dirZ - limit
      const insidePrevious = keepGreater ? sPrevious >= 0 : sPrevious <= 0
      const insideCurrent = keepGreater ? sCurrent >= 0 : sCurrent <= 0
      if (insidePrevious !== insideCurrent) {
        const t = sPrevious / (sPrevious - sCurrent)
        next.push({
          x: previous.x + (current.x - previous.x) * t,
          y: previous.y + (current.y - previous.y) * t,
          z: previous.z + (current.z - previous.z) * t,
          u: previous.u + (current.u - previous.u) * t,
          v: previous.v + (current.v - previous.v) * t,
        })
      }
      if (insideCurrent) next.push(current)
    }
    polygon = next
    if (polygon.length < 3) return []
  }
  const fan: Triangle[] = []
  for (let index = 1; index < polygon.length - 1; index += 1) {
    fan.push([polygon[0]!, polygon[index]!, polygon[index + 1]!])
  }
  return fan
}

/** The 2D segment a vertical triangle projects onto, longest extent first. */
function verticalSpan(triangle: Triangle) {
  let best: { start: [number, number]; end: [number, number]; length: number } | null = null
  for (let index = 0; index < 3; index += 1) {
    const a = triangle[index]!
    const b = triangle[(index + 1) % 3]!
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (!best || length > best.length) best = { start: [a.x, a.z], end: [b.x, b.z], length }
  }
  return best && best.length > 1e-9 ? best : null
}

function push(buckets: Map<string, Triangle[]>, role: string, triangles: readonly Triangle[]) {
  if (role === 'hidden' || !triangles.length) return
  const bucket = buckets.get(role)
  if (bucket) bucket.push(...triangles)
  else buckets.set(role, [...triangles])
}

/**
 * Split a slab buffer by face orientation only — the pre-plate behaviour, kept
 * verbatim for manual slabs so their two meshes and their paint slots never
 * change.
 */
export function splitSlabFacesByFacing(geometry: BufferGeometry): {
  top: BufferGeometry
  side: BufferGeometry
} {
  const top: Triangle[] = []
  const side: Triangle[] = []
  const withUv = geometry.getAttribute('uv') !== undefined
  for (const triangle of readTriangles(geometry)) {
    ;(faceNormalY(triangle) > TOP_NORMAL_THRESHOLD ? top : side).push(triangle)
  }
  return { top: buildGeometry(top, withUv), side: buildGeometry(side, withUv) }
}

/**
 * Split a plate buffer into one bucket per rendered role: a top bucket per
 * partition cell, `edge` / `riser` per exposure run, and `underside`. Buckets
 * come back in a stable order (cells in partition order, then the sides) so the
 * mesh order of a plate is the same on every rebuild.
 */
export function splitPlateFaces(
  geometry: BufferGeometry,
  partition: PlateSurfacePartition,
  slab: Pick<SlabNode, 'elevation' | 'thickness' | 'polygon' | 'holes'>,
): SplitBucket[] {
  const buckets = new Map<string, Triangle[]>()
  const withUv = geometry.getAttribute('uv') !== undefined
  // Cells in partition order, then the sides in a fixed order: a plate's mesh
  // list is then the same on every rebuild, which is what the node batch's
  // per-mesh allocation keys are indexed by.
  // A room-owned riser draws one mesh per doorway, so each paints on its own.
  const sideRole = (side: { role: string; zoneId?: string; stepKey?: string }) =>
    side.zoneId && side.role !== 'hidden'
      ? side.role === 'riser'
        ? floorStepRole(side.zoneId, side.stepKey)
        : `edge:${side.zoneId}`
      : side.role
  const order = [
    ...new Set([
      ...partition.cells.map((cell) => cell.role),
      'edge',
      'riser',
      ...partition.sides.map(sideRole),
      'underside',
    ]),
  ]

  const cellBounds = partition.cells.map((cell) => polygonBounds(cell.polygons))
  const soffit = slab.elevation - slab.thickness
  const downturns = partition.sides.flatMap((side) => {
    if (side.role === 'hidden' || side.dropTo === undefined || side.dropTo >= soffit - 0.001)
      return []
    const [a, b] = [side.start, side.end]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const dx = (-(b[1] - a[1]) / length) * slab.thickness,
      dz = ((b[0] - a[0]) / length) * slab.thickness
    return [
      {
        bottom: side.dropTo,
        polygon: [a, b, [b[0] + dx, b[1] + dz], [a[0] + dx, a[1] + dz]] as Ring,
      },
    ]
  })
  const downturnCover = union(downturns.map((d) => d.polygon))

  for (const triangle of readTriangles(geometry)) {
    const normalY = faceNormalY(triangle)
    if (normalY > TOP_NORMAL_THRESHOLD) {
      if (partition.plainTop) {
        push(buckets, partition.cells[0]?.role ?? 'surface', [triangle])
        continue
      }
      // Area a manual slab already draws belongs to no cell, so it is simply
      // never emitted — the plate keeps its body and stops z-fighting the top.
      const triangleBounds = bounds(triangleRing(triangle))
      for (const [index, cell] of partition.cells.entries()) {
        if (disjoint(triangleBounds, cellBounds[index]!)) continue
        push(buckets, cell.role, clipTriangleToPolygons(triangle, cell.polygons))
      }
      continue
    }
    if (normalY < -TOP_NORMAL_THRESHOLD) {
      push(
        buckets,
        'underside',
        downturnCover.length
          ? clipTriangleToPolygons(triangle, difference(triangleRing(triangle), downturnCover))
          : [triangle],
      )
    }
  }

  const rings = [slab.polygon, ...slab.holes]
  for (const side of partition.sides) {
    if (side.role === 'hidden') continue
    const bottom = side.bottom ?? side.dropTo ?? slab.elevation - slab.thickness
    const top = side.top ?? slab.elevation
    const [ax, az] = side.start,
      [bx, bz] = side.end
    const [u0, u1] = sideEdgeUvs(rings, side.start, side.end)
    const a = { x: ax, y: bottom, z: az, u: u0, v: bottom }
    const b = { x: bx, y: bottom, z: bz, u: u1, v: bottom }
    const c = { ...b, y: top, v: top },
      d = { ...a, y: top, v: top }
    push(buckets, sideRole(side), [
      [a, c, b],
      [a, d, c],
    ])
  }
  const levels = [...new Set([...downturns.map((d) => d.bottom), soffit])].sort((a, b) => a - b)
  let previous: MultiPolygon = []
  for (const [i, low] of levels.slice(0, -1).entries()) {
    const high = levels[i + 1]!
    const section = union(downturns.filter((d) => d.bottom <= low + 1e-7).map((d) => d.polygon))
    for (const polygon of difference(section, previous)) {
      const contour = polygon.outer.map(([x, z]) => new Vector2(x, z))
      const holes = polygon.holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)))
      const points = [...contour, ...holes.flat()]
      for (const face of ShapeUtils.triangulateShape(contour, holes)) {
        const triangle = face.map((index) => ({
          x: points[index]!.x,
          y: low,
          z: points[index]!.y,
          u: points[index]!.x,
          v: points[index]!.y,
        })) as Triangle
        push(buckets, 'underside', [faceNormalY(triangle) > 0 ? reverse(triangle) : triangle])
      }
    }
    for (const polygon of section)
      for (const ring of [polygon.outer, ...polygon.holes])
        for (const [j, a] of ring.entries()) {
          const b = ring[(j + 1) % ring.length]!
          const dx = b[0] - a[0],
            dz = b[1] - a[1],
            length = Math.hypot(dx, dz)
          const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          const exterior = partition.sides.some((side) => {
            const sx = side.end[0] - side.start[0],
              sz = side.end[1] - side.start[1]
            const t =
              ((midpoint[0] - side.start[0]) * sx + (midpoint[1] - side.start[1]) * sz) /
              (sx * sx + sz * sz)
            return (
              t >= -1e-6 &&
              t <= 1 + 1e-6 &&
              Math.abs((midpoint[0] - side.start[0]) * sz - (midpoint[1] - side.start[1]) * sx) <
                1e-6
            )
          })
          if (exterior) continue
          const normalInside = containsPoint(section, [
            midpoint[0] + (dz / length) * 0.0001,
            midpoint[1] - (dx / length) * 0.0001,
          ])
          const aa = { x: a[0], y: low, z: a[1], u: 0, v: low },
            bb = { x: b[0], y: low, z: b[1], u: length, v: low }
          const cc = { ...bb, y: high, v: high },
            dd = { ...aa, y: high, v: high }
          const faces: Triangle[] = [
            [aa, cc, bb],
            [aa, dd, cc],
          ]
          push(buckets, 'underside', normalInside ? faces.map(reverse) : faces)
        }
    previous = section
  }

  return order
    .filter((role) => (buckets.get(role)?.length ?? 0) > 0)
    .map((role) => ({ role, geometry: buildGeometry(buckets.get(role)!, withUv) }))
}

function sideEdgeUvs(
  rings: readonly Ring[],
  start: readonly [number, number],
  end: readonly [number, number],
): [number, number] {
  for (const ring of rings) {
    for (const [i, a] of ring.entries()) {
      const b = ring[(i + 1) % ring.length]!
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 1e-9) continue
      const dx = (b[0] - a[0]) / length
      const dz = (b[1] - a[1]) / length
      const along = (p: readonly [number, number]) => (p[0] - a[0]) * dx + (p[1] - a[1]) * dz
      const onEdge = (p: readonly [number, number]) =>
        Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) < 1e-6 &&
        along(p) >= -1e-6 &&
        along(p) <= length + 1e-6
      if (onEdge(start) && onEdge(end)) return [along(start), along(end)]
    }
  }
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  const dx = (end[0] - start[0]) / length
  const dz = (end[1] - start[1]) / length
  return [start[0] * dx + start[1] * dz, end[0] * dx + end[1] * dz]
}

export function clipPlateTerrainFill(
  geometry: BufferGeometry,
  partition: PlateSurfacePartition,
): BufferGeometry {
  const triangles: Triangle[] = []
  for (const triangle of readTriangles(geometry)) {
    // Keep the terrain-following bottom cap, including steep slopes.
    if (Math.abs(faceNormalY(triangle)) > 1e-6) {
      triangles.push(triangle)
      continue
    }
    const span = verticalSpan(triangle)
    if (!span) continue
    const runs = plateSideRuns(partition, span.start, span.end)
    for (const run of runs) {
      if (run.dropTo !== undefined) continue
      triangles.push(
        ...clipTriangleBySlab(
          triangle,
          span.start,
          (span.end[0] - span.start[0]) / span.length,
          (span.end[1] - span.start[1]) / span.length,
          run.t0 * span.length,
          run.t1 * span.length,
        ),
      )
    }
  }
  return buildGeometry(triangles, geometry.getAttribute('uv') !== undefined)
}
