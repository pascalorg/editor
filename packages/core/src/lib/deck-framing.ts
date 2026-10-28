import { DEFAULT_DECK_BOARDS, type DeckBoardSettings, deckJoistSpacingLimit } from './deck-boards'

/**
 * A wood deck's frame, planned once for the engine, which draws it under the deck's boards, and
 * for the framing plugin, which books, labels and cites it: a deck room's floor plate, or any
 * slab tagged `metadata.floor: 'deck'`. Framed to IRC R507:
 *
 *   - a LEDGER on the house edge (the deck edge along a house wall), the joist size;
 *   - JOISTS at the spacing (closer under diagonal boards, Table R507.7), sized from a span table:
 *     square to the house under boards that run along it or at 45°, along the house under boards
 *     that run out from it;
 *   - RIMS on every other edge, set in so the boards overhang them an inch (none at the house);
 *   - a BEAM under each edge the joists run out to that is no ledger: DROPPED 16 in in under the
 *     joists (a 4x8, the joists cantilevering past it) where the deck stands high enough for posts
 *     under it, else FLUSH, a second joist-size board doubled inside the rim, the joists hung on
 *     it; more beams between where the joists would span past the table. Joists along the house
 *     bear on beams square to it at both ends, as joists hung off a ledger cannot run that way;
 *   - 4x4 POSTS under each beam, at both ends and no more than 8 ft apart, down to the ground under
 *     each, unless posts already standing there to grade carry it (a porch cover's).
 *
 * Any outline frames along its edges: an L-shaped deck gets a rim on every edge and a beam under
 * each outer edge. Everything is level-local metres; a `yaw` is three.js's (local +x → world
 * (cos θ, −sin θ)), a piece's `dims` its length along its run, its height and its thickness.
 */

const IN = 0.0254
const FT = 12 * IN
const EPS = 1e-9

type P = readonly [number, number]
type V2 = [number, number]

/** A dropped beam sits this far in from the edge it carries (16 in), the joists cantilevering past it. */
export const DECK_BEAM_INSET = 16 * IN
/** Posts at both beam ends (2 in in) and no more than 8 ft apart. */
export const DECK_POST_SPACING = 96 * IN
/** The shortest post worth a post base (Simpson ABU/ABA need it); below this the beam goes flush. */
export const DECK_MIN_POST_HEIGHT = 6 * IN
/** A post's face stands this far in from its beam's end. */
export const DECK_POST_END_INSET = 2 * IN
/** The boards overhang the rim this much on a free edge; at the house they stop at the wall. */
export const DECK_BOARD_OVERHANG = 1 * IN
/** An edge whose midpoint is within this of a wall's face is on the house. */
const LEDGER_TOLERANCE = 0.3
/** A post standing within this of a beam's line carries it. */
const CARRIER_REACH = 12 * IN
const CARRIER_END_REACH = 6 * IN
/** The narrowest deck framed. */
const MIN_DECK = 12 * IN
/** A post shorter than this is not drawn: the beam sits on the ground there. */
const MIN_DRAWN_POST = 0.05
/** A hanger's seat: this far along the joist from its end. */
const HANGER_SEAT = 0.375 * IN

/** A stock section: its name, thickness (across) and depth (down), metres. */
export type DeckLumber = { size: string; thickness: number; depth: number }
/** A joist size and the most it spans. */
export type DeckJoistSpan = DeckLumber & { span: number }

/**
 * The joists a deck takes by the span they reach, first that spans: SPF #2 at 40 psf live, the
 * floor table's arithmetic (R502.3.1(2); IRC R507.6 governs deck joists), as the framing plugin's
 * default span table has them.
 */
export const DECK_JOIST_SPANS: readonly DeckJoistSpan[] = [
  { size: '2x8', thickness: 1.5 * IN, depth: 7.25 * IN, span: 12.25 * FT },
  { size: '2x10', thickness: 1.5 * IN, depth: 9.25 * IN, span: 15 * FT },
  { size: '2x12', thickness: 1.5 * IN, depth: 11.25 * IN, span: 17.4 * FT },
]
/** A dropped beam: a 4x8 (span per Table R507.5(1)). */
export const DECK_DROPPED_BEAM: DeckLumber = { size: '4x8', thickness: 3.5 * IN, depth: 7.25 * IN }
/** A deck post (Table R507.4). */
export const DECK_POST: DeckLumber = { size: '4x4', thickness: 3.5 * IN, depth: 3.5 * IN }

