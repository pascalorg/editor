import {
  type AnyNode,
  type AnyNodeId,
  createTerrainField,
  type GeometryContext,
  persistedTerrainFieldOf,
  pointInPolygon2D,
  type Ring,
  type SiteNode,
  type TerrainBreakNode,
  type TerrainField,
  terrainBreakSideAt,
  terrainBreaksOf,
  terrainTilesOf,
  tileFieldOf,
} from '@pascal-app/core'
import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three'
import { terrainRegionHeight } from '../site/terrain-break-split'
import type { TerrainMeshBuffers } from '../site/terrain-geometry'
import { buildTerrainGroundMesh, terrainGroundPatches } from '../site/terrain-ground'
import { terrainBreakMaterial } from './material'

type Point = [number, number]
type Side = 'left' | 'right'

function onEdge(point: Point, a: Point, b: Point, finite: boolean): boolean {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const length = Math.hypot(dx, dz)
  if (Math.abs(dx * (point[1] - a[1]) - dz * (point[0] - a[0])) > length * 1e-5) return false
  const dot = (point[0] - a[0]) * dx + (point[1] - a[1]) * dz
  return !finite || (dot >= -length * 1e-5 && dot <= length * length + length * 1e-5)
}

function authoredRightNormal(edge: TerrainBreakNode, a: Point, b: Point): Point {
  for (let i = 1; i < edge.line.length; i++) {
    const p = edge.line[i - 1] as Point
    const q = edge.line[i] as Point
    if (!onEdge(a, p, q, false) || !onEdge(b, p, q, false)) continue
    const dx = q[0] - p[0]
    const dz = q[1] - p[1]
    const length = Math.hypot(dx, dz)
    return [dz / length, -dx / length]
  }
  throw new Error('Terrain face segment does not lie on its authored boundary.')
}

function clipToLot(a: Point, b: Point, polygon?: Ring): [Point, Point][] {
  if (!polygon?.length) return [[a, b]]
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const cuts = [0, 1]
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i] as Point
    const q = polygon[(i + 1) % polygon.length] as Point
    const ex = q[0] - p[0]
    const ez = q[1] - p[1]
    const denominator = dx * ez - dz * ex
    if (Math.abs(denominator) < 1e-12) continue
    const t = ((p[0] - a[0]) * ez - (p[1] - a[1]) * ex) / denominator
    const u = ((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / denominator
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t)
  }
  cuts.sort((p, q) => p - q)
  const at = (t: number): Point => [a[0] + dx * t, a[1] + dz * t]
  const result: [Point, Point][] = []
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1] ?? 0
    const hi = cuts[i] ?? 1
    if (hi - lo > 1e-9 && pointInPolygon2D(at((lo + hi) / 2), polygon, { includeBoundary: true }))
      result.push([at(lo), at(hi)])
  }
  return result
}

export function updateTerrainBreakMesh(buffers: TerrainMeshBuffers, field: TerrainField): void {
  const breaks = buffers.terrainBreaks ?? []
  const regions = buffers.terrainBreakSides ?? []
  const order = [0, 1, 2, 2, 1, 3]
  for (let i = 0; i < regions.length; i++)
    buffers.positions[i * 3 + 1] = terrainRegionHeight(
      field,
      breaks,
      regions[i] as readonly Side[],
      buffers.positions[i * 3] ?? 0,
      buffers.positions[i * 3 + 2] ?? 0,
    )
  for (let vertex = 0; vertex < regions.length; vertex += 4) {
    const a = vertex * 3
    const b = a + 3
    const dx = (buffers.positions[b] ?? 0) - (buffers.positions[a] ?? 0)
    const dz = (buffers.positions[b + 2] ?? 0) - (buffers.positions[a + 2] ?? 0)
    const sign =
      (buffers.positions[a + 1] ?? 0) + (buffers.positions[b + 1] ?? 0) >=
      (buffers.positions[a + 7] ?? 0) + (buffers.positions[a + 10] ?? 0)
        ? 1
        : -1
    const nx = buffers.normals[a] ?? 0
    const nz = buffers.normals[a + 2] ?? 0
    // Preserve the authored plane direction; short Float32 edges magnify subtraction error.
    const flip = sign * (nx * dz - nz * dx) < 0 ? -1 : 1
    for (let i = 0; i < 4; i++) buffers.normals.set([nx * flip, 0, nz * flip], a + i * 3)
    const offset = (vertex / 4) * 6
    for (let i = 0; i < 6; i++) buffers.indices[offset + i] = vertex + (order[i] ?? 0)
  }
}

