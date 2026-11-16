import { refuse } from '../agent-tools/refusal'
import type { TerrainBreakNode } from '../schema/nodes/terrain-break'
import { pointInPolygon, segmentsIntersect } from './polygon-relations'
import type { TerrainField } from './terrain-field'
import type { TerrainNodes, TerrainSite } from './terrain-tiles'

export type TerrainBreakSide = 'left' | 'right'
type Point = [number, number]
type BreakShape = { line: Point[]; left: number | 'ground'; right: number | 'ground' }
const EPS = 1e-10

function cross(a: Point, b: Point, p: Point): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

export function terrainBreakIsClosed(boundary: Pick<TerrainBreakNode, 'line'>): boolean {
  const a = boundary.line[0]
  const b = boundary.line.at(-1)
  return !!a && !!b && a[0] === b[0] && a[1] === b[1]
}

const edgeCache = new WeakMap<object, [Point, Point][]>()

/** A break's edges, built once per line: every height read tests them, and a line is immutable. */
function edgesOf(boundary: Pick<TerrainBreakNode, 'line'>): [Point, Point][] {
  const line = boundary.line
  let edges = edgeCache.get(line)
  if (!edges) {
    edges = line.slice(1).map((to, i) => [line[i] as Point, to])
    edgeCache.set(line, edges)
  }
  return edges
}

export function validateTerrainBreak(boundary: BreakShape): void {
  const line = boundary.line
  if (
    !Array.isArray(line) ||
    line.length < 2 ||
    line.length > 513 ||
    line.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
  )
    refuse('invalid_input', 'A terrain break needs 2 to 513 finite [x,z] points.')
  if (boundary.left === 'ground' && boundary.right === 'ground')
    refuse('invalid_input', 'At least one terrain-break side must have a numeric height.')
  if (
    [boundary.left, boundary.right].some((value) => value !== 'ground' && !Number.isFinite(value))
  )
    refuse('invalid_input', 'Terrain-break side heights must be finite numbers or ground.')
  const edges = edgesOf(boundary)
  if (edges.some(([a, b]) => !Number.isFinite(Math.hypot(b[0] - a[0], b[1] - a[1]))))
    refuse('invalid_input', 'Terrain-break edge lengths must be finite.')
  if (edges.some(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) <= EPS))
    refuse('unsupported_geometry', 'A terrain break cannot have a collapsed edge.')
  const first = line[0] as Point
  const second = line[1] as Point
  if (!terrainBreakIsClosed(boundary)) {
    const dx = second[0] - first[0]
    const dz = second[1] - first[1]
    let previous = 0
    for (const point of line.slice(1)) {
      const along = (point[0] - first[0]) * dx + (point[1] - first[1]) * dz
      if (Math.abs(cross(first, second, point)) > EPS * Math.hypot(dx, dz) || along <= previous)
        refuse(
          'unsupported_geometry',
          'Open terrain breaks must be straight, collinear and ordered.',
        )
      previous = along
    }
    return
  }
  if (line.length < 4)
    refuse('unsupported_geometry', 'A closed terrain break needs a simple convex CCW ring.')
  for (const [a, b] of edges) {
    if (line.some((point) => cross(a, b, point) < -EPS))
      refuse('unsupported_geometry', 'Closed terrain breaks must be convex and counterclockwise.')
  }
  if (!line.some((point) => cross(first, second, point) > EPS))
    refuse('unsupported_geometry', 'A closed terrain break must enclose area.')
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 2; j < edges.length; j++) {
      if (i === 0 && j === edges.length - 1) continue
      const a = edges[i]
      const b = edges[j]
      if (a && b && segmentsIntersect(a[0], a[1], b[0], b[1]))
        refuse('unsupported_geometry', 'A terrain break cannot intersect itself.')
    }
  }
}

function breaksCross(a: TerrainBreakNode, b: TerrainBreakNode): boolean {
  const ae = edgesOf(a)
  const be = edgesOf(b)
  if (!terrainBreakIsClosed(a) && !terrainBreakIsClosed(b)) {
    const [p, q] = ae[0] as [Point, Point]
    const [r, s] = be[0] as [Point, Point]
    const determinant = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0])
    return Math.abs(determinant) > EPS || Math.abs(cross(p, q, r)) <= EPS
  }
  const open = !terrainBreakIsClosed(a) ? a : !terrainBreakIsClosed(b) ? b : null
  if (open) {
    const ring = open === a ? b : a
    const [p, q] = edgesOf(open)[0] as [Point, Point]
    const signs = ring.line.map((point) => cross(p, q, point))
    return Math.min(...signs) <= EPS && Math.max(...signs) >= -EPS
  }
  return ae.some(([p, q]) => be.some(([r, s]) => segmentsIntersect(p, q, r, s)))
}