/** A wall a deck edge may bear on: its centreline and thickness. */
export type DeckWall = { start: P; end: P; thickness: number; curved?: boolean }

/**
 * A slab that is a wood deck, boards on a frame: a deck room's floor plate, or any slab tagged
 * `metadata.floor: 'deck'` as the framing plugin reads it (a generated deck).
 */
export function isDeckSlab(slab: { metadata?: unknown; recessed?: boolean }): boolean {
  return (slab.metadata as { floor?: unknown } | undefined)?.floor === 'deck' && !slab.recessed
}

const sub = (a: P, b: P): V2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1]
const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0]

function distanceToWall(p: P, wall: DeckWall): number {
  const [dx, dz] = sub(wall.end, wall.start)
  const dd = dx * dx + dz * dz
  if (dd < EPS) return Math.hypot(p[0] - wall.start[0], p[1] - wall.start[1])
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - wall.start[0]) * dx + (p[1] - wall.start[1]) * dz) / dd),
  )
  return Math.hypot(p[0] - (wall.start[0] + dx * t), p[1] - (wall.start[1] + dz * t))
}

/** How near edge `i` lies on a wall (parallel within 15°, its midpoint within the tolerance), or null. */
function wallDistance(polygon: readonly P[], i: number, walls: readonly DeckWall[]): number | null {
  const a = polygon[i]!
  const b = polygon[(i + 1) % polygon.length]!
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (length < EPS) return null
  const along: V2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
  const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let best: number | null = null
  for (const wall of walls) {
    if (wall.curved) continue
    const [dx, dz] = sub(wall.end, wall.start)
    const wallLength = Math.hypot(dx, dz)
    if (wallLength < EPS) continue
    const d = distanceToWall(mid, wall)
    if (d > LEDGER_TOLERANCE + wall.thickness / 2) continue
    if (Math.abs(cross(along, [dx / wallLength, dz / wallLength])) > Math.sin((15 * Math.PI) / 180))
      continue
    if (best === null || d < best) best = d
  }
  return best
}

/** The deck edge that lies on a wall (the nearest such), where the ledger goes; null when none does. */
export function deckLedgerEdge(polygon: readonly P[], walls: readonly DeckWall[]): number | null {
  let best: { i: number; d: number } | null = null
  for (let i = 0; i < polygon.length; i++) {
    const d = wallDistance(polygon, i, walls)
    if (d !== null && (!best || d < best.d)) best = { i, d }
  }
  return best ? best.i : null
}

/**
 * A deck's frame: `u` along its ledger edge (the longest edge of a deck standing free), `v`
 * square to it pointing into the deck, from the edge's first corner.
 */
export type DeckAxes = {
  /** The deck edge on the house, or null: the deck stands free. */
  ledgerEdge: number | null
  /** The edge the frame is squared to: the ledger edge, else the longest. */
  baseEdge: number
  origin: V2
  u: V2
  v: V2
}

export function deckAxes(polygon: readonly P[], walls: readonly DeckWall[]): DeckAxes | null {
  if (polygon.length < 3) return null
  const ledgerEdge = deckLedgerEdge(polygon, walls)
  let base = ledgerEdge ?? 0
  if (ledgerEdge === null) {
    let longest = 0
    for (let i = 0; i < polygon.length; i++) {
      const [dx, dz] = sub(polygon[(i + 1) % polygon.length]!, polygon[i]!)
      const length = Math.hypot(dx, dz)
      if (length > longest) {
        longest = length
        base = i
      }
    }
  }
  const a = polygon[base]!
  const [dx, dz] = sub(polygon[(base + 1) % polygon.length]!, a)
  const length = Math.hypot(dx, dz)
  if (length < EPS) return null
  const u: V2 = [dx / length, dz / length]
  // the vertex average decides which perpendicular points into the deck
  let cx = 0
  let cz = 0
  for (const p of polygon) {
    cx += p[0]
    cz += p[1]
  }
  cx /= polygon.length
  cz /= polygon.length
  let v: V2 = [-u[1], u[0]]
  if ((cx - a[0]) * v[0] + (cz - a[1]) * v[1] < 0) v = [u[1], -u[0]]
  return { ledgerEdge, baseEdge: base, origin: [a[0], a[1]], u, v }
}

