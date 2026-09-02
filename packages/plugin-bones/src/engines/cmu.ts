/**
 * CMU (concrete masonry unit) wall engine — Florida-style exterior block
 * wall. Pure function: one WallSlice + FramingSpec → the running-bond block
 * coursing that REPLACES stud framing for that wall (system stays
 * 'wall-framing' so visibility/color toggles treat it as the wall system):
 *
 *   8x8x16 blocks in running bond · half-block starters on odd courses ·
 *   first/last blocks cut to the wall length · blocks cut tight to opening
 *   jambs · precast lintel over each opening (8" bearing per side) · a
 *   grouted + reinforced bond beam as the top course · grouted vertical
 *   cells (with rebar) at both wall ends.
 *
 * Real-world basis:
 *  - Standard CMU is nominally 8"h × 16"l × 8"d; actual faces are 3/8" less
 *    (7-5/8" × 15-5/8") so units + mortar joints hit the 8"/16" module
 *    (ASTM C90). We model that literally: nominal grid, blocks shrunk 3/8"
 *    in length/height so the mortar joints read visually WITHOUT emitting
 *    thousands of mortar members.
 *  - Running bond (head joints offset half a unit each course) is the
 *    prescriptive masonry pattern (TMS 402 / IRC R606).
 *  - Reinforced bond beam at the top of the wall — the Florida "tie beam"
 *    (FBC/ACI 530 high-wind practice): top course grouted solid with
 *    horizontal rebar to collect uplift/diaphragm loads.
 *  - Precast concrete lintels over openings with ≥8" bearing each side
 *    (manufacturer minimum, FBC R606.10 / ACI 530 bearing practice).
 *  - Vertical reinforcing in grouted cells (IRC R606.12 / FBC wind
 *    provisions): #5 bars at wall ends/corners, at opening jambs, and in the
 *    field at 48" o.c., each hooked into the bond beam. Cells a bar passes
 *    through are grouted solid — blocks keep role 'block' (purchasable
 *    units); the label marks the grout so a grout/rebar line can be derived.
 *  - Corner interlock (running bond THROUGH corners, TMS 402): at a shared
 *    corner the two walls alternate per course — one lays through to the
 *    neighbor's far face, the other stops short of the through wall's face —
 *    so no two blocks ever occupy the same corner volume.
 *
 * Geometry convention copied from wall-framing.ts: wall-local frame with X
 * along the wall from `start`, Y up, Z across the thickness; every member is
 * an axis-aligned box in that frame and shares one Y rotation (`yaw`).
 */