function ringArea(boundary: TerrainBreakNode): number {
  return Math.abs(edgesOf(boundary).reduce((sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1], 0)) / 2
}

export function terrainLinePolygonCrossings(from: Point, to: Point, polygon: Point[]): number[] {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length2 = dx * dx + dz * dz
  const result: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (!a || !b) refuse('invalid_polygon', 'The property has a missing corner.')
    const ex = b[0] - a[0]
    const ez = b[1] - a[1]
    const ax = a[0] - from[0]
    const az = a[1] - from[1]
    const det = dx * ez - dz * ex
    if (Math.abs(det) <= EPS) {
      if (Math.abs(dx * az - dz * ax) <= EPS)
        result.push(
          (ax * dx + az * dz) / length2,
          ((b[0] - from[0]) * dx + (b[1] - from[1]) * dz) / length2,
        )
      continue
    }
    const u = (ax * dz - az * dx) / det
    if (u >= -EPS && u <= 1 + EPS) result.push((ax * ez - az * ex) / det)
  }
  return result.sort((a, b) => a - b)
}

export function validateTerrainBreakLotSpan(boundary: TerrainBreakNode, polygon: Point[]): void {
  if (terrainBreakIsClosed(boundary)) return
  if (polygon.length < 3 || polygon.some((point) => !point.every(Number.isFinite)))
    refuse('invalid_polygon', 'The site needs a finite property polygon.')
  const from = boundary.line[0]
  const to = boundary.line.at(-1)
  if (!from || !to) refuse('invalid_input', 'A terrain break needs two endpoints.')
  const crossings = terrainLinePolygonCrossings(from, to, polygon)
  if (crossings.some((t) => t < -EPS || t > 1 + EPS))
    refuse(
      'unsupported_geometry',
      'An open terrain break must cover the whole lot crossing; extend its endpoints before enlarging the property.',
    )
}

export function terrainBreaksOf(
  site: Pick<TerrainSite, 'id'> | null | undefined,
  nodes?: TerrainNodes,
): TerrainBreakNode[] {
  if (!site?.id || !nodes) return []
  const breaks = Object.values(nodes).filter(
    (node): node is TerrainBreakNode => node.type === 'terrain-break' && node.parentId === site.id,
  )
  for (const boundary of breaks) validateTerrainBreak(boundary)
  breaks.sort(
    (a, b) =>
      Number(terrainBreakIsClosed(a)) - Number(terrainBreakIsClosed(b)) ||
      ringArea(b) - ringArea(a) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const [i, boundary] of breaks.entries()) {
    if (breaks.slice(0, i).some((other) => breaksCross(boundary, other)))
      refuse(
        'crossing_breaks',
        'Terrain breaks may not cross, touch or share a supporting open line.',
      )
  }
  if (breaks.filter((boundary) => !terrainBreakIsClosed(boundary)).length > 1)
    refuse('unsupported_geometry', 'This increment supports at most one open terrain break.')
  if (
    breaks.length > 1 &&
    breaks.some((boundary) => terrainBreakIsClosed(boundary) && boundary.right !== 'ground')
  )
    refuse(
      'conflicting_breaks',
      'A closed break with a numeric exterior cannot be combined with other breaks.',
    )
  return breaks
}

export function terrainBreakSideAt(
  boundary: Pick<TerrainBreakNode, 'line'>,
  x: number,
  z: number,
): TerrainBreakSide {
  const edges = edgesOf(boundary)
  if (terrainBreakIsClosed(boundary)) {
    for (const [a, b] of edges)
      if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < -EPS) return 'right'
    return 'left'
  }
  const [a, b] = edges[0] as [Point, Point]
  return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -EPS ? 'left' : 'right'
}