export type DeckFramingInput = {
  /** The deck's outline, plan [x, z]. */
  polygon: readonly P[]
  /** Height of the walking surface: the boards' top. */
  top: number
  /** The boards' thickness: the joists' tops stand this far under `top`. */
  decking: number
  /** Walls a deck edge may lie on (the house's), for the ledger. */
  walls: readonly DeckWall[]
  /** How the boards run and what they are (`lib/deck-boards`): the joists follow. */
  boards?: DeckBoardSettings
  /** The joist spacing asked for, 16 in unless said; the boards may close it (Table R507.7). */
  joistSpacing?: number
  /** The joist sizes, first that spans (the framing plugin's span table): `DECK_JOIST_SPANS` unless said. */
  joists?: readonly DeckJoistSpan[]
  /** The ground the beam is chosen against: the grade under the deck's middle. */
  gradeY: number
  /** The ground under each post; absent, `gradeY` under every post. */
  gradeAt?: (x: number, z: number) => number
  /** Posts already standing to grade (a porch cover's): a beam line two of them stand on gets none of its own. */
  carriers?: readonly P[]
  /** How far the boards overhang the rims, `DECK_BOARD_OVERHANG` unless said. */
  overhang?: number
}

export type DeckPieceRole = 'ledger' | 'joist' | 'rim' | 'beam' | 'post'

/** One member: its stock, its centre, its `dims` ([run, height, across]) and its yaw. */
export type DeckPiece = {
  role: DeckPieceRole
  size: string
  position: [number, number, number]
  dims: [number, number, number]
  yaw: number
}

/** Where a joist end hangs in a hanger, on the ledger or a flush beam, and the yaw of what it hangs on. */
export type DeckHanger = { position: [number, number, number]; yaw: number }

export type DeckJoistPiece = DeckPiece & {
  role: 'joist'
  /** A joist on a rim's line (the end joist a side rim is): the rim stands in for it where it is drawn. */
  atRim: boolean
  hangers: DeckHanger[]
}

export type DeckBeamPiece = DeckPiece & {
  role: 'beam'
  /** Posts already standing to grade carry it (`carriers`): it gets none of its own. */
  carried: boolean
  /** One between the outer beams, where the joists would span past the table. */
  between: boolean
}

export type DeckPostPiece = DeckPiece & {
  role: 'post'
  /** The ground it stands on, where its footing is. */
  bottom: number
}

export type DeckBeamKind = 'dropped' | 'flush' | 'unsupported'

export type DeckFramingPlan = {
  axes: DeckAxes | null
  /** 'dropped' under the joists on posts, 'flush' doubled inside the rim, 'unsupported': no room for a post. */
  beam: DeckBeamKind
  joist: DeckJoistSpan | null
  /** Even its largest size spans short of the joists. */
  spanPastTable: boolean
  joistSpacing: number
  /** The spacing is closer than asked, for the boards (Table R507.7). */
  spacingForBoards: boolean
  /** The joists run along the house (the boards run out from it). */
  joistsAlongHouse: boolean
  /** The outline is no rectangle square to its frame: framed along its edges. */
  irregular: boolean
  /** The beam's lumber: a 4x8 dropped, the joist size flush. */
  beamLumber: DeckLumber | null
  /** The joists' tops, the beams' and the posts' (under the beams). */
  joistTop: number
  beamTop: number
  postTop: number
  /** The posts' height over `gradeY`: under `DECK_MIN_POST_HEIGHT`, no post fits. */
  postHeight: number
  /** The way the joists are laid out, a plan unit vector, and their stations along it from `axes.origin`. */
  stationAxis: V2 | null
  stations: number[]
  ledger: DeckPiece | null
  rims: DeckPiece[]
  joists: DeckJoistPiece[]
  beams: DeckBeamPiece[]
  posts: DeckPostPiece[]
}

