import { pointInPolygon } from '../agent-operations/plan-geometry'

/**
 * The unit interior guesser's data: a unit's space (funnel stage 0) and interior layouts over it.
 * Rooms are unions of axis-aligned rectangles in metres, in the unit's frame as drawn (x right,
 * z down). Walls derive from the rooms, so a layout cannot hold a wall that bounds nothing.
 */

export type Pt = [number, number]
export type Rect = readonly [x0: number, z0: number, x1: number, z1: number]

/** What lies across an outline edge, in `add_entry_doors`' words. */
export type EdgeKind = 'outside' | 'party' | 'shared'

export type UnitSpace = {
  /** Rectilinear, either winding. */
  outline: Pt[]
  /** `edges[i]` is the edge `outline[i]` → `outline[i + 1]`. */
  edges: EdgeKind[]
  /** The shared edge the entry door goes on. */
  entryEdge: number
}

export const ROOM_TYPES = [
  'living',
  'kitchen',
  'hall',
  'entry',
  'bedroom',
  'bathroom',
  'walk_in',
  'closet',
  'pantry',
  'laundry',
] as const
export type RoomType = (typeof ROOM_TYPES)[number]

/** The day side and its circulation: these open onto each other with no wall between. */
export const OPEN_PLAN_ROOMS: ReadonlySet<RoomType> = new Set([
  'living',
  'kitchen',
  'hall',
  'entry',
])
export const WET_ROOMS: ReadonlySet<RoomType> = new Set(['bathroom', 'kitchen', 'laundry'])

export type UnitRoom = { id: string; type: RoomType; rects: Rect[] }
/** `at` is the door's centre, on the wall the two rooms share. */
export type UnitDoor = { rooms: [string, string]; at: Pt; width: number }

export type UnitLayout = {
  id: string
  rooms: UnitRoom[]
  /** Room pairs with no wall between them. */
  open: [string, string][]
  doors: UnitDoor[]
  entry: { room: string; at: Pt; width: number }
}

export type Segment = { a: Pt; b: Pt }
export type WallSegment = Segment & { rooms: [string, string] }

/** Metres: below this, two coordinates are the same line. */
export const TOL = 1e-3

export const rectArea = ([x0, z0, x1, z1]: Rect) => (x1 - x0) * (z1 - z0)
export const roomArea = (room: UnitRoom) => room.rects.reduce((sum, r) => sum + rectArea(r), 0)
export const segmentLength = ({ a, b }: Segment) => Math.hypot(b[0] - a[0], b[1] - a[1])

export function polygonArea(points: readonly Pt[]) {
  let twice = 0
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i]!
    const [bx, bz] = points[(i + 1) % points.length]!
    twice += ax * bz - bx * az
  }
  return Math.abs(twice) / 2
}

export function isRectilinear(outline: readonly Pt[]) {
  if (outline.length < 4) return false
  return outline.every((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    const dx = Math.abs(b[0] - a[0])
    const dz = Math.abs(b[1] - a[1])
    return dx < TOL !== dz < TOL
  })
}

export function outlineEdges(space: UnitSpace): (Segment & { kind: EdgeKind; index: number })[] {
  const { outline } = space
  return outline.map((a, index) => ({
    a,
    b: outline[(index + 1) % outline.length]!,
    kind: space.edges[index]!,
    index,
  }))
}

const unique = (values: number[]) => {
  const sorted = [...values].sort((p, q) => p - q)
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1]! > TOL)
}

/** Row runs of inside cells, merged down where a run repeats: few rectangles, deterministic. */
function mergeCells(xs: number[], zs: number[], inside: (i: number, j: number) => boolean): Rect[] {
  const rects: Rect[] = []
  let open: { i0: number; i1: number; z0: number }[] = []
  for (let j = 0; j <= zs.length - 1; j++) {
    const runs: { i0: number; i1: number }[] = []
    if (j < zs.length - 1) {
      let i = 0
      while (i < xs.length - 1) {
        if (!inside(i, j)) {
          i++
          continue
        }
        const i0 = i
        while (i < xs.length - 1 && inside(i, j)) i++
        runs.push({ i0, i1: i })
      }
    }
    const next: typeof open = []
    for (const run of open) {
      if (runs.some((r) => r.i0 === run.i0 && r.i1 === run.i1)) next.push(run)
      else rects.push([xs[run.i0]!, run.z0, xs[run.i1]!, zs[j]!])
    }
    for (const r of runs)
      if (!open.some((o) => o.i0 === r.i0 && o.i1 === r.i1)) next.push({ ...r, z0: zs[j]! })
    open = next
  }
  return rects
}