function planeHeight(points: Point[], heights: number[], x: number, z: number): number {
  const [a, b, c] = points as [Point, Point, Point]
  const [ha, hb, hc] = heights as [number, number, number]
  const det = cross(a, b, c)
  return (
    ha +
    ((hb - ha) * ((x - a[0]) * (c[1] - a[1]) - (z - a[1]) * (c[0] - a[0])) +
      (hc - ha) * ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]))) /
      det
  )
}

function triangleAvoidsBreaks(points: Point[], breaks: readonly TerrainBreakNode[]): boolean {
  const first = points[0]
  if (!first) return false
  return breaks.every((boundary) => {
    if (
      !terrainBreakIsClosed(boundary) ||
      terrainBreakSideAt(boundary, first[0], first[1]) === 'left'
    )
      return true
    const corner = boundary.line[0]
    if (corner && pointInPolygon(corner, points)) return false
    return points.every((a, i) => {
      const b = points[(i + 1) % points.length]
      return b && !edgesOf(boundary).some(([c, d]) => segmentsIntersect(a, b, c, d))
    })
  })
}

/** Extend the nearest wholly same-region source triangle, never a straddling triangle. */
export function isolatedTerrainPlane(
  field: TerrainField,
  accepts: (x: number, z: number) => boolean,
  x: number,
  z: number,
  sample?: (col: number, row: number) => number,
  breaks: readonly TerrainBreakNode[] = [],
): ((x: number, z: number) => number) | null {
  if (field.cols < 2 || field.rows < 2) return null
  const read = sample ?? ((col, row) => (field.heights[row * field.cols + col] ?? 0) * field.step)
  const u = Math.max(0, Math.min(field.cols - 1, (x - field.origin[0]) / field.spacing))
  const v = Math.max(0, Math.min(field.rows - 1, (z - field.origin[1]) / field.spacing))
  const col = Math.min(field.cols - 2, Math.floor(u))
  const row = Math.min(field.rows - 2, Math.floor(v))
  const point = (c: number, r: number): Point => [
    field.origin[0] + c * field.spacing,
    field.origin[1] + r * field.spacing,
  ]
  const containing: [number, number][] =
    u - col + v - row <= 1
      ? [
          [col, row],
          [col + 1, row],
          [col, row + 1],
        ]
      : [
          [col + 1, row + 1],
          [col, row + 1],
          [col + 1, row],
        ]
  const original = containing.map(([c, r]) => point(c, r))
  if (original.every(([px, pz]) => accepts(px, pz)) && triangleAvoidsBreaks(original, breaks)) {
    const heights = containing.map(([c, r]) => read(c, r))
    return (px, pz) => planeHeight(original, heights, px, pz)
  }
  for (let radius = 0; radius <= 32; radius++) {
    let best: { points: Point[]; indices: [number, number][]; distance: number } | undefined
    for (let r = Math.max(0, row - radius); r <= Math.min(field.rows - 2, row + radius); r++) {
      for (let c = Math.max(0, col - radius); c <= Math.min(field.cols - 2, col + radius); c++) {
        if (radius > 0 && Math.max(Math.abs(c - col), Math.abs(r - row)) !== radius) continue
        const triangles: [number, number][][] = [
          [
            [c, r],
            [c + 1, r],
            [c, r + 1],
          ],
          [
            [c + 1, r + 1],
            [c, r + 1],
            [c + 1, r],
          ],
        ]
        for (const indices of triangles) {
          const points = indices.map(([pc, pr]) => point(pc, pr))
          if (!points.every(([px, pz]) => accepts(px, pz)) || !triangleAvoidsBreaks(points, breaks))
            continue
          const distance = points.reduce((sum, [px, pz]) => sum + (px - x) ** 2 + (pz - z) ** 2, 0)
          if (!best || distance < best.distance) best = { points, indices, distance }
        }
      }
    }
    if (best) {
      const points = best.points
      const heights = best.indices.map(([c, r]) => read(c, r))
      return (px, pz) => planeHeight(points, heights, px, pz)
    }
  }
  return null
}

/**
 * Which of a grid's triangles the search of `isolatedTerrainPlane` may take, for one region:
 * triangle `2 * (row * (cols - 1) + col) + t` (t = 0 the lower, 1 the upper one of a cell) has
 * all its corners accepted and avoids the breaks. It is a property of the grid, the breaks and
 * the region alone, so one table serves every read in that region.
 */
