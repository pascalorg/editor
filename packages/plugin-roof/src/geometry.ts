/**
 * Plan geometry for the auto roof — pure, level-local, metres. Points are
 * `[x, z]` in the level's plan (the wall schema's frame). The loop trace and
 * collinear merge follow PlanCrafters' `HA.exteriorLoop` /
 * `mergeCollinearLoop`; the rectilinear decomposition is what Pascal needs
 * instead of their straight skeleton, because Pascal's roof is a set of
 * rectangular segments the viewer unions, not a face list.
 */

export type Pt = readonly [number, number]

export type WallInput = {
  id: string
  start: Pt
  end: Pt
  /** Total wall thickness, metres. */
  thickness: number
  frontSide?: string
  backSide?: string
}

/** Endpoints within this distance are one corner. */
const CORNER_SNAP = 0.01
/** Coordinates within this distance lie on one grid line. */
const GRID_SNAP = 0.005

export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]]
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k]
export const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1]
export const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0]
export const len = (a: Pt): number => Math.hypot(a[0], a[1])
export const dist = (a: Pt, b: Pt): number => len(sub(a, b))
export const unit = (a: Pt): Pt => {
  const l = len(a)
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0]
}

const cornerKey = (p: Pt): string =>
  `${Math.round(p[0] / CORNER_SNAP)},${Math.round(p[1] / CORNER_SNAP)}`

export function isExteriorWall(w: WallInput): boolean {
  return w.frontSide === 'exterior' || w.backSide === 'exterior'
}

export type LoopEdge = { a: Pt; b: Pt; wallIds: string[] }
/** A closed loop: `edges[i]` runs from `pts[i]` to `pts[(i + 1) % n]`. */
export type Loop = { pts: Pt[]; edges: LoopEdge[] }

/**
 * Trace the closed loop of exterior walls. Every corner must join exactly two
 * exterior walls and the walk must use all of them — anything else (an open
 * run, a dangling exterior stub, two separate buildings) returns null and the
 * caller falls back.
 */
export function traceExteriorLoop(walls: WallInput[]): Loop | null {
  const ext = walls.filter((w) => isExteriorWall(w) && dist(w.start, w.end) > 0.05)
  if (ext.length < 3) return null
  const at = new Map<string, { wall: WallInput; end: 0 | 1 }[]>()
  for (const wall of ext) {
    for (const end of [0, 1] as const) {
      const k = cornerKey(end === 0 ? wall.start : wall.end)
      const list = at.get(k) ?? []
      list.push({ wall, end })
      at.set(k, list)
    }
  }
  for (const list of at.values()) if (list.length !== 2) return null

  const first = ext[0] as WallInput
  const pts: Pt[] = []
  const edges: LoopEdge[] = []
  const used = new Set<string>()
  let cur: WallInput = first
  let entry: Pt = cur.start
  let exitEnd: 0 | 1 = 1
  for (let guard = 0; guard <= ext.length; guard++) {
    used.add(cur.id)
    const exit: Pt = exitEnd === 1 ? cur.end : cur.start
    pts.push(entry)
    edges.push({ a: entry, b: exit, wallIds: [cur.id] })
    const curId = cur.id
    const next: { wall: WallInput; end: 0 | 1 } | undefined = (at.get(cornerKey(exit)) ?? []).find((c) => c.wall.id !== curId)
    if (!next) return null
    if (next.wall.id === first.id) return used.size === ext.length ? { pts, edges } : null
    if (used.has(next.wall.id)) return null
    cur = next.wall
    entry = exit
    exitEnd = next.end === 0 ? 1 : 0
  }
  return null
}