/** A rectilinear polygon as rectangles. */
export function polygonRects(outline: readonly Pt[]): Rect[] {
  const xs = unique(outline.map((p) => p[0]))
  const zs = unique(outline.map((p) => p[1]))
  const polygon = outline as Pt[]
  return mergeCells(xs, zs, (i, j) =>
    pointInPolygon([(xs[i]! + xs[i + 1]!) / 2, (zs[j]! + zs[j + 1]!) / 2], polygon, false),
  )
}

/** The segment two rectangles share along an edge, if it has length. */
export function sharedSegment(p: Rect, q: Rect): Segment | null {
  const overlap = (a0: number, a1: number, b0: number, b1: number) =>
    [Math.max(a0, b0), Math.min(a1, b1)] as const
  for (const [x, other] of [
    [p[2], q[0]],
    [p[0], q[2]],
  ] as const) {
    if (Math.abs(x - other) > TOL) continue
    const [z0, z1] = overlap(p[1], p[3], q[1], q[3])
    if (z1 - z0 > TOL) return { a: [x, z0], b: [x, z1] }
  }
  for (const [z, other] of [
    [p[3], q[1]],
    [p[1], q[3]],
  ] as const) {
    if (Math.abs(z - other) > TOL) continue
    const [x0, x1] = overlap(p[0], p[2], q[0], q[2])
    if (x1 - x0 > TOL) return { a: [x0, z], b: [x1, z] }
  }
  return null
}

/** Collinear, touching segments joined: one wall per straight run. */
export function mergeSegments<S extends Segment>(segments: readonly S[]): S[] {
  const lines = new Map<string, S[]>()
  for (const s of segments) {
    const vertical = Math.abs(s.a[0] - s.b[0]) < TOL
    const key = `${vertical ? 'x' : 'z'}${Math.round((vertical ? s.a[0] : s.a[1]) / TOL)}`
    const ordered = (vertical ? s.a[1] > s.b[1] : s.a[0] > s.b[0]) ? { ...s, a: s.b, b: s.a } : s
    lines.set(key, [...(lines.get(key) ?? []), ordered])
  }
  const merged: S[] = []
  for (const [key, line] of lines) {
    const axis = key[0] === 'x' ? 1 : 0
    line.sort((p, q) => p.a[axis] - q.a[axis])
    let current = line[0]!
    for (const s of line.slice(1)) {
      if (s.a[axis] <= current.b[axis] + TOL) {
        if (s.b[axis] > current.b[axis]) current = { ...current, b: s.b }
      } else {
        merged.push(current)
        current = s
      }
    }
    merged.push(current)
  }
  return merged
}

const pairKey = (p: string, q: string) => (p < q ? `${p}|${q}` : `${q}|${p}`)

/** Every boundary two rooms share, by room pair. */
export function roomContacts(layout: Pick<UnitLayout, 'rooms'>): Map<string, WallSegment[]> {
  const contacts = new Map<string, WallSegment[]>()
  const { rooms } = layout
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const p = rooms[i]!
      const q = rooms[j]!
      const shared: WallSegment[] = []
      for (const r of p.rects)
        for (const s of q.rects) {
          const segment = sharedSegment(r, s)
          if (segment) shared.push({ ...segment, rooms: [p.id, q.id] })
        }
      if (shared.length) contacts.set(pairKey(p.id, q.id), mergeSegments(shared))
    }
  return contacts
}

export const isOpenPair = (layout: Pick<UnitLayout, 'open'>, p: string, q: string) =>
  layout.open.some(([a, b]) => (a === p && b === q) || (a === q && b === p))

/** The interior walls: every shared boundary except the open ones. The outline is not here. */
export function layoutWalls(layout: Pick<UnitLayout, 'rooms' | 'open'>): WallSegment[] {
  const walls: WallSegment[] = []
  for (const shared of roomContacts(layout).values()) {
    const [p, q] = shared[0]!.rooms
    if (!isOpenPair(layout, p, q)) walls.push(...shared)
  }
  return walls
}