function breakAuthority(edge: TerrainBreakNode, field: TerrainField): TerrainField {
  const existing = field.terrainBreaks ?? []
  const breaks = existing.some((other) => other.id === edge.id)
    ? existing.map((other) => (other.id === edge.id ? edge : other))
    : terrainBreaksOf(
        { id: 'site_terrain-break-mesh' },
        Object.fromEntries(
          [...existing, edge].map((other) => [
            other.id,
            { ...other, parentId: 'site_terrain-break-mesh' },
          ]),
        ),
      )
  return { ...field, terrainBreaks: breaks }
}

/** Whether `grid`'s rectangle can hold a point of the break's line (the whole line when open). */
function gridMeetsLine(grid: TerrainField, line: readonly Point[], closed: boolean): boolean {
  const minX = grid.origin[0]
  const minZ = grid.origin[1]
  const maxX = minX + (grid.cols - 1) * grid.spacing
  const maxZ = minZ + (grid.rows - 1) * grid.spacing
  // `onEdge` takes a point within 1e-5 of its line; a millimetre is the margin.
  const pad = 1e-3
  if (closed) {
    let lineMinX = Number.POSITIVE_INFINITY
    let lineMaxX = Number.NEGATIVE_INFINITY
    let lineMinZ = Number.POSITIVE_INFINITY
    let lineMaxZ = Number.NEGATIVE_INFINITY
    for (const [x, z] of line) {
      lineMinX = Math.min(lineMinX, x)
      lineMaxX = Math.max(lineMaxX, x)
      lineMinZ = Math.min(lineMinZ, z)
      lineMaxZ = Math.max(lineMaxZ, z)
    }
    return !(
      lineMaxX < minX - pad ||
      lineMinX > maxX + pad ||
      lineMaxZ < minZ - pad ||
      lineMinZ > maxZ + pad
    )
  }
  // An open break is read as an infinite line: it meets the rectangle when its corners straddle it.
  const a = line[0] as Point
  const b = line.at(-1) as Point
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const length = Math.hypot(dx, dz) || 1
  const side = (x: number, z: number) => (dx * (z - a[1]) - dz * (x - a[0])) / length
  const corners = [side(minX, minZ), side(maxX, minZ), side(minX, maxZ), side(maxX, maxZ)]
  return Math.min(...corners) <= pad && Math.max(...corners) >= -pad
}

type SurfaceRun = {
  lines: readonly (readonly Point[])[]
  holes: readonly Ring[]
  /** Per break, the mesh edges that lie on its line, keyed so a shared vertex pair counts once. */
  byLine: Map<readonly Point[], [string, [Point, Point]][]>
}
const surfaceRuns = new WeakMap<TerrainField, SurfaceRun[]>()

const sameRefs = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const segmentsOf = (line: readonly Point[], closed: boolean): [Point, Point][] =>
  closed
    ? line.slice(0, -1).map((a, i) => [a, line[i + 1] as Point] as [Point, Point])
    : [[line[0] as Point, line.at(-1) as Point]]

const isClosed = (line: readonly Point[]) => {
  const first = line[0] as Point
  const last = line.at(-1) as Point
  return first[0] === last[0] && first[1] === last[1]
}

