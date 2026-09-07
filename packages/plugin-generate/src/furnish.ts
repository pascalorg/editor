/**
 * Furnishing — the fixtures and furniture a generated house is drawn with,
 * placed from the editor's item catalog by room kind (Steve, 2026-09-06:
 * "furniture … kitchen layouts using their tooling, sinks and cabinets
 * facing the correct directions, bathrooms have a standard layout, typically
 * vanity, toilet, shower or tub — auto fixtures").
 *
 * Every room is a rectangle in plan inches (`u` along the front, `v` into
 * the lot) with four edges; each edge knows its wall's half thickness, whether
 * it is exterior, and the openings seated in it. An item goes AGAINST an
 * edge with its back to the wall (the catalog's models face their own local
 * +Z, so an item turned to face the room's inward normal reads the right way
 * round — the same rule the editor's wall placement uses), or free-standing
 * facing a target (a chair facing its table, the sofa facing the TV).
 * Nothing lands in the 36 in clear zone in front of a door or a cased
 * opening, nothing tall stands in front of a window, nothing overlaps.
 *
 * The recipes are the ordinary ones: a bed with its head to the wall without
 * the door, nightstands beside it, a dresser opposite; the bath's wet wall —
 * toilet, then the vanity toward the door — with the tub or shower across
 * the far end; the kitchen run under the window (the sink unit centred on
 * it, the range and the fridge either side); the dining table centred with
 * its chairs; the living room's TV on a blank wall, the sofa facing it, the
 * coffee table between; the desk under the office window; the washer in the
 * laundry. What does not fit is left out and said so — the catalog's vanity
 * is a 72 in double, so a 5 ft bath gets its toilet and shower and a warning.
 *
 * Bones reads the placed sanitary fixtures straight off the item nodes
 * (`extractPlacedFixtures`: toilet, bathroom-sink, shower, bathtub,
 * washing-machine, the kitchen sink unit), so the plumbing follows.
 */

import type { PlanEdge, RoomKind } from './document'

export type Pt = [number, number]

const IN = 0.0254
const M_TO_IN = 1 / IN
const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d

/** A catalog entry as the editor's item catalog carries it (`AssetInput`). */
export type CatalogAsset = {
  id: string
  category: string
  name: string
  thumbnail: string
  src: string
  floorPlanUrl?: string
  /** [w, h, d] metres — w along the item's own x, d along its own z (its front is +z). An entry without them cannot be placed. */
  dimensions?: [number, number, number]
  offset?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  tags?: string[]
  attachTo?: string
  surface?: { height: number }
  tool?: string
}

/** A catalog entry that can be placed: its dimensions are known. */
export type Sized = CatalogAsset & { dimensions: [number, number, number] }

export type FurnishOpening = {
  /** Extent along the edge's own coordinate (u for front/back, v for left/right), inches. */
  a: number
  b: number
  kind: 'door' | 'open' | 'window'
  /** A window's sill above the floor, inches. */
  sillIn?: number
}

export type FurnishEdge = {
  exterior: boolean
  /** Half the wall's thickness, inches — the room's inner face is this far inside the edge line. */
  halfIn: number
  openings: FurnishOpening[]
  /**
   * No wall on this edge at all — the room runs straight into the next one
   * (a kitchen open to the great room). Nothing stands with its back to it:
   * a range there would back onto the neighbour's sofa.
   */
  open?: boolean
}

export type FurnishRoom = {
  name: string
  kind: RoomKind
  /** The primary bedroom — it gets the lounge chair. */
  primary?: boolean
  u0: number
  v0: number
  u1: number
  v1: number
  edges: Record<PlanEdge, FurnishEdge>
}

export type FurnishOp = { node: Record<string, unknown>; parentId?: string }

export type FurnishInput = {
  rooms: FurnishRoom[]
  catalog: readonly CatalogAsset[]
  levelId: string
  /** A fresh item node id. */
  ids: () => string
  /** Plan inches → level-local metres. */
  toLocal: (p: Pt) => Pt
  generatedBy: string
  /** Where each decision went — for a probe, never for the user. */
  trace?: (line: string) => void
  /**
   * The roll's random — the choices a plan can go either way on (an island
   * or not, an L, a fireplace, a sideboard) so one house is not every
   * house (Steve, 2026-09-07: "so the random generates more options").
   * Absent: every gate reads 0.5 — the tests' fixed layout.
   */
  rng?: () => number
}

export type FurnishResult = {
  ops: FurnishOp[]
  warnings: string[]
  /** Items placed. */
  placed: number
}

/** Clear zone in front of a door or cased opening (its swing / the walkway), inches. */
export const DOOR_SWING = 36
/** A door's zone reaches this far past its jambs, inches. */
const DOOR_SIDE = 6
/** Breathing room between items, inches. */
const GAP = 2
/** Search step when sliding an item along a wall, inches. */
const STEP = 6
/** A toilet's centre keeps 15 in from a side wall (IRC R307.1); 18 in reads as built. */
const TOILET_FROM_WALL = 18
/** The sofa's distance from the TV wall, tried from far to near, inches. */
const SOFA_DISTANCES = [108, 96, 84, 72, 60]

type Rect = { u0: number; v0: number; u1: number; v1: number }

type Placed = {
  asset: Sized
  centre: Pt
  yaw: number
  rect: Rect
  role: string
  /** A corrective scale on the node (a vanity narrowed to its wall). */
  scale?: [number, number, number]
  /** Off the floor, metres — a hood over the range, a television on its stand. */
  elevationM?: number
  /** Takes no floor: a hood, a carpet, a television — nothing collides with it. */
  floating?: boolean
}

type Rng = () => number

const EDGES: readonly PlanEdge[] = ['front', 'back', 'left', 'right']

function opposite(edge: PlanEdge): PlanEdge {
  return edge === 'front' ? 'back' : edge === 'back' ? 'front' : edge === 'left' ? 'right' : 'left'
}

function perpendicular(edge: PlanEdge): [PlanEdge, PlanEdge] {
  return edge === 'front' || edge === 'back' ? ['left', 'right'] : ['front', 'back']
}