const collinearOverlap = (s: Segment, t: Segment) => {
  const sVertical = Math.abs(s.a[0] - s.b[0]) < TOL
  const tVertical = Math.abs(t.a[0] - t.b[0]) < TOL
  if (sVertical !== tVertical) return 0
  const axis = sVertical ? 1 : 0
  const line = sVertical ? 0 : 1
  if (Math.abs(s.a[line] - t.a[line]) > TOL) return 0
  const lo = Math.max(Math.min(s.a[axis], s.b[axis]), Math.min(t.a[axis], t.b[axis]))
  const hi = Math.min(Math.max(s.a[axis], s.b[axis]), Math.max(t.a[axis], t.b[axis]))
  return Math.max(0, hi - lo)
}

const rectSides = ([x0, z0, x1, z1]: Rect): Segment[] => [
  { a: [x0, z0], b: [x1, z0] },
  { a: [x1, z0], b: [x1, z1] },
  { a: [x0, z1], b: [x1, z1] },
  { a: [x0, z0], b: [x0, z1] },
]

/** How much of these rectangles' boundary lies on outline edges of the given kinds. */
export function lengthOnEdges(rects: readonly Rect[], space: UnitSpace, kinds: EdgeKind[]) {
  let length = 0
  for (const edge of outlineEdges(space)) {
    if (!kinds.includes(edge.kind)) continue
    for (const rect of rects)
      for (const side of rectSides(rect)) length += collinearOverlap(side, edge)
  }
  return length
}

/** The overlap of a segment with an outline edge, as a segment (for door placement). */
export function overlapOnEdge(rect: Rect, edge: Segment): Segment | null {
  for (const side of rectSides(rect)) {
    if (collinearOverlap(side, edge) <= TOL) continue
    const vertical = Math.abs(side.a[0] - side.b[0]) < TOL
    const axis = vertical ? 1 : 0
    const lo = Math.max(Math.min(side.a[axis], side.b[axis]), Math.min(edge.a[axis], edge.b[axis]))
    const hi = Math.min(Math.max(side.a[axis], side.b[axis]), Math.max(edge.a[axis], edge.b[axis]))
    const at = (v: number): Pt => (vertical ? [side.a[0], v] : [v, side.a[1]])
    return { a: at(lo), b: at(hi) }
  }
  return null
}

/**
 * The side of the largest axis-aligned square that fits in the room: a bedroom with a closet
 * alcove is as wide as its main body, however its rectangles are cut.
 */
export function roomWidth(room: Pick<UnitRoom, 'rects'>) {
  const xs = unique(room.rects.flatMap((r) => [r[0], r[2]]))
  const zs = unique(room.rects.flatMap((r) => [r[1], r[3]]))
  const inside = (i: number, j: number) => {
    const x = (xs[i]! + xs[i + 1]!) / 2
    const z = (zs[j]! + zs[j + 1]!) / 2
    return room.rects.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3])
  }
  let best = 0
  for (let i0 = 0; i0 < xs.length - 1; i0++)
    for (let j0 = 0; j0 < zs.length - 1; j0++)
      for (let i1 = i0 + 1; i1 < xs.length; i1++) {
        if (!inside(i1 - 1, j0)) break
        for (let j1 = j0 + 1; j1 < zs.length; j1++) {
          let filled = true
          for (let i = i0; i < i1 && filled; i++) filled = inside(i, j1 - 1)
          if (!filled) break
          best = Math.max(best, Math.min(xs[i1]! - xs[i0]!, zs[j1]! - zs[j0]!))
        }
      }
  return best
}

/**
 * How narrow a corridor gets: through each of its rectangles, the shorter of the two runs across
 * the room (along x with the rectangle's z-span, along z with its x-span), the smallest of those.
 * A single rectangle measures its short side; how the room is cut into rectangles does not matter.
 */
