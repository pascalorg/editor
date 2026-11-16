import {
  heightAt,
  type TerrainBreakNode,
  type TerrainField,
  terrainBreakHeightAt,
  terrainBreakSideAt,
} from '@pascal-app/core'
import type { TerrainMeshBuffers, TerrainSkirtBuffers } from './terrain-geometry'

type Point = [number, number]
type Side = 'left' | 'right'
type Piece = { points: Point[]; sides: Side[] }
const EPSILON = 1e-9

/**
 * How the ground is shaded where the site has terrain breaks. `faceted` is the first build: one
 * normal per triangle. `smooth` gives each vertex the normal of the ground on its own side of the
 * breaks, as the ground without a break has it, so only the break itself is an edge.
 */
export type TerrainBreakGround = 'faceted' | 'smooth'

function terrainBreakGroundFromEnvironment(): TerrainBreakGround {
  try {
    return process.env.NEXT_PUBLIC_PASCAL_TERRAIN_BREAK_GROUND === 'smooth' ? 'smooth' : 'faceted'
  } catch {
    return 'faceted'
  }
}

let terrainBreakGround = terrainBreakGroundFromEnvironment()

export function getTerrainBreakGround(): TerrainBreakGround {
  return terrainBreakGround
}

/** A host chooses once, before the first ground is built; a mesh keeps the choice it was built with. */
export function setTerrainBreakGround(ground: TerrainBreakGround): void {
  terrainBreakGround = ground
}

function distance(a: Point, b: Point, p: Point): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  return (dx * (p[1] - a[1]) - dz * (p[0] - a[0])) / Math.hypot(dx, dz)
}

function halfPlane(points: Point[], a: Point, b: Point, side: Side): Point[] {
  const result: Point[] = []
  const sign = side === 'left' ? 1 : -1
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point
    const q = points[(i + 1) % points.length] as Point
    const dp = distance(a, b, p) * sign
    const dq = distance(a, b, q) * sign
    if (dp >= -EPSILON) result.push(p)
    if ((dp > EPSILON && dq < -EPSILON) || (dp < -EPSILON && dq > EPSILON)) {
      const t = dp / (dp - dq)
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  }
  return result.filter((p, i) => {
    const q = result[(i + result.length - 1) % result.length] as Point
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > EPSILON
  })
}

function partition(piece: Piece, edge: TerrainBreakNode): Piece[] {
  const first = edge.line[0] as Point
  const last = edge.line.at(-1) as Point
  const closed = first[0] === last[0] && first[1] === last[1]
  if (!closed) {
    return (['left', 'right'] as const).map((side) => ({
      points: halfPlane(piece.points, first, last, side),
      sides: [...piece.sides, side],
    }))
  }
  const result: Piece[] = []
  let inside = piece.points
  for (let i = 0; i < edge.line.length - 1 && inside.length >= 3; i++) {
    const a = edge.line[i] as Point
    const b = edge.line[i + 1] as Point
    result.push({
      points: halfPlane(inside, a, b, 'right'),
      sides: [...piece.sides, 'right'],
    })
    inside = halfPlane(inside, a, b, 'left')
  }
  result.push({ points: inside, sides: [...piece.sides, 'left'] })
  return result
}

export function terrainRegionHeight(
  field: TerrainField,
  breaks: readonly TerrainBreakNode[],
  sides: readonly Side[],
  x: number,
  z: number,
): number {
  for (let i = breaks.length - 1; i >= 0; i--) {
    const edge = breaks[i] as TerrainBreakNode
    const side = sides[i] as Side
    if (typeof edge[side] === 'number') return terrainBreakHeightAt(field, edge, side, x, z)
  }
  for (let i = breaks.length - 1; i >= 0; i--) {
    const edge = breaks[i] as TerrainBreakNode
    const side = sides[i] as Side
    if (terrainBreakSideAt(edge, x, z) !== side)
      return terrainBreakHeightAt(field, edge, side, x, z)
  }
  const edge = breaks.at(-1)
  return edge
    ? terrainBreakHeightAt(field, edge, sides.at(-1) as Side, x, z)
    : heightAt(field, x, z)
}