import type { FramingSpec } from '../core/spec'
import type { Member, OpeningSlice, WallSlice } from '../core/types'
import { formatIn, inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import { openingSpans } from './electrical'
import { anchorBoltPositions } from './foundation'
import { detectCorners, detectTees, fitAcross, frameWall, studSizeFor } from './wall-framing'

const EPS = 1e-6

// ---------------------------------------------------------------------------
// The 8" module (exported so tests + takeoff refinements share one truth)
// ---------------------------------------------------------------------------

/** Nominal course height — 8" block + bed joint (ASTM C90 module). */
export const COURSE_HEIGHT = inches(8) // 0.2032 m
/** Nominal block length — 16" block + head joint. */
export const BLOCK_LENGTH = inches(16) // 0.4064 m
/** Actual (manufactured) block depth — 7-5/8" for a nominal 8" unit. */
export const BLOCK_DEPTH_ACTUAL = inches(7.625)
/**
 * Face bury — how far every block face sits strictly INSIDE the host wall's
 * drawn face planes (the DUCT_JUNCTION_BURY precedent, hvac.ts). CONSTRAINT:
 * the host draws its wall skin at ±thickness/2; a block face landing exactly
 * on that plane z-fights the host face the moment the host face renders
 * opaque — the plugin's 'down' wall mode keeps the host face depth-silent,
 * but PAINTING a material onto a Bones CMU wall resurrects an opaque host
 * face (prod report 2026-08-23: painted CMU walls flicker/"display both
 * textures at once", camera-angle dependent). Block outer faces must
 * therefore never contest the depth buffer with the drawn wall: they stop
 * CMU_FACE_BURY inside each drawn face plane, in every mode and paint state.
 */
export const CMU_FACE_BURY = 0.005
/** Canonical thin-wall bury flag (gates grep it) — rides the bond beam. */
export const THIN_BURY_FLAG =
  'wall too thin for the CMU face bury — blocks floored at half the drawn thickness; verify'
/** Standard mortar joint — 3/8". Blocks shrink by this so joints read in 3D. */
export const MORTAR_JOINT = inches(0.375)
/** Precast lintel: nominal 8" tall (one course), bears 8" past each jamb. */
export const LINTEL_HEIGHT = inches(8)
export const LINTEL_BEARING = inches(8)
/** #5 vertical / bond-beam bar — 5/8" diameter, drawn as a square section. */
export const REBAR_SIZE = inches(0.625)
/** Field spacing for vertical bars in grouted cells (FBC high-wind typical). */
export const VERT_BAR_SPACING = inches(48)
/** Center of the first cell in from a wall end / opening jamb (8" cell). */
export const CELL_CENTER = inches(4)
/** Clear cover for bond-beam bars off the block faces. */
const BAR_CLEAR = inches(2)

/**
 * Smallest piece a mason will cut and lay. Slivers below this are dropped
 * rather than rendered as unbuildable chips.
 * ASSUMPTION: 2" minimum piece; a real crew would shift head joints or thicken
 * a jamb joint instead of leaving the tiny gap this drop creates.
 */
const MIN_PIECE = inches(2)

// ---------------------------------------------------------------------------
// Wall frame (same yaw/place math as wall-framing.ts)
// ---------------------------------------------------------------------------

type WallFrame = {
  yaw: number
  /** Map wall-local (u, y, v) → level-local position. */
  place: (u: number, y: number, v?: number) => [number, number, number]
}

function frameOf(wall: WallSlice): WallFrame {
  const [dx, dz] = wall.dir
  const [sx, sz] = wall.start
  // Rotating a +X-aligned box by yaw about Y maps +X → [cos, 0, -sin];
  // we need +X → [dx, 0, dz], hence yaw = atan2(-dz, dx).
  const yaw = Math.atan2(-dz, dx)
  return {
    yaw,
    place: (u, y, v = 0) => [sx + dx * u - dz * v, y, sz + dz * u + dx * v],
  }
}

// ---------------------------------------------------------------------------
// Coursing math (exported for direct unit testing, like studPositions)
// ---------------------------------------------------------------------------

/** Whole 8" courses that fit under a height (EPS guards exact-fit floats). */
export function courseCount(height: number): number {
  return Math.floor(height / COURSE_HEIGHT + EPS)
}

/**
 * Snap a requested CMU-zone height to whole courses (ASTM C90 module,
 * IRC R606 coursing): nearest course multiple, clamped to [1 course, all
 * the courses that fit under the wall]. The UI height slider and the mixed
 * wall engine share this one truth. Returns 0 when the wall is shorter
 * than a single course (nothing to lay).
 */
export function snapCmuHeight(requestedM: number, wallHeight: number): number {
  const total = courseCount(wallHeight)
  if (total < 1 || !Number.isFinite(requestedM)) return 0
  const courses = Math.min(total, Math.max(1, Math.round(requestedM / COURSE_HEIGHT)))
  return courses * COURSE_HEIGHT
}

/** A block's raw extent [a, b] along the wall, BEFORE the mortar shrink. */
export type BlockInterval = { a: number; b: number }

/**
 * Block layout for one course: full 16" units from the start, with the first
 * unit halved on odd courses (running bond) and the last unit cut to the wall
 * length. Pieces shorter than MIN_PIECE are dropped.
 */
export function courseIntervals(length: number, oddCourse: boolean): BlockInterval[] {
  const out: BlockInterval[] = []
  let u = 0
  if (oddCourse) {
    // Running bond: odd courses start with a half block so every head joint
    // lands mid-unit on the course below (TMS 402 running-bond definition).
    const b = Math.min(BLOCK_LENGTH / 2, length)
    if (b - u >= MIN_PIECE - EPS) out.push({ a: u, b })
    u = b
  }
  while (u < length - EPS) {
    const b = Math.min(u + BLOCK_LENGTH, length) // last block cut to fit
    if (b - u >= MIN_PIECE - EPS) out.push({ a: u, b })
    u = b
  }
  return out
}

/** Axis-aligned keep-out rectangle in wall-local (u, y) space. */
type KeepOut = { u0: number; u1: number; y0: number; y1: number }

/**
 * Cut one block interval around every keep-out: pieces fully inside vanish,
 * straddling blocks are cut tight to the jamb (the cut face lands exactly on
 * the rough-opening line; the rendered face sits half a mortar joint inside).
 */
function subtractKeepOuts(piece: BlockInterval, cuts: BlockInterval[]): BlockInterval[] {
  let pieces = [piece]
  for (const cut of cuts) {
    const next: BlockInterval[] = []
    for (const p of pieces) {
      if (cut.b <= p.a + EPS || cut.a >= p.b - EPS) {
        next.push(p) // no overlap
        continue
      }
      if (cut.a > p.a + EPS) next.push({ a: p.a, b: cut.a }) // left jamb piece
      if (cut.b < p.b - EPS) next.push({ a: cut.b, b: p.b }) // right jamb piece
    }
    pieces = next
  }
  return pieces
}

// ---------------------------------------------------------------------------
// Vertical reinforcing layout (exported for direct unit testing)
// ---------------------------------------------------------------------------

/**
 * Wall-local u positions of the vertical #5 bars: both end cells first (they
 * anchor the corner cores), then a bar in the first cell beside every opening
 * jamb (R606.12 opening reinforcement), then the 48" o.c. field grid. Later
 * candidates are dropped when they land within 6" of an accepted bar (one bar
 * per cell) or inside an opening's rough width.
 */
export function verticalBarPositions(
  length: number,
  openings: { u0: number; u1: number }[],
  skipStartBar = false,
  skipEndBar = false,
): number[] {
  const MIN_GAP = inches(6)
  const accepted: number[] = []
  const consider = (u: number): void => {
    if (u < CELL_CENTER - EPS || u > length - CELL_CENTER + EPS) return
    // A shared corner core holds ONE bar — the wall that lays through on
    // even courses owns it; the yielding wall skips its end bar.
    if (skipStartBar && u < inches(8)) return
    if (skipEndBar && u > length - inches(8)) return
    if (openings.some((o) => u > o.u0 - EPS && u < o.u1 + EPS)) return
    if (accepted.some((v) => Math.abs(v - u) < MIN_GAP)) return
    accepted.push(u)
  }
  consider(CELL_CENTER)
  consider(length - CELL_CENTER)
  for (const o of openings) {
    consider(o.u0 - CELL_CENTER)
    consider(o.u1 + CELL_CENTER)
  }
  for (let u = CELL_CENTER + VERT_BAR_SPACING; u < length - CELL_CENTER - inches(8); u += VERT_BAR_SPACING) {
    consider(u)
  }
  return accepted.sort((a, b) => a - b)
}

/**
 * Foundation-facing dowel layout for one CMU-based wall (LOD-400 B18b).
 * `us`: wall-local positions where the foundation's dowels must rise so
 * they lap this wall's grouted-cell verticals. `barTop`: the y where the
 * ZONE's verticals top out (bond-beam mid-height, cmuWall's own barTop
 * formula: zone courses × 8" − 4") — the HIGHEST steel a dowel can lap
 * into. On a knee wall that is the SEAM story, not the wall top: a dowel
 * rising past it punches through the PT seam sill and the framed zone
 * (skeptic B18 round 1, F1 — fixed 30" laps on a 0.61 m knee put steel
 * 14-76 mm inside the wood).
 */
export type CmuDowelLayout = { us: number[]; barTop: number }

/**
 * Dowel layout so the FOUNDATION laps this CMU wall's verticals (LOD-400
 * B18b: stemwall dowels used to march on the generic 48"-grid and never
 * lapped the wall's own bars).
 * One truth with the wall engine: the same `verticalBarPositions` layout —
 * WITHOUT the corner skip flags, so every emitted vertical (including a
 * skipped end's neighbor-owned corner core) has a dowel partner; the extra
 * end-cell dowel is standard corner detailing, never a clash (rebar laps).
 * MIXED walls (CMU below a course-snapped seam) map the layout onto the
 * inset CMU zone run — the same insets `mixedCmuWall` courses with — so no
 * dowel rises outside the blockwork into the framed-zone air, and `barTop`
 * caps the dowels below the seam story.
 */
export function cmuDowelPositions(
  wall: WallSlice,
  cmuHeightM?: number,
  neighbors: WallSlice[] = [],
): CmuDowelLayout {
  const none: CmuDowelLayout = { us: [], barTop: 0 }
  if (wall.curved) return none
  let startInset = 0
  let endInset = 0
  let zoneHeight = wall.height
  let openings = wall.openings
  if (cmuHeightM !== undefined) {
    const seam = snapCmuHeight(cmuHeightM, wall.height)
    if (seam <= 0) return none
    if (courseCount(seam) < courseCount(wall.height)) {
      const insets = mixedWallInsets(wall, neighbors)
      startInset = insets.startInset
      endInset = insets.endInset
      zoneHeight = seam
      // The CMU zone's openings: fully below the seam or crossing it —
      // exactly the set mixedCmuWall jamb-cuts the blockwork around.
      openings = wall.openings.filter(
        (o) => (o.kind === 'door' ? 0 : o.sillHeight) < seam - EPS,
      )
    }
  }
  const len = wall.length - startInset - endInset
  if (len <= EPS || courseCount(zoneHeight) < 1) return none
  const ro = openings.map((o) => ({
    u0: o.u - o.roughWidth / 2 - startInset,
    u1: o.u + o.roughWidth / 2 - startInset,
  }))
  return {
    us: verticalBarPositions(len, ro).map((u) => u + startInset),
    barTop: courseCount(zoneHeight) * COURSE_HEIGHT - COURSE_HEIGHT / 2,
  }
}

// ---------------------------------------------------------------------------
// Corner interlock hints (computed across walls by cmuWalls)
// ---------------------------------------------------------------------------

/** One corner this wall participates in, as seen from this wall. */
export type CmuCorner = {
  /** Which end of THIS wall meets the corner. */
  end: 'start' | 'end'
  /** The abutting wall's thickness — sets how far to lay through / stop short. */
  otherThickness: number
  /** True: this wall lays THROUGH the corner on even courses (else on odd). */
  claimEven: boolean
}

export type CmuHints = { corners?: CmuCorner[] }

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Lay up one CMU wall. Returns [] for curved walls (v1 — flagged upstream)
 * and for walls shorter than a single course.
 *
 * The top course is ALWAYS the bond beam: body coursing stops at the last
 * full course below `wall.height`, and that final full course is emitted as
 * the grouted bond beam ("tie beam") so the wall never exceeds its
 * architectural height.
 */
export function cmuWall(wall: WallSlice, spec: FramingSpec, hints: CmuHints = {}): Member[] {
  if (wall.curved) return []
  const members: Member[] = []
  const { yaw, place } = frameOf(wall)
  const len = wall.length

  // Block depth: full 8" nominal walls get the actual 7-5/8" unit; thinner
  // architectural walls clamp to the drawn thickness (4"/6" units exist)
  // LESS the face bury on each side, so the block faces sit strictly inside
  // the host wall's drawn face planes (CMU_FACE_BURY — never coplanar with
  // a painted/opaque host face). Walls deeper than the actual unit + both
  // buries keep the true 7-5/8" unit unchanged (its natural clearance is
  // ≥ the bury by construction). A wall too thin for the full bury
  // (< 4×bury = 2 cm — below the host panel's 0.05 m thickness floor, only
  // raw-API scenes can draw one) floors the depth at HALF the drawn
  // thickness (the bury degrades to thickness/4 per side, still strictly
  // inside) and the bond beam carries an honest flag instead of the blocks
  // vanishing or breaking the bury.
  const depth = Math.min(
    Math.max(wall.thickness - 2 * CMU_FACE_BURY, wall.thickness / 2),
    BLOCK_DEPTH_ACTUAL,
  )
  const thinBuryFloor = wall.thickness - 2 * CMU_FACE_BURY < wall.thickness / 2 - EPS

  // Whole courses that fit under the wall height (EPS guards an exact-fit
  // height like 8'-0" from float-rounding down to 11 courses).
  const totalCourses = courseCount(wall.height)
  if (totalCourses < 1) return [] // shorter than one course — nothing to lay
  const bodyCourses = totalCourses - 1 // top course is the bond beam
  const bondBeamBottom = bodyCourses * COURSE_HEIGHT

  // ---- corner interlock: per-course extents along the wall ----
  // At a shared corner the claiming course lays THROUGH to the neighbor's far
  // face (extends otherThickness/2 past the corner point); the yielding
  // course stops short of the through wall's face (retreats otherThickness/2)
  // — so the corner volume is filled exactly once per course.
  const cornerAt = (end: 'start' | 'end'): CmuCorner | undefined =>
    hints.corners?.find((c) => c.end === end)
  const courseSpan = (c: number): [number, number] => {
    let lo = 0
    let hi = len
    const cs = cornerAt('start')
    if (cs) lo = (c % 2 === 0) === cs.claimEven ? -cs.otherThickness / 2 : cs.otherThickness / 2
    const ce = cornerAt('end')
    if (ce) hi = len + ((c % 2 === 0) === ce.claimEven ? ce.otherThickness / 2 : -ce.otherThickness / 2)
    return [lo, hi]
  }
  /** Extend the terminal units through a claimed corner / clip to a yielded one. */
  const interlock = (intervals: BlockInterval[], lo: number, hi: number): BlockInterval[] => {
    const out: BlockInterval[] = []
    for (const iv of intervals) {
      let a = Math.max(iv.a, lo)
      let b = Math.min(iv.b, hi)
      if (iv.a < EPS && lo < 0) a = lo // first unit reaches through the corner
      if (iv.b > len - EPS && hi > len) b = hi // last unit reaches through
      if (b - a >= MIN_PIECE - EPS) out.push({ a, b })
    }
    return out
  }

  const emit = (
    role: Member['role'],
    interval: BlockInterval,
    cellBottom: number,
    cellHeight: number,
    label?: string,
    grouted?: boolean,
  ): void => {
    // Shrink 3/8" in length and height, centered in the nominal cell, so a
    // half-joint of visual gap surrounds every unit (reads as mortar).
    const dims: [number, number, number] = [
      interval.b - interval.a - MORTAR_JOINT,
      cellHeight - MORTAR_JOINT,
      depth,
    ]
    members.push({
      system: 'wall-framing', // CMU replaces the wall's framing system
      role,
      // size intentionally undefined — unit masonry, not dimensional lumber
      dims,
      length: Math.max(dims[0], dims[1]), // cut length = the unit's long dim
      position: place((interval.a + interval.b) / 2, cellBottom + cellHeight / 2),
      rotation: [0, yaw, 0],
      material: 'concrete',
      sourceId: wall.id,
      label,
      grouted: grouted || undefined,
    })
  }

  // ---- vertical reinforcing layout (bars drive which cells grout solid) ----
  const fab = spec.detail !== '200' // LOD 350 gate, matching the foundation engine
  const roRanges = wall.openings.map((o) => ({
    u0: o.u - o.roughWidth / 2,
    u1: o.u + o.roughWidth / 2,
  }))
  const barUs =
    fab && bodyCourses >= 1
      ? verticalBarPositions(
          len,
          roRanges,
          cornerAt('start') ? !cornerAt('start')?.claimEven : false,
          cornerAt('end') ? !cornerAt('end')?.claimEven : false,
        )
      : []

  // ---- openings: keep-outs + precast lintels ----
  const keepOuts: KeepOut[] = []
  for (const opening of wall.openings) {
    // Rough opening rectangle in wall-local (u, y). Doors carry sillHeight 0,
    // so [sill, sill + roughHeight] covers both kinds.
    const u0 = opening.u - opening.roughWidth / 2
    const u1 = opening.u + opening.roughWidth / 2
    const roBottom = opening.sillHeight
    const roTop = opening.sillHeight + opening.roughHeight
    keepOuts.push({ u0, u1, y0: roBottom, y1: roTop })
    // ASSUMPTION: blocks are removed per whole course cell the RO touches —
    // CMU openings are laid to the 8" module in practice, so partial-height
    // (notched) units are not modeled. // LOD 400: snap RO head/sill to
    // coursing and emit sash/jamb blocks.

    // Precast lintel directly above the RO: 8" tall, bearing 8" onto the
    // blockwork past each jamb (FBC R606.10 / precast manufacturer minimum).
    const la = Math.max(0, u0 - LINTEL_BEARING) // clamp bearing inside the wall
    const lb = Math.min(len, u1 + LINTEL_BEARING)
    // Where the head is within one course of the top of the wall, the bond
    // beam doubles as the lintel (standard FL tie-beam-over-door detail) —
    // cap the lintel at the bond beam and skip it entirely if nothing is left.
    const lintelTop = Math.min(roTop + LINTEL_HEIGHT, bondBeamBottom)
    const lintelHeight = lintelTop - roTop
    if (lintelHeight >= MIN_PIECE && lb - la >= MIN_PIECE) {
      emit(
        'lintel',
        // One precast piece, so its emitted length is the TRUE length
        // (RO + 2×8" bearing): pad half a joint each side to cancel the unit
        // mortar shrink — its end faces then meet the jamb blocks' rendered
        // faces exactly across a half-joint, like a mortared butt joint.
        { a: la - MORTAR_JOINT / 2, b: lb + MORTAR_JOINT / 2 },
        roTop,
        lintelHeight,
        `precast lintel over ${opening.kind} — 8" bearing`,
      )
      // Blocks butt the lintel ends — cut coursing around its rectangle too.
      keepOuts.push({ u0: la, u1: lb, y0: roTop, y1: lintelTop })
    }
  }

  // ---- body coursing: running bond, interlocked corners, cut at openings ----
  for (let c = 0; c < bodyCourses; c++) {
    const y0 = c * COURSE_HEIGHT
    const y1 = y0 + COURSE_HEIGHT
    const [lo, hi] = courseSpan(c)
    // Keep-outs that touch this course cell vertically.
    const cuts: BlockInterval[] = []
    for (const k of keepOuts) {
      if (k.y0 < y1 - EPS && k.y1 > y0 + EPS) cuts.push({ a: k.u0, b: k.u1 })
    }
    for (const unit of interlock(courseIntervals(len, c % 2 === 1), lo, hi)) {
      for (const piece of subtractKeepOuts(unit, cuts)) {
        if (piece.b - piece.a < MIN_PIECE - EPS) continue
        // Cells a vertical bar passes through grout solid (IRC R606.12 wind
        // reinforcing) — label so takeoff can derive a grout/rebar line. At
        // LOD 200 (no bars) the end cells keep the schematic call-out.
        const grouted = fab
          ? barUs.some((u) => u > piece.a + EPS && u < piece.b - EPS)
          : piece.a <= lo + EPS || piece.b >= hi - EPS
        emit(
          'block',
          piece,
          y0,
          COURSE_HEIGHT,
          grouted ? 'grouted cell + vertical rebar' : undefined,
          grouted,
        )
      }
    }
  }

  // ---- bond beam: the top course, grouted solid with horizontal rebar ----
  // One continuous member (not unit blocks): once grouted, the tie beam acts
  // as a monolithic reinforced element, and the takeoff prices it as poured
  // concrete rather than unit masonry. Runs over openings — it is the
  // structural head where lintels merge into it. The beam course interlocks
  // corners like any other course (its bars lap into the neighbor's beam).
  // ASSUMPTION: continuous across the full wall even over a full-height
  // opening — real FBC tie-beam details splice, not interrupt, there.
  const [beamLo, beamHi] = courseSpan(bodyCourses)
  emit(
    'bond-beam',
    // Padded half a joint each side so the emitted box spans the exact
    // course extent after the mortar shrink — a poured beam shows no joints.
    { a: beamLo - MORTAR_JOINT / 2, b: beamHi + MORTAR_JOINT / 2 },
    bondBeamBottom,
    COURSE_HEIGHT,
    'bond beam — grouted + rebar',
  )
  if (thinBuryFloor) {
    // The bond beam always exists (any wall with ≥1 course), so it carries
    // the wall's thin-bury honesty — one flag per wall, B1 ' | ' compose.
    const beam = members[members.length - 1]
    if (beam) beam.flag = beam.flag ? `${beam.flag} | ${THIN_BURY_FLAG}` : THIN_BURY_FLAG
  }

  // ---- reinforcing steel (LOD 350+) ----
  if (fab) {
    // Two horizontal #5 bars centered in the beam, 2" clear off each face
    // (FBC tie-beam detail). Walls too thin for two bars carry one on center.
    const beamBarY = bondBeamBottom + COURSE_HEIGHT / 2
    const offset = depth / 2 - BAR_CLEAR
    const beamBarLen = beamHi - beamLo
    for (const side of offset > REBAR_SIZE ? [-1, 1] : [0]) {
      members.push({
        system: 'wall-framing',
        role: 'rebar',
        dims: [beamBarLen, REBAR_SIZE, REBAR_SIZE],
        length: beamBarLen,
        position: place((beamLo + beamHi) / 2, beamBarY, side * Math.max(offset, 0)),
        rotation: [0, yaw, 0],
        material: 'steel',
        sourceId: wall.id,
        label: '#5 horizontal — bond beam, lap corners',
      })
    }
    // Vertical #5 bars in the grouted cells, hooked into the bond beam: from
    // the slab (foundation dowels lap below) up to the beam's mid-height.
    const barTop = bondBeamBottom + COURSE_HEIGHT / 2
    for (const u of barUs) {
      members.push({
        system: 'wall-framing',
        role: 'rebar',
        dims: [REBAR_SIZE, barTop, REBAR_SIZE],
        length: barTop,
        position: place(u, barTop / 2),
        rotation: [0, yaw, 0],
        material: 'steel',
        sourceId: wall.id,
        label: '#5 vertical — grouted cell, hooked into bond beam (R606.12)',
      })
    }
  }

  return members
}

/**
 * Lay up a SET of CMU walls with cross-wall fabrication: shared corners are
 * detected (same convention as the framing engine — the longer wall is the
 * "through" wall) and the two walls interlock, alternating which one lays
 * through the corner per course; the through wall owns the single corner
 * bar. ASSUMPTION: corners between a CMU wall and a FRAMED wall get no
 * interlock — the engines run on disjoint wall groups.
 */
export function cmuWalls(walls: WallSlice[], spec: FramingSpec): Member[] {
  const hints = new Map<string, CmuHints>()
  const add = (id: string, corner: CmuCorner): void => {
    const h = hints.get(id) ?? {}
    h.corners = [...(h.corners ?? []), corner]
    hints.set(id, h)
  }
  for (const corner of detectCorners(walls)) {
    // Oblique multiplier (round-14): the interlock reach/retreat scales by
    // (1+|cosθ|)/sinθ so 45/60/120° corners neither share block volume nor
    // gap. Perpendicular k = 1; splices (near-parallel) skip. Capped at 4.
    const a = corner.through.dir
    const b = corner.butting.dir
    const crossD = Math.abs(a[0] * b[1] - a[1] * b[0])
    if (crossD < 0.1) continue
    const k = Math.min(4, (1 + Math.abs(a[0] * b[0] + a[1] * b[1])) / crossD)
    add(corner.through.id, {
      end: corner.throughEnd,
      otherThickness: k * corner.butting.thickness,
      claimEven: true,
    })
    add(corner.butting.id, {
      end: corner.buttingEnd,
      otherThickness: k * corner.through.thickness,
      claimEven: false,
    })
  }
  const members: Member[] = []
  for (const wall of walls) {
    members.push(...cmuWall(wall, spec, hints.get(wall.id)))
  }
  return members
}

// ---------------------------------------------------------------------------
// Mixed CMU/framed wall (knee/stem wall pattern)
// ---------------------------------------------------------------------------

/** Seam anchor bolt: 5/8" J-bolt (R403.1.6 prescribes 1/2" minimum). */
const SEAM_BOLT_SIDE = inches(5 / 8)
/** R403.1.6: bolts extend ≥ 7" into the masonry — here the grouted bond beam. */
const SEAM_BOLT_EMBEDMENT = inches(7)

/** Canonical crossing-opening flag (board spec verbatim) — gates grep it. */
export const SEAM_CROSSING_FLAG = 'opening crosses the CMU/framing seam — verify detail'

/** Canonical corner-butt advisory (board spec verbatim) — gates grep it. */
export const MIXED_CORNER_FLAG = 'mixed wall butts at corners — verify tie detail'

export type MixedWallResult = { members: Member[]; warnings: string[] }

/**
 * Corner/tee butt insets for a mixed wall. A mixed wall joins NEITHER
 * corner-fabrication group (the framed and CMU groups each run their own
 * cross-wall pass), so without this its courses/bond beam/PT sill/plates ran
 * to the centerline corner point and interpenetrated the neighbor (skeptic
 * 2026-08-16, S1). The mixed wall always BUTTS — never through-runs — at
 * every shared corner AND as the stem of a tee: both zones stop at the
 * neighbor's near face (k half-thicknesses back from the centerline, same
 * oblique multiplier as frameWalls/cmuWalls; tees mirror frameWalls' plain
 * thickness/2). Each junction is a per-corner advisory: the butt joint
 * carries no interlock/California corner, so the tie detail (corner bars,
 * strap, cap lap) is the builder's to verify.
 */
export function mixedWallInsets(
  wall: WallSlice,
  neighbors: WallSlice[],
): { startInset: number; endInset: number; junctions: ('start' | 'end')[] } {
  let startInset = 0
  let endInset = 0
  const junctions: ('start' | 'end')[] = []
  const others = neighbors.filter((n) => n.id !== wall.id && !n.curved)
  if (others.length === 0) return { startInset, endInset, junctions }
  const group = [wall, ...others]
  const claim = (end: 'start' | 'end', inset: number): void => {
    junctions.push(end)
    if (end === 'start') startInset = Math.max(startInset, inset)
    else endInset = Math.max(endInset, inset)
  }
  for (const corner of detectCorners(group)) {
    // Only corners THIS wall participates in — either role, it butts.
    let myEnd: 'start' | 'end'
    let other: WallSlice
    if (corner.through.id === wall.id) {
      myEnd = corner.throughEnd
      other = corner.butting
    } else if (corner.butting.id === wall.id) {
      myEnd = corner.buttingEnd
      other = corner.through
    } else continue
    // Oblique multiplier (round-14 convention): a square-cut run retreats
    // (1+|cosθ|)/sinθ half-thicknesses to clear the neighbor's sloped face.
    // That multiplier is exact only when the retreating member is no wider
    // than the neighbor's thickness — the general square-cut retreat is
    // (neighborThickness + ownWidth·|cosθ|)/(2·sinθ). A mixed wall's widest
    // corner member is the CMU block (7-5/8" deep — wider than a thin
    // framed neighbor), so an acute corner undershot by the width
    // difference and the block noses clipped the neighbor (skeptic
    // 2026-08-16). Both zones share the joint, so the block-width retreat
    // governs the whole butt. Same razor-angle guard and ×4 cap as
    // frameWalls.
    const crossD = Math.abs(wall.dir[0] * other.dir[1] - wall.dir[1] * other.dir[0])
    const dotD = Math.abs(wall.dir[0] * other.dir[0] + wall.dir[1] * other.dir[1])
    // Deliberately the UN-buried width: the corner retreat only has to
    // clear the neighbor's face, and CMU_FACE_BURY makes the real block
    // strictly NARROWER than this — over-retreating by ≤ bury·|cosθ| terms
    // is the safe direction and keeps the inset layout byte-equal.
    const ownWidth = Math.min(wall.thickness, BLOCK_DEPTH_ACTUAL)
    const k = crossD < 0.1 ? 1 : Math.min(4, (1 + dotD) / crossD)
    const kOwn =
      crossD < 0.1
        ? 1
        : Math.min(4, (other.thickness + ownWidth * dotD) / (crossD * other.thickness))
    claim(myEnd, (Math.max(k, kOwn) * other.thickness) / 2)
  }
  for (const tee of detectTees(group)) {
    if (tee.stem.id !== wall.id) continue
    // Width-aware oblique retreat — the same S5 formula the framed tee
    // path adopted night-5 (plain t/2 left a 45° mixed stem's blocks and
    // plates inside the through studs; skeptic probe F).
    const cosT = Math.abs(
      tee.stem.dir[0] * tee.through.dir[0] + tee.stem.dir[1] * tee.through.dir[1],
    )
    const sinT = Math.max(
      0.2,
      Math.abs(tee.stem.dir[0] * tee.through.dir[1] - tee.stem.dir[1] * tee.through.dir[0]),
    )
    claim(tee.stemEnd, (tee.through.thickness + wall.thickness * cosT) / (2 * sinT))
  }
  return { startInset, endInset, junctions }
}

/**
 * Lay up one MIXED wall: CMU coursing from the floor to a course-snapped
 * seam, stud framing above — the knee/stem wall pattern (block base, framed
 * top). Anatomy, bottom to top:
 *
 *   body courses → grouted bond beam as the CMU zone's top course (the seam
 *   collector, FBC tie-beam practice) → PT sill plate anchor-bolted to the
 *   bond beam (R403.1.6 spacing: ≤6' o.c., within 12" of ends, ≥2 bolts) →
 *   the shortened framed zone with its own bottom plate, studs and top
 *   plates, topping out exactly at the wall's architectural height.
 *
 * Openings:
 *  - entirely below the seam → CMU zone (precast lintel logic as today);
 *  - entirely above → framed zone (king/trimmer/header logic), translated;
 *  - CROSSING the seam → flagged (SEAM_CROSSING_FLAG on the bond beam +
 *    a returned warning) and framed as if fully in the TALLER zone; the
 *    blockwork still cuts clear of the rough opening (jamb cuts, no lintel —
 *    the head is above the zone).
 *
 * ASSUMPTIONS (v1): mixed walls do not interlock corners with neighboring
 * walls — at every shared corner/tee BOTH zones butt at the neighbor's near
 * face instead (mixedWallInsets from the `neighbors` context; the framed and
 * CMU groups still run their own cross-wall fabrication separately) and a
 * per-corner MIXED_CORNER_FLAG advisory is returned; the bond beam and PT
 * sill run continuous across a crossing opening (real details splice the tie
 * beam and cut the plate at the door — the crossing flag covers it);
 * assembly layers are unchanged per wall (no sheathing/drywall split at the
 * seam).
 */
export function mixedCmuWall(
  wall: WallSlice,
  spec: FramingSpec,
  cmuHeightM: number,
  neighbors: WallSlice[] = [],
): MixedWallResult {
  const warnings: string[] = []
  if (wall.curved) return { members: [], warnings } // flagged upstream
  const seam = snapCmuHeight(cmuHeightM, wall.height)
  if (seam <= 0) return { members: cmuWall(wall, spec), warnings } // < 1 course — today's path ([])
  if (courseCount(seam) >= courseCount(wall.height)) {
    // Snapped to every course that fits = full-height CMU, exactly as today.
    return { members: cmuWall(wall, spec), warnings }
  }

  const { yaw, place } = frameOf(wall)
  const len = wall.length

  // ---- corner/tee butt joints: both zones stop at the neighbor's face ----
  const { startInset, endInset, junctions } = mixedWallInsets(wall, neighbors)
  for (const end of junctions) {
    warnings.push(`${MIXED_CORNER_FLAG} (wall ${wall.id}, ${end})`)
  }
  const runLen = len - startInset - endInset
  const studSize = studSizeFor(wall, spec)
  const [sillT, sillW] = LUMBER_CROSS_SECTIONS[studSize] // 1.5" plate stock
  const framedBase = seam + sillT
  const framedHeight = wall.height - framedBase

  // ---- zone the openings ----
  const roExtent = (o: OpeningSlice): [number, number] =>
    o.kind === 'door' ? [0, o.roughHeight] : [o.sillHeight, o.sillHeight + o.roughHeight]
  /** Translate an opening into the framed zone's local frame (y=0 at the
   * plate line above the PT sill). A sill landing inside the sill-plate band
   * clamps to the zone floor; roughHeight preserves the TRUE head height. */
  const toFramedZone = (o: OpeningSlice): OpeningSlice => {
    const [roBottom, roTop] = roExtent(o)
    const bottom = Math.max(0, roBottom - framedBase)
    return { ...o, sillHeight: bottom, roughHeight: roTop - framedBase - bottom }
  }
  const cmuOpenings: OpeningSlice[] = []
  const framedOpenings: OpeningSlice[] = []
  let crossings = 0
  for (const o of wall.openings) {
    const [roBottom, roTop] = roExtent(o)
    if (roTop <= seam + EPS) {
      cmuOpenings.push(o) // fully in the blockwork — lintel logic as today
    } else if (roBottom >= seam - EPS) {
      framedOpenings.push(toFramedZone(o)) // fully in the framed zone
    } else {
      // Crossing: structural home is the TALLER zone; flag either way.
      crossings += 1
      warnings.push(`${SEAM_CROSSING_FLAG} (${o.kind} ${o.id})`)
      // The blockwork always cuts clear of the RO (jamb cuts; the head is
      // above the zone so cmuWall emits no lintel for it).
      cmuOpenings.push(o)
      const framedTaller = framedHeight >= seam
      if (framedTaller && roTop > framedBase + sillT) {
        framedOpenings.push(toFramedZone(o))
      }
    }
  }

  // ---- CMU zone: courses + bond beam topping out exactly at the seam ----
  // The zone slice is the wall SHORTENED to the butt run [startInset,
  // len − endInset]: start/end/length shift so the coursing, bond beam,
  // lintels and bar layout all live inside the run (openings re-based onto
  // the new start). A wall crushed between two thick neighbors can leave no
  // run at all — nothing to lay.
  if (runLen <= EPS) return { members: [], warnings }
  const zone: WallSlice = {
    ...wall,
    start: [wall.start[0] + wall.dir[0] * startInset, wall.start[1] + wall.dir[1] * startInset],
    end: [wall.end[0] - wall.dir[0] * endInset, wall.end[1] - wall.dir[1] * endInset],
    length: runLen,
    height: seam,
    openings: cmuOpenings.map((o) => ({ ...o, u: o.u - startInset })),
  }
  const members = cmuWall(zone, spec)
  if (crossings > 0) {
    // The bond beam is the seam element — it carries the canonical flag so
    // the takeoff's Flags section surfaces the crossing (one line per wall).
    // Composed ' | ' (B1 convention): the beam may already carry the
    // thin-bury honesty flag from cmuWall.
    for (const m of members) {
      if (m.role === 'bond-beam')
        m.flag = m.flag ? `${m.flag} | ${SEAM_CROSSING_FLAG}` : SEAM_CROSSING_FLAG
    }
  }

  // ---- PT sill plate on the bond beam (mudsill, R403.1.6 anchorage) ----
  // ROs whose vertical extent crosses the sill band [seam, seam + sillT]
  // over the plate's horizontal run: the continuous plate passes THROUGH the
  // opening there (the v1 continuity assumption above), so the seam element
  // carries the canonical 'verify detail' flag — a real detail cuts the
  // plate at the door.
  const sillRoSpans = openingSpans(wall, seam, seam + sillT).filter(
    (s) => s.hi > startInset + EPS && s.lo < len - endInset - EPS,
  )
  // Cavity-fit (night-4): the PT sill's across-wall geometry compresses to
  // the drawn wall like every framed member (labels/takeoff stay nominal).
  const sillWFit = fitAcross(sillW, wall)
  members.push({
    system: 'wall-framing',
    role: 'mudsill',
    size: studSize,
    dims: [runLen, sillT, sillWFit],
    length: runLen,
    position: place(startInset + runLen / 2, seam + sillT / 2),
    rotation: [0, yaw, 0],
    material: 'pt-lumber',
    sourceId: wall.id,
    label: 'PT sill plate on bond beam — anchor-bolted (R403.1.6)',
    flag:
      sillRoSpans.length > 0
        ? SEAM_CROSSING_FLAG
        : sillWFit < sillW
          ? `${studSize} framing compressed to ${formatIn(sillWFit)} — ${wall.thickness.toFixed(3)}m drawn wall holds ${formatIn(sillWFit)} + finishes; deepen to ${(sillW + inches(1)).toFixed(3)}m for full-depth ${studSize}`
          : undefined,
  })

  // ---- anchor bolts through the sill into the grouted bond beam ----
  // R403.1.6 layout (shared with the foundation engine): max spacing 6' o.c.
  // (tighter via jurisdiction), first/last within 12" of the plate ends,
  // never fewer than two. 7" embedment stays inside the 8" beam course; the
  // shank tops out flush with the sill top (nut + washer land on the plate).
  // Bolts never land inside an opening RO — a J-bolt in a doorway anchors
  // nothing (the RO spans above already flagged the plate). The run splits
  // at the RO spans and every remaining plate segment keeps its OWN
  // R403.1.6 layout: ≤6' o.c., first/last within 12" of the segment ends,
  // never fewer than two per section.
  const boltHeight = SEAM_BOLT_EMBEDMENT + sillT
  const boltSegments: { a: number; b: number }[] = []
  let boltCursor = startInset
  for (const s of sillRoSpans) {
    if (s.lo > boltCursor + EPS) boltSegments.push({ a: boltCursor, b: Math.min(s.lo, len - endInset) })
    boltCursor = Math.max(boltCursor, s.hi)
  }
  if (len - endInset > boltCursor + EPS) boltSegments.push({ a: boltCursor, b: len - endInset })
  for (const seg of boltSegments) {
    for (const u of anchorBoltPositions(seg.b - seg.a, spec.anchorBoltSpacing, spec.anchorBoltEndDistance)) {
      members.push({
        system: 'wall-framing',
        role: 'anchor-bolt',
        dims: [SEAM_BOLT_SIDE, boltHeight, SEAM_BOLT_SIDE],
        length: boltHeight,
        position: place(seg.a + u, seam - SEAM_BOLT_EMBEDMENT + boltHeight / 2),
        rotation: [0, yaw, 0],
        material: 'steel',
        sourceId: wall.id,
        label: '5/8" anchor bolt — sill to bond beam (R403.1.6)',
      })
    }
  }

  // ---- framed zone: shortened wall with its own bottom/top plates ----
  // frameWall runs in zone-local coordinates (y=0 on the PT sill top); the
  // members shift up by framedBase so the top plate lands at wall.height.
  // Corner butts pass through as run insets (frameWall's own hint contract).
  const framedMembers = frameWall(
    { ...wall, height: framedHeight, openings: framedOpenings },
    spec,
    { startInset, endInset },
  )
  for (const m of framedMembers) {
    members.push({
      ...m,
      position: [m.position[0], m.position[1] + framedBase, m.position[2]] as const,
    })
  }

  return { members, warnings }
}
