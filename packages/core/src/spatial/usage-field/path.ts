import { type BucketIndex, cellOf, cellX, cellZ, type Grid } from './field'

/** A binary min-heap on a numeric key. */
class Heap {
  private keys: number[] = []
  private values: number[] = []

  get size() {
    return this.keys.length
  }

  push(key: number, value: number) {
    const keys = this.keys
    const values = this.values
    let i = keys.length
    keys.push(key)
    values.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[i]! >= keys[parent]!) break
      ;[keys[i], keys[parent]] = [keys[parent]!, keys[i]!]
      ;[values[i], values[parent]] = [values[parent]!, values[i]!]
      i = parent
    }
  }

  pop(): [number, number] {
    const keys = this.keys
    const values = this.values
    const top: [number, number] = [keys[0]!, values[0]!]
    const lastKey = keys.pop()!
    const lastValue = values.pop()!
    if (keys.length) {
      keys[0] = lastKey
      values[0] = lastValue
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < keys.length && keys[l]! < keys[m]!) m = l
        if (r < keys.length && keys[r]! < keys[m]!) m = r
        if (m === i) break
        ;[keys[i], keys[m]] = [keys[m]!, keys[i]!]
        ;[values[i], values[m]] = [values[m]!, values[i]!]
        i = m
      }
    }
    return top
  }
}

const FOUR: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * The widest path (maximin) from the source cells over cells where `inside` holds and the clearance
 * is positive, 4-neighbour. `B[c]` is the best bottleneck, the least clearance along the widest path
 * to `c`; `P[c]` the cell before it.
 */
export function widestPath(
  g: Grid,
  F: Float32Array,
  inside: Uint8Array,
  sources: Iterable<number>,
): { B: Float64Array; P: Int32Array } {
  const B = new Float64Array(g.W * g.H).fill(Number.NEGATIVE_INFINITY)
  const P = new Int32Array(g.W * g.H).fill(-1)
  const done = new Uint8Array(g.W * g.H)
  const heap = new Heap()
  // a max-heap on the bottleneck, as a min-heap on its negative
  for (const s of sources)
    if (F[s]! > 0 && inside[s]) {
      B[s] = F[s]!
      heap.push(-F[s]!, s)
    }
  while (heap.size) {
    const [negative, c] = heap.pop()
    if (done[c]) continue
    done[c] = 1
    const b = -negative
    const i = c % g.W
    const j = (c / g.W) | 0
    for (const [di, dj] of FOUR) {
      const ii = i + di
      const jj = j + dj
      if (ii < 0 || jj < 0 || ii >= g.W || jj >= g.H) continue
      const n = jj * g.W + ii
      if (!inside[n] || F[n]! <= 0 || done[n]) continue
      const nb = Math.min(b, F[n]!)
      if (nb > B[n]!) {
        B[n] = nb
        P[n] = c
        heap.push(-nb, n)
      }
    }
  }
  return { B, P }
}

/** The cells of the widest path from its source to `c`, in order, and the index of its narrowest. */
export function pathTo(
  P: Int32Array,
  F: Float32Array,
  c: number,
): { cells: number[]; narrowest: number } {
  const cells: number[] = []
  for (let k = c; k >= 0; k = P[k]!) cells.push(k)
  cells.reverse()
  let narrowest = 0
  for (let k = 1; k < cells.length; k++) if (F[cells[k]!]! < F[cells[narrowest]!]!) narrowest = k
  return { cells, narrowest }
}

type Move = { di: number; dj: number; length: number; via: [number, number][] }

/** The 16 moves of a grid walk; those that cross cells need those cells passable too, so no corner cuts a wall. */
const MOVES: Move[] = (() => {
  const seen = new Set<string>()
  const moves: Move[] = []
  const add = (di: number, dj: number) => {
    const key = `${di},${dj}`
    if (seen.has(key)) return
    seen.add(key)
    const via: [number, number][] = []
    if (Math.abs(di) === 1 && Math.abs(dj) === 1) via.push([di, 0], [0, dj])
    if (Math.abs(di) === 2) via.push([Math.sign(di), 0], [Math.sign(di), dj])
    if (Math.abs(dj) === 2) via.push([0, Math.sign(dj)], [di, Math.sign(dj)])
    moves.push({ di, dj, length: Math.hypot(di, dj), via })
  }
  for (const [a, b] of [
    [1, 0],
    [1, 1],
    [2, 1],
    [1, 2],
  ] as const)
    for (const sx of [1, -1]) for (const sz of [1, -1]) add(a * sx, b * sz)
  add(0, 1)
  add(0, -1)
  return moves
})()