/**
 * The normal of the ground of one region at a point of it: central differences of that region's
 * own ground one spacing away, as `normalAt` takes them, never the ground across a break. A
 * read the region has no ground for (past the last triangle of its side) leaves the difference
 * one-sided.
 */
function regionNormal(
  field: TerrainField,
  read: (px: number, pz: number) => number | null,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const d = field.spacing
  const slope = (low: number | null, high: number | null) =>
    low !== null && high !== null
      ? (high - low) / (2 * d)
      : high !== null
        ? (high - y) / d
        : low !== null
          ? (y - low) / d
          : 0
  const dhdx = slope(read(x - d, z), read(x + d, z))
  const dhdz = slope(read(x, z - d), read(x, z + d))
  const length = Math.hypot(dhdx, 1, dhdz)
  return [-dhdx / length, 1 / length, -dhdz / length]
}

type RegionReads = {
  /** A region's ground at a point, or null where the region has none to read. */
  read(sides: readonly Side[], x: number, z: number): number | null
  /** A height already read the plain way, kept for the neighbours that will ask for it. */
  keep(sides: readonly Side[], x: number, z: number, height: number): void
}

/**
 * The reads of one pass over a ground. A vertex on the grid asks for its region's ground at its
 * four neighbours, which are those neighbours' own heights: each (region, grid point) is read
 * once and kept, five reads a vertex become about one. A point off the grid (a cut triangle's
 * corner) is read each time, as before; the values are the same either way.
 */
function regionReads(field: TerrainField, breaks: readonly TerrainBreakNode[]): RegionReads {
  const d = field.spacing
  const kept = new Map<number, Map<number, number>>()
  const SPAN = 2 ** 20
  const place = (sides: readonly Side[], x: number, z: number) => {
    const ix = Math.round(x / d)
    const iz = Math.round(z / d)
    if (
      sides.length > 30 ||
      Math.abs(x - ix * d) > 1e-9 ||
      Math.abs(z - iz * d) > 1e-9 ||
      Math.abs(ix) >= SPAN ||
      Math.abs(iz) >= SPAN
    )
      return null
    let region = 0
    for (let i = 0; i < sides.length; i++) if (sides[i] === 'left') region |= 1 << i
    let heights = kept.get(region)
    if (!heights) {
      heights = new Map()
      kept.set(region, heights)
    }
    return { heights, key: (ix + SPAN) * 2 * SPAN + iz + SPAN }
  }
  const plain = (sides: readonly Side[], x: number, z: number) => {
    try {
      return terrainRegionHeight(field, breaks, sides, x, z)
    } catch {
      return null
    }
  }
  return {
    read(sides, x, z) {
      const at = place(sides, x, z)
      if (!at) return plain(sides, x, z)
      let height = at.heights.get(at.key)
      if (height === undefined) {
        height = plain(sides, x, z) ?? Number.NaN
        at.heights.set(at.key, height)
      }
      return Number.isNaN(height) ? null : height
    },
    keep(sides, x, z, height) {
      place(sides, x, z)?.heights.set(
        (Math.round(x / d) + SPAN) * 2 * SPAN + Math.round(z / d) + SPAN,
        height,
      )
    },
  }
}

/**
 * How far past a stroke's rectangle a break ground is read again. Beside a break a height is the
 * plane of the nearest triangle wholly on its own side, which can stand a few cells away, and a
 * normal reads one spacing farther.
 */
const BREAK_READ_REACH_CELLS = 4

/**
 * Heights and normals of a ground built smooth, in `bounds` when given: the range of the buffers
 * it wrote, as `updateTerrainGroundMesh` reports it, or null when nothing of this mesh is in reach.
 */