/** Signed area; positive when the loop turns counter-clockwise in the (x, z) plane. */
export function signedArea(pts: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt
    const q = pts[(i + 1) % pts.length] as Pt
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

/** Outward unit normal of edge i (from pts[i] to pts[i+1]) for either winding. */
export function outwardNormal(pts: readonly Pt[], i: number): Pt {
  const d = unit(sub(pts[(i + 1) % pts.length] as Pt, pts[i] as Pt))
  const left: Pt = [-d[1], d[0]]
  // interior lies to the LEFT of each edge when the signed area is positive
  return signedArea(pts) > 0 ? [-left[0], -left[1]] : left
}

/** Merge runs of collinear edges (a wall split by a partition tee, a door-length stub). */
export function mergeCollinear(loop: Loop, tol = 0.02): Loop {
  const n = loop.pts.length
  if (n < 4) return loop
  const straightThrough = (i: number): boolean => {
    const prev = loop.edges[(i - 1 + n) % n] as LoopEdge
    const e = loop.edges[i] as LoopEdge
    const d1 = unit(sub(prev.b, prev.a))
    const d2 = unit(sub(e.b, e.a))
    return Math.abs(cross(d1, d2)) < tol && dot(d1, d2) > 0
  }
  let start = 0
  for (let i = 0; i < n; i++) {
    if (!straightThrough(i)) {
      start = i
      break
    }
  }
  const pts: Pt[] = []
  const edges: LoopEdge[] = []
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    const e = loop.edges[i] as LoopEdge
    const last = edges[edges.length - 1]
    if (last && straightThrough(i)) {
      last.b = e.b
      last.wallIds.push(...e.wallIds)
      continue
    }
    pts.push(e.a)
    edges.push({ a: e.a, b: e.b, wallIds: [...e.wallIds] })
  }
  return { pts, edges }
}

/**
 * The building's own axes: `u` along the longest loop edge, `v` a quarter
 * turn on. Everything after the trace happens in this frame (a, b) so a
 * house square to its street — not to north — still decomposes on a grid,
 * the way PlanCrafters computes in the lot's local frame.
 */
export type Frame = { origin: Pt; u: Pt; v: Pt }

export function frameFor(loop: Loop): Frame {
  let best = loop.edges[0] as LoopEdge
  for (const e of loop.edges) if (dist(e.a, e.b) > dist(best.a, best.b)) best = e
  const u = unit(sub(best.b, best.a))
  return { origin: loop.pts[0] as Pt, u, v: [-u[1], u[0]] }
}

export const toFrame = (f: Frame, p: Pt): Pt => {
  const d = sub(p, f.origin)
  return [dot(d, f.u), dot(d, f.v)]
}

export const fromFrame = (f: Frame, q: Pt): Pt => [
  f.origin[0] + q[0] * f.u[0] + q[1] * f.v[0],
  f.origin[1] + q[0] * f.u[1] + q[1] * f.v[1],
]

/** A direction in level coordinates expressed in the frame (no translation). */
export const dirToFrame = (f: Frame, d: Pt): Pt => [dot(d, f.u), dot(d, f.v)]

/** Every edge parallel to u or v (a rectilinear footprint the decomposition can grid). */
export function isRectilinear(polyF: readonly Pt[], tol = 0.02): boolean {
  for (let i = 0; i < polyF.length; i++) {
    const d = unit(sub(polyF[(i + 1) % polyF.length] as Pt, polyF[i] as Pt))
    if (Math.abs(d[0]) > tol && Math.abs(d[1]) > tol) return false
  }
  return true
}

export function pointInPolygon(poly: readonly Pt[], p: Pt): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt
    const b = poly[j] as Pt
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      if (p[0] < x) inside = !inside
    }
  }
  return inside
}

export type Bounds = { a0: number; a1: number; b0: number; b1: number }

export function boundsOf(pts: readonly Pt[]): Bounds {
  const bb: Bounds = {
    a0: Number.POSITIVE_INFINITY,
    a1: Number.NEGATIVE_INFINITY,
    b0: Number.POSITIVE_INFINITY,
    b1: Number.NEGATIVE_INFINITY,
  }
  for (const p of pts) {
    bb.a0 = Math.min(bb.a0, p[0])
    bb.a1 = Math.max(bb.a1, p[0])
    bb.b0 = Math.min(bb.b0, p[1])
    bb.b1 = Math.max(bb.b1, p[1])
  }
  return bb
}

export const rectArea = (r: Bounds): number => Math.max(0, r.a1 - r.a0) * Math.max(0, r.b1 - r.b0)

function gridLines(values: number[]): number[] {
  const out: number[] = []
  for (const v of [...values].sort((x, y) => x - y)) {
    const last = out[out.length - 1]
    if (last === undefined || v - last > GRID_SNAP) out.push(v)
  }
  return out
}

