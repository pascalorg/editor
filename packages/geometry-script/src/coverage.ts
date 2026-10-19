import type { MultiPolygon, Ring } from '@pascal-app/core/polygon-boolean'
import * as THREE from 'three'
import type { HostRegion } from './cut'

const CELL = 0.02
const MAX_CELLS = 250_000
/**
 * Strips between the heights where a triangle or the region has a corner hold no corner, so the
 * covered length along each strip's middle line is its exact mean. Beyond this many corners per
 * cell row (a rotated mosaic), strips are a fixed quarter of a row instead.
 */
const MAX_CORNERS_PER_ROW = 8
const LINES = 4
/** Patches nearer than this (about a board's width) are one place for the report. */
const NEAR = 0.3
const MAX_PATCHES = 4
const EPS = 1e-6

/** A rectangle in the region's plane: a floor's (x, z), a face's (x along the wall, y up). */
export type UncoveredPatch = { min: [number, number]; max: [number, number] }

export type Coverage = { coverage: number; uncovered: UncoveredPatch[] }

/** Cells of `cell` metres from the region's near corner (u0, v0); the last ones may run past (u1, v1). */
type Grid = { u0: number; v0: number; u1: number; v1: number; cell: number; nu: number; nv: number }

function gridOver(area: MultiPolygon): Grid | null {
  let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { outer } of area) {
    for (const [u, v] of outer) {
      u0 = Math.min(u0, u)
      v0 = Math.min(v0, v)
      u1 = Math.max(u1, u)
      v1 = Math.max(v1, v)
    }
  }
  const [w, h] = [u1 - u0, v1 - v0]
  if (!(w > EPS && h > EPS)) return null
  const cell = Math.max(CELL, Math.sqrt((w * h) / MAX_CELLS))
  return { u0, v0, u1, v1, cell, nu: Math.ceil(w / cell - EPS), nv: Math.ceil(h / cell - EPS) }
}

/** The build's triangles seen square-on to the plane, (u, v) × 3 each; those edge-on are left out. */
function projectedTriangles(meshes: THREE.Mesh[], axis: HostRegion['axis']): Float64Array {
  const out: number[] = []
  const point = new THREE.Vector3()
  const corner: number[] = [0, 0, 0, 0, 0, 0]
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const count = index ? index.count : position.count
    for (let t = 0; t + 2 < count; t += 3) {
      for (let k = 0; k < 3; k++) {
        point.fromBufferAttribute(position, index ? index.getX(t + k) : t + k)
        point.applyMatrix4(mesh.matrixWorld)
        corner[2 * k] = point.x
        corner[2 * k + 1] = axis === 'y' ? point.z : point.y
      }
      const [ua, va, ub, vb, uc, vc] = corner as [number, number, number, number, number, number]
      if (Math.abs((ub - ua) * (vc - va) - (uc - ua) * (vb - va)) < 1e-12) continue
      out.push(ua, va, ub, vb, uc, vc)
    }
  }
  return Float64Array.from(out)
}

type Strips = { mid: Float64Array; height: Float64Array }

/** The strips the region is read in: cell rows cut at every corner's height, or in LINES. */
function stripsOf(grid: Grid, triangles: Float64Array, rings: Ring[]): Strips {
  const { v0, v1, cell, nv } = grid
  const inside = (v: number) => v > v0 && v < v1
  const corners: number[] = []
  for (let k = 1; k < triangles.length; k += 2)
    if (inside(triangles[k]!)) corners.push(triangles[k]!)
  for (const ring of rings) for (const [, v] of ring) if (inside(v)) corners.push(v)
  const cuts = Array.from({ length: nv }, (_, j) => v0 + j * cell)
  cuts.push(v1)
  const sorted = Float64Array.from(corners).sort()
  let distinct = 0
  for (let k = 0; k < sorted.length; k++) if (!k || sorted[k]! - sorted[k - 1]! > EPS) distinct++
  if (distinct <= nv * MAX_CORNERS_PER_ROW) cuts.push(...sorted)
  else
    for (let j = 0; j < nv; j++)
      for (let k = 1; k < LINES; k++) cuts.push(v0 + (j + k / LINES) * cell)
  const at = Float64Array.from(cuts).sort()
  const mid: number[] = []
  const height: number[] = []
  let from = at[0]!
  for (let k = 1; k < at.length; k++) {
    if (at[k]! - from <= EPS) continue
    mid.push((from + at[k]!) / 2)
    height.push(at[k]! - from)
    from = at[k]!
  }
  return { mid: Float64Array.from(mid), height: Float64Array.from(height) }
}