export function updateSmoothTerrainBreakSurface(
  buffers: TerrainMeshBuffers,
  field: TerrainField,
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number },
): { start: number; count: number } | null {
  const regions = buffers.terrainBreakSides
  const breaks = buffers.terrainBreaks
  if (!regions || !breaks) return null
  const reach = BREAK_READ_REACH_CELLS * field.spacing
  const reads = regionReads(field, breaks)
  const heights = new Float64Array(regions.length)
  const within = (i: number) => {
    if (!bounds) return true
    const x = buffers.positions[i * 3] ?? 0
    const z = buffers.positions[i * 3 + 2] ?? 0
    return !(
      x < bounds.minX - reach ||
      x > bounds.maxX + reach ||
      z < bounds.minZ - reach ||
      z > bounds.maxZ + reach
    )
  }
  // Every height first, so that a normal finds its neighbours' already read.
  for (let i = 0; i < regions.length; i++) {
    if (!within(i)) continue
    const sides = regions[i] as readonly Side[]
    const x = buffers.positions[i * 3] ?? 0
    const z = buffers.positions[i * 3 + 2] ?? 0
    const y = terrainRegionHeight(field, breaks, sides, x, z)
    heights[i] = y
    reads.keep(sides, x, z, y)
  }
  let start = regions.length * 3
  let end = 0
  for (let i = 0; i < regions.length; i++) {
    if (!within(i)) continue
    const x = buffers.positions[i * 3] ?? 0
    const z = buffers.positions[i * 3 + 2] ?? 0
    const sides = regions[i] as readonly Side[]
    const y = heights[i] as number
    buffers.positions[i * 3 + 1] = y
    buffers.normals.set(
      regionNormal(field, (px, pz) => reads.read(sides, px, pz), x, y, z),
      i * 3,
    )
    start = Math.min(start, i * 3)
    end = i * 3 + 3
  }
  return end > start ? { start, count: end - start } : null
}

export function updateTerrainBreakSurface(buffers: TerrainMeshBuffers, field: TerrainField): void {
  if (buffers.terrainBreakGround === 'smooth') {
    updateSmoothTerrainBreakSurface(buffers, field)
    return
  }
  const regions = buffers.terrainBreakSides
  const breaks = buffers.terrainBreaks
  if (!regions || !breaks) return
  for (let i = 0; i < regions.length; i++) {
    const x = buffers.positions[i * 3] ?? 0
    const z = buffers.positions[i * 3 + 2] ?? 0
    buffers.positions[i * 3 + 1] = terrainRegionHeight(
      field,
      breaks,
      regions[i] as readonly Side[],
      x,
      z,
    )
  }
  for (let i = 0; i < buffers.indices.length; i += 3) {
    const a = (buffers.indices[i] ?? 0) * 3
    const b = (buffers.indices[i + 1] ?? 0) * 3
    const c = (buffers.indices[i + 2] ?? 0) * 3
    const ux = (buffers.positions[b] ?? 0) - (buffers.positions[a] ?? 0)
    const uy = (buffers.positions[b + 1] ?? 0) - (buffers.positions[a + 1] ?? 0)
    const uz = (buffers.positions[b + 2] ?? 0) - (buffers.positions[a + 2] ?? 0)
    const vx = (buffers.positions[c] ?? 0) - (buffers.positions[a] ?? 0)
    const vy = (buffers.positions[c + 1] ?? 0) - (buffers.positions[a + 1] ?? 0)
    const vz = (buffers.positions[c + 2] ?? 0) - (buffers.positions[a + 2] ?? 0)
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    for (const index of [a, b, c])
      buffers.normals.set([nx / length, ny / length, nz / length], index)
  }
}