/**
 * The yaw that turns an item's front (+z) onto an edge's inward normal:
 * rotating by θ about y maps local +z to (sin θ, cos θ) in (u, v).
 */
export function edgeYaw(edge: PlanEdge): number {
  switch (edge) {
    case 'front':
      return 0 // inward (0, +1)
    case 'back':
      return Math.PI // inward (0, −1)
    case 'left':
      return Math.PI / 2 // inward (+1, 0)
    default:
      return -Math.PI / 2 // inward (−1, 0)
  }
}

/** The yaw facing from `from` toward `to`. */
export function yawToward(from: Pt, to: Pt): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1])
}

function inwardOf(edge: PlanEdge): Pt {
  switch (edge) {
    case 'front':
      return [0, 1]
    case 'back':
      return [0, -1]
    case 'left':
      return [1, 0]
    default:
      return [-1, 0]
  }
}

/** Plan extents of an item at `yaw` (a quarter turn swaps its width and depth). */
export function extents(asset: Sized, yaw: number): { u: number; v: number } {
  const w = asset.dimensions[0] * M_TO_IN
  const d = asset.dimensions[2] * M_TO_IN
  const quarter = Math.abs(Math.sin(yaw)) > 0.5
  return quarter ? { u: d, v: w } : { u: w, v: d }
}

function rectAround(centre: Pt, ext: { u: number; v: number }): Rect {
  return {
    u0: centre[0] - ext.u / 2,
    v0: centre[1] - ext.v / 2,
    u1: centre[0] + ext.u / 2,
    v1: centre[1] + ext.v / 2,
  }
}

function overlaps(a: Rect, b: Rect, margin = 0): boolean {
  const eps = 1e-6
  return (
    a.u0 < b.u1 + margin - eps &&
    a.u1 > b.u0 - margin + eps &&
    a.v0 < b.v1 + margin - eps &&
    a.v1 > b.v0 - margin + eps
  )
}

function inside(inner: Rect, r: Rect, tolerance = 0.5): boolean {
  return (
    r.u0 >= inner.u0 - tolerance &&
    r.u1 <= inner.u1 + tolerance &&
    r.v0 >= inner.v0 - tolerance &&
    r.v1 <= inner.v1 + tolerance
  )
}

/** One room's placement state: its inner rectangle, the door zones, what stands in it. */
class RoomBox {
  readonly inner: Rect
  readonly zones: Rect[] = []
  readonly placed: Placed[] = []

  constructor(readonly room: FurnishRoom) {
    const e = room.edges
    this.inner = {
      u0: room.u0 + e.left.halfIn,
      v0: room.v0 + e.front.halfIn,
      u1: room.u1 - e.right.halfIn,
      v1: room.v1 - e.back.halfIn,
    }
    for (const edge of EDGES) {
      for (const o of e[edge].openings) {
        if (o.kind === 'window') continue
        this.zones.push(this.bandOn(edge, o.a - DOOR_SIDE, o.b + DOOR_SIDE, DOOR_SWING))
      }
    }
  }

  /** The rectangle along `edge` between `a` and `b` (edge coordinate), `depth` into the room. */
  bandOn(edge: PlanEdge, a: number, b: number, depth: number): Rect {
    const lo = Math.max(a, this.spanOf(edge)[0])
    const hi = Math.min(b, this.spanOf(edge)[1])
    switch (edge) {
      case 'front':
        return { u0: lo, u1: hi, v0: this.inner.v0, v1: this.inner.v0 + depth }
      case 'back':
        return { u0: lo, u1: hi, v0: this.inner.v1 - depth, v1: this.inner.v1 }
      case 'left':
        return { v0: lo, v1: hi, u0: this.inner.u0, u1: this.inner.u0 + depth }
      default:
        return { v0: lo, v1: hi, u0: this.inner.u1 - depth, u1: this.inner.u1 }
    }
  }

  /** The inner span along an edge, in the edge's coordinate. */
  spanOf(edge: PlanEdge): [number, number] {
    return edge === 'front' || edge === 'back'
      ? [this.inner.u0, this.inner.u1]
      : [this.inner.v0, this.inner.v1]
  }

  /** Length of the room along an edge, inches (inner). */
  lengthOf(edge: PlanEdge): number {
    const [a, b] = this.spanOf(edge)
    return b - a
  }

  /** The room's depth away from an edge, inches (inner). */
  depthFrom(edge: PlanEdge): number {
    return edge === 'front' || edge === 'back'
      ? this.inner.v1 - this.inner.v0
      : this.inner.u1 - this.inner.u0
  }

  /** No wall on this edge: the room runs into the next one. */
  isOpen(edge: PlanEdge): boolean {
    return this.room.edges[edge].open === true
  }

  /** A door, an opening, or no wall at all — not a wall to stand something against. */
  hasDoor(edge: PlanEdge): boolean {
    return this.isOpen(edge) || this.room.edges[edge].openings.some((o) => o.kind !== 'window')
  }

  windows(edge: PlanEdge): FurnishOpening[] {
    return this.room.edges[edge].openings.filter((o) => o.kind === 'window')
  }

  /** Spans along an edge clear of doors and openings (with their side margins). */
  freeSpans(edge: PlanEdge): [number, number][] {
    if (this.isOpen(edge)) return []
    let spans: [number, number][] = [this.spanOf(edge)]
    for (const o of this.room.edges[edge].openings) {
      if (o.kind === 'window') continue
      const next: [number, number][] = []
      for (const [a, b] of spans) {
        const lo = o.a - DOOR_SIDE
        const hi = o.b + DOOR_SIDE
        if (hi <= a || lo >= b) {
          next.push([a, b])
          continue
        }
        if (lo > a) next.push([a, lo])
        if (hi < b) next.push([hi, b])
      }
      spans = next
    }
    return spans.filter(([a, b]) => b - a > 1)
  }