export function roomNarrowest(room: Pick<UnitRoom, 'rects'>) {
  const covered = (x0: number, z0: number, x1: number, z1: number) => {
    const xs = unique([x0, x1, ...room.rects.flatMap((r) => [r[0], r[2]])]).filter(
      (v) => v >= x0 - TOL && v <= x1 + TOL,
    )
    const zs = unique([z0, z1, ...room.rects.flatMap((r) => [r[1], r[3]])]).filter(
      (v) => v >= z0 - TOL && v <= z1 + TOL,
    )
    for (let i = 0; i + 1 < xs.length; i++)
      for (let j = 0; j + 1 < zs.length; j++) {
        const x = (xs[i]! + xs[i + 1]!) / 2
        const z = (zs[j]! + zs[j + 1]!) / 2
        if (!room.rects.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3])) return false
      }
    return true
  }
  const xs = unique(room.rects.flatMap((r) => [r[0], r[2]]))
  const zs = unique(room.rects.flatMap((r) => [r[1], r[3]]))
  const run = (
    from: number,
    to: number,
    stops: number[],
    fits: (a: number, b: number) => boolean,
  ) => {
    let a = from
    let b = to
    for (const s of [...stops].reverse()) if (s < a - TOL && fits(s, b)) a = s
    for (const s of stops) if (s > b + TOL && fits(a, s)) b = s
    return b - a
  }
  let narrowest = Number.POSITIVE_INFINITY
  for (const [x0, z0, x1, z1] of room.rects) {
    const alongX = run(x0, x1, xs, (a, b) => covered(a, z0, b, z1))
    const alongZ = run(z0, z1, zs, (a, b) => covered(x0, a, x1, b))
    narrowest = Math.min(narrowest, Math.min(alongX, alongZ))
  }
  return narrowest
}

/** The shortest gap between two rooms' rectangles (0 when they touch). */
export function roomGap(p: Pick<UnitRoom, 'rects'>, q: Pick<UnitRoom, 'rects'>) {
  let best = Number.POSITIVE_INFINITY
  for (const r of p.rects)
    for (const s of q.rects) {
      const dx = Math.max(0, s[0] - r[2], r[0] - s[2])
      const dz = Math.max(0, s[1] - r[3], r[1] - s[3])
      best = Math.min(best, Math.hypot(dx, dz))
    }
  return best
}

/** A small seeded generator (mulberry32): the same seed always draws the same layouts. */
export function seededRandom(seed: number) {
  let state = seed >>> 0 || 0x9e3779b9
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    between: (min: number, max: number) => min + next() * (max - min),
    pick: <T>(options: readonly T[]) => options[Math.floor(next() * options.length)]!,
    chance: (p: number) => next() < p,
  }
}
export type Random = ReturnType<typeof seededRandom>

/** The outline of a union of rectangles (one connected room), corners only. */
export function rectsOutline(rects: readonly Rect[]): Pt[] {
  if (rects.length === 1) {
    const [x0, z0, x1, z1] = rects[0]!
    return [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ]
  }
  const xs = unique(rects.flatMap((r) => [r[0], r[2]]))
  const zs = unique(rects.flatMap((r) => [r[1], r[3]]))
  const inside = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= zs.length - 1) return false
    const x = (xs[i]! + xs[i + 1]!) / 2
    const z = (zs[j]! + zs[j + 1]!) / 2
    return rects.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3])
  }
  const next = new Map<string, Pt>()
  const key = (p: Pt) => `${p[0]},${p[1]}`
  let start: Pt | null = null
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      if (!inside(i, j)) continue
      const [x0, x1, z0, z1] = [xs[i]!, xs[i + 1]!, zs[j]!, zs[j + 1]!]
      const edges: [Pt, Pt][] = []
      if (!inside(i, j - 1))
        edges.push([
          [x0, z0],
          [x1, z0],
        ])
      if (!inside(i + 1, j))
        edges.push([
          [x1, z0],
          [x1, z1],
        ])
      if (!inside(i, j + 1))
        edges.push([
          [x1, z1],
          [x0, z1],
        ])
      if (!inside(i - 1, j))
        edges.push([
          [x0, z1],
          [x0, z0],
        ])
      for (const [a, b] of edges) {
        next.set(key(a), b)
        start ??= a
      }
    }
  if (!start) return []
  const ring: Pt[] = [start]
  for (let p = next.get(key(start))!; key(p) !== key(start); p = next.get(key(p))!) ring.push(p)
  return ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length]!
    const b = ring[(i + 1) % ring.length]!
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9
  })
}