/**
 * The edges of a grid's ground mesh that lie on each of the field's breaks. Where the mesh's edges
 * lie on a line depends on the grid, the holes and the breaks' lines, not on any height, and the
 * mesh is the same for every break of the field: it is built once, however many breaks there are.
 */
function surfaceRunOf(
  grid: TerrainField,
  field: TerrainField,
  holes: Ring[],
  breakLines: readonly (readonly Point[])[],
): SurfaceRun {
  const runs = surfaceRuns.get(grid) ?? []
  surfaceRuns.set(grid, runs)
  const found = runs.find(
    (entry) => sameRefs(entry.lines, breakLines) && sameRefs(entry.holes, holes),
  )
  if (found) return found
  const byLine = new Map<readonly Point[], [string, [Point, Point]][]>()
  // `onEdge` takes a point within 1e-5 of its line; a millimetre is the margin of the box.
  const margin = 1e-3
  const candidates = breakLines
    .filter((line) => gridMeetsLine(grid, line, isClosed(line)))
    .map((line) => {
      const closed = isClosed(line)
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minZ = Number.POSITIVE_INFINITY
      let maxZ = Number.NEGATIVE_INFINITY
      // An open break is an infinite line: no box.
      for (const [x, z] of line) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
      const entries: [string, [Point, Point]][] = []
      byLine.set(line, entries)
      return { line, closed, lines: segmentsOf(line, closed), minX, maxX, minZ, maxZ, entries }
    })
  if (candidates.length) {
    const surface = buildTerrainGroundMesh(grid, field, holes)
    for (let i = 0; i < surface.indices.length; i += 3) {
      for (let j = 0; j < 3; j++) {
        const ai = (surface.indices[i + j] ?? 0) * 3
        const bi = (surface.indices[i + ((j + 1) % 3)] ?? 0) * 3
        let a: Point = [surface.positions[ai] ?? 0, surface.positions[ai + 2] ?? 0]
        let b: Point = [surface.positions[bi] ?? 0, surface.positions[bi + 2] ?? 0]
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-7) continue
        for (const candidate of candidates) {
          if (
            candidate.closed &&
            (Math.max(a[0], b[0]) < candidate.minX - margin ||
              Math.min(a[0], b[0]) > candidate.maxX + margin ||
              Math.max(a[1], b[1]) < candidate.minZ - margin ||
              Math.min(a[1], b[1]) > candidate.maxZ + margin)
          )
            continue
          const line = candidate.lines.find(
            ([p, q]) => onEdge(a, p, q, candidate.closed) && onEdge(b, p, q, candidate.closed),
          )
          if (!line) continue
          const [p, q] = line
          if ((b[0] - a[0]) * (q[0] - p[0]) + (b[1] - a[1]) * (q[1] - p[1]) < 0) [a, b] = [b, a]
          const key = [...a, ...b].map((value) => Math.round(value * 1e6)).join(':')
          candidate.entries.push([key, [a, b]])
          break
        }
      }
    }
  }
  const run: SurfaceRun = { lines: breakLines, holes: [...holes], byLine }
  runs.push(run)
  if (runs.length > 8) runs.shift()
  return run
}

function collectBreakSegments(
  edge: TerrainBreakNode,
  field: TerrainField,
  grids: readonly TerrainField[],
  holes: Ring[],
): [Point, Point][] {
  const closed = isClosed(edge.line)
  const segments = new Map<string, [Point, Point]>()
  const breakLines = (field.terrainBreaks ?? []).map((boundary) => boundary.line)
  for (const grid of grids) {
    // A grid away from the break has no edge of its mesh on it: its mesh need not be built.
    if (!gridMeetsLine(grid, edge.line, closed)) continue
    const run = surfaceRunOf(grid, field, holes, breakLines)
    for (const [key, segment] of run.byLine.get(edge.line) ?? []) segments.set(key, segment)
  }
  return [...segments.values()]
}