export function splitTerrainBreaks(
  source: TerrainMeshBuffers,
  field: TerrainField,
): TerrainMeshBuffers {
  const breaks = field.terrainBreaks ?? []
  if (!breaks.length) return source
  if (terrainBreakGround === 'smooth') return splitSmoothTerrainBreaks(source, field, breaks)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const regions: Side[][] = []
  for (let i = 0; i < source.indices.length; i += 3) {
    const triangle = Array.from(source.indices.subarray(i, i + 3))
    let pieces: Piece[] = [
      {
        points: triangle.map((index) => [
          source.positions[index * 3] ?? 0,
          source.positions[index * 3 + 2] ?? 0,
        ]),
        sides: [],
      },
    ]
    for (const edge of breaks)
      pieces = pieces
        .flatMap((piece) => partition(piece, edge))
        .filter((piece) => piece.points.length >= 3)
    for (const { points, sides } of pieces) {
      for (let j = 1; j < points.length - 1; j++) {
        const a = points[0] as Point
        const b = points[j] as Point
        const c = points[j + 1] as Point
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if (Math.abs(area) <= EPSILON) continue
        const ordered = area < 0 ? [a, b, c] : [a, c, b]
        for (const [x, z] of ordered) {
          indices.push(positions.length / 3)
          positions.push(x, 0, z)
          uvs.push(x, z)
          regions.push(sides)
        }
      }
    }
  }
  // Duplicated seam vertices carry region identity even when their XZ is identical.
  const buffers: TerrainMeshBuffers = {
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
    terrainBreaks: breaks,
    terrainBreakSides: regions,
  }
  updateTerrainBreakSurface(buffers, field)
  return buffers
}

/** Whether a corner of the triangle stands within `reach` of a break's line in plan. */
function nearBreakLine(
  points: readonly Point[],
  breaks: readonly TerrainBreakNode[],
  reach: number,
): boolean {
  for (const edge of breaks) {
    const first = edge.line[0] as Point
    const last = edge.line.at(-1) as Point
    const closed = first[0] === last[0] && first[1] === last[1]
    // An open break is its whole straight line; a ring is its sides, not their extensions.
    const sides: [Point, Point][] = closed
      ? edge.line.slice(0, -1).map((p, j) => [p, edge.line[j + 1] as Point])
      : [[first, last]]
    for (const [a, b] of sides) {
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const length2 = dx * dx + dz * dz
      for (const p of points) {
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length2
        if (closed) t = Math.max(0, Math.min(1, t))
        if (Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz) < reach) return true
      }
    }
  }
  return false
}

/**
 * The smooth ground: the grid keeps its vertices, one per sample and shared, in their rows, and
 * only a triangle that a break really cuts is redrawn in pieces with vertices of its own. So a
 * tile no break comes near is the mesh it would be without one, and a stroke uploads rows again.
 *
 * A grid vertex is given once more for each further region whose triangles meet at it (a break
 * through a sample): the two sides keep their own height and normal there. A triangle the
 * partition cut only along the extension of a ring's side, all of it in one region, is drawn
 * whole when it stands clear of every break: there each of its heights is its own samples' plane.
 */