export function isolatedTriangleFlags(
  field: TerrainField,
  accepts: (x: number, z: number) => boolean,
  breaks: readonly TerrainBreakNode[],
): Uint8Array {
  const cols = field.cols - 1
  const rows = field.rows - 1
  const flags = new Uint8Array(Math.max(0, cols * rows * 2))
  const accepted = new Uint8Array(field.cols * field.rows)
  for (let r = 0; r < field.rows; r++)
    for (let c = 0; c < field.cols; c++)
      accepted[r * field.cols + c] = accepts(
        field.origin[0] + c * field.spacing,
        field.origin[1] + r * field.spacing,
      )
        ? 1
        : 0
  const point = (c: number, r: number): Point => [
    field.origin[0] + c * field.spacing,
    field.origin[1] + r * field.spacing,
  ]
  const at = (c: number, r: number) => accepted[r * field.cols + c] === 1
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const base = 2 * (r * cols + c)
      if (at(c, r) && at(c + 1, r) && at(c, r + 1)) {
        if (triangleAvoidsBreaks([point(c, r), point(c + 1, r), point(c, r + 1)], breaks))
          flags[base] = 1
      }
      if (at(c + 1, r + 1) && at(c, r + 1) && at(c + 1, r)) {
        if (triangleAvoidsBreaks([point(c + 1, r + 1), point(c, r + 1), point(c + 1, r)], breaks))
          flags[base + 1] = 1
      }
    }
  return flags
}

/**
 * `isolatedTerrainPlane` read from a table of the triangles it may take (see
 * `isolatedTriangleFlags`): the same triangle, in the same order of search and tie-break, so the
 * same plane, without testing a triangle against the breaks again.
 */
export function isolatedTerrainPlaneFlagged(
  field: TerrainField,
  flags: Uint8Array,
  x: number,
  z: number,
  sample?: (col: number, row: number) => number,
): ((x: number, z: number) => number) | null {
  if (field.cols < 2 || field.rows < 2) return null
  const read = sample ?? ((col, row) => (field.heights[row * field.cols + col] ?? 0) * field.step)
  const u = Math.max(0, Math.min(field.cols - 1, (x - field.origin[0]) / field.spacing))
  const v = Math.max(0, Math.min(field.rows - 1, (z - field.origin[1]) / field.spacing))
  const col = Math.min(field.cols - 2, Math.floor(u))
  const row = Math.min(field.rows - 2, Math.floor(v))
  const cols = field.cols - 1
  const lower = u - col + v - row <= 1
  const point = (c: number, r: number): Point => [
    field.origin[0] + c * field.spacing,
    field.origin[1] + r * field.spacing,
  ]
  const plane = (c: number, r: number, upper: boolean) => {
    const indices: [number, number][] = upper
      ? [
          [c + 1, r + 1],
          [c, r + 1],
          [c + 1, r],
        ]
      : [
          [c, r],
          [c + 1, r],
          [c, r + 1],
        ]
    const points = indices.map(([pc, pr]) => point(pc, pr))
    const heights = indices.map(([pc, pr]) => read(pc, pr))
    return (px: number, pz: number) => planeHeight(points, heights, px, pz)
  }
  if (flags[2 * (row * cols + col) + (lower ? 0 : 1)] === 1) return plane(col, row, !lower)
  for (let radius = 0; radius <= 32; radius++) {
    let best: { c: number; r: number; upper: boolean; distance: number } | undefined
    const take = (c: number, r: number) => {
      for (const upper of [false, true]) {
        if (flags[2 * (r * cols + c) + (upper ? 1 : 0)] !== 1) continue
        const corners: [number, number][] = upper
          ? [
              [c + 1, r + 1],
              [c, r + 1],
              [c + 1, r],
            ]
          : [
              [c, r],
              [c + 1, r],
              [c, r + 1],
            ]
        let distance = 0
        for (const [pc, pr] of corners) {
          const [px, pz] = point(pc, pr)
          distance += (px - x) ** 2 + (pz - z) ** 2
        }
        if (!best || distance < best.distance) best = { c, r, upper, distance }
      }
    }
    // The cells at exactly this Chebyshev radius, in the order a row-by-row scan of the square
    // meets them: the whole row at the top and bottom of the ring, its two ends between.
    const rowLo = Math.max(0, row - radius)
    const rowHi = Math.min(field.rows - 2, row + radius)
    const colLo = Math.max(0, col - radius)
    const colHi = Math.min(field.cols - 2, col + radius)
    for (let r = rowLo; r <= rowHi; r++) {
      if (radius === 0 || Math.abs(r - row) === radius) {
        for (let c = colLo; c <= colHi; c++) take(c, r)
      } else {
        if (col - radius >= 0) take(col - radius, r)
        if (col + radius <= field.cols - 2) take(col + radius, r)
      }
    }
    if (best) return plane(best.c, best.r, best.upper)
  }
  return null
}

