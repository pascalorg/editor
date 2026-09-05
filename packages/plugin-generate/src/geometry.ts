/**
 * Rectilinear plan geometry in INCHES on the 6" grid. Rooms are axis-aligned
 * rectangles that tile the footprint; a rectangle edge is a wall centreline.
 * Everything here is integer arithmetic on grid coordinates, so a loop that
 * should close does close — PlanCrafters' hard-won rule was to snap at every
 * pass boundary, not once at the end.
 */

export const GRID_IN_DEFAULT = 6

export type Rect = { u0: number; v0: number; u1: number; v1: number }
export type Seg = { a: [number, number]; b: [number, number] }
/** A wall run: axis-aligned, `a` before `b` along its axis. */
export type Run = {
  a: [number, number]
  b: [number, number]
  horizontal: boolean
  /** Room indices on each side (−1 = outdoors): `left` is the −v side of a horizontal run / the −u side of a vertical one. */
  left: number
  right: number
  /** Every room a merged run bounds (an exterior wall runs past several). */
  rooms?: number[]
}

/** Runs merge when they are the same wall: the same two rooms, or the same exterior side. */
function mergeKey(run: Run): string {
  if (run.left === -1) return 'out-left'
  if (run.right === -1) return 'out-right'
  return `${run.left}:${run.right}`
}

const key = (p: [number, number]) => `${p[0]},${p[1]}`

/**
 * Unit wall pieces along every rectangle edge, on the grid, tagged with the
 * rooms on either side. Pieces with the same room on both sides are the
 * `zone` boundaries (open plan) and are dropped by the caller.
 */
export function edgePieces(rects: readonly Rect[], grid: number): Run[] {
  const horizontal = new Map<string, { left: number; right: number }>()
  const vertical = new Map<string, { left: number; right: number }>()
  const touch = (map: Map<string, { left: number; right: number }>, k: string, side: 'left' | 'right', i: number) => {
    const cur = map.get(k) ?? { left: -1, right: -1 }
    cur[side] = i
    map.set(k, cur)
  }
  rects.forEach((r, i) => {
    for (let u = r.u0; u < r.u1; u += grid) {
      touch(horizontal, `${u},${r.v0}`, 'right', i) // the room lies on the +v side of its front edge
      touch(horizontal, `${u},${r.v1}`, 'left', i)
    }
    for (let v = r.v0; v < r.v1; v += grid) {
      touch(vertical, `${r.u0},${v}`, 'right', i) // the room lies on the +u side of its left edge
      touch(vertical, `${r.u1},${v}`, 'left', i)
    }
  })
  const out: Run[] = []
  for (const [k, sides] of horizontal) {
    const [u, v] = k.split(',').map(Number) as [number, number]
    out.push({ a: [u, v], b: [u + grid, v], horizontal: true, ...sides })
  }
  for (const [k, sides] of vertical) {
    const [u, v] = k.split(',').map(Number) as [number, number]
    out.push({ a: [u, v], b: [u, v + grid], horizontal: false, ...sides })
  }
  return out
}

/** Merge collinear, touching pieces of the same wall into runs (exterior walls run the whole side). */
export function mergeRuns(pieces: readonly Run[]): Run[] {
  const sorted = [...pieces].sort((p, q) => {
    if (p.horizontal !== q.horizontal) return p.horizontal ? -1 : 1
    const pk = p.horizontal ? p.a[1] : p.a[0]
    const qk = q.horizontal ? q.a[1] : q.a[0]
    if (pk !== qk) return pk - qk
    const pa = p.horizontal ? p.a[0] : p.a[1]
    const qa = q.horizontal ? q.a[0] : q.a[1]
    return pa - qa
  })
  const out: Run[] = []
  for (const piece of sorted) {
    const last = out[out.length - 1]
    const rooms = [piece.left, piece.right].filter((i) => i !== -1)
    if (
      last &&
      last.horizontal === piece.horizontal &&
      mergeKey(last) === mergeKey(piece) &&
      key(last.b) === key(piece.a)
    ) {
      last.b = piece.b
      for (const r of rooms) if (!last.rooms?.includes(r)) last.rooms?.push(r)
      continue
    }
    out.push({ ...piece, rooms })
  }
  return out
}

/**
 * The exterior outline of a set of tiling rectangles as ONE closed ring
 * (counter-clockwise in u,v), from its boundary pieces. Returns null when
 * the boundary is not a single closed loop (a detached room, a hole).
 */
export function outlineRing(rects: readonly Rect[], grid: number): [number, number][] | null {
  const boundary = edgePieces(rects, grid).filter((p) => p.left === -1 || p.right === -1)
  if (boundary.length === 0) return null
  // Orient every piece so the interior is on its left when walking it:
  // interior on the +v side of a horizontal piece → walk +u; interior on
  // the −v side → walk −u. For vertical pieces interior on +u → walk −v.
  const next = new Map<string, [number, number]>()
  for (const p of boundary) {
    const interiorRight = p.right !== -1
    let from: [number, number]
    let to: [number, number]
    if (p.horizontal) {
      ;[from, to] = interiorRight ? [p.a, p.b] : [p.b, p.a]
    } else {
      ;[from, to] = interiorRight ? [p.b, p.a] : [p.a, p.b]
    }
    if (next.has(key(from))) return null
    next.set(key(from), to)
  }
  const start = boundary[0] as Run
  const first: [number, number] = start.horizontal
    ? start.right !== -1
      ? start.a
      : start.b
    : start.right !== -1
      ? start.b
      : start.a
  const ring: [number, number][] = [first]
  let cur = next.get(key(first))
  let guard = next.size + 2
  while (cur && key(cur) !== key(first) && guard-- > 0) {
    ring.push(cur)
    cur = next.get(key(cur))
  }
  if (!cur || key(cur) !== key(first) || ring.length !== next.size) return null
  // Drop collinear points.
  const out: [number, number][] = []
  for (let i = 0; i < ring.length; i++) {
    const p = ring[(i + ring.length - 1) % ring.length] as [number, number]
    const q = ring[i] as [number, number]
    const r = ring[(i + 1) % ring.length] as [number, number]
    const collinear = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) === 0
    if (!collinear) out.push(q)
  }
  return out
}

export function ringArea(ring: readonly [number, number][]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as [number, number]
    const q = ring[(i + 1) % ring.length] as [number, number]
    s += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(s) / 2
}

export function pointInRing(ring: readonly [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number]
    const [xj, yj] = ring[j] as [number, number]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