/** The outline with each edge moved in by its offset (signed area kept), or null when that collapses it. */
function insetEdges(polygon: readonly P[], offsets: readonly number[]): V2[] | null {
  const n = polygon.length
  let twice = 0
  for (let i = 0; i < n; i++) twice += cross(polygon[i]!, polygon[(i + 1) % n]!)
  const sign = twice > 0 ? 1 : -1
  const lines = polygon.map((a, i) => {
    const [dx, dz] = sub(polygon[(i + 1) % n]!, a)
    const length = Math.hypot(dx, dz) || 1
    const e: V2 = [dx / length, dz / length]
    const inward: V2 = sign > 0 ? [-e[1], e[0]] : [e[1], -e[0]]
    const d = offsets[i] ?? 0
    return { p: [a[0] + inward[0] * d, a[1] + inward[1] * d] as V2, e }
  })
  const inset = polygon.map((_, i): V2 => {
    const before = lines[(i - 1 + n) % n]!
    const after = lines[i]!
    const turn = cross(before.e, after.e)
    if (Math.abs(turn) < 1e-9) return after.p
    const t = cross(sub(after.p, before.p), after.e) / turn
    return [before.p[0] + before.e[0] * t, before.p[1] + before.e[1] * t]
  })
  let insetTwice = 0
  for (let i = 0; i < n; i++) insetTwice += cross(inset[i]!, inset[(i + 1) % n]!)
  return insetTwice * sign > 0.5 * Math.abs(twice) ? inset : null
}

/** The outline without repeated corners. */
function cleanOutline(polygon: readonly P[]): V2[] {
  const out: V2[] = []
  for (const p of polygon) {
    const last = out.at(-1)
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push([p[0], p[1]])
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0]![0] - out.at(-1)![0], out[0]![1] - out.at(-1)![1]) <= 1e-6
  )
    out.pop()
  return out
}