  /** The longest span along an edge clear of doors. */
  longestFree(edge: PlanEdge): [number, number] | null {
    let best: [number, number] | null = null
    for (const s of this.freeSpans(edge)) if (!best || s[1] - s[0] > best[1] - best[0]) best = s
    return best
  }

  /**
   * Can `rect` stand here: inside the room, clear of the door zones, clear of
   * what is placed, and — for an item `heightIn` tall standing with its back
   * on `backEdge` — not in front of a window in that wall it would block
   * (its top above the sill). An item beside a window on the wall square to
   * it (a shower in the corner) blocks nothing.
   */
  fits(rect: Rect, heightIn: number, gap = GAP, backEdge?: PlanEdge): boolean {
    if (!inside(this.inner, rect)) return false
    if (backEdge && this.isOpen(backEdge)) return false
    if (this.zones.some((z) => overlaps(rect, z))) return false
    if (this.placed.some((p) => !p.floating && overlaps(rect, p.rect, gap))) return false
    if (backEdge) {
      for (const w of this.windows(backEdge)) {
        if (heightIn <= (w.sillIn ?? 0) + 0.5) continue
        if (overlaps(rect, this.bandOn(backEdge, w.a, w.b, 1))) return false
      }
    }
    return true
  }

  /** Centre of an item standing with its back on `edge` at `along` (edge coordinate). */
  centreOn(edge: PlanEdge, asset: Sized, along: number): Pt {
    const depth = asset.dimensions[2] * M_TO_IN
    switch (edge) {
      case 'front':
        return [along, this.inner.v0 + depth / 2]
      case 'back':
        return [along, this.inner.v1 - depth / 2]
      case 'left':
        return [this.inner.u0 + depth / 2, along]
      default:
        return [this.inner.u1 - depth / 2, along]
    }
  }

  /** Try to stand an item with its back on `edge` centred at `along`. */
  against(
    edge: PlanEdge,
    asset: Sized,
    along: number,
    role: string,
    gap = GAP,
  ): Placed | null {
    const yaw = edgeYaw(edge)
    return this.tryAt(asset, this.centreOn(edge, asset, along), yaw, role, gap, edge)
  }

  /** Slide an item along `edge` from `preferred` outward until it stands. */
  slideAgainst(
    edge: PlanEdge,
    asset: Sized,
    preferred: number,
    role: string,
    within?: [number, number],
  ): Placed | null {
    const [lo, hi] = within ?? this.spanOf(edge)
    const half = extents(asset, edgeYaw(edge))[edge === 'front' || edge === 'back' ? 'u' : 'v'] / 2
    const min = lo + half
    const max = hi - half
    if (max < min) return null
    const start = Math.min(Math.max(preferred, min), max)
    const reach = Math.max(start - min, max - start)
    for (let d = 0; d <= reach + STEP; d += STEP) {
      for (const s of d === 0 ? [0] : [1, -1]) {
        const along = start + s * d
        if (along < min - 1e-6 || along > max + 1e-6) continue
        const hit = this.against(edge, asset, along, role)
        if (hit) return hit
      }
    }
    return null
  }

  /** Try to stand an item free at `centre` facing `yaw`. */
  tryAt(
    asset: Sized,
    centre: Pt,
    yaw: number,
    role: string,
    gap = GAP,
    backEdge?: PlanEdge,
  ): Placed | null {
    const rect = rectAround(centre, extents(asset, yaw))
    if (!this.fits(rect, asset.dimensions[1] * M_TO_IN, gap, backEdge)) return null
    const placed: Placed = { asset, centre, yaw, rect, role }
    this.placed.push(placed)
    return placed
  }

  /** Put an item that takes no floor — over, under or on another — at `centre`, `elevationM` up. */
  float(asset: Sized, centre: Pt, yaw: number, role: string, elevationM = 0): Placed {
    const rect = rectAround(centre, extents(asset, yaw))
    const placed: Placed = { asset, centre, yaw, rect, role, elevationM, floating: true }
    this.placed.push(placed)
    return placed
  }

  /** Try to stand an item free at `centre`, else nearby — stepping out along both axes up to `reach`. */
  tryNear(asset: Sized, centre: Pt, yaw: number, role: string, reach = 24): Placed | null {
    for (let d = 0; d <= reach + 1e-6; d += STEP) {
      const offsets: Pt[] = d === 0 ? [[0, 0]] : [[-d, 0], [d, 0], [0, -d], [0, d]]
      for (const [du, dv] of offsets) {
        const hit = this.tryAt(asset, [centre[0] + du, centre[1] + dv], yaw, role)
        if (hit) return hit
      }
    }
    return null
  }

  /** Corner of the room where `edge` meets `side`, in `edge`'s coordinate, stepped in by `half`. */
  cornerAlong(edge: PlanEdge, side: PlanEdge, half: number): number {
    const [lo, hi] = this.spanOf(edge)
    return side === 'left' || side === 'front' ? lo + half : hi - half
  }
}

