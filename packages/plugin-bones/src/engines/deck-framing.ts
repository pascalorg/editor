/**
 * Deck framing engine — a wood deck (a slab node the generator marks
 * `metadata.floor: 'deck'`: the porch or rear deck of a raised house) framed
 * the way PlanCrafters' `F.deck` frames it (Chief Architect's auto-deck
 * defaults), pure function of the deck slice, the level's walls and the
 * spec:
 *
 *   - the LEDGER on the house edge (the deck edge that lies on an exterior
 *     wall face): a PT board the joist size, every joist hung on it
 *     (R507.9 — the ledger connection is a Table R507.9.1.3(1) detail,
 *     cited on the member, not restated);
 *   - JOISTS spanning square to the ledger at the spec's spacing, sized
 *     from the joist span table (R507.6 governs deck joists — the floor
 *     table is the same species/size arithmetic; the label says so);
 *   - RIM joists on the three free edges;
 *   - a BEAM carrying the free end of the joists: DROPPED under them (4x8,
 *     16 in in from the free edge, Table R507.5(1) span cited) when the
 *     deck stands high enough for posts under it, else FLUSH — a second
 *     joist-size board doubled with the outer rim, the joists hung on it —
 *     the low-deck detail a deck a foot or so above grade actually gets;
 *   - 4x4 PT POSTS under the beam at both ends and ≤ 8 ft apart, down to
 *     the grade the caller passes (the foundation pours a pad under each —
 *     the same girder-post pad mechanism as the house). A deck whose frame
 *     reaches below grade even with a flush beam (a deck drawn off a slab
 *     house) gets no posts and a flag on every member.
 *
 * A deck with no wall on any edge is freestanding: beams at both ends of
 * the joist span, posts under both. Only quadrilateral decks are framed in
 * their own frame; any other outline frames its bounding box with a flag.
 * Members ride the `floor-framing` system so the Floor toggle shows them.
 */
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Member, SlabSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS, type LumberSize } from '../lumber'
import { joistSizeFor } from './floor-framing'
import { hangerFor, partLabel, postBaseFor, postCapFor } from './hardware'

type Pt = readonly [number, number]

/** A dropped beam sits this far in from the free outer edge (PlanCrafters BI = 16). */
export const DECK_BEAM_INSET = inches(16)
/** Posts at both beam ends (2 in in) and no more than 8 ft apart. */
export const DECK_POST_SPACING = inches(96)
/** The shortest post worth a post base (Simpson ABU/ABA need it); below this the beam goes flush. */
export const DECK_MIN_POST_HEIGHT = inches(6)
const DECK_POST_END_INSET = inches(2)
/** An edge whose midpoint is within this of an exterior wall centreline is the ledger edge. */
const LEDGER_TOLERANCE = 0.3
const EPS = 1e-9

export interface DeckFrame {
  /** Ledger edge index (the deck edge on the house), or null when freestanding. */
  ledgerEdge: number | null
  /** 'dropped' = 4x8 under the joists on posts; 'flush' = doubled rim; 'unsupported' = flagged, no posts. */
  beam: 'dropped' | 'flush' | 'unsupported'
  members: Member[]
}

function edgeMid(poly: readonly Pt[], i: number): Pt {
  const a = poly[i] as Pt
  const b = poly[(i + 1) % poly.length] as Pt
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/** Distance from a point to a wall's centreline segment. */
function distToWall(p: Pt, w: WallSlice): number {
  const [ax, az] = w.start
  const [bx, bz] = w.end
  const dx = bx - ax
  const dz = bz - az
  const dd = dx * dx + dz * dz
  if (dd < EPS) return Math.hypot(p[0] - ax, p[1] - az)
  const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / dd))
  return Math.hypot(p[0] - (ax + dx * t), p[1] - (az + dz * t))
}