/** What the triangles cover along each strip's middle line, as unsorted [from, to] pairs. */
function coveredSpans(triangles: Float64Array, { mid }: Strips): number[][] {
  const spans: number[][] = Array.from({ length: mid.length }, () => [])
  for (let t = 0; t < triangles.length; t += 6) {
    const u = [triangles[t]!, triangles[t + 2]!, triangles[t + 4]!]
    const v = [triangles[t + 1]!, triangles[t + 3]!, triangles[t + 5]!]
    const vMin = Math.min(v[0]!, v[1]!, v[2]!) - EPS
    const vMax = Math.max(v[0]!, v[1]!, v[2]!) + EPS
    let first = 0
    let last = mid.length
    while (first < last) {
      const half = (first + last) >> 1
      if (mid[half]! < vMin) first = half + 1
      else last = half
    }
    for (let s = first; s < mid.length && mid[s]! <= vMax; s++) {
      const at = mid[s]!
      let lo = Infinity
      let hi = -Infinity
      for (let a = 0, b = 2; a < 3; b = a++) {
        const [ua, va, ub, vb] = [u[a]!, v[a]!, u[b]!, v[b]!]
        if (at < Math.min(va, vb) - EPS || at > Math.max(va, vb) + EPS) continue
        if (Math.abs(vb - va) < EPS) {
          lo = Math.min(lo, ua, ub)
          hi = Math.max(hi, ua, ub)
        } else {
          const cross = ua + ((at - va) / (vb - va)) * (ub - ua)
          lo = Math.min(lo, cross)
          hi = Math.max(hi, cross)
        }
      }
      if (lo <= hi) spans[s]!.push(lo - EPS, hi + EPS)
    }
  }
  return spans
}

/** The region along line `v`, as sorted [from, to] pairs, even–odd over every ring. */
function regionSpans(rings: Ring[], v: number): number[] {
  const crossings: number[] = []
  for (const ring of rings) {
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const [ua, va] = ring[k]!
      const [ub, vb] = ring[i]!
      if (va > v !== vb > v) crossings.push(ua + ((v - va) * (ub - ua)) / (vb - va))
    }
  }
  return crossings.sort((a, b) => a - b)
}

/** Adds the area [a, b) × `height` lays on each cell of row `j` to `bare`. */
function addToCells(
  bare: Float64Array,
  grid: Grid,
  j: number,
  a: number,
  b: number,
  height: number,
) {
  const first = Math.max(0, Math.floor((a - grid.u0) / grid.cell))
  const last = Math.min(grid.nu - 1, Math.floor((b - grid.u0) / grid.cell))
  for (let i = first; i <= last; i++) {
    const length = Math.min(b, grid.u0 + (i + 1) * grid.cell) - Math.max(a, grid.u0 + i * grid.cell)
    if (length > 0) bare[j * grid.nu + i]! += length * height
  }
}

/** The cells of `mask` that belong to a 2 × 2 block of them: a gap one cell wide is not a patch. */
function withoutThin(mask: Uint8Array, { nu, nv }: Grid): Uint8Array {
  const block = new Uint8Array(nu * nv)
  for (let j = 0; j + 1 < nv; j++) {
    for (let i = 0; i + 1 < nu; i++) {
      const c = j * nu + i
      block[c] = mask[c]! & mask[c + 1]! & mask[c + nu]! & mask[c + nu + 1]!
    }
  }
  const open = new Uint8Array(nu * nv)
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const c = j * nu + i
      open[c] =
        block[c]! |
        (i > 0 ? block[c - 1]! : 0) |
        (j > 0 ? block[c - nu]! : 0) |
        (i > 0 && j > 0 ? block[c - nu - 1]! : 0)
    }
  }
  return open
}

/** `mask` grown by `r` cells each way (a square), through running sums along rows then columns. */
function grown(mask: Uint8Array, { nu, nv }: Grid, r: number): Uint8Array {
  const rows = new Uint8Array(nu * nv)
  const sums = new Int32Array(Math.max(nu, nv) + 1)
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) sums[i + 1] = sums[i]! + mask[j * nu + i]!
    for (let i = 0; i < nu; i++)
      rows[j * nu + i] = sums[Math.min(nu, i + r + 1)]! > sums[Math.max(0, i - r)]! ? 1 : 0
  }
  const out = new Uint8Array(nu * nv)
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) sums[j + 1] = sums[j]! + rows[j * nu + i]!
    for (let j = 0; j < nv; j++)
      out[j * nu + i] = sums[Math.min(nv, j + r + 1)]! > sums[Math.max(0, j - r)]! ? 1 : 0
  }
  return out
}