export function planDeckFraming(input: DeckFramingInput): DeckFramingPlan {
  const boards = input.boards ?? DEFAULT_DECK_BOARDS
  const asked = input.joistSpacing ?? 16 * IN
  const spacing = Math.min(asked, deckJoistSpacingLimit(boards))
  const joistsAlongHouse = boards.direction === 'perpendicular'
  const ladder = input.joists?.length ? input.joists : DECK_JOIST_SPANS
  const joistTop = input.top - input.decking
  const plan: DeckFramingPlan = {
    axes: null,
    beam: 'unsupported',
    joist: null,
    spanPastTable: false,
    joistSpacing: spacing,
    spacingForBoards: spacing < asked - EPS,
    joistsAlongHouse,
    irregular: false,
    beamLumber: null,
    joistTop,
    beamTop: joistTop,
    postTop: joistTop,
    postHeight: 0,
    stationAxis: null,
    stations: [],
    ledger: null,
    rims: [],
    joists: [],
    beams: [],
    posts: [],
  }
  const outline = cleanOutline(input.polygon)
  if (outline.length < 3) return plan
  const axes = deckAxes(outline, input.walls)
  if (!axes) return plan
  plan.axes = axes
  const n = outline.length
  const ledgerEdge = axes.ledgerEdge

  // ---- the frame's outline: the free edges in by the boards' overhang ----
  const overhang = input.overhang ?? DECK_BOARD_OVERHANG
  const offsets = outline.map((_, i) =>
    wallDistance(outline, i, input.walls) === null ? overhang : 0,
  )
  const frame = insetEdges(outline, offsets) ?? outline
  // Frame coordinates: s along the joists' layout (stations), j along the joists.
  const S = joistsAlongHouse ? axes.v : axes.u
  const J = joistsAlongHouse ? axes.u : axes.v
  const [ox, oz] = axes.origin
  const toFrame = (p: P): V2 => [
    (p[0] - ox) * S[0] + (p[1] - oz) * S[1],
    (p[0] - ox) * J[0] + (p[1] - oz) * J[1],
  ]
  const toPlan = (s: number, j: number): V2 => [ox + S[0] * s + J[0] * j, oz + S[1] * s + J[1] * j]
  const yawOf = (s: number, j: number) => {
    const x = S[0] * s + J[0] * j
    const z = S[1] * s + J[1] * j
    return Math.atan2(-z, x)
  }
  const yawS = yawOf(1, 0)
  const yawJ = yawOf(0, 1)
  const fq = frame.map(toFrame)
  let twice = 0
  for (let i = 0; i < n; i++) twice += cross(fq[i]!, fq[(i + 1) % n]!)
  const ccw = twice > 0
  const edges = fq.map((a, i) => {
    const b = fq[(i + 1) % n]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const e: V2 = length > EPS ? [(b[0] - a[0]) / length, (b[1] - a[1]) / length] : [1, 0]
    const inward: V2 = ccw ? [-e[1], e[0]] : [e[1], -e[0]]
    // An 'end' edge runs across the joists: they run out to it. A 'side' edge runs with them.
    const kind: 'end' | 'side' = Math.abs(e[0]) >= Math.abs(e[1]) ? 'end' : 'side'
    return { a, b, e, inward, length, kind }
  })
  let sMin = Number.POSITIVE_INFINITY
  let sMax = Number.NEGATIVE_INFINITY
  let jMin = Number.POSITIVE_INFINITY
  let jMax = Number.NEGATIVE_INFINITY
  for (const [s, j] of fq) {
    sMin = Math.min(sMin, s)
    sMax = Math.max(sMax, s)
    jMin = Math.min(jMin, j)
    jMax = Math.max(jMax, j)
  }
  if (sMax - sMin < MIN_DECK || jMax - jMin < MIN_DECK) return plan
  plan.irregular =
    n !== 4 || edges.some((edge) => Math.min(Math.abs(edge.e[0]), Math.abs(edge.e[1])) > 1e-6)

  // ---- the joists: sized for the span between their supports, beams between past the table ----
  // A ledger carries the joists' house ends unless they run along it.
  const hung = ledgerEdge !== null && !joistsAlongHouse
  const near = hung ? jMin : jMin + DECK_BEAM_INSET
  const far = jMax - DECK_BEAM_INSET
  const run = Math.max(far - near, 0)
  const longest = ladder.at(-1)!
  const bays = Math.max(1, Math.ceil(run / longest.span - 1e-9))
  const joist = ladder.find((size) => run / bays <= size.span + EPS) ?? longest
  plan.joist = joist
  plan.spanPastTable = run / bays > longest.span + EPS
  const t = joist.thickness
  const d = joist.depth
  const centerY = joistTop - d / 2

  // ---- the beam: dropped where a post fits under a 4x8 under the joists, else flush ----
  const dropped = joistTop - d - DECK_DROPPED_BEAM.depth - input.gradeY >= DECK_MIN_POST_HEIGHT
  const beamLumber: DeckLumber = dropped ? DECK_DROPPED_BEAM : joist
  const beamTop = dropped ? joistTop - d : joistTop
  const postTop = beamTop - beamLumber.depth
  const postHeight = postTop - input.gradeY
  const canPost = postHeight >= DECK_MIN_POST_HEIGHT
  plan.beam = dropped ? 'dropped' : canPost ? 'flush' : 'unsupported'
  plan.beamLumber = beamLumber
  plan.beamTop = beamTop
  plan.postTop = postTop
  plan.postHeight = postHeight

  const pieceAt = (
    role: DeckPieceRole,
    size: string,
    s: number,
    j: number,
    y: number,
    dims: [number, number, number],
    yaw: number,
  ): DeckPiece => {
    const [x, z] = toPlan(s, j)
    return { role, size, position: [x, y, z], dims, yaw }
  }
  // A run along an edge direction, its yaw taken along +s or +j, as the frame's own axes are.
  const runYaw = (e: V2) => {
    const flip = Math.abs(e[0]) >= Math.abs(e[1]) ? e[0] < 0 : e[1] < 0
    return flip ? yawOf(-e[0], -e[1]) : yawOf(e[0], e[1])
  }
  const isConvex = (i: number) => {
    const turn = cross(edges[(i - 1 + n) % n]!.e, edges[i]!.e)
    return ccw ? turn > 1e-9 : turn < -1e-9
  }
  const isReflex = (i: number) => {
    const turn = cross(edges[(i - 1 + n) % n]!.e, edges[i]!.e)
    return ccw ? turn < -1e-9 : turn > 1e-9
  }

  // ---- the ledger and the rims: one along every edge, a board the joist size inside it ----
  // Where an end edge meets a side edge, the end's board runs to the corner and the side's stops at
  // it (at an inside corner the end's runs on past it), so the corners close.
  for (let i = 0; i < n; i++) {
    const edge = edges[i]!
    const prev = edges[(i - 1 + n) % n]!
    const next = edges[(i + 1) % n]!
    const startTrim =
      edge.kind === 'side' && prev.kind === 'end' && isConvex(i)
        ? t
        : edge.kind === 'end' && prev.kind === 'side' && isReflex(i)
          ? -t
          : 0
    const j1 = (i + 1) % n
    const endTrim =
      edge.kind === 'side' && next.kind === 'end' && isConvex(j1)
        ? t
        : edge.kind === 'end' && next.kind === 'side' && isReflex(j1)
          ? -t
          : 0
    const length = edge.length - startTrim - endTrim
    if (length < t) continue
    const mid = startTrim + length / 2
    const s = edge.a[0] + edge.e[0] * mid + edge.inward[0] * (t / 2)
    const j = edge.a[1] + edge.e[1] * mid + edge.inward[1] * (t / 2)
    const piece = pieceAt(
      i === ledgerEdge ? 'ledger' : 'rim',
      joist.size,
      s,
      j,
      centerY,
      [length, d, t],
      runYaw(edge.e),
    )
    if (i === ledgerEdge) plan.ledger = piece
    else plan.rims.push(piece)
  }

  // ---- the beams: under each end edge the joists run out to, and between past the table ----
  type BeamLine = {
    /** The beam's centreline, frame coordinates, its full run inside the frame. */
    from: V2
    to: V2
    /** Its own edge, or null for one between. */
    edge: number | null
    yaw: number
    thickness: number
  }
  const lines: BeamLine[] = []
  const inset = dropped ? DECK_BEAM_INSET : t + t / 2
  edges.forEach((edge, i) => {
    if (edge.kind !== 'end' || i === ledgerEdge) return
    const offset: V2 = [edge.inward[0] * inset, edge.inward[1] * inset]
    lines.push({
      from: [edge.a[0] + offset[0], edge.a[1] + offset[1]],
      to: [edge.b[0] + offset[0], edge.b[1] + offset[1]],
      edge: i,
      yaw: runYaw(edge.e),
      thickness: dropped ? beamLumber.thickness : t,
    })
  })
  // The beams between: lines across the frame at even spacing, where it lies across them.
  const middles: number[] = []
  if (bays > 1) {
    const first = hung ? jMin : jMin + inset
    const last = jMax - inset
    for (let k = 1; k < bays; k++) middles.push(first + ((last - first) * k) / bays)
  }
  /** Where the frame lies across the line j = `j`: [s0, s1] runs, with the edges they end on. */
  const across = (j: number) => {
    const hits: Array<{ s: number; edge: number }> = []
    edges.forEach((edge, i) => {
      const { a, b } = edge
      if ((a[1] <= j && j < b[1]) || (b[1] <= j && j < a[1]))
        hits.push({ s: a[0] + ((j - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), edge: i })
    })
    hits.sort((p, q) => p.s - q.s)
    const runs: Array<[number, number]> = []
    for (let k = 0; k + 1 < hits.length; k += 2) runs.push([hits[k]!.s, hits[k + 1]!.s])
    return runs
  }
  for (const j of middles)
    for (const [s0, s1] of across(j))
      lines.push({
        from: [s0, j],
        to: [s1, j],
        edge: null,
        yaw: yawS,
        thickness: dropped ? beamLumber.thickness : 2 * t,
      })

  const carriers = (input.carriers ?? []).map(toFrame)
  const endInset = dropped ? DECK_POST_END_INSET : t
  for (const line of lines) {
    const dir = sub(line.to, line.from)
    const full = Math.hypot(dir[0], dir[1])
    if (full < EPS) continue
    const e: V2 = [dir[0] / full, dir[1] / full]
    const length = full - 2 * endInset
    if (length < DECK_POST.thickness) continue
    const mid: V2 = [(line.from[0] + line.to[0]) / 2, (line.from[1] + line.to[1]) / 2]
    const carried =
      carriers.filter((c) => {
        const along = dot(sub(c, line.from), e)
        return (
          Math.abs(cross(e, sub(c, line.from))) <= CARRIER_REACH &&
          along >= -CARRIER_END_REACH &&
          along <= full + CARRIER_END_REACH
        )
      }).length >= 2
    const beam = pieceAt(
      'beam',
      beamLumber.size,
      mid[0],
      mid[1],
      beamTop - beamLumber.depth / 2,
      [length, beamLumber.depth, line.thickness],
      line.yaw,
    ) as DeckBeamPiece
    beam.carried = carried
    beam.between = line.edge === null
    plan.beams.push(beam)
    if (!canPost || carried) continue
    const count = Math.max(2, Math.ceil(length / DECK_POST_SPACING) + 1)
    const span = length - 2 * DECK_POST_END_INSET
    for (let k = 0; k < count; k++) {
      const along = -length / 2 + DECK_POST_END_INSET + (span * k) / (count - 1)
      const s = mid[0] + e[0] * along
      const j = mid[1] + e[1] * along
      const [x, z] = toPlan(s, j)
      const bottom = input.gradeAt ? input.gradeAt(x, z) : input.gradeY
      const height = postTop - bottom
      if (!(height >= MIN_DRAWN_POST)) continue
      plan.posts.push({
        role: 'post',
        size: DECK_POST.size,
        position: [x, postTop - height / 2, z],
        dims: [DECK_POST.thickness, height, DECK_POST.depth],
        yaw: line.yaw,
        bottom,
      })
    }
  }

  // ---- the joists: at the spacing from one side to the other, each run between its supports ----
  const flushEdges = new Set(
    dropped ? [] : lines.flatMap((line) => (line.edge === null ? [] : [line.edge])),
  )
  const stations: number[] = []
  for (let k = 0; ; k++) {
    const s = sMin + t / 2 + k * spacing
    if (s > sMax - t / 2 + EPS) break
    stations.push(s)
  }
  if ((stations.at(-1) ?? Number.NEGATIVE_INFINITY) < sMax - t / 2 - EPS)
    stations.push(sMax - t / 2)
  plan.stationAxis = [S[0], S[1]]
  plan.stations = stations
  // A station on a side edge's board: the rim (or a ledger along the joists) is that joist.
  const sideRims = edges.filter((edge) => edge.kind === 'side' && Math.abs(edge.e[0]) < 1e-6)
  for (const s of stations) {
    const hits: Array<{ j: number; edge: number }> = []
    edges.forEach((edge, i) => {
      const { a, b } = edge
      if ((a[0] <= s && s < b[0]) || (b[0] <= s && s < a[0]))
        hits.push({ j: a[1] + ((s - a[0]) * (b[1] - a[1])) / (b[0] - a[0]), edge: i })
    })
    hits.sort((p, q) => p.j - q.j)
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const lo = hits[k]!
      const hi = hits[k + 1]!
      // in past the board on the edge each end meets: the rim, the ledger, a flush beam's two
      const band = (edge: number) => {
        const thick = flushEdges.has(edge) ? 2 * t : t
        return thick / Math.max(Math.abs(edges[edge]!.inward[1]), 0.3)
      }
      const hangsOn = (edge: number) => edge === ledgerEdge || flushEdges.has(edge)
      const segments: Array<{
        j0: number
        j1: number
        hung0: boolean
        hung1: boolean
        yaw0: number
        yaw1: number
      }> = [
        {
          j0: lo.j + band(lo.edge),
          j1: hi.j - band(hi.edge),
          hung0: hangsOn(lo.edge),
          hung1: hangsOn(hi.edge),
          yaw0: runYaw(edges[lo.edge]!.e),
          yaw1: runYaw(edges[hi.edge]!.e),
        },
      ]
      // a flush beam between cuts the run: the joists hang on both its faces
      if (!dropped)
        for (const j of middles) {
          const at = segments.findIndex((seg) => j - t > seg.j0 + EPS && j + t < seg.j1 - EPS)
          if (at < 0) continue
          const seg = segments[at]!
          segments.splice(
            at,
            1,
            { ...seg, j1: j - t, hung1: true, yaw1: yawS },
            { ...seg, j0: j + t, hung0: true, yaw0: yawS },
          )
        }
      const atRim = sideRims.some(
        (edge) =>
          Math.abs(s - edge.a[0]) < t - EPS &&
          Math.max(edge.a[1], edge.b[1]) > lo.j + EPS &&
          Math.min(edge.a[1], edge.b[1]) < hi.j - EPS,
      )
      for (const seg of segments) {
        const length = seg.j1 - seg.j0
        if (length < t) continue
        const piece = pieceAt(
          'joist',
          joist.size,
          s,
          (seg.j0 + seg.j1) / 2,
          centerY,
          [length, d, t],
          yawJ,
        ) as DeckJoistPiece
        piece.atRim = atRim
        piece.hangers = []
        const hanger = (j: number, yaw: number) => {
          const [x, z] = toPlan(s, j)
          piece.hangers.push({ position: [x, centerY, z], yaw })
        }
        if (seg.hung0) hanger(seg.j0 + HANGER_SEAT, seg.yaw0)
        if (seg.hung1) hanger(seg.j1 - HANGER_SEAT, seg.yaw1)
        plan.joists.push(piece)
      }
    }
  }
  return plan
}