function splitSmoothTerrainBreaks(
  source: TerrainMeshBuffers,
  field: TerrainField,
  breaks: readonly TerrainBreakNode[],
): TerrainMeshBuffers {
  const count = source.positions.length / 3
  const positions: number[] = []
  const uvs: number[] = []
  const regions: Side[][] = []
  const signatures: string[] = []
  for (let i = 0; i < count; i++) {
    const x = source.positions[i * 3] ?? 0
    const z = source.positions[i * 3 + 2] ?? 0
    positions.push(x, 0, z)
    uvs.push(x, z)
  }
  const again = new Map<string, number>()
  const shared = (vertex: number, sides: Side[], signature: string): number => {
    if (signatures[vertex] === undefined) {
      regions[vertex] = sides
      signatures[vertex] = signature
      return vertex
    }
    if (signatures[vertex] === signature) return vertex
    const key = `${vertex}:${signature}`
    let index = again.get(key)
    if (index === undefined) {
      index = positions.length / 3
      positions.push(positions[vertex * 3] as number, 0, positions[vertex * 3 + 2] as number)
      uvs.push(uvs[vertex * 2] as number, uvs[vertex * 2 + 1] as number)
      regions[index] = sides
      signatures[index] = signature
      again.set(key, index)
    }
    return index
  }
  const indices: number[] = []
  const clear = field.spacing * 2
  // Which side of every line a break is cut along each sample stands on (0: on it, to a micron).
  // A triangle whose three corners agree on every line is not cut and needs no clipping: all but
  // a few hundred of a tile's 8 192.
  const lines = breaks.map((edge) => {
    const first = edge.line[0] as Point
    const last = edge.line.at(-1) as Point
    const closed = first[0] === last[0] && first[1] === last[1]
    return {
      closed,
      sides: closed
        ? edge.line.slice(0, -1).map((p, j): [Point, Point] => [p, edge.line[j + 1] as Point])
        : ([[first, last]] as [Point, Point][]),
    }
  })
  const lineCount = lines.reduce((sum, line) => sum + line.sides.length, 0)
  const standing = new Int8Array(count * lineCount)
  for (let v = 0; v < count; v++) {
    const p: Point = [positions[v * 3] as number, positions[v * 3 + 2] as number]
    let at = v * lineCount
    for (const line of lines)
      for (const [a, b] of line.sides) {
        const d = distance(a, b, p)
        standing[at++] = d > 1e-6 ? 1 : d < -1e-6 ? -1 : 0
      }
  }
  const uncutRegions = new Map<number, { sides: Side[]; signature: string }>()
  const uncutRegion = (vertex: number) => {
    let region = 0
    let at = vertex * lineCount
    for (let k = 0; k < lines.length; k++) {
      let left = true
      for (let j = 0; j < (lines[k] as (typeof lines)[number]).sides.length; j++)
        if (standing[at++] !== 1) left = false
      if (left) region |= 1 << k
    }
    let found = uncutRegions.get(region)
    if (!found) {
      const sides = lines.map((_, k): Side => (region & (1 << k) ? 'left' : 'right'))
      found = { sides, signature: sides.join() }
      uncutRegions.set(region, found)
    }
    return found
  }
  for (let i = 0; i < source.indices.length; i += 3) {
    const triangle = Array.from(source.indices.subarray(i, i + 3))
    const corners: Point[] = triangle.map((index) => [
      source.positions[index * 3] ?? 0,
      source.positions[index * 3 + 2] ?? 0,
    ])
    let apart = lines.length > 30
    for (let k = 0; k < lineCount && !apart; k++) {
      const side = standing[(triangle[0] as number) * lineCount + k]
      apart =
        side === 0 ||
        side !== standing[(triangle[1] as number) * lineCount + k] ||
        side !== standing[(triangle[2] as number) * lineCount + k]
    }
    if (!apart) {
      const [a, b, c] = corners as [Point, Point, Point]
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (Math.abs(area) <= EPSILON) continue
      const { sides, signature } = uncutRegion(triangle[0] as number)
      for (const corner of area < 0 ? [0, 1, 2] : [0, 2, 1])
        indices.push(shared(triangle[corner] as number, sides, signature))
      continue
    }
    let pieces: Piece[] = [{ points: corners, sides: [] }]
    for (const edge of breaks)
      pieces = pieces
        .flatMap((piece) => partition(piece, edge))
        .filter((piece) => piece.points.length >= 3)
    const first = pieces[0]
    if (!first) continue
    const signature = first.sides.join()
    const uncut =
      pieces.length === 1 &&
      first.points.length === 3 &&
      first.points.every((p, j) => p[0] === corners[j]?.[0] && p[1] === corners[j]?.[1])
    const whole =
      uncut ||
      (pieces.every((piece) => piece.sides.join() === signature) &&
        !nearBreakLine(corners, breaks, clear))
    if (whole) {
      const [a, b, c] = corners as [Point, Point, Point]
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (Math.abs(area) <= EPSILON) continue
      for (const corner of area < 0 ? [0, 1, 2] : [0, 2, 1])
        indices.push(shared(triangle[corner] as number, first.sides, signature))
      continue
    }
    for (const { points, sides } of pieces) {
      for (let j = 1; j < points.length - 1; j++) {
        const a = points[0] as Point
        const b = points[j] as Point
        const c = points[j + 1] as Point
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if (Math.abs(area) <= EPSILON) continue
        for (const [x, z] of area < 0 ? [a, b, c] : [a, c, b]) {
          const index = positions.length / 3
          indices.push(index)
          positions.push(x, 0, z)
          uvs.push(x, z)
          regions[index] = sides
        }
      }
    }
  }
  // A sample no whole triangle uses (cut on every side, or under a hole) still has a height.
  for (let i = 0; i < count; i++)
    regions[i] ??= breaks.map((edge) =>
      terrainBreakSideAt(edge, positions[i * 3] as number, positions[i * 3 + 2] as number),
    )
  const buffers: TerrainMeshBuffers = {
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
    terrainBreaks: breaks,
    terrainBreakSides: regions,
    terrainBreakGround: 'smooth',
  }
  updateSmoothTerrainBreakSurface(buffers, field)
  return buffers
}