/** Bounds of the patches, gathered by the places they grow into, largest first. */
function patchesOf(patches: Uint8Array, grid: Grid): UncoveredPatch[] {
  const { nu, nv, u0, v0, u1, v1, cell } = grid
  const places = grown(patches, grid, Math.ceil(NEAR / 2 / cell))
  const label = new Int32Array(nu * nv).fill(-1)
  const queue = new Int32Array(nu * nv)
  const found: { cells: number; i0: number; j0: number; i1: number; j1: number }[] = []
  for (let start = 0; start < places.length; start++) {
    if (!places[start] || label[start] !== -1) continue
    const id = found.length
    const place = { cells: 0, i0: nu, j0: nv, i1: -1, j1: -1 }
    found.push(place)
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    while (head < tail) {
      const c = queue[head++]!
      const i = c % nu
      const j = (c - i) / nu
      if (patches[c]) {
        place.cells++
        place.i0 = Math.min(place.i0, i)
        place.j0 = Math.min(place.j0, j)
        place.i1 = Math.max(place.i1, i)
        place.j1 = Math.max(place.j1, j)
      }
      for (const n of [i > 0 ? c - 1 : -1, i < nu - 1 ? c + 1 : -1, c - nu, c + nu]) {
        if (n >= 0 && n < places.length && places[n] && label[n] === -1) {
          label[n] = id
          queue[tail++] = n
        }
      }
    }
  }
  const mm = (value: number) => Math.round(value * 1000) / 1000
  return found
    .sort((a, b) => b.cells - a.cells)
    .slice(0, MAX_PATCHES)
    .map(({ i0, j0, i1, j1 }) => ({
      min: [mm(u0 + i0 * cell), mm(v0 + j0 * cell)],
      max: [mm(Math.min(u1, u0 + (i1 + 1) * cell)), mm(Math.min(v1, v0 + (j1 + 1) * cell))],
    }))
}

/**
 * How much of the region the build covers, seen square-on to its plane (a floor from above, a
 * face from the room). `coverage` is the covered share of the region's area, two decimals,
 * joints included: read along strips between the heights of every corner, exact for boards and
 * tiles laid square. On a grid of 2 cm cells (coarser on a region too big for 250k of them), a
 * cell more than half bare is bare; `uncovered` bounds the largest bare patches (two cells across
 * at least, so no joint is one; patches nearer than NEAR are one place), largest first. Null
 * when the region has no area.
 */
export function measureCoverage(meshes: THREE.Mesh[], region: HostRegion): Coverage | null {
  const grid = gridOver(region.area)
  if (!grid) return null
  const rings = region.area.flatMap(({ outer, holes }) => [outer, ...holes])
  const triangles = projectedTriangles(meshes, region.axis)
  const strips = stripsOf(grid, triangles, rings)
  const spans = coveredSpans(triangles, strips)
  const bareArea = new Float64Array(grid.nu * grid.nv)
  let inside = 0
  let bare = 0
  for (let s = 0; s < strips.mid.length; s++) {
    const [at, height] = [strips.mid[s]!, strips.height[s]!]
    const row = Math.min(grid.nv - 1, Math.floor((at - grid.v0) / grid.cell))
    const exposed = (from: number, to: number) => {
      bare += (to - from) * height
      addToCells(bareArea, grid, row, from, to, height)
    }
    const area = regionSpans(rings, at)
    const pairs = spans[s]!
    const order = Array.from({ length: pairs.length / 2 }, (_, p) => p).sort(
      (p, q) => pairs[2 * p]! - pairs[2 * q]!,
    )
    for (let r = 0; r + 1 < area.length; r += 2) {
      const [from, to] = [area[r]!, area[r + 1]!]
      inside += (to - from) * height
      let cursor = from
      for (const p of order) {
        const [lo, hi] = [pairs[2 * p]!, pairs[2 * p + 1]!]
        if (hi <= cursor) continue
        if (lo >= to) break
        if (lo > cursor) exposed(cursor, lo)
        cursor = hi
        if (cursor >= to) break
      }
      if (cursor < to) exposed(cursor, to)
    }
  }
  if (inside <= EPS * EPS) return null
  const half = (grid.cell * grid.cell) / 2
  const bareCells = bareArea.map((area) => (area > half ? 1 : 0))
  return {
    coverage: Math.round((1 - bare / inside) * 100) / 100,
    uncovered: patchesOf(withoutThin(Uint8Array.from(bareCells), grid), grid),
  }
}