/** A catalog lookup that says what it could not find (once per id). */
function lookup(catalog: readonly CatalogAsset[], warnings: string[]) {
  const byId = new Map(catalog.map((a) => [a.id, a] as const))
  const missing = new Set<string>()
  return (id: string): Sized | null => {
    const a = byId.get(id)
    if (a?.dimensions) return a as Sized
    if (!missing.has(id)) {
      missing.add(id)
      warnings.push(`furnishing: the item catalog has no "${id}" — left out.`)
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

type Get = (id: string) => Sized | null
type Trace = (line: string) => void

/** Edges ranked for a headboard / a blank wall: no door first, then no window, then the longer. */
function blankEdges(box: RoomBox, prefer?: (edge: PlanEdge) => number): PlanEdge[] {
  const doorEdges = EDGES.filter((e) => box.hasDoor(e))
  const score = (e: PlanEdge): number =>
    (box.hasDoor(e) ? 100 : 0) +
    (box.windows(e).length > 0 ? 10 : 0) +
    (doorEdges.some((d) => opposite(d) === e) ? -5 : 0) +
    (prefer ? prefer(e) : 0) -
    box.lengthOf(e) / 1000
  return [...EDGES].sort((p, q) => score(p) - score(q))
}

function furnishBedroom(box: RoomBox, get: Get, warnings: string[], trace: Trace, rng: Rng): void {
  const narrow = Math.min(box.lengthOf('front'), box.lengthOf('left')) < 120
  const bed = get(narrow ? 'single-bed' : 'double-bed')
  if (!bed) return
  let placedBed: Placed | null = null
  let bedEdge: PlanEdge | null = null
  for (const edge of blankEdges(box)) {
    const [lo, hi] = box.spanOf(edge)
    placedBed = box.slideAgainst(edge, bed, (lo + hi) / 2, 'bed')
    if (placedBed) {
      bedEdge = edge
      break
    }
  }
  if (!placedBed || !bedEdge) {
    warnings.push(`furnishing: "${box.room.name}" has no clear wall for a bed.`)
    return
  }
  trace(`${box.room.name}: bed on the ${bedEdge} wall`)
  const stand = get('bedside-table')
  if (stand) {
    const alongAxis = bedEdge === 'front' || bedEdge === 'back' ? 0 : 1
    const bedHalf = extents(bed, edgeYaw(bedEdge))[alongAxis === 0 ? 'u' : 'v'] / 2
    const standHalf = extents(stand, edgeYaw(bedEdge))[alongAxis === 0 ? 'u' : 'v'] / 2
    const centre = placedBed.centre[alongAxis]
    for (const s of [-1, 1]) {
      box.against(bedEdge, stand, centre + s * (bedHalf + GAP + standHalf), 'nightstand')
    }
  }
  const dresser = get('dresser')
  if (dresser) {
    for (const edge of blankEdges(box)) {
      if (edge === bedEdge) continue
      const [lo, hi] = box.spanOf(edge)
      if (box.slideAgainst(edge, dresser, (lo + hi) / 2, 'dresser')) break
    }
  }
  // the primary's lounge chair, in a corner away from the bed
  const chair = get('lounge-chair')
  if (chair && box.room.primary && rng() < 0.7) {
    for (const edge of blankEdges(box)) {
      if (edge === bedEdge) continue
      const half = extents(chair, edgeYaw(edge))[edge === 'front' || edge === 'back' ? 'u' : 'v'] / 2
      for (const side of perpendicular(edge)) {
        if (box.against(edge, chair, box.cornerAlong(edge, side, half + GAP), 'lounge-chair')) return
      }
    }
  }
}

function furnishBath(box: RoomBox, get: Get, warnings: string[], trace: Trace, _rng: Rng): void {
  const doorEdges = EDGES.filter((e) => box.hasDoor(e))
  // The wet wall: the longest edge without a door (a window is fine — the
  // vanity sits under it), the end wall a door-free edge square to it, the
  // one farther from the door when both are free.
  const wet = [...EDGES]
    .filter((e) => !box.hasDoor(e))
    .sort((p, q) => box.lengthOf(q) - box.lengthOf(p))[0]
  if (!wet) {
    warnings.push(`furnishing: "${box.room.name}" has doors on every wall — no fixtures placed.`)
    return
  }
  const ends = perpendicular(wet).filter((e) => !box.hasDoor(e))
  const end =
    ends.find((e) => doorEdges.some((d) => opposite(d) === e)) ??
    ends.sort((p, q) => box.lengthOf(q) - box.lengthOf(p))[0] ??
    null
  trace(
    `${box.room.name}: wet wall ${wet} (${Math.round(box.lengthOf(wet))} in), end wall ${end ?? 'none'}, doors on ${doorEdges.join('/') || 'none'}`,
  )
  // Across the far end: the tub when the end wall takes its 92 in, else the
  // shower in the corner; with a door on both end walls the shower stands
  // on the wet wall itself, at its low end, and the toilet follows it.
  let bathed: Placed | null = null
  if (!end) {
    const shower = get('shower-square')
    if (shower) {
      const half = extents(shower, edgeYaw(wet))[wet === 'front' || wet === 'back' ? 'u' : 'v'] / 2
      bathed = box.slideAgainst(wet, shower, box.spanOf(wet)[0] + half, 'shower')
    }
  }
  if (end) {
    const tub = get('bathtub')
    const tubLen = tub ? tub.dimensions[0] * M_TO_IN : Number.POSITIVE_INFINITY
    if (tub && box.lengthOf(end) >= tubLen + 2) {
      const [lo, hi] = box.spanOf(end)
      bathed = box.slideAgainst(end, tub, (lo + hi) / 2, 'tub')
    }
    if (!bathed) {
      const shower = get('shower-square')
      if (shower) {
        // in the corner where the end wall meets the wet wall — the toilet
        // follows it along the wet wall, the vanity after that toward the door
        const half = extents(shower, edgeYaw(end))[end === 'front' || end === 'back' ? 'u' : 'v'] / 2
        const corner = box.cornerAlong(end, wet, half)
        bathed = box.slideAgainst(end, shower, corner, 'shower')
      }
    }
  }
  // Along the wet wall from the end: the toilet (its centre 18 in from what
  // stands at the end), then the vanity toward the door.
  const toilet = get('toilet')
  const axis = wet === 'front' || wet === 'back' ? 'u' : 'v'
  const [lo, hi] = box.spanOf(wet)
  const fromLow = end === null || end === 'left' || end === 'front'
  // what stands across the end only pushes the toilet along when it reaches
  // the wet wall (a tub does; a shower in the far corner does not)
  const reachesWet =
    bathed !== null &&
    (wet === 'front'
      ? bathed.rect.v0 <= box.inner.v0 + 1
      : wet === 'back'
        ? bathed.rect.v1 >= box.inner.v1 - 1
        : wet === 'left'
          ? bathed.rect.u0 <= box.inner.u0 + 1
          : bathed.rect.u1 >= box.inner.u1 - 1)
  const endLine =
    bathed && reachesWet
      ? fromLow
        ? axis === 'u'
          ? bathed.rect.u1
          : bathed.rect.v1
        : axis === 'u'
          ? bathed.rect.u0
          : bathed.rect.v0
      : fromLow
        ? lo
        : hi
  const dir = fromLow ? 1 : -1
  let cursor = endLine
  trace(
    `${box.room.name}: ${bathed ? `${bathed.role} ${end ? `across the ${end}` : `on the ${wet} wall`}` : 'no tub or shower'}, toilet from ${Math.round(endLine)} going ${dir > 0 ? 'up' : 'down'}`,
  )
  if (toilet) {
    const t = box.slideAgainst(wet, toilet, cursor + dir * TOILET_FROM_WALL, 'toilet')
    if (t) cursor = dir > 0 ? (axis === 'u' ? t.rect.u1 : t.rect.v1) : axis === 'u' ? t.rect.u0 : t.rect.v0
    else trace(`${box.room.name}: the toilet found no clear spot on the ${wet} wall`)
  }
  const vanity = get('bathroom-sink')
  if (vanity) {
    // the catalog's vanity is 72 in wide; where the wet wall has less, the
    // same piece narrowed to a stock width (48, 36, 30 in) — the node
    // carries the scale, the plan reads the real cabinet
    const fullIn = vanity.dimensions[0] * M_TO_IN
    const widths = [fullIn, 48, 36, 30].filter((w, i, all) => w <= fullIn && all.indexOf(w) === i)
    let placedVanity: Placed | null = null
    for (const w of widths) {
      const scaled: Sized = { ...vanity, dimensions: [w / M_TO_IN, vanity.dimensions[1], vanity.dimensions[2]] }
      const half = extents(scaled, edgeYaw(wet))[axis] / 2
      placedVanity = box.slideAgainst(wet, scaled, cursor + dir * (GAP + half), 'vanity')
      if (placedVanity) {
        if (w < fullIn - 1e-6) {
          placedVanity.scale = [w / fullIn, 1, 1]
          placedVanity.asset = vanity
          trace(`${box.room.name}: the vanity narrowed to ${Math.round(w)} in`)
        }
        break
      }
    }
    if (!placedVanity) {
      warnings.push(
        `furnishing: "${box.room.name}" — no vanity fits the wet wall even at 30 in; toilet and ${bathed ? bathed.role : 'bath'} placed, no vanity.`,
      )
    }
  }
}

/** Clear aisle either side of an island (NKBA: 42 in). */
const AISLE = 42

/**
 * THE KITCHEN. The run goes on a real wall — under a window with the sink
 * centred on it when a window wall has no door, else the longest door-free
 * wall — never on an open side of the room (an open edge is a doorway to
 * the furnisher, so the run cannot land in the middle of a great room).
 * Along the run from the sink: the dishwasher beside it, the range with
 * its hood over it, a counter, a cabinet; the fridge the other way then a
 * counter. Then, as the room allows and the roll decides: an island
 * parallel to the run with a 42 in aisle each side, and an L — a counter
 * and a cabinet turning the corner onto a door-free wall square to the run
 * (Steve, 2026-09-07: "better kitchen designs and layouts … check all the
 * fixtures and layouts, add more").
 */
function furnishKitchen(box: RoomBox, get: Get, warnings: string[], trace: Trace, rng: Rng): void {
  const withWindow = EDGES.filter((e) => box.windows(e).length > 0 && !box.hasDoor(e))
  const doorFree = EDGES.filter((e) => !box.hasDoor(e)).sort(
    (p, q) => box.lengthOf(q) - box.lengthOf(p),
  )
  const byFree = [...EDGES].sort((p, q) => {
    const fp = box.longestFree(p)
    const fq = box.longestFree(q)
    return (fq ? fq[1] - fq[0] : 0) - (fp ? fp[1] - fp[0] : 0)
  })
  const run = withWindow[0] ?? doorFree[0] ?? byFree[0]
  if (!run) return
  const span = box.longestFree(run)
  if (!span) {
    warnings.push(`furnishing: "${box.room.name}" has no clear wall for a kitchen run.`)
    return
  }
  const axisOf = (edge: PlanEdge) => (edge === 'front' || edge === 'back' ? 'u' : 'v')
  const axis = axisOf(run)
  trace(`${box.room.name}: run on the ${run} wall, free ${Math.round(span[0])}–${Math.round(span[1])}${box.windows(run).length > 0 ? ', under its window' : ''}`)
  const width = (a: Sized, edge: PlanEdge = run) => extents(a, edgeYaw(edge))[axisOf(edge)]
  const sink = get('kitchen')
  const stove = get('stove')
  const fridge = get('fridge')
  const counter = get('kitchen-counter')
  const cabinet = get('kitchen-cabinet')
  const dishwasher = get('dishwasher-movn72ls')
  const hood = get('hood')
  const island = get('wooden-kitchen-bar-moa2hhh4')
  const window = box.windows(run)[0]
  const roleOf = (piece: Sized) =>
    piece.id === 'kitchen' ? 'sink' : piece.id === 'dishwasher-movn72ls' ? 'dishwasher' : piece.id
  // Lay pieces back to back (a continuous run — no gap) along `edge` from
  // `from` in direction `dir`, stopping at `limit`; returns what did not fit.
  const lay = (
    edge: PlanEdge,
    pieces: (Sized | null)[],
    from: number,
    dir: 1 | -1,
    limit: number,
  ): Sized[] => {
    let cursor = from
    const left: Sized[] = []
    for (const piece of pieces) {
      if (!piece) continue
      const w = width(piece, edge)
      const along = cursor + (dir * w) / 2
      const past = dir > 0 ? along + w / 2 > limit + 1e-6 : along - w / 2 < limit - 1e-6
      const hit = past ? null : box.against(edge, piece, along, roleOf(piece), 0)
      if (!hit) {
        left.push(piece)
        continue
      }
      // the hood hangs over the range, 5 ft up
      if (piece.id === 'stove' && hood) box.float(hood, hit.centre, hit.yaw, 'hood', 1.55)
      cursor = along + (dir * w) / 2
    }
    return left
  }
  let placedAny = false
  // the wall square to the run at the end the dishwasher side reaches — where
  // a range that finds no room on the run turns the corner, so the sink, the
  // dishwasher and the range stay together
  let cornerWall: PlanEdge | null = null
  if (window && sink && span[0] <= window.a && span[1] >= window.b) {
    const centre = (window.a + window.b) / 2
    const s = box.slideAgainst(run, sink, centre, 'sink', span)
    if (s) {
      placedAny = true
      const sw = width(sink)
      // the longer side takes the dishwasher, the range and its counter; the
      // other the fridge then a counter — and what one side cannot take the
      // other tries
      const longerUp = span[1] - (centre + sw / 2) >= centre - sw / 2 - span[0]
      const first: [number, 1 | -1, number] = longerUp
        ? [centre + sw / 2, 1, span[1]]
        : [centre - sw / 2, -1, span[0]]
      const second: [number, 1 | -1, number] = longerUp
        ? [centre - sw / 2, -1, span[0]]
        : [centre + sw / 2, 1, span[1]]
      const rest = lay(run, [dishwasher, stove, counter, cabinet], ...first)
      lay(run, [fridge, ...rest, counter], ...second)
      const [nearLow, nearHigh] = perpendicular(run)
      cornerWall = longerUp ? nearHigh : nearLow
    }
  }
  if (!placedAny) {
    // from the corner: fridge, counter, sink, dishwasher, range, counter
    const before = box.placed.length
    lay(run, [fridge, counter, sink, dishwasher, stove, counter, cabinet], span[0], 1, span[1])
    placedAny = box.placed.length > before
  }
  if (!placedAny) warnings.push(`furnishing: "${box.room.name}" — no kitchen piece fits its walls.`)

  // THE L: a counter and a cabinet turn the corner onto a door-free wall
  // square to the run, from the corner the run reaches
  const legs = perpendicular(run).filter((e) => !box.hasDoor(e))
  const wantsL = rng() < 0.4
  for (const edge of legs) {
    if (!counter || !wantsL) break
    const free = box.freeSpans(edge)
    const corner = box.cornerAlong(edge, run, 0)
    const at = free.find((f) => f[0] - 1e-6 <= corner && corner <= f[1] + 1e-6)
    if (!at || at[1] - at[0] < 72) continue
    const dir: 1 | -1 = corner <= (at[0] + at[1]) / 2 ? 1 : -1
    // start past the run's own counter depth so the leg does not overlap the corner piece
    const runDepth = counter.dimensions[2] * M_TO_IN
    const from = corner + dir * runDepth
    const before = box.placed.length
    lay(edge, [counter, cabinet], from, dir, dir > 0 ? at[1] : at[0])
    if (box.placed.length > before) {
      trace(`${box.room.name}: an L — the leg on the ${edge} wall`)
      break
    }
  }

  // THE ISLAND: parallel to the run, a 42 in aisle each side, when the room
  // is deep enough and the roll says so
  if (island && counter && rng() < 0.7) {
    const counterDepth = counter.dimensions[2] * M_TO_IN
    const islandDepth = extents(island, edgeYaw(run))[axis === 'u' ? 'v' : 'u']
    const needed = counterDepth + AISLE + islandDepth + AISLE
    if (box.depthFrom(run) >= needed && span[1] - span[0] >= width(island) + 24) {
      const dist = counterDepth + AISLE + islandDepth / 2
      const mid = (span[0] + span[1]) / 2
      const centre: Pt =
        run === 'front'
          ? [mid, box.inner.v0 + dist]
          : run === 'back'
            ? [mid, box.inner.v1 - dist]
            : run === 'left'
              ? [box.inner.u0 + dist, mid]
              : [box.inner.u1 - dist, mid]
      // the island faces the room, its back to the run
      const hit = box.tryNear(island, centre, edgeYaw(opposite(run)), 'island', 12)
      if (hit) trace(`${box.room.name}: an island ${Math.round(AISLE)} in off the run`)
    }
  }

  // the fridge and the range that found no room on the run go on a wall
  // square to it, in the corner next to the run (an L)
  const roles = new Set(box.placed.map((p) => p.role))
  // the walled sides square to the run, the dishwasher's end first, then
  // door-free before doored (a door's swing is kept clear either way); an
  // open edge — no wall — never
  const cornerWalls: PlanEdge[] = (cornerWall
    ? [cornerWall, ...perpendicular(run).filter((e) => e !== cornerWall)]
    : [...perpendicular(run)]
  )
    .filter((e) => !box.isOpen(e))
    .sort((p, q) => (box.hasDoor(p) ? 1 : 0) - (box.hasDoor(q) ? 1 : 0))
  for (const piece of [fridge, stove]) {
    if (!piece || roles.has(piece.id)) continue
    let hit: Placed | null = null
    for (const edge of cornerWalls) {
      const half = extents(piece, edgeYaw(edge))[edge === 'front' || edge === 'back' ? 'u' : 'v'] / 2
      hit = box.slideAgainst(edge, piece, box.cornerAlong(edge, run, half), piece.id)
      if (hit) break
    }
    // last: anywhere along the run itself, past what stands there
    if (!hit) hit = box.slideAgainst(run, piece, (span[0] + span[1]) / 2, piece.id, span)
    if (!hit) {
      warnings.push(`furnishing: "${box.room.name}" — no wall takes the ${piece.id}; left out.`)
      continue
    }
    if (piece.id === 'stove' && hood) box.float(hood, hit.centre, hit.yaw, 'hood', 1.55)
  }
}

function furnishDining(box: RoomBox, get: Get, warnings: string[], trace: Trace, rng: Rng): void {
  const table = get('dining-table')
  if (!table) return
  const centre: Pt = [(box.inner.u0 + box.inner.u1) / 2, (box.inner.v0 + box.inner.v1) / 2]
  // the table's length runs the room's long way — or the other way when
  // only that fits; centred, or shifted off a door's swing
  const longWay = box.lengthOf('front') >= box.lengthOf('left') ? 0 : Math.PI / 2
  let yaw = longWay
  let placed = box.tryNear(table, centre, yaw, 'table')
  if (!placed) {
    yaw = longWay === 0 ? Math.PI / 2 : 0
    placed = box.tryNear(table, centre, yaw, 'table')
  }
  if (!placed) {
    warnings.push(`furnishing: "${box.room.name}" — the dining table does not fit.`)
    return
  }
  trace(`${box.room.name}: table ${yaw === 0 ? 'along' : 'across'} the front`)
  const chair = get('dining-chair')
  if (!chair) return
  const at = placed.centre
  const ext = extents(table, yaw)
  const cd = chair.dimensions[2] * M_TO_IN
  const cw = chair.dimensions[0] * M_TO_IN
  // two chairs a side along the long sides, facing the table
  const alongLong = yaw === 0 ? 'u' : 'v'
  const long = alongLong === 'u' ? ext.u : ext.v
  const short = alongLong === 'u' ? ext.v : ext.u
  const seats = long >= 2 * cw + 3 * GAP ? [-long / 4, long / 4] : [0]
  const off = short / 2 + 2 * GAP + cd / 2
  for (const side of [-1, 1]) {
    for (const s of seats) {
      const c: Pt =
        alongLong === 'u' ? [at[0] + s, at[1] + side * off] : [at[0] + side * off, at[1] + s]
      box.tryAt(chair, c, yawToward(c, alongLong === 'u' ? [c[0], at[1]] : [at[0], c[1]]), 'chair')
    }
  }
  // a sideboard on a blank wall, most houses
  const sideboard = get('cabinet')
  if (sideboard && rng() < 0.6) {
    for (const edge of blankEdges(box)) {
      const free = box.longestFree(edge)
      if (!free) continue
      if (box.slideAgainst(edge, sideboard, (free[0] + free[1]) / 2, 'sideboard', free)) break
    }
  }
}

function furnishLiving(box: RoomBox, get: Get, warnings: string[], trace: Trace, rng: Rng): void {
  const tv = get('tv-stand')
  const sofa = get('sofa')
  if (!tv || !sofa) return
  // the TV on a blank wall (interior first — the windows are on the exterior ones)
  let placedTv: Placed | null = null
  let tvEdge: PlanEdge | null = null
  for (const edge of blankEdges(box, (e) => (box.room.edges[e].exterior ? 8 : 0))) {
    const [lo, hi] = box.spanOf(edge)
    placedTv = box.slideAgainst(edge, tv, (lo + hi) / 2, 'tv')
    if (placedTv) {
      tvEdge = edge
      break
    }
  }
  if (!placedTv || !tvEdge) {
    warnings.push(`furnishing: "${box.room.name}" has no clear wall for the TV.`)
    return
  }
  trace(`${box.room.name}: TV on the ${tvEdge} wall`)
  const inward = inwardOf(tvEdge)
  const tvFront: Pt = [
    placedTv.centre[0] + (inward[0] * extents(tv, placedTv.yaw).u) / 2,
    placedTv.centre[1] + (inward[1] * extents(tv, placedTv.yaw).v) / 2,
  ]
  let placedSofa: Placed | null = null
  for (const dist of SOFA_DISTANCES) {
    const c: Pt = [tvFront[0] + inward[0] * dist, tvFront[1] + inward[1] * dist]
    placedSofa = box.tryAt(sofa, c, yawToward(c, placedTv.centre), 'sofa')
    if (placedSofa) break
  }
  if (!placedSofa) {
    warnings.push(`furnishing: "${box.room.name}" — no room for the sofa facing the TV.`)
    return
  }
  const coffee = get('coffee-table')
  const between: Pt = [
    (placedSofa.centre[0] + tvFront[0]) / 2,
    (placedSofa.centre[1] + tvFront[1]) / 2,
  ]
  // the carpet under the coffee table, first — it takes no floor
  const carpet = get('rectangular-carpet')
  if (carpet) box.float(carpet, between, placedSofa.yaw, 'carpet', 0)
  if (coffee) box.tryAt(coffee, between, placedSofa.yaw, 'coffee-table')
  // the television on its stand
  const television = get('television')
  if (television) {
    const standTop = placedTv.asset.dimensions[1]
    box.float(television, placedTv.centre, placedTv.yaw, 'television', standTop)
  }
  // a lamp at the sofa's end, on the side away from a door
  const lamp = get('floor-lamp')
  if (lamp) {
    const sofaExt = extents(sofa, placedSofa.yaw)
    const across: Pt = [-inward[1], inward[0]]
    const lampHalf = extents(lamp, placedSofa.yaw).u / 2
    for (const side of [1, -1]) {
      const c: Pt = [
        placedSofa.centre[0] + across[0] * side * (sofaExt.u / 2 + GAP + lampHalf),
        placedSofa.centre[1] + across[1] * side * (sofaExt.v / 2 + GAP + lampHalf),
      ]
      if (box.tryAt(lamp, c, placedSofa.yaw, 'lamp')) break
    }
  }
  // a fireplace on a blank exterior wall that is not the TV wall — half the houses
  const fireplace = get('fireplace-movn1fnn')
  if (fireplace && rng() < 0.5) {
    for (const edge of blankEdges(box, (e) => (box.room.edges[e].exterior ? -8 : 0))) {
      if (edge === tvEdge) continue
      const free = box.longestFree(edge)
      if (!free || free[1] - free[0] < 60) continue
      if (box.slideAgainst(edge, fireplace, (free[0] + free[1]) / 2, 'fireplace', free)) {
        trace(`${box.room.name}: a fireplace on the ${edge} wall`)
        break
      }
    }
  }
}

function furnishOffice(box: RoomBox, get: Get, warnings: string[], _trace: Trace, _rng: Rng): void {
  const desk = get('office-table')
  if (!desk) return
  let placed: Placed | null = null
  for (const edge of blankEdges(box, (e) => (box.windows(e).length > 0 ? -20 : 0))) {
    const window = box.windows(edge)[0]
    const [lo, hi] = box.spanOf(edge)
    placed = box.slideAgainst(edge, desk, window ? (window.a + window.b) / 2 : (lo + hi) / 2, 'desk')
    if (placed) break
  }
  if (!placed) {
    warnings.push(`furnishing: "${box.room.name}" has no clear wall for a desk.`)
    return
  }
  // the chair behind the desk, facing it
  const chair = get('office-chair')
  if (chair) {
    const deskEdge = EDGES.find((e) => Math.abs(edgeYaw(e) - placed.yaw) < 1e-6) ?? 'front'
    const inward = inwardOf(deskEdge)
    const deskDepth = extents(desk, placed.yaw).v
    const chairDepth = chair.dimensions[2] * M_TO_IN
    const c: Pt = [
      placed.centre[0] + inward[0] * (deskDepth / 2 + GAP + chairDepth / 2),
      placed.centre[1] + inward[1] * (deskDepth / 2 + GAP + chairDepth / 2),
    ]
    box.tryNear(chair, c, yawToward(c, placed.centre), 'office-chair', 12)
  }
  const shelf = get('bookshelf')
  if (shelf) {
    for (const edge of blankEdges(box)) {
      const [lo, hi] = box.spanOf(edge)
      if (box.slideAgainst(edge, shelf, (lo + hi) / 2, 'bookshelf')) break
    }
  }
}

/**
 * THE GARAGE: the car parked nose-in from the garage door, and the EV
 * charger on the wall beside it, 4 ft up.
 */
function furnishGarage(box: RoomBox, get: Get, _warnings: string[], trace: Trace, _rng: Rng): void {
  const car = get('tesla')
  if (!car) return
  // the garage door: the widest door on an exterior edge
  let doorEdge: PlanEdge | null = null
  let widest = 0
  for (const edge of EDGES) {
    for (const o of box.room.edges[edge].openings) {
      if (o.kind === 'door' && o.b - o.a > widest) {
        widest = o.b - o.a
        doorEdge = edge
      }
    }
  }
  if (!doorEdge) return
  // the car's nose toward the back wall: its length runs square to the door wall
  const yaw = edgeYaw(doorEdge)
  const inward = inwardOf(doorEdge)
  const [lo, hi] = box.spanOf(doorEdge)
  const along = (lo + hi) / 2
  const depth = box.depthFrom(doorEdge)
  const carLen = car.dimensions[2] * M_TO_IN
  const centre: Pt =
    doorEdge === 'front' || doorEdge === 'back'
      ? [along, (doorEdge === 'front' ? box.inner.v0 : box.inner.v1) + inward[1] * Math.min(depth / 2, 30 + carLen / 2)]
      : [(doorEdge === 'left' ? box.inner.u0 : box.inner.u1) + inward[0] * Math.min(depth / 2, 30 + carLen / 2), along]
  // the car ignores the door's swing zone — it drives through that door
  const rect = rectAround(centre, extents(car, yaw))
  if (inside(box.inner, rect) && !box.placed.some((p) => !p.floating && overlaps(rect, p.rect))) {
    box.placed.push({ asset: car, centre, yaw, rect, role: 'car' })
    trace(`${box.room.name}: the car nose-in from the ${doorEdge} door`)
  }
  const charger = get('ev-wall-charger')
  if (charger) {
    for (const edge of perpendicular(doorEdge)) {
      const free = box.longestFree(edge)
      if (!free) continue
      const half = extents(charger, edgeYaw(edge))[edge === 'front' || edge === 'back' ? 'u' : 'v'] / 2
      const c = box.centreOn(edge, charger, (free[0] + free[1]) / 2)
      void half
      box.float(charger, c, edgeYaw(edge), 'ev-charger', 1.2)
      break
    }
  }
}

function furnishLaundry(box: RoomBox, get: Get, warnings: string[], _trace: Trace, _rng: Rng): void {
  const washer = get('washing-machine')
  if (!washer) return
  for (const edge of blankEdges(box, (e) => (e === 'back' ? -2 : 0))) {
    const half = extents(washer, edgeYaw(edge))[edge === 'front' || edge === 'back' ? 'u' : 'v'] / 2
    const [lo] = box.spanOf(edge)
    if (box.slideAgainst(edge, washer, lo + half, 'washer')) return
  }
  warnings.push(`furnishing: "${box.room.name}" has no clear wall for the washer.`)
}

const RECIPES: Partial<
  Record<RoomKind, (box: RoomBox, get: Get, warnings: string[], trace: Trace, rng: Rng) => void>
> = {
  bed: furnishBedroom,
  bath: furnishBath,
  kitchen: furnishKitchen,
  dining: furnishDining,
  living: furnishLiving,
  office: furnishOffice,
  laundry: furnishLaundry,
  garage: furnishGarage,
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function furnishRooms(input: FurnishInput): FurnishResult {
  const warnings: string[] = []
  const get = lookup(input.catalog, warnings)
  const ops: FurnishOp[] = []
  let placed = 0
  for (const room of input.rooms) {
    const recipe = RECIPES[room.kind]
    if (!recipe) continue
    const box = new RoomBox(room)
    recipe(box, get, warnings, input.trace ?? (() => {}), input.rng ?? (() => 0.5))
    for (const p of box.placed) {
      const { tool: _tool, ...asset } = p.asset
      const [x, z] = input.toLocal(p.centre)
      placed += 1
      ops.push({
        node: {
          id: input.ids(),
          type: 'item',
          name: p.asset.name,
          parentId: input.levelId,
          position: [round(x), round(p.elevationM ?? 0), round(z)],
          rotation: [0, round(p.yaw, 6), 0],
          // the schema's default, written out so a headless reader (the sections
          // plugin's item boxes) sees the same node the store would
          scale: p.scale ?? [1, 1, 1],
          asset,
          metadata: {
            generatedBy: input.generatedBy,
            furnish: { room: room.name, kind: room.kind, role: p.role, ...(p.floating ? { floating: true } : {}) },
          },
        },
        parentId: input.levelId,
      })
    }
  }
  return { ops, warnings, placed }
}