/**
 * Split a rectilinear polygon into the fewest large rectangles a roof wants:
 * repeatedly take the largest rectangle of still-uncovered interior cells on
 * the polygon's own coordinate grid. The first is the main mass; the rest
 * are wings, in size order. Slivers under `minArea` are dropped (the
 * neighbouring roof's overhang covers them).
 */
export function decomposeRectilinear(polyF: readonly Pt[], minArea = 0.25): Bounds[] {
  const as = gridLines(polyF.map((p) => p[0]))
  const bs = gridLines(polyF.map((p) => p[1]))
  const na = as.length - 1
  const nb = bs.length - 1
  if (na < 1 || nb < 1) return []
  // 1 = interior cell still uncovered
  const free: number[][] = []
  for (let i = 0; i < na; i++) {
    const row: number[] = []
    for (let j = 0; j < nb; j++) {
      const c: Pt = [((as[i] as number) + (as[i + 1] as number)) / 2, ((bs[j] as number) + (bs[j + 1] as number)) / 2]
      row.push(pointInPolygon(polyF, c) ? 1 : 0)
    }
    free.push(row)
  }
  const out: Bounds[] = []
  for (let round = 0; round < 32; round++) {
    let best: { i0: number; i1: number; j0: number; j1: number; area: number } | null = null
    for (let i0 = 0; i0 < na; i0++) {
      for (let j0 = 0; j0 < nb; j0++) {
        if (!(free[i0] as number[])[j0]) continue
        // grow the column band first, then the row band, checking every cell
        for (let i1 = i0; i1 < na; i1++) {
          if (!(free[i1] as number[])[j0]) break
          let j1 = j0
          for (; j1 < nb; j1++) {
            let ok = true
            for (let i = i0; i <= i1; i++) {
              if (!(free[i] as number[])[j1]) {
                ok = false
                break
              }
            }
            if (!ok) break
            const area = ((as[i1 + 1] as number) - (as[i0] as number)) * ((bs[j1 + 1] as number) - (bs[j0] as number))
            if (!best || area > best.area) best = { i0, i1, j0, j1, area }
          }
        }
      }
    }
    if (!best || best.area < minArea) break
    for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) (free[i] as number[])[j] = 0
    out.push({
      a0: as[best.i0] as number,
      a1: as[best.i1 + 1] as number,
      b0: bs[best.j0] as number,
      b1: bs[best.j1 + 1] as number,
    })
  }
  return out
}

/**
 * PlanCrafters' `popSide`: how far the footprint pops forward, in the
 * direction `n`, past its dominant (longest) wall facing that way. Zero on a
 * flush box; a garage or wing projecting toward the street reads as the
 * projection depth.
 */
export function popSide(polyF: readonly Pt[], n: Pt): number {
  let extreme = Number.NEGATIVE_INFINITY
  let domC: number | null = null
  let domLen = -1
  for (let i = 0; i < polyF.length; i++) {
    const a = polyF[i] as Pt
    const b = polyF[(i + 1) % polyF.length] as Pt
    if (dot(outwardNormal(polyF, i), n) < 0.9) continue
    const l = dist(a, b)
    if (l < 0.3) continue
    const c = dot(a, n)
    if (c > extreme) extreme = c
    if (l > domLen) {
      domLen = l
      domC = c
    }
  }
  return domC !== null && extreme > Number.NEGATIVE_INFINITY ? extreme - domC : 0
}

/** Fraction of interior sample points (0.3 m grid) inside at least one rectangle. */
export function coverageOf(polyF: readonly Pt[], rects: readonly Bounds[], step = 0.3): number {
  const bb = boundsOf(polyF)
  let total = 0
  let hit = 0
  for (let a = bb.a0 + step / 2; a < bb.a1; a += step) {
    for (let b = bb.b0 + step / 2; b < bb.b1; b += step) {
      if (!pointInPolygon(polyF, [a, b])) continue
      total++
      if (rects.some((r) => a >= r.a0 - 0.01 && a <= r.a1 + 0.01 && b >= r.b0 - 0.01 && b <= r.b1 + 0.01)) hit++
    }
  }
  return total === 0 ? 1 : hit / total
}