export function isolatedTerrainHeight(
  field: TerrainField,
  accepts: (x: number, z: number) => boolean,
  x: number,
  z: number,
  breaks: readonly TerrainBreakNode[] = [],
  sample?: (col: number, row: number) => number,
): number {
  const read = isolatedTerrainPlane(field, accepts, x, z, sample, breaks)
  if (read) return read(x, z)
  refuse(
    'unsupported_geometry',
    'Keep-ground needs a same-side source triangle within 32 grid cells; widen the ground region or give a numeric side.',
  )
}

export function terrainBreakHeightAt(
  field: TerrainField,
  boundary: TerrainBreakNode,
  side: TerrainBreakSide,
  x: number,
  z: number,
): number {
  const value = boundary[side]
  if (typeof value === 'number') return value
  if (field.readHeightOnSide) return field.readHeightOnSide(boundary, side, x, z)
  if (!field.heights.length)
    refuse('unsupported_geometry', 'A virtual ground trace needs an explicit side-isolated reader.')
  return isolatedTerrainHeight(
    field,
    (px, pz) => terrainBreakSideAt(boundary, px, pz) === side,
    x,
    z,
    [boundary],
  )
}

export function terrainBreakFacts(boundary: TerrainBreakNode, field: TerrainField) {
  validateTerrainBreak(boundary)
  const exact = typeof boundary.left === 'number' && typeof boundary.right === 'number'
  let lengthM = 0
  let faceAreaM2 = 0
  let dropMinM = Number.POSITIVE_INFINITY
  let dropMaxM = Number.NEGATIVE_INFINITY
  const left = { minM: Number.POSITIVE_INFINITY, maxM: Number.NEGATIVE_INFINITY }
  const right = { minM: Number.POSITIVE_INFINITY, maxM: Number.NEGATIVE_INFINITY }
  let sampleCount = 0
  for (const [a, b] of edgesOf(boundary)) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    lengthM += length
    const count = exact ? 1 : Math.max(1, Math.ceil(length / field.spacing))
    if (sampleCount + count + 1 > 20_000)
      refuse('sampling_limit', 'Terrain-break facts exceed 20,000 samples.')
    let previous = 0
    for (let i = 0; i <= count; i++) {
      const x = a[0] + (b[0] - a[0]) * (i / count)
      const z = a[1] + (b[1] - a[1]) * (i / count)
      const lh = terrainBreakHeightAt(field, boundary, 'left', x, z)
      const rh = terrainBreakHeightAt(field, boundary, 'right', x, z)
      if (!Number.isFinite(lh) || !Number.isFinite(rh))
        refuse('no_terrain', 'Terrain-break traces must be finite.')
      left.minM = Math.min(left.minM, lh)
      left.maxM = Math.max(left.maxM, lh)
      right.minM = Math.min(right.minM, rh)
      right.maxM = Math.max(right.maxM, rh)
      const drop = lh - rh
      dropMinM = Math.min(dropMinM, Math.abs(drop))
      dropMaxM = Math.max(dropMaxM, Math.abs(drop))
      if (i > 0) {
        const span = length / count
        if (previous * drop < 0) dropMinM = 0
        faceAreaM2 +=
          previous * drop < 0
            ? (span * (previous * previous + drop * drop)) /
              (2 * (Math.abs(previous) + Math.abs(drop)))
            : (span * (Math.abs(previous) + Math.abs(drop))) / 2
      }
      previous = drop
      sampleCount++
    }
  }
  return {
    breakId: boundary.id,
    line: boundary.line,
    kind: boundary.kind,
    lengthM,
    left,
    right,
    dropMinM,
    dropMaxM,
    faceAreaM2,
    ...(!exact
      ? {
          sampling: {
            approximate: true as const,
            method: 'side_isolated_trace_trapezoids',
            spacingM: field.spacing,
            sampleCount,
          },
        }
      : {}),
  }
}