function skirtSegmentCuts(a: Point, b: Point, breaks: readonly TerrainBreakNode[]): number[] {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const cuts = [0, 1]
  for (const edge of breaks) {
    const first = edge.line[0] as Point
    const last = edge.line.at(-1) as Point
    const closed = first[0] === last[0] && first[1] === last[1]
    const lines: [Point, Point][] = closed
      ? edge.line.slice(0, -1).map((p, j) => [p, edge.line[j + 1] as Point])
      : [[first, last]]
    for (const [p, q] of lines) {
      const ex = q[0] - p[0]
      const ez = q[1] - p[1]
      const det = dx * ez - dz * ex
      if (Math.abs(det) < EPSILON) continue
      const t = ((p[0] - a[0]) * ez - (p[1] - a[1]) * ex) / det
      const u = ((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / det
      if (t > 0 && t < 1 && (!closed || (u >= 0 && u <= 1))) cuts.push(t)
    }
  }
  return cuts.sort((p, q) => p - q)
}

export function buildTerrainBreakSkirt(
  field: TerrainField,
  ring: Float32Array,
  base: number,
): TerrainSkirtBuffers {
  const breaks = field.terrainBreaks ?? []
  const positions: number[] = []
  const indices: number[] = []
  const regions: Side[][] = []
  const count = ring.length / 2
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    const a: Point = [ring[i * 2] ?? 0, ring[i * 2 + 1] ?? 0]
    const b: Point = [ring[next * 2] ?? 0, ring[next * 2 + 1] ?? 0]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const cuts = skirtSegmentCuts(a, b, breaks)
    for (let j = 1; j < cuts.length; j++) {
      const lo = cuts[j - 1] ?? 0
      const hi = cuts[j] ?? 1
      if (hi - lo < EPSILON) continue
      const at = (t: number): Point => [a[0] + dx * t, a[1] + dz * t]
      const sides = breaks.map((edge) => terrainBreakSideAt(edge, ...at((lo + hi) / 2)))
      const offset = positions.length / 3
      for (const point of [at(lo), at(hi), at(lo), at(hi)]) positions.push(point[0], 0, point[1])
      indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3)
      regions.push(sides)
    }
  }
  const buffers: TerrainSkirtBuffers = {
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices),
    ring,
    terrainBreaks: breaks,
    terrainBreakSides: regions,
  }
  updateTerrainBreakSkirt(field, buffers, base)
  return buffers
}

export function updateTerrainBreakSkirt(
  field: TerrainField,
  buffers: TerrainSkirtBuffers,
  base: number,
): void {
  const breaks = buffers.terrainBreaks ?? []
  for (const [i, sides] of (buffers.terrainBreakSides ?? []).entries()) {
    const offset = i * 12
    const dx = (buffers.positions[offset + 3] ?? 0) - (buffers.positions[offset] ?? 0)
    const dz = (buffers.positions[offset + 5] ?? 0) - (buffers.positions[offset + 2] ?? 0)
    const length = Math.hypot(dx, dz) || 1
    for (let j = 0; j < 4; j++) {
      const at = offset + j * 3
      buffers.positions[at + 1] =
        j < 2
          ? terrainRegionHeight(
              field,
              breaks,
              sides,
              buffers.positions[at] ?? 0,
              buffers.positions[at + 2] ?? 0,
            )
          : base
      buffers.normals.set([dz / length, 0, -dx / length], at)
    }
  }
}