function emitBreakQuads(
  edge: TerrainBreakNode,
  field: TerrainField,
  segments: readonly [Point, Point][],
  polygon?: Ring,
): TerrainMeshBuffers {
  const breaks = field.terrainBreaks ?? []
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const regions: Side[][] = []
  const targetIndex = breaks.findIndex((other) => other.id === edge.id)
  for (const segment of segments) {
    for (const [a, b] of clipToLot(...segment, polygon)) {
      const [nx, nz] = authoredRightNormal(edge, a, b)
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const left = breaks.map((other) => terrainBreakSideAt(other, ...mid))
      const right = [...left]
      left[targetIndex] = 'left'
      right[targetIndex] = 'right'
      const height = (point: Point, sides: Side[]) =>
        terrainRegionHeight(field, breaks, sides, ...point)
      const da = height(a, left) - height(a, right)
      const db = height(b, left) - height(b, right)
      const cuts = da * db < 0 ? [0, da / (da - db), 1] : [0, 1]
      for (let i = 1; i < cuts.length; i++) {
        const at = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        const p = at(cuts[i - 1] ?? 0)
        const q = at(cuts[i] ?? 1)
        const length = Math.hypot(q[0] - p[0], q[1] - p[1])
        for (const [point, sides, u] of [
          [p, left, 0],
          [q, left, length],
          [p, right, 0],
          [q, right, length],
        ] as const) {
          positions.push(point[0], 0, point[1])
          normals.push(nx, 0, nz)
          uvs.push(u, height(point, sides))
          regions.push(sides)
        }
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: new Uint32Array((regions.length / 4) * 6),
    terrainBreaks: breaks,
    terrainBreakSides: regions,
  }
}

export function buildTerrainBreakMesh(
  edge: TerrainBreakNode,
  field: TerrainField,
  grids: readonly TerrainField[] = [field],
  holes: Ring[] = [],
  polygon?: Ring,
): TerrainMeshBuffers {
  const authority = breakAuthority(edge, field)
  const segments = collectBreakSegments(edge, authority, grids, holes)
  const buffers = emitBreakQuads(edge, authority, segments, polygon)
  updateTerrainBreakMesh(buffers, authority)
  return buffers
}

export function terrainBreakSources(site: SiteNode, nodes: Readonly<Record<string, AnyNode>>) {
  const tiles = terrainTilesOf(site, nodes)
  return [
    ...terrainGroundPatches(site, tiles),
    ...tiles.flatMap((tile) => {
      const grid = tileFieldOf(tile)
      return grid ? [{ key: tile.id, grid, holes: [] as Ring[] }] : []
    }),
  ]
}

export function buildTerrainBreakGeometry(edge: TerrainBreakNode, ctx?: GeometryContext): Group {
  const group = new Group()
  const site = ctx?.parent?.type === 'site' ? ctx.parent : null
  const nodes: Record<string, AnyNode> = { [edge.id]: edge }
  if (site) {
    nodes[site.id] = site
    for (const id of site.children ?? []) {
      const child = ctx?.resolve(id as AnyNodeId)
      if (child) nodes[id] = child
    }
  }
  const field = site ? persistedTerrainFieldOf(site, nodes) : createTerrainField()
  if (!field) return group
  const sources = site ? terrainBreakSources(site, nodes) : [{ grid: field, holes: [] }]
  let material: ReturnType<typeof terrainBreakMaterial> | undefined
  for (const source of sources) {
    const buffers = buildTerrainBreakMesh(
      edge,
      field,
      [source.grid],
      source.holes,
      site?.polygon.points,
    )
    if (!buffers.indices.length) continue
    material ??= terrainBreakMaterial(edge.kind)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3))
    geometry.setAttribute('uv', new BufferAttribute(buffers.uvs, 2))
    geometry.setIndex(new BufferAttribute(buffers.indices, 1))
    const mesh = new Mesh(geometry, material)
    mesh.name = 'terrain-break-face'
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