/** Grid Dijkstra over the passable cells, 16 neighbours: the travel distance in metres, Infinity where unreached. */
export function travel(g: Grid, pass: Uint8Array, sources: Iterable<number>): Float64Array {
  const D = new Float64Array(g.W * g.H).fill(Number.POSITIVE_INFINITY)
  const heap = new Heap()
  for (const s of sources)
    if (pass[s]) {
      D[s] = 0
      heap.push(0, s)
    }
  while (heap.size) {
    const [d, c] = heap.pop()
    if (d > D[c]!) continue
    const i = c % g.W
    const j = (c / g.W) | 0
    for (const m of MOVES) {
      const ii = i + m.di
      const jj = j + m.dj
      if (ii < 0 || jj < 0 || ii >= g.W || jj >= g.H) continue
      const n = jj * g.W + ii
      if (!pass[n]) continue
      let open = true
      for (const [vi, vj] of m.via)
        if (!pass[(j + vj) * g.W + (i + vi)]) {
          open = false
          break
        }
      if (!open) continue
      const next = d + m.length * g.h
      if (next < D[n]!) {
        D[n] = next
        heap.push(next, n)
      }
    }
  }
  return D
}

type Window = {
  x0: number
  z0: number
  n: number
  step: number
  sources: number[]
  targets: number[]
}

/** A fine grid (the coarse step divided by `fine`) of side 2R around path cell `k`, with its source and target cells. */
function windowAround(
  g: Grid,
  cells: number[],
  k: number,
  isSource: (cell: number) => boolean,
  isTarget: (x: number, z: number) => boolean,
  R: number,
  fine: number,
): Window {
  const cx = (c: number) => cellX(g, c % g.W)
  const cz = (c: number) => cellZ(g, (c / g.W) | 0)
  const X = cx(cells[k]!)
  const Z = cz(cells[k]!)
  const step = g.h / fine
  const n = Math.round((2 * R) / step)
  const fx = (i: number) => X - R + (i + 0.5) * step
  const fz = (j: number) => Z - R + (j + 0.5) * step
  const far = (c: number) => Math.hypot(cx(c) - X, cz(c) - Z) > 0.75 * R
  let before = -1
  let after = -1
  for (let q = k; q >= 0; q--)
    if (far(cells[q]!)) {
      before = cells[q]!
      break
    }
  for (let q = k; q < cells.length; q++)
    if (far(cells[q]!)) {
      after = cells[q]!
      break
    }
  const near = (c: number, i: number, j: number) =>
    Math.hypot(fx(i) - cx(c), fz(j) - cz(c)) <= g.h / 2
  const sources: number[] = []
  const targets: number[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const coarse = Math.floor((fz(j) - g.z0) / g.h) * g.W + Math.floor((fx(i) - g.x0) / g.h)
      if (before >= 0 ? near(before, i, j) : isSource(coarse)) sources.push(j * n + i)
      if (after >= 0 ? near(after, i, j) : isTarget(fx(i), fz(j))) targets.push(j * n + i)
    }
  return { x0: X - R, z0: Z - R, n, step, sources, targets }
}

/**
 * The widest path inside one window, on the exact clearance of its fine cells: the best bottleneck
 * and where it pinches. Only fine cells that could still limit the path are asked exactly; where
 * the grid says the clearance is `slack` above the coarse bottleneck, it cannot be the bottleneck.
 */
function solveWindow(
  w: Window,
  index: BucketIndex,
  g: Grid,
  F: Float32Array,
  limit: number,
): { d: number; at: [number, number] } {
  const field = new Float32Array(w.n * w.n)
  // a fine cell's coarse cell is off its centre by at most this
  const reach = Math.SQRT1_2 * g.h
  for (let j = 0; j < w.n; j++)
    for (let i = 0; i < w.n; i++) {
      const x = w.x0 + (i + 0.5) * w.step
      const z = w.z0 + (j + 0.5) * w.step
      const coarse = cellOf(g, x, z)
      field[j * w.n + i] =
        coarse >= 0 && F[coarse]! - reach > limit ? F[coarse]! : index.query(x, z).d
    }
  const fine = { W: w.n, H: w.n, h: w.step, x0: w.x0, z0: w.z0 }
  const { B } = widestPath(fine, field, new Uint8Array(w.n * w.n).fill(1), w.sources)
  let best = Number.NEGATIVE_INFINITY
  for (const c of w.targets) if (B[c]! > best) best = B[c]!
  let at: [number, number] = [w.x0 + w.n * w.step * 0.5, w.z0 + w.n * w.step * 0.5]
  let nearest = Number.POSITIVE_INFINITY
  for (let c = 0; c < B.length; c++) {
    const gap = Math.abs(field[c]! - best)
    if (Math.abs(B[c]! - best) < 1e-6 && gap < nearest) {
      nearest = gap
      at = [w.x0 + ((c % w.n) + 0.5) * w.step, w.z0 + (((c / w.n) | 0) + 0.5) * w.step]
    }
  }
  return { d: best, at }
}