/** The deck edge that lies on a wall (parallel within ~15°, midpoint within the tolerance), or null. */
export function ledgerEdgeOf(poly: readonly Pt[], walls: readonly WallSlice[]): number | null {
  let best: { i: number; d: number } | null = null
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt
    const b = poly[(i + 1) % poly.length] as Pt
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < EPS) continue
    const ux = (b[0] - a[0]) / len
    const uz = (b[1] - a[1]) / len
    const mid = edgeMid(poly, i)
    for (const w of walls) {
      if (w.curved) continue
      const d = distToWall(mid, w)
      if (d > LEDGER_TOLERANCE + w.thickness / 2) continue
      const sin = Math.abs(ux * w.dir[1] - uz * w.dir[0])
      if (sin > Math.sin((15 * Math.PI) / 180)) continue
      if (!best || d < best.d) best = { i, d }
    }
  }
  return best ? best.i : null
}

/**
 * Frame one deck. `gradeY` is the level-local height the posts stand on
 * (the crawl / yard grade for a ground-storey deck).
 */
export function frameDeck(
  slab: SlabSlice,
  walls: readonly WallSlice[],
  spec: FramingSpec = DEFAULT_SPEC,
  gradeY = 0,
): DeckFrame {
  const members: Member[] = []
  const poly = slab.polygon
  if (poly.length < 3) return { ledgerEdge: null, beam: 'unsupported', members }

  // The deck's own frame: u along the ledger edge (or the longest edge when
  // freestanding), v square to it pointing INTO the deck.
  const ledgerEdge = ledgerEdgeOf(poly, walls)
  let base = ledgerEdge
  if (base === null) {
    let longest = 0
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] as Pt
      const b = poly[(i + 1) % poly.length] as Pt
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len > longest) {
        longest = len
        base = i
      }
    }
  }
  const A = poly[base as number] as Pt
  const B = poly[((base as number) + 1) % poly.length] as Pt
  const eLen = Math.hypot(B[0] - A[0], B[1] - A[1])
  if (eLen < EPS) return { ledgerEdge: null, beam: 'unsupported', members }
  const U: Pt = [(B[0] - A[0]) / eLen, (B[1] - A[1]) / eLen]
  // centroid decides which perpendicular points into the deck
  let cx = 0
  let cz = 0
  for (const p of poly) {
    cx += p[0]
    cz += p[1]
  }
  cx /= poly.length
  cz /= poly.length
  let V: Pt = [-U[1], U[0]]
  if ((cx - A[0]) * V[0] + (cz - A[1]) * V[1] < 0) V = [U[1], -U[0]]
  // extents in the deck frame
  let u0 = Number.POSITIVE_INFINITY
  let u1 = Number.NEGATIVE_INFINITY
  let v1 = Number.NEGATIVE_INFINITY
  for (const p of poly) {
    const u = (p[0] - A[0]) * U[0] + (p[1] - A[1]) * U[1]
    const v = (p[0] - A[0]) * V[0] + (p[1] - A[1]) * V[1]
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v1 = Math.max(v1, v)
  }
  const width = u1 - u0
  const depth = v1
  if (width < inches(12) || depth < inches(12)) return { ledgerEdge, beam: 'unsupported', members }
  const freestanding = ledgerEdge === null

  // ---- sizes and the vertical datum ----
  const joistSize =
    joistSizeFor(depth, spec) ?? spec.joistSizes[spec.joistSizes.length - 1] ?? '2x12'
  const spanFlag = joistSizeFor(depth, spec)
    ? undefined
    : 'deck joist span past the table — verify per R507.6'
  const [t, d] = LUMBER_CROSS_SECTIONS[joistSize]
  const topY = slab.elevation - slab.thickness // joist tops, under the decking
  const centerY = topY - d / 2
  // The beam: dropped when a post of at least the minimum height fits under
  // a 4x8 below the joists; else flush with the joists (doubled rim); if even
  // the rim bottom is at or below grade there is nothing to stand on.
  const [bt4x8, bd4x8] = LUMBER_CROSS_SECTIONS['4x8']
  const dropped = topY - d - bd4x8 - gradeY >= DECK_MIN_POST_HEIGHT
  const beamSize: LumberSize = dropped ? '4x8' : joistSize
  const [beamThick, beamDepth] = dropped ? [bt4x8, bd4x8] : [t, d]
  const beamTop = dropped ? topY - d : topY
  const postTop = beamTop - beamDepth
  const postHeight = postTop - gradeY
  const canPost = postHeight >= DECK_MIN_POST_HEIGHT
  const beam: DeckFrame['beam'] = dropped ? 'dropped' : canPost ? 'flush' : 'unsupported'
  const flags = [
    poly.length !== 4
      ? 'deck outline is not a quadrilateral — framed as its bounding box; verify'
      : undefined,
    canPost
      ? undefined
      : `deck frame reaches below grade (${Math.round(-postHeight / inches(1))}" short of a post) — raise the deck or lower the grade; verify`,
  ].filter((f): f is string => f !== undefined)
  const flag = flags.length > 0 ? flags.join('; ') : undefined

  const at = (u: number, v: number, y: number): [number, number, number] => [
    A[0] + U[0] * u + V[0] * v,
    y,
    A[1] + U[1] * u + V[1] * v,
  ]
  // three.js Y rotation: local +x → world (cos θ, 0, −sin θ)
  const yawU = Math.atan2(-U[1], U[0])
  const yawV = Math.atan2(-V[1], V[0])
  const emit = (
    role: Member['role'],
    size: LumberSize | undefined,
    dims: [number, number, number],
    position: [number, number, number],
    yaw: number,
    length: number,
    material: Member['material'],
    label: string,
  ) => {
    members.push({
      system: 'floor-framing',
      role,
      size,
      dims,
      length,
      position,
      rotation: [0, yaw, 0],
      material,
      sourceId: slab.id,
      label,
      flag,
    })
  }
  const hangerAt = (u: number, v: number) =>
    emit(
      'hanger',
      undefined,
      [inches(3), d, inches(0.75)],
      at(u, v, centerY),
      yawU,
      inches(3),
      'steel',
      partLabel(hangerFor(joistSize), `${joistSize} PT deck joist`),
    )

  // ---- joists: span v, laid out along u ----
  // Between the ledger (or near rim) face and the far rim face — or the flush
  // beam's inner face, the joists hung on it, when the beam is doubled with
  // the rim. Freestanding + dropped: the joists cross both beams; freestanding
  // + flush: hung on both doubled rims.
  const flush = beam === 'flush'
  const jv0 = freestanding && flush ? 2 * t : t
  const jv1 = flush ? depth - 2 * t : depth - t
  const jLen = jv1 - jv0
  const stations: number[] = []
  for (let u = u0 + t / 2; u <= u1 - t / 2 + EPS; u += spec.joistSpacing) stations.push(u)
  if ((stations[stations.length - 1] ?? Number.NEGATIVE_INFINITY) < u1 - t / 2 - EPS)
    stations.push(u1 - t / 2)
  for (const u of stations) {
    emit(
      'joist',
      joistSize,
      [jLen, d, t],
      at(u, (jv0 + jv1) / 2, centerY),
      yawV,
      jLen,
      'pt-lumber',
      `Deck joist ${joistSize} PT @ ${Math.round(spec.joistSpacing / inches(1))}" o.c. (R507.6, Table R507.6)${spanFlag ? ` — ${spanFlag}` : ''}`,
    )
  }

  // ---- ledger or near rim, far rim, side rims ----
  if (!freestanding) {
    emit(
      'ledger',
      joistSize,
      [width, d, t],
      at((u0 + u1) / 2, t / 2, centerY),
      yawU,
      width,
      'pt-lumber',
      `Deck ledger ${joistSize} PT — fastened to the band joist / rim per Table R507.9.1.3(1), flashed (R507.9.1)`,
    )
    for (const u of stations) hangerAt(u, t + inches(0.75) / 2)
  } else {
    emit(
      'rim-joist',
      joistSize,
      [width, d, t],
      at((u0 + u1) / 2, t / 2, centerY),
      yawU,
      width,
      'pt-lumber',
      `Deck rim ${joistSize} PT`,
    )
  }
  emit(
    'rim-joist',
    joistSize,
    [width, d, t],
    at((u0 + u1) / 2, depth - t / 2, centerY),
    yawU,
    width,
    'pt-lumber',
    `Deck rim ${joistSize} PT`,
  )
  for (const u of [u0 + t / 2, u1 - t / 2]) {
    emit(
      'rim-joist',
      joistSize,
      [depth - 2 * t, d, t],
      at(u, depth / 2, centerY),
      yawV,
      depth - 2 * t,
      'pt-lumber',
      `Deck rim ${joistSize} PT`,
    )
  }

  // ---- the beam(s) and the posts to grade ----
  // Dropped: 16 in in from the free edge(s), under the joists. Flush /
  // unsupported: doubled with the outer rim(s), directly inside it.
  const farLine = dropped ? depth - DECK_BEAM_INSET : depth - t - t / 2
  const nearLine = dropped ? DECK_BEAM_INSET : t + t / 2
  const beamLines = freestanding ? [nearLine, farLine] : [farLine]
  const [pt, pw] = LUMBER_CROSS_SECTIONS['4x4']
  const bLen = dropped ? width - 2 * DECK_POST_END_INSET : width - 2 * t
  for (const bv of beamLines) {
    emit(
      'girder',
      beamSize,
      [bLen, beamDepth, beamThick],
      at((u0 + u1) / 2, bv, beamTop - beamDepth / 2),
      yawU,
      bLen,
      'pt-lumber',
      dropped
        ? 'Deck beam 4x8 PT, dropped — joists bear on it (span per Table R507.5(1), verify)'
        : `Deck flush beam ${joistSize} PT doubled with the rim — joists hung on it (span per Table R507.5(1), verify)`,
    )
    if (!dropped)
      for (const u of stations)
        hangerAt(u, bv + (bv < depth / 2 ? 1 : -1) * (t / 2 + inches(0.75) / 2))
    if (!canPost) continue
    const n = Math.max(2, Math.ceil(bLen / DECK_POST_SPACING) + 1)
    const p0 = (u0 + u1) / 2 - bLen / 2 + DECK_POST_END_INSET
    const span = bLen - 2 * DECK_POST_END_INSET
    for (let i = 0; i < n; i++) {
      const u = p0 + (span * i) / (n - 1)
      emit(
        'post',
        '4x4',
        [pt, postHeight, pw],
        at(u, bv, postTop - postHeight / 2),
        yawU,
        postHeight,
        'pt-lumber',
        'Deck post 4x4 PT to grade (Table R507.4) — on a pad footing, restrained at the base (R507.3, R507.4.1)',
      )
      // the base on the pad (R507.4.1 restraint) and, under a dropped beam, the cap
      emit(
        'post-base',
        undefined,
        [pt + inches(0.5), inches(1), pw + inches(0.5)],
        at(u, bv, gradeY + inches(0.5)),
        yawU,
        inches(1),
        'steel',
        partLabel(postBaseFor('4x4'), '4x4 PT deck post on its pad footing (R507.4.1)'),
      )
      if (dropped) {
        emit(
          'post-cap',
          undefined,
          [pt + inches(0.5), inches(2), beamThick + inches(0.5)],
          at(u, bv, postTop + inches(1)),
          yawU,
          inches(2),
          'steel',
          partLabel(postCapFor('4x4'), '4x4 PT deck post to the dropped 4x8 beam (R507.5.1)'),
        )
      }
    }
  }

  return { ledgerEdge, beam, members }
}