export type WindowCache = Map<string, { d: number; at: [number, number] }>

/**
 * The passage along a coarse widest path, to the millimetre. The grid says where the path pinches,
 * to within half a cell; this re-solves the widest path on a grid ten times finer, with exact
 * clearances, in a window around every path cell that is within one cell of the coarse bottleneck
 * (centres at least `spacing` apart), and takes the narrowest result. The passage is twice that
 * clearance.
 */
export function refinePassage(
  g: Grid,
  F: Float32Array,
  index: BucketIndex,
  path: { cells: number[]; narrowest: number },
  isSource: (cell: number) => boolean,
  isTarget: (x: number, z: number) => boolean,
  {
    R = 0.3,
    step = 0.005,
    spacing = 0.2,
    cache,
    roomKey = '',
  }: { R?: number; step?: number; spacing?: number; cache?: WindowCache; roomKey?: string } = {},
): { width: number; at: [number, number]; windows: number } {
  const { cells } = path
  const coarse = F[cells[path.narrowest]!]!
  const threshold = coarse + g.h
  const fine = Math.max(1, Math.round(g.h / step))
  const centres: number[] = []
  const at = (k: number): [number, number] => [
    cellX(g, cells[k]! % g.W),
    cellZ(g, (cells[k]! / g.W) | 0),
  ]
  for (let k = 0; k < cells.length; k++) {
    if (F[cells[k]!]! > threshold) continue
    const [x, z] = at(k)
    if (centres.every((m) => Math.hypot(at(m)[0] - x, at(m)[1] - z) > spacing)) centres.push(k)
  }
  let best: { d: number; at: [number, number] } | null = null
  for (const k of centres) {
    // a window whose path leaves it the same way for any room is shared between rooms
    const [x, z] = at(k)
    const leaves = cells
      .slice(k)
      .some((q) => Math.hypot(cellX(g, q % g.W) - x, cellZ(g, (q / g.W) | 0) - z) > 0.75 * R)
    const key = `${cells[k]}${leaves ? '' : `|${roomKey}`}`
    let result = cache?.get(key)
    if (!result) {
      result = solveWindow(
        windowAround(g, cells, k, isSource, isTarget, R, fine),
        index,
        g,
        F,
        coarse + 2 * g.h,
      )
      cache?.set(key, result)
    }
    if (!best || result.d < best.d) best = result
  }
  if (!best) {
    const c = cells[path.narrowest]!
    best = { d: F[c]!, at: [cellX(g, c % g.W), cellZ(g, (c / g.W) | 0)] }
  }
  return { width: 2 * best.d, at: best.at, windows: centres.length }
}

const EIGHT: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/**
 * The shortest way from one cell to another over the passable cells, 8 neighbours, no corner cut
 * through a blocked cell (A*). The cells in order, or null when there is no way.
 */
export function shortestRoute(
  g: Grid,
  pass: Uint8Array,
  from: number,
  to: number,
): number[] | null {
  if (!pass[from] || !pass[to]) return null
  const cost = new Float64Array(g.W * g.H).fill(Number.POSITIVE_INFINITY)
  const parent = new Int32Array(g.W * g.H).fill(-1)
  const tx = to % g.W
  const tz = (to / g.W) | 0
  const heuristic = (c: number) => Math.hypot((c % g.W) - tx, ((c / g.W) | 0) - tz)
  const heap = new Heap()
  cost[from] = 0
  heap.push(heuristic(from), from)
  while (heap.size) {
    const [, c] = heap.pop()
    if (c === to) break
    const i = c % g.W
    const j = (c / g.W) | 0
    for (const [di, dj] of EIGHT) {
      const ii = i + di
      const jj = j + dj
      if (ii < 0 || jj < 0 || ii >= g.W || jj >= g.H) continue
      const n = jj * g.W + ii
      if (!pass[n]) continue
      if (di !== 0 && dj !== 0 && !(pass[j * g.W + ii] && pass[jj * g.W + i])) continue
      const next = cost[c]! + Math.hypot(di, dj)
      if (next < cost[n]!) {
        cost[n] = next
        parent[n] = c
        heap.push(next + heuristic(n), n)
      }
    }
  }
  if (parent[to]! < 0 && from !== to) return null
  const route: number[] = []
  for (let c = to; c >= 0; c = parent[c]!) route.push(c)
  return route.reverse()
}
