/**
 * Roof framing engine — pure functions: Pascal roof-segment nodes → rafters,
 * ridge, hips, ceiling joists, collar ties (+ hurricane ties in high-wind
 * jurisdictions).
 *
 * Host geometry (verified against `roof-segment.ts` / `getSegmentSlopeFrame`
 * in @pascal-app/core):
 *  - a segment is a footprint `width` (local X) × `depth` (local Z) centered
 *    on its `position`, rotated by `rotation` (Y radians); segments nest
 *    under a `roof` group node (own position + Y rotation) which parents to
 *    the level;
 *  - `pitch` is in DEGREES; the primary slope run for a gable is `depth / 2`
 *    (slopes face ±Z, ridge runs along X at z = 0), a shed runs the full
 *    `depth` (single plane), a hip runs `min(width, depth) / 2`;
 *  - eaves sit at `wallHeight` above the segment origin (the knee wall) and
 *    the peak at `wallHeight + run·tan(pitch)`; `overhang` extends past the
 *    footprint along the slope.
 *
 * Rotation convention (matches wall-framing / three.js): a Member's euler
 * [0, ψ, θ] applies Rz(θ) THEN Ry(ψ) to the +X-aligned box — Rz tilts the
 * box to the pitch in the XY plane, Ry yaws it into the slope's downhill
 * direction. Verified numerically in the tests by rotating (1,0,0).
 */

import { DEFAULT_SPEC, type FramingSpec, tableSpanFor } from '../core/spec'
import { stableMembers } from '../core/stable'
import type { Member, WallSlice } from '../core/types'
import { feet, formatIn, inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS, LUMBER_SIZES, type LumberSize } from '../lumber'
import { hangerFor, partLabel } from './hardware'

const EPS = 1e-6

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>
type NodesRecord = Record<string, AnyRecord>

export type RoofSegmentSlice = {
  id: string
  roofType: string
  /** Level-local footprint center (X, Z) and origin height (Y). */
  position: readonly [number, number, number]
  /** Total level-local yaw (roof group + segment), radians. */
  yaw: number
  width: number
  depth: number
  /** Radians (schema stores degrees — converted here). */
  pitch: number
  overhang: number
  wallHeight: number
  /** Segment wall thickness — infill studs above the plate fit inside it. */
  wallThickness?: number
  /**
   * How the segment meets a wall it leans on (`metadata.roof.attach`): `high`
   * = a shed whose high edge bears on a LEDGER at the house wall (no
   * pediment, no overhang there, rafters on hangers) — the porch roof.
   */
  attach?: 'high'
  /** An OPEN roof (`metadata.roof.open`): posts and a beam under the eaves, no walls — no rake studs. */
  open?: boolean
  // Shape ratios for the multi-face types — host schema fields with the
  // ROOF_SHAPE_DEFAULTS values (roof-segment.ts in @pascal-app/core).
  gambrelLowerWidthRatio?: number
  gambrelLowerHeightRatio?: number
  mansardSteepWidthRatio?: number
  mansardSteepHeightRatio?: number
  dutchHipWidthRatio?: number
  dutchHipHeightRatio?: number
  dutchWaistLengthRatio?: number
}

/** Host defaults for the shape ratios (ROOF_SHAPE_DEFAULTS in @pascal-app/core). */
export const SHAPE_DEFAULTS = {
  gambrelLowerWidthRatio: 0.5,
  gambrelLowerHeightRatio: 0.6,
  mansardSteepWidthRatio: 0.15,
  mansardSteepHeightRatio: 0.7,
  dutchHipWidthRatio: 0.25,
  dutchHipHeightRatio: 0.5,
  dutchWaistLengthRatio: 0.98,
} as const

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * Find every roof-segment whose ancestor chain reaches `levelId`, composing
 * the roof group's transform into the slice. Walks parentId links so it
 * tolerates intermediate grouping nodes.
 */
/** `metadata.roof.{attach, open}` on a segment — the porch's hints (see RoofSegmentSlice). */
function roofHints(node: Record<string, unknown>): Pick<RoofSegmentSlice, 'attach' | 'open'> {
  const meta = node.metadata as { roof?: { attach?: unknown; open?: unknown } } | null | undefined
  const roof = meta && typeof meta === 'object' ? meta.roof : undefined
  const out: Pick<RoofSegmentSlice, 'attach' | 'open'> = {}
  if (roof?.attach === 'high') out.attach = 'high'
  if (roof?.open === true) out.open = true
  return out
}

export function extractRoofs(nodes: NodesRecord, levelId: string): RoofSegmentSlice[] {
  const slices: RoofSegmentSlice[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'roof-segment') continue
    if (node.visible === false) continue

    // Walk up: collect roof-group transforms, stop at the level.
    let px = 0
    let py = 0
    let pz = 0
    const segPos = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
    px = num(segPos[0], 0)
    py = num(segPos[1], 0)
    pz = num(segPos[2], 0)
    let yaw = num(node.rotation, 0)

    let parentId = typeof node.parentId === 'string' ? node.parentId : null
    let reachedLevel = false
    for (let hop = 0; hop < 6 && parentId; hop++) {
      if (parentId === levelId) {
        reachedLevel = true
        break
      }
      const parent = nodes[parentId]
      if (!parent) break
      // Another LEVEL in the chain means this segment belongs elsewhere —
      // walking through it would double-extract the segment from two levels
      // (re-verify advisory: 2x members, one copy at the wrong elevation).
      if (parent.type === 'level') break
      if (parent.type === 'roof') {
        // Compose: p' = roofPos + Ry(roofRot)·p ; yaw' = roofRot + yaw.
        const rot = num(parent.rotation, 0)
        const rp = Array.isArray(parent.position) ? (parent.position as number[]) : [0, 0, 0]
        const cos = Math.cos(rot)
        const sin = Math.sin(rot)
        // three Y-rotation: +X → (cos, 0, -sin), +Z → (sin, 0, cos)
        const nx = px * cos + pz * sin
        const nz = -px * sin + pz * cos
        px = nx + num(rp[0], 0)
        py += num(rp[1], 0)
        pz = nz + num(rp[2], 0)
        yaw += rot
      }
      parentId = typeof parent.parentId === 'string' ? parent.parentId : null
    }
    if (!reachedLevel) continue

    slices.push({
      id: String(node.id ?? ''),
      roofType: typeof node.roofType === 'string' ? node.roofType : 'gable',
      position: [px, py, pz],
      yaw,
      width: num(node.width, 8),
      depth: num(node.depth, 6),
      pitch: (num(node.pitch, 40) * Math.PI) / 180,
      overhang: num(node.overhang, 0.3),
      wallHeight: num(node.wallHeight, 0.5),
      wallThickness: num(node.wallThickness, 0.1),
      ...roofHints(node),
      gambrelLowerWidthRatio: num(
        node.gambrelLowerWidthRatio,
        SHAPE_DEFAULTS.gambrelLowerWidthRatio,
      ),
      gambrelLowerHeightRatio: num(
        node.gambrelLowerHeightRatio,
        SHAPE_DEFAULTS.gambrelLowerHeightRatio,
      ),
      mansardSteepWidthRatio: num(
        node.mansardSteepWidthRatio,
        SHAPE_DEFAULTS.mansardSteepWidthRatio,
      ),
      mansardSteepHeightRatio: num(
        node.mansardSteepHeightRatio,
        SHAPE_DEFAULTS.mansardSteepHeightRatio,
      ),
      dutchHipWidthRatio: num(node.dutchHipWidthRatio, SHAPE_DEFAULTS.dutchHipWidthRatio),
      dutchHipHeightRatio: num(node.dutchHipHeightRatio, SHAPE_DEFAULTS.dutchHipHeightRatio),
      dutchWaistLengthRatio: num(node.dutchWaistLengthRatio, SHAPE_DEFAULTS.dutchWaistLengthRatio),
    })
  }
  return slices
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * B8a: a plain ridge BOARD is prescriptive only when the rafter slope
 * carrying it is ≥ 3:12 — below that R802.4.3 requires a structural ridge
 * BEAM with posts to bearing. No beam/post set is modeled v1 (nothing under
 * a ridge is a verified bearing — even the purlin-strut machinery's own
 * assumption stops at the ceiling joists), so the gap PRINTS instead of
 * upgrading silently: the flag rides the ridge member to the takeoff Flags
 * row and the P4 schedules block (the B6 stated-gap convention). Applies to
 * the GABLE ridge (slope = the schema pitch — the dutch GABLET rides this
 * route with its computed crown pitch), the GAMBREL main ridge (slope =
 * the shallow UPPER planes' φ — a 15° gambrel's upper faces fall under
 * 3:12 while its steep lowers don't; fix-round advisory), and the HIP
 * ridge (slope = the long-plane commons' pitch — the MANSARD CROWN rides
 * this route via the inner frameHip with its computed crown pitch, which
 * sits sub-3:12 even on the default 40° mansard; NIGHT-10 residual
 * closed). 200 stays schematic.
 */
function ridgeBeamFlagFor(spec: FramingSpec, slopeTan: number): string | undefined {
  return spec.detail !== '200' && slopeTan < 3 / 12 - EPS
    ? 'ridge slope < 3:12 — ridge beam required, R802.4.3 (plain ridge board modeled; structural ridge beam + posts to bearing not modeled — verify design)'
    : undefined
}

/** Ridge stock: one size deeper than the rafters (practice: R802.3 ridge ≥ rafter cut depth). */
function ridgeSizeFor(rafterSize: LumberSize): LumberSize {
  switch (rafterSize) {
    case '2x4':
      return '2x6'
    case '2x6':
      return '2x8'
    case '2x8':
      return '2x10'
    default:
      return '2x12'
  }
}

/** Layout positions along an axis at o.c. spacing with guaranteed ends. */
function layout(from: number, to: number, spacing: number, halfT: number): number[] {
  const out: number[] = []
  const end = to - halfT
  for (let u = from + halfT; u < end - EPS; u += spacing) out.push(u)
  out.push(end)
  return out.filter((u, i, all) => i === all.length - 1 || (all[i + 1] ?? 0) - u > 2 * halfT - EPS)
}

/**
 * Frame every roof segment. `walls` are the level's walls: the interior
 * partitions the ceiling joists lap over (W15, `planCeilingJoists`).
 */
export function frameRoofs(
  roofs: RoofSegmentSlice[],
  walls: WallSlice[],
  spec: FramingSpec = DEFAULT_SPEC,
): Member[] {
  const members: Member[] = []
  const truss = spec.roofSystem === 'truss'
  for (const roof of roofs) {
    const before = members.length
    if (roof.roofType === 'gable') {
      // The truss fork lives HERE, not inside frameGable: the dutch gablet
      // reuses frameGable internally with a synthetic segment, and a hip-
      // and-gablet combination roof is a specialty truss set no prescriptive
      // model should fake — only a top-level gable segment trusses out.
      if (truss) frameGableTruss(roof, spec, members)
      else frameGable(roof, spec, members, walls)
    } else if (roof.roofType === 'shed') frameShed(roof, spec, members)
    else if (roof.roofType === 'hip') frameHip(roof, spec, members, walls)
    else if (roof.roofType === 'flat') frameFlat(roof, spec, members)
    else if (roof.roofType === 'gambrel') frameGambrel(roof, spec, members, walls)
    else if (roof.roofType === 'mansard') frameMansard(roof, spec, members, walls)
    else if (roof.roofType === 'dutch') frameDutch(roof, spec, members, walls)
    // Truss mode on a non-gable segment: hip sets, mono trusses and mansard
    // packages are manufacturer-designed geometries — modeling one would be
    // an invented design. The segment stays stick-framed and SAYS SO (the
    // B6 stated-gap convention: the flag rides to the takeoff Flags row).
    if (truss && roof.roofType !== 'gable') {
      const note = `truss roof system selected — ${roof.roofType} segment shown stick-framed (specialty truss sets are manufacturer-designed; not modeled)`
      for (let i = before; i < members.length; i++) {
        const m = members[i]
        if (m !== undefined && m.role === 'rafter' && m.flag === undefined) m.flag = note
      }
    }
  }
  // Valleys where two gable segments cross (LOD 350).
  if (spec.detail !== '200') {
    const valleys = detectValleys(roofs)
    for (const valley of valleys) emitValley(valley, spec, members)
    // B6: a valley MINOR's deck plane keeps running past the valley line
    // (the detector's stated overlay-framing assumption — its rafters
    // already overlay the main roof). Cheap honesty over expensive
    // clipping — as a FLAG, not a label suffix: labels never print on the
    // sheets, flags reach the takeoff Flags rows and the schedules flag
    // block (round-1 examiner F3: zero paper hits while the un-clipped
    // panels visibly overlaid the major).
    const minors = new Set(valleys.map((v) => v.minorId))
    if (minors.size > 0) {
      for (const m of members) {
        if ((m.role === 'sheathing' || m.role === 'wrb') && minors.has(m.sourceId)) {
          m.flag =
            'roof deck/underlayment overlays the main roof past the valley — trim to the valley line on site (overlay framing)'
        }
      }
    }
  }
  // W16c: a parallel wing running under the main — its buried members go,
  // the straddlers are cut at the junction (every LOD: buried wood is not
  // schematic, it is wrong).
  return stableMembers(buryWings(roofs, members))
}

type Emit = (
  role: Member['role'],
  size: LumberSize | undefined,
  dims: [number, number, number],
  segPos: [number, number, number],
  extraYaw: number,
  tilt: number,
  length: number,
  material: Member['material'],
  label?: string,
  roll?: number,
  flag?: string,
) => void

/**
 * XYZ euler equal to Ry(yaw)·Rx(roll) — a member yawed about world Y and
 * ROLLED about its own long (+X) axis. The [0, ψ, θ] convention can't
 * express roll (Rz pitches the axis instead of spinning the section);
 * decomposition follows three's Euler XYZ extraction.
 */
export function eulerYawRoll(yaw: number, roll: number): [number, number, number] {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  return [
    Math.atan2(sr, cy * cr),
    Math.asin(Math.max(-1, Math.min(1, sy * cr))),
    Math.atan2(-sy * sr, cy),
  ]
}

/** Shared emitter: segment-local point → level space via the segment yaw. */
function emitter(roof: RoofSegmentSlice, members: Member[]): Emit {
  const cos = Math.cos(roof.yaw)
  const sin = Math.sin(roof.yaw)
  return (role, size, dims, segPos, extraYaw, tilt, length, material, label, roll, flag) => {
    const [x, y, z] = segPos
    // three Y-rotation of the segment-local offset: +X → (cos, 0, -sin).
    const wx = x * cos + z * sin
    const wz = -x * sin + z * cos
    members.push({
      system: 'roof-framing',
      role,
      size,
      dims,
      length,
      position: [roof.position[0] + wx, roof.position[1] + y, roof.position[2] + wz],
      rotation: roll ? eulerYawRoll(roof.yaw + extraYaw, roll) : [0, roof.yaw + extraYaw, tilt],
      material,
      sourceId: roof.id,
      label,
      flag,
    })
  }
}

/** Outlooker spacing up the rake (4 ft o.c. is the conventional maximum). */
const OUTLOOKER_SPACING = 1.2
/** Rake overhangs below this need no outlookers — the sheathing cantilevers. */
const MIN_RAKE_OVERHANG = 0.15
/** Sub-fascia stock. */
const FASCIA_SIZE: LumberSize = '2x6'
/** Finish fascia board — 1x8 (3/4" × 7-1/4" actual), face-nailed over the sub. */
const FINISH_FASCIA_SIZE: LumberSize = '1x8'
/** Drip edge profile approximated as a thin bar (flange width × metal). */
const DRIP_W = 0.05
const DRIP_T = 0.004

/**
 * One eave edge = a 2x6 sub-fascia + a 1x8 FINISH fascia proud of its face
 * (rubric 400 'fascia + sub-fascia members'). `alongXAxis` names the edge
 * direction; `cross` is the signed eave-line coordinate on the other axis —
 * the finish board sits |sub/2 + finish/2| further OUT along that sign.
 */
function fasciaPair(
  emit: Emit,
  alongXAxis: boolean,
  length: number,
  along: number,
  cross: number,
  y: number,
  note = '',
) {
  const [fT, fD] = LUMBER_CROSS_SECTIONS[FASCIA_SIZE]
  const yaw = alongXAxis ? 0 : -Math.PI / 2
  const at = (c: number): [number, number, number] => (alongXAxis ? [along, y, c] : [c, y, along])
  // `cross` is the tail plumb-cut plane — the sub-fascia face-nails to it,
  // so its CENTER sits half a thickness outside (round-10 gate: centering
  // it on the cut buried the tails inside the board).
  const subCross = cross + Math.sign(cross) * (fT / 2)
  emit(
    'fascia',
    FASCIA_SIZE,
    [length, fD, fT],
    at(subCross),
    yaw,
    0,
    length,
    'lumber',
    `Sub-fascia ${FASCIA_SIZE}${note}`,
  )
  const [nT, nD] = LUMBER_CROSS_SECTIONS[FINISH_FASCIA_SIZE]
  const out = Math.sign(cross) * (fT / 2 + nT / 2)
  emit(
    'fascia',
    FINISH_FASCIA_SIZE,
    [length, nD, nT],
    at(subCross + out),
    yaw,
    0,
    length,
    'lumber',
    `Fascia 1x8 (finish, over sub-fascia)${note}`,
  )
  // B6c: eave drip edge caps the finish fascia (R905.2.8.5) — one lf run
  // per fascia'd eave, drawn as a thin bar on the finish board's top edge.
  // Its OUTER edge stops flush with the finish board's outer face (the
  // vertical leg lies ON that face; the flange runs INWARD over the deck
  // edge) so the drip never grows the plan envelope the fascia already
  // set — the shared sheet transform stays put (round-1 F1b).
  const p = at(subCross + out + Math.sign(cross) * (nT / 2 - DRIP_W / 2))
  emit(
    'drip-edge',
    undefined,
    [length, DRIP_T, DRIP_W],
    [p[0], p[1] + nD / 2 + DRIP_T / 2, p[2]],
    yaw,
    0,
    length,
    'steel',
    'Drip edge — eave (R905.2.8.5)',
  )
}

/**
 * LOD 400 fabrication data for a common rafter: plumb-cut angle at the ridge,
 * birdsmouth seat and HAP — the height above plate that survives after the
 * seat cut (drives fascia lines).
 *
 * The seat wants the full 3½" plate, but R802.7.1 caps the notch: the
 * heel's vertical bite (seat × tanθ) must not exceed d/4 of the rafter.
 * Above ~21° on a 2x6 (or ~27° on a 2x8) the cap governs and the seat
 * narrows — a fixed 3½" seat over-notched every steep roof.
 */
export function birdsmouthSeat(theta: number, rafterDepth: number): number {
  const full = inches(3.5)
  const tan = Math.tan(theta)
  if (tan <= 0) return full
  return Math.min(full, rafterDepth / 4 / tan)
}

function rafterCutData(spec: FramingSpec, theta: number, rafterDepth: number): string {
  if (spec.detail !== '400') return ''
  const deg = Math.round((theta * 180) / Math.PI)
  const seat = birdsmouthSeat(theta, rafterDepth)
  const plumbDepth = rafterDepth / Math.cos(theta)
  const hap = plumbDepth - seat * Math.tan(theta)
  return ` — plumb cut ${deg}°, birdsmouth seat ${formatIn(seat)}, HAP ${formatIn(hap)}`
}

// ---------------------------------------------------------------------------
// Span discipline (LOD-400 audit B2) — R802.4.1 rafters / R802.5.1 supports
// ---------------------------------------------------------------------------

/** Longest one-piece stock stick the takeoff can buy (20 ft). A structural
 * rafter/joist beyond this is a FIELD SPLICE — not a prescriptive member
 * unless the splice lands over a real bearing (purlin row). */
const MAX_ONE_PIECE = feet(20)
/** R802.5.1: purlin struts ≤ 4 ft o.c. to bearing. */
const STRUT_SPACING = 1.2
const STRUT_SIZE: LumberSize = '2x4'

const fmtM = (v: number) => `${v.toFixed(2)} m`
const ocIn = (spacing: number) => `${Math.round(spacing / inches(1))}"`

/** Allowable rafter span (horizontal projection, m) for the spec, or
 * undefined when unchecked (LOD 200, or no tabulated row for the size). */
function rafterAllowable(spec: FramingSpec): number | undefined {
  if (spec.detail === '200') return undefined
  return tableSpanFor(spec.rafterSpans, spec.rafterSize, spec.rafterSpacing)
}

/** Over-span flag for one slope plane's rafters (shapes without a purlin fix). */
function rafterOverSpanFlag(
  spec: FramingSpec,
  run: number,
  allowable: number,
  what = 'Rafter',
): string {
  return (
    `${what} over prescriptive span — ${fmtM(run)} horizontal projection > ` +
    `${fmtM(allowable)} allowable (${spec.rafterSize} @ ${ocIn(spec.rafterSpacing)} o.c., ` +
    `SPF #2, R802.4.1) — purlin + 2x4 struts to bearing or engineered member required (R802.5.1)`
  )
}

/** One-piece stock flag: a spliced structural member without a bearing under
 * the splice is not a prescriptive member (the takeoff otherwise books
 * '20 ft stock (field splice)' silently). */
function onePieceFlag(what: string, cutLength: number): string | undefined {
  if (cutLength <= MAX_ONE_PIECE + EPS) return undefined
  return (
    `${what} ${fmtM(cutLength)} exceeds 20 ft one-piece stock — field splice needs ` +
    `bearing at the joint (purlin/wall) or an engineered member (R802.4.1)`
  )
}

/** Flag for one slope: over-span first, then the one-piece check. */
function slopeRafterFlag(
  spec: FramingSpec,
  run: number,
  cutLength: number,
  what = 'Rafter',
): string | undefined {
  if (spec.detail === '200') return undefined
  const allowable = rafterAllowable(spec)
  if (allowable !== undefined && run > allowable + EPS) {
    return rafterOverSpanFlag(spec, run, allowable, what)
  }
  return onePieceFlag(what, cutLength)
}

/** Label suffix for CONTINUOUSLY-SUPPORTED members that exceed one-piece
 * stock (ridge boards between rafter pairs, rims on joist ends, barges on
 * outlookers, purlins on struts): their field splice lands over real
 * support, so the takeoff's '20 ft stock (field splice)' row books with the
 * bearing named instead of silently. Spanning members use the FLAG instead.
 * FABRICATION data → 400 only, exactly like rafterCutData (plumb cuts/HAP):
 * at 300 these members stay byte-equal to the shipped output. */
function splicedNote(spec: FramingSpec, length: number, over: string): string {
  if (spec.detail !== '400') return ''
  return length > MAX_ONE_PIECE + EPS ? ` — spliced over ${over}` : ''
}

/**
 * Ceiling joists: sized from the table, lapped over the interior bearing
 * partition (R802.5.1 / R802.5.2.1) — W15.
 *
 * A one-piece joist eave to eave rarely fits Table R802.5.1(2): the
 * generator's houses span 5–7 m and the 2x6 @ 16" row stops at 3.90 m. A
 * framer never buys a 2x6 for that — he laps the joists over the interior
 * partition that runs with the ridge (12 in on site; R802.5.2.1 asks ≥ 3
 * in, nailed together per Table R802.5.2(1) so the tie still resists the
 * rafter thrust), and where no partition runs under a station he goes up
 * the table (2x8, 2x10 — the deepest row) or calls an engineered member.
 * The planner answers per STATION: the partition covering that station
 * nearest mid-span carries the lap; stations past every partition stay
 * one piece. Each piece is checked against the table on ITS span (eave
 * line to the partition centreline — conservative by the plate width);
 * the size steps up the 2x ladder from the spec stock until a row spans
 * it, and only when the deepest row still cannot span the piece does the
 * over-span flag ride the member. LOD 200 keeps the schematic one-piece
 * joist at the spec size (no flags there, as before).
 */

/** Lap at the bearing partition — the site convention (R802.5.2.1 minimum 3 in). */
export const CJ_LAP = inches(12)
/** A partition this close (m) to an eave line is the eave wall itself or a
 * closet wall beside it — never the mid-span bearing. */
const CJ_BEARING_EAVE_CLEAR = 0.65
/** Shorter partitions are closet returns (the floor engine's bearing-wall
 * length convention, `BEARING_WALL_MIN`). */
const CJ_BEARING_MIN_LENGTH = 1.5
/** A wall shorter than this is a pony / knee wall — nothing to lap on. */
const CJ_BEARING_MIN_HEIGHT = 1.8
/** "Runs with the ridge" tolerance (the floor engine's ±10° convention). */
const CJ_BEARING_ANGLE_TAN = Math.tan((10 * Math.PI) / 180)

/** An interior partition the joists can lap over, in the segment's frame. */
export interface CeilingJoistBearing {
  wallId: string
  /** Partition centreline along the JOIST axis (span-centre origin, m). */
  at: number
  /** Extent along the ridge axis the partition covers, clipped to the roof. */
  cover: readonly [number, number]
}

/** One buy-length piece along the joist axis (span-centre origin), UNCLIPPED. */
export interface CeilingJoistPiece {
  from: number
  to: number
  /** Order along the axis from the −eave: odd pieces sit beside their mates, one thickness over. */
  index: number
  size: LumberSize
  /** Stock thickness / depth (m). */
  t: number
  d: number
  /** The support-to-support span the size was chosen for (m). */
  span: number
  /** Table span for `size` at the plan spacing (undefined = no row). */
  allowable: number | undefined
  /** Over-span flag when even the deepest row cannot span the piece. */
  flag: string | undefined
  /** Label suffix — the lap, the sizing and the spacing story ('' when none applies). */
  note: string
}

/** The joist line at one station: the partitions it laps over and its pieces. */
export interface CeilingJoistVariant {
  /** Partitions the line breaks at, −eave → +eave (empty = one piece). */
  breaks: CeilingJoistBearing[]
  pieces: CeilingJoistPiece[]
  /** The deepest piece. */
  dMax: number
}

export interface CeilingJoistPlan {
  /** Joist stock thickness (every 2x row shares it). */
  t: number
  /** The deepest joist any station emits — the strut-bearing / band gate. */
  dMax: number
  /** Station spacing — the spec's, or 12" when tightening removed over-span flags. */
  spacing: number
  /** Partitions available to the segment, nearest mid-span first. */
  bearings: CeilingJoistBearing[]
  /** The joist line at a station (its ridge-axis coordinate). */
  at: (ridge: number) => CeilingJoistVariant
  /** The first piece covering joist-axis coordinate `u` at `station` (the base piece at a lap). */
  pieceAt: (station: number, u: number) => CeilingJoistPiece | undefined
  /** Sideways shift of the odd pieces at `station` (beside their mates). */
  shiftAt: (station: number) => number
  /** Sideways shift of the piece covering `u` at `station` (0 on even pieces). */
  lapOffsetAt: (station: number, u: number) => number
}

/**
 * Interior partitions that can carry a ceiling-joist lap: straight, ≥ 1.5
 * m long, full height, running WITH the ridge (±10°), well inside the
 * eave lines. `spansZ` = the joists run along segment-local Z (stations
 * along X — the gable convention); `span` = the eave-to-eave span; `bandHalf`
 * = the roof's half-extent along the ridge axis. Nearest mid-span first.
 */
export function ceilingJoistBearingsFor(
  roof: RoofSegmentSlice,
  walls: readonly WallSlice[],
  spansZ: boolean,
  span: number,
  bandHalf: number,
): CeilingJoistBearing[] {
  const cos = Math.cos(roof.yaw)
  const sin = Math.sin(roof.yaw)
  // level-local → segment-local: the inverse of emitter()'s yaw
  // (wx = x·cos + z·sin, wz = −x·sin + z·cos).
  const toLocal = (p: readonly [number, number]): [number, number] => {
    const dx = p[0] - roof.position[0]
    const dz = p[1] - roof.position[2]
    return [dx * cos - dz * sin, dx * sin + dz * cos]
  }
  const out: CeilingJoistBearing[] = []
  for (const wall of walls) {
    if (wall.exterior || wall.curved) continue
    if (wall.length < CJ_BEARING_MIN_LENGTH || wall.height < CJ_BEARING_MIN_HEIGHT) continue
    const a = toLocal(wall.start)
    const b = toLocal(wall.end)
    const spanA = spansZ ? a[1] : a[0]
    const spanB = spansZ ? b[1] : b[0]
    const ridgeA = spansZ ? a[0] : a[1]
    const ridgeB = spansZ ? b[0] : b[1]
    if (Math.abs(spanB - spanA) > CJ_BEARING_ANGLE_TAN * Math.abs(ridgeB - ridgeA)) continue
    const at = (spanA + spanB) / 2
    if (Math.abs(at) > span / 2 - CJ_BEARING_EAVE_CLEAR) continue
    const lo = Math.max(-bandHalf, Math.min(ridgeA, ridgeB))
    const hi = Math.min(bandHalf, Math.max(ridgeA, ridgeB))
    if (hi - lo < CJ_BEARING_MIN_LENGTH - EPS) continue
    out.push({ wallId: wall.id, at, cover: [lo, hi] })
  }
  return out.sort((p, q) => Math.abs(p.at) - Math.abs(q.at) || p.wallId.localeCompare(q.wallId))
}

/**
 * The smallest 2x stock from the spec size up whose Table R802.5.1(2) row
 * spans `span` at `spacing`, never deeper than `maxDepth` (a hip ridge
 * overhead caps it). `fits` false = the deepest eligible row still falls
 * short — the spec stock is returned with the honest flag to follow.
 */
export function ceilingJoistSizeFor(
  spec: FramingSpec,
  span: number,
  maxDepth = Number.POSITIVE_INFINITY,
  spacing = spec.ceilingJoistSpacing,
): { size: LumberSize; allowable: number | undefined; fits: boolean; deepest: LumberSize } {
  const stock = spec.ceilingJoistSize
  const stockAllowable = tableSpanFor(spec.ceilingJoistSpans, stock, spacing)
  if (stockAllowable === undefined) {
    return { size: stock, allowable: undefined, fits: true, deepest: stock }
  }
  if (span <= stockAllowable + EPS) {
    return { size: stock, allowable: stockAllowable, fits: true, deepest: stock }
  }
  const start = Math.max(0, LUMBER_SIZES.indexOf(stock))
  let deepest: LumberSize = stock
  let deepestAllowable = stockAllowable
  for (const candidate of LUMBER_SIZES.slice(start + 1)) {
    if (!candidate.startsWith('2x')) continue
    const allowable = tableSpanFor(spec.ceilingJoistSpans, candidate, spacing)
    if (allowable === undefined) continue
    if (LUMBER_CROSS_SECTIONS[candidate][1] > maxDepth + EPS) break
    deepest = candidate
    deepestAllowable = allowable
    if (span <= allowable + EPS)
      return { size: candidate, allowable, fits: true, deepest: candidate }
  }
  return { size: stock, allowable: deepestAllowable, fits: false, deepest }
}

/**
 * The partitions a joist line breaks at: walking from the −eave, the
 * fewest laps that keep every piece within the spec stock's row — each
 * break the farthest partition the stock still reaches; when the next
 * partition is already past the row the line breaks there anyway (the
 * piece sizes up, or flags). Partitions closer than two laps to the last
 * break are skipped (the pieces would overlap each other).
 */
function ceilingJoistBreaks(
  covering: readonly CeilingJoistBearing[],
  span: number,
  stockAllowable: number | undefined,
): CeilingJoistBearing[] {
  const out: CeilingJoistBearing[] = []
  if (stockAllowable === undefined) return out
  const sorted = [...covering].sort((a, b) => a.at - b.at)
  let s = -span / 2
  for (;;) {
    if (span / 2 - s <= stockAllowable + EPS) break
    const ahead = sorted.filter((b) => b.at - s >= 2 * CJ_LAP)
    if (ahead.length === 0) break
    const within = ahead.filter((b) => b.at - s <= stockAllowable + EPS)
    const pick = (within.length > 0 ? within[within.length - 1] : ahead[0]) as CeilingJoistBearing
    out.push(pick)
    s = pick.at
  }
  return out
}

function ceilingJoistVariantFor(
  spec: FramingSpec,
  spacing: number,
  span: number,
  covering: readonly CeilingJoistBearing[],
  maxDepth: number,
  tightened: boolean,
): CeilingJoistVariant {
  const stock = spec.ceilingJoistSize
  const [stockT, stockD] = LUMBER_CROSS_SECTIONS[stock]
  if (spec.detail === '200') {
    return {
      breaks: [],
      pieces: [
        {
          from: -span / 2,
          to: span / 2,
          index: 0,
          size: stock,
          t: stockT,
          d: stockD,
          span,
          allowable: undefined,
          flag: undefined,
          note: '',
        },
      ],
      dMax: stockD,
    }
  }
  const stockAllowable = tableSpanFor(spec.ceilingJoistSpans, stock, spacing)
  const breaks = ceilingJoistBreaks(covering, span, stockAllowable)
  const edges = [-span / 2, ...breaks.map((b) => b.at), span / 2]
  const oc = `${ocIn(spacing)} o.c.`
  const spacingNote = tightened
    ? ` — @ ${oc}, tightened from ${ocIn(spec.ceilingJoistSpacing)} o.c. for the span (R802.5.1(2))`
    : ''
  const pieces: CeilingJoistPiece[] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i] as number
    const b = edges[i + 1] as number
    const pieceSpan = b - a
    const sized = ceilingJoistSizeFor(spec, pieceSpan, maxDepth, spacing)
    const [t, d] = LUMBER_CROSS_SECTIONS[sized.size]
    const before = breaks[i - 1]
    const after = breaks[i]
    const names = [before?.wallId, after?.wallId].filter((n): n is string => n !== undefined)
    const plural = names.length > 1 ? 's' : ''
    const lapNote =
      names.length === 0
        ? ''
        : ` — lapped ${formatIn(CJ_LAP)} over bearing partition${plural} ${names.join(' and ')} (R802.5.2.1; nailed together per Table R802.5.2(1))`
    const sizeNote =
      sized.size === stock
        ? ''
        : ` — ${sized.size} from the R802.5.1(2) table for the ${fmtM(pieceSpan)} span (spec ${stock})`
    let flag: string | undefined
    if (!sized.fits && sized.allowable !== undefined) {
      const deepest = `${sized.deepest} @ ${oc}${sized.deepest === stock ? '' : ' (the deepest R802.5.1(2) row)'}`
      flag =
        names.length === 0
          ? `Ceiling joist over prescriptive span — ${fmtM(pieceSpan)} > ${fmtM(sized.allowable)} allowable ` +
            `(${deepest}, SPF #2, R802.5.1(2) limited storage) — no interior partition runs with the ridge ` +
            'under these joists to lap over (R802.5.2.1); engineered member required'
          : `Ceiling joist over prescriptive span — even lapped over partition${plural} ${names.join(' and ')} ` +
            `the ${fmtM(pieceSpan)} piece exceeds ${fmtM(sized.allowable)} allowable ` +
            `(${deepest}, SPF #2, R802.5.1(2) limited storage) — engineered member required`
    } else {
      const buy = pieceSpan + (before ? CJ_LAP / 2 : 0) + (after ? CJ_LAP / 2 : 0)
      flag = onePieceFlag('Ceiling joist', buy)
    }
    pieces.push({
      from: before ? a - CJ_LAP / 2 : a,
      to: after ? b + CJ_LAP / 2 : b,
      index: i,
      size: sized.size,
      t,
      d,
      span: pieceSpan,
      allowable: sized.allowable,
      flag,
      note: `${lapNote}${sizeNote}${spacingNote}`,
    })
  }
  return { breaks, pieces, dMax: Math.max(...pieces.map((p) => p.d)) }
}

/** The tighter spacing the planner may fall back to (the 12" column of the table). */
const CJ_TIGHT_SPACING = inches(12)

/**
 * Plan a segment's ceiling joists against the level's walls. `spansZ`,
 * `span`, `bandHalf` as in `ceilingJoistBearingsFor`; `maxDepth` caps the
 * stock (a hip ridge board overhead). `parallel` = the ridge-axis stations
 * of members running WITH the joists (rafter planes, jacks) the shifted
 * pieces must not land in; `stationHalfFor(depth)` bounds the shift.
 *
 * The stations along the band see different partition sets (a hall wall
 * covers the middle, a bedroom wall one end); every set is planned on its
 * own. When some piece still flags at the spec spacing and the 12" column
 * clears flags, the whole segment's joists go to 12" o.c. — the table's
 * own next move before an engineered member.
 */
export function planCeilingJoists(
  roof: RoofSegmentSlice,
  walls: readonly WallSlice[],
  spec: FramingSpec,
  opts: {
    spansZ: boolean
    span: number
    bandHalf: number
    maxDepth?: number
    parallel: readonly number[]
    parallelHalfT: number
    stationHalfFor: (depth: number) => number
  },
): CeilingJoistPlan {
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY
  const schematic = spec.detail === '200'
  const bearings = schematic
    ? []
    : ceilingJoistBearingsFor(roof, walls, opts.spansZ, opts.span, opts.bandHalf)
  const coveringAt = (ridge: number): CeilingJoistBearing[] =>
    bearings.filter((b) => ridge >= b.cover[0] - EPS && ridge <= b.cover[1] + EPS)
  const keyOf = (cov: readonly CeilingJoistBearing[]) => cov.map((b) => b.wallId).join('|')
  // the partition sets that occur along the band (sampled; the ends included)
  const sets = new Map<string, CeilingJoistBearing[]>()
  sets.set('', [])
  const SAMPLE = 0.1
  for (let r = -opts.bandHalf; r <= opts.bandHalf + EPS; r += SAMPLE) {
    const cov = coveringAt(r)
    sets.set(keyOf(cov), cov)
  }
  const build = (spacing: number, tightened: boolean) => {
    const m = new Map<string, CeilingJoistVariant>()
    for (const [k, cov] of sets) {
      m.set(k, ceilingJoistVariantFor(spec, spacing, opts.span, cov, maxDepth, tightened))
    }
    return m
  }
  const overSpanCount = (m: Map<string, CeilingJoistVariant>) => {
    let n = 0
    for (const v of m.values()) {
      for (const p of v.pieces) if (p.flag?.startsWith('Ceiling joist over prescriptive span')) n++
    }
    return n
  }
  let spacing = spec.ceilingJoistSpacing
  let variants = build(spacing, false)
  if (!schematic && spacing > CJ_TIGHT_SPACING + EPS && overSpanCount(variants) > 0) {
    const tight = build(CJ_TIGHT_SPACING, true)
    if (overSpanCount(tight) < overSpanCount(variants)) {
      spacing = CJ_TIGHT_SPACING
      variants = tight
    }
  }
  const tightened = spacing !== spec.ceilingJoistSpacing
  const at = (ridge: number): CeilingJoistVariant => {
    const cov = coveringAt(ridge)
    const k = keyOf(cov)
    let v = variants.get(k)
    if (v === undefined) {
      v = ceilingJoistVariantFor(spec, spacing, opts.span, cov, maxDepth, tightened)
      variants.set(k, v)
    }
    return v
  }
  const dMax = Math.max(...[...variants.values()].map((v) => v.dMax))
  const t = LUMBER_CROSS_SECTIONS[spec.ceilingJoistSize][0]
  const clashes = (x: number, half: number) =>
    opts.parallel.some((rx) => Math.abs(rx - x) < opts.parallelHalfT + half - EPS)
  const shiftAt = (station: number): number => {
    const v = at(station)
    if (v.breaks.length === 0) return 0
    // beside its mate toward the roof centre, unless a rafter plane sits
    // there — then the other side; always inside the station band.
    const toward = station > 0 ? -t : t
    const stationHalf = opts.stationHalfFor(v.dMax)
    for (const shift of [toward, -toward]) {
      const x = station + shift
      if (Math.abs(x) + t / 2 > stationHalf + EPS) continue
      if (clashes(x, t / 2)) continue
      return shift
    }
    return toward
  }
  const pieceAt = (station: number, u: number): CeilingJoistPiece | undefined =>
    at(station).pieces.find((p) => u >= p.from - EPS && u <= p.to + EPS)
  const lapOffsetAt = (station: number, u: number): number => {
    const piece = pieceAt(station, u)
    return piece !== undefined && piece.index % 2 === 1 ? shiftAt(station) : 0
  }
  return { t, dMax, spacing, bearings, at, pieceAt, shiftAt, lapOffsetAt }
}

/** Clip a piece's eave end(s) by `clip` (the B6 inscribed box); span-centre origin. */
export function clipCeilingJoistPiece(
  piece: Pick<CeilingJoistPiece, 'from' | 'to'>,
  span: number,
  clip: number,
): { from: number; to: number } {
  const from = piece.from <= -span / 2 + EPS ? piece.from + clip : piece.from
  const to = piece.to >= span / 2 - EPS ? piece.to - clip : piece.to
  return { from, to }
}

/**
 * Level warnings for the lapped joists: which partitions carry the laps —
 * they must be framed as BEARING walls (the wall engine frames every
 * partition alike; the load path below is the reader's check).
 */
export function ceilingJoistBearingWarnings(members: readonly Member[]): string[] {
  const byWall = new Map<string, number>()
  for (const m of members) {
    if (m.role !== 'ceiling-joist') continue
    const hit = / over bearing partitions? (.+?) \(R802\.5\.2\.1/.exec(m.label ?? '')
    if (hit === null) continue
    for (const id of (hit[1] as string).split(' and ')) byWall.set(id, (byWall.get(id) ?? 0) + 1)
  }
  if (byWall.size === 0) return []
  const list = [...byWall.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, n]) => `${id} (${n} joist pieces)`)
    .join(', ')
  return [
    `ceiling joists lap over interior partition${byWall.size === 1 ? '' : 's'} ${list} ` +
      '(R802.5.2.1) — frame as BEARING: double top plate, studs stacked over the floor girder / ' +
      'thickened slab below, the lap nailed per Table R802.5.2(1)',
  ]
}

/**
 * Emit the planned joist piece(s) at a station (W15): the base piece at
 * the station, the lapped piece beside it (`lapOffsetAt`), each clipped at
 * its eave end by `clipFor(depth)` (the B6 inscribed box). `spansZ` = the
 * joist axis is segment-local Z (the +X box yawed −π/2), else X.
 */
function emitCeilingJoistPieces(
  emit: Emit,
  plan: CeilingJoistPlan,
  station: number,
  spansZ: boolean,
  span: number,
  clipFor: (depth: number) => number,
  plateY: number,
  labelFor: (size: LumberSize) => string,
  extraFlag?: string,
): void {
  const v = plan.at(station)
  const shift = v.breaks.length > 0 ? plan.shiftAt(station) : 0
  for (const piece of v.pieces) {
    const { from, to } = clipCeilingJoistPiece(piece, span, clipFor(piece.d))
    const len = to - from
    if (len < 0.3) continue
    const centre = (from + to) / 2
    const x = station + (piece.index % 2 === 1 ? shift : 0)
    const flag =
      [piece.flag, extraFlag].filter((f): f is string => f !== undefined).join(' | ') || undefined
    emit(
      'ceiling-joist',
      piece.size,
      [len, piece.d, piece.t],
      spansZ ? [x, plateY + piece.d / 2, centre] : [centre, plateY + piece.d / 2, x],
      spansZ ? -Math.PI / 2 : 0,
      0,
      len,
      'lumber',
      `${labelFor(piece.size)}${piece.note}`,
      undefined,
      flag,
    )
  }
}

// ---------------------------------------------------------------------------
// Roof deck (LOD-400 B6) — R803.2 sheathing on the rafter planes
// ---------------------------------------------------------------------------

/** 7/16" WSP roof deck (R803.2, fastened per Table R602.3(1)). */
const ROOF_DECK_T = inches(7 / 16)
/** Strip height (plan run) when tiling TAPERED planes (hip/skirt). Each
 * strip takes its width at its UPHILL edge so it stays inside the hip/arris
 * lines — the under-tile per hip edge is ≈ run·strip·taper/cosθ, so the
 * strip pitch bounds the loss (~8% on a default hip at 0.4 m — stated on
 * the members' labels; the takeoff books what renders, S4). */
const DECK_STRIP = 0.4
/** Panel clearance off hip/arris lines (strips stay inside the plane). */
const DECK_CLEAR = 0.02
/** Minimum panel dimension worth emitting. */
const DECK_MIN = 0.1

/** Edge gap at a panel's UP/DOWNHILL plan edges: the square-cut end faces
 * tilt with the plane, so their corners reach (t/2)·sinθ past the plan edge
 * — the gap keeps them clear of the mirrored panel at a ridge/kink and of
 * the fascia band at the eave (the ridge-vent / drip-edge seams). */
const deckGap = (theta: number): number => (ROOF_DECK_T / 2) * Math.sin(theta) + 0.002

/** The gap at a RIDGE (or purlin) board: the board's top rides the rafter
 * tops, so the panels must also stay clear of its half thickness in plan. */
const ridgeDeckGap = (theta: number, boardT: number): number => boardT / 2 + deckGap(theta)

const DECK_LABEL = 'Roof sheathing 7/16" WSP — 8d @ 6"/12" edges/field (R803.2, Table R602.3(1))'

/** Underlayment membrane drawn thickness — the wall-layers WRB convention
 * (a thin box; real felt has no structural thickness). */
const UNDERLAYMENT_T = 0.002
/** The TOP membrane carries the assumption-label contract: the covering
 * itself (shingles/metal/tile) stays HOST cosmetic and is never booked. */
const UNDERLAYMENT_LABEL =
  'Roof underlayment — one layer felt/synthetic (R905.1.1); covering by finish schedule — not booked'

type DeckPanelSpec = {
  theta: number
  side: 1 | -1
  alongXAxis: boolean
  u0: number
  u1: number
  zTop: number
  zBot: number
  yTop: number
}

/** Drawn area of a strip batch (deckPlane's own skip predicate mirrored)
 * and the HONEST per-compose note: tapered planes state the EXACT coverage
 * they achieve, so 'slight under-tile' can never paper over a
 * scene-dependent shortfall (round-1 examiner F2: a 5×4 @ 30° hip books
 * 84.4% while the 10×8 gate floor sat at 85%). */
function tiledDeckNote(
  panels: DeckPanelSpec[],
  planeArea: number,
  what: string,
): { note: string; drawn: number } {
  let drawn = 0
  for (const p of panels) {
    const len = p.u1 - p.u0
    const slopeW = (p.zBot - p.zTop) / Math.cos(p.theta)
    if (len < DECK_MIN || slopeW < DECK_MIN) continue
    drawn += len * slopeW
  }
  const pct = planeArea > EPS ? Math.round((drawn / planeArea) * 1000) / 10 : 100
  return {
    drawn,
    note: ` — strip-tiled: conservative under-tile, ${pct.toFixed(1)}% of plane area; trim to ${what} on site`,
  }
}

/**
 * One deck panel on a slope plane. Geometry in the SEGMENT frame: the
 * plane's eave (level) direction runs along X when `alongXAxis` (downhill =
 * ±Z via `side`), else along Z (downhill = ±X). `zTop`→`zBot` is the
 * panel's PLAN band on the downhill axis measured from the segment center
 * (zTop uphill of zBot; negative allowed — the shed's high edge crosses the
 * center); `yTop` is the RAFTER-CENTERLINE plane height at `zTop` (falling
 * at tanθ downhill); `u0`→`u1` bound the panel along the eave axis. The
 * deck rides the rafter TOP faces — `rafterDepth/2 + t/2` up the plane
 * normal (the outlooker roll convention), SLID up-slope so the panel's plan
 * extents equal [zTop, zBot] exactly: callers own the edge gaps (deckGap)
 * that keep the tilted end faces clear of ridges, kinks and the fascia
 * band, while adjacent strips in one plane meet edge-to-edge (coplanar
 * exact contact — the stud-on-plate convention, zero shared volume).
 */
function deckPlane(
  emit: Emit,
  spec: FramingSpec,
  opts: {
    theta: number
    side: 1 | -1
    alongXAxis: boolean
    u0: number
    u1: number
    zTop: number
    zBot: number
    yTop: number
    rafterDepth: number
    note?: string
    /** Rides the DECK member only (one Flags row per statement class). */
    flag?: string
  },
) {
  if (spec.detail === '200') return
  const { theta, side, alongXAxis, u0, u1, zTop, zBot, yTop, rafterDepth, note = '', flag } = opts
  const cosT = Math.cos(theta)
  const len = u1 - u0
  const slopeW = (zBot - zTop) / cosT
  if (len < DECK_MIN || slopeW < DECK_MIN) return
  const along = (u0 + u1) / 2
  const zm = (zTop + zBot) / 2
  const ym = yTop - (zm - zTop) * Math.tan(theta)
  // Roll spins the box about its long (+X) axis so its local +Y aligns with
  // the plane normal — the outlooker convention. Along-Z panels yaw −π/2
  // first (local +X → +Z, local +Z → −X), which flips the roll sign.
  const roll = alongXAxis ? side * theta : -side * theta
  const yaw = alongXAxis ? 0 : -Math.PI / 2
  // Normal offset + in-plane slide back to the band: vertically that is
  // up/cosθ (the dropped-gable olT/cosθ convention) with the plan center
  // staying at zm — the panel covers [zTop, zBot] exactly. The membrane
  // stacks 1:1 ON the deck, one thickness further up the normal — the
  // wall-layers emitStack pattern (each layer advances its own thickness).
  const cross = side * zm
  const layer = (
    role: Member['role'],
    up: number,
    t: number,
    material: Member['material'],
    label: string,
    memberFlag?: string,
  ) => {
    const y = ym + up / cosT
    emit(
      role,
      undefined,
      [len, t, slopeW],
      alongXAxis ? [along, y, cross] : [cross, y, along],
      yaw,
      0,
      len,
      material,
      label,
      roll,
      memberFlag,
    )
  }
  layer(
    'sheathing',
    rafterDepth / 2 + ROOF_DECK_T / 2,
    ROOF_DECK_T,
    'engineered',
    DECK_LABEL + note,
    flag,
  )
  layer(
    'wrb',
    rafterDepth / 2 + ROOF_DECK_T + UNDERLAYMENT_T / 2,
    UNDERLAYMENT_T,
    'lumber',
    UNDERLAYMENT_LABEL + note,
  )
}

/**
 * Steel hurricane tie block at a rafter bearing (IRC R802.11 uplift path).
 * NIGHT-10 (the B10 skeptic's residual): the sub-130 mph coastal belt
 * (`hurricaneTies` without `highWindUplift` — TX/AL/CT/DE/GA/MA/MS/NJ/NY/
 * NC/RI/SC) books roof ties while the WALL engine deliberately models no
 * continuation (S16 keeps those walls byte-equal to INTL), so the tie
 * itself states its scope instead of implying a full path. ≥ 130 mph
 * (`highWindUplift` — LA/HI/FL) keeps the plain label: B10's wall
 * connectors/straps ARE the continuation there.
 * CANADA round-1 skeptic (2026-08-24): a THIRD class exists since the CA
 * rows — ≥ 130 mph WITHOUT the researched flag (`highWindTiesOnly`, today
 * exactly CA-NU at 140 mph): the belt clause's 'below 130 mph' would be
 * factually false there and the plain label would imply a wall
 * continuation S16 never builds, so this class states exactly what holds
 * (its compute also carries the non-IRC confession — CA-NU is NBC).
 */
/**
 * The roof-to-wall connector the plans call out: Simpson Strong-Tie H2.5A
 * (or an equal listed connector) at every rafter or truss bearing, nailed
 * (5) 8d×1½" into the rafter and (5) 8d×1½" into the double top plate —
 * the catalog nailing for that part. The IRC names no manufacturer
 * (R802.11 asks for the uplift connection); the part is what a permit set
 * prints, so the member says it.
 */
export const HURRICANE_TIE_LABEL =
  'hurricane tie — Simpson H2.5A or equal, (5) 8d×1½" to the rafter + (5) 8d×1½" to the plate (R802.11)'

function tieAt(emit: Emit, spec: FramingSpec, x: number, z: number, y: number) {
  emit(
    'blocking',
    undefined,
    [inches(1.5), inches(3), inches(3)],
    [x, y, z],
    0,
    0,
    inches(3),
    'steel',
    spec.highWindUplift
      ? HURRICANE_TIE_LABEL
      : spec.highWindTiesOnly
        ? `${HURRICANE_TIE_LABEL} (roof-to-wall ties only — high-wind wall/foundation uplift continuation not modeled for this jurisdiction (no prescriptive-uplift flag in its researched data); verify against the governing code)`
        : `${HURRICANE_TIE_LABEL} (roof-to-wall ties only — wall/foundation uplift path not modeled below 130 mph design wind)`,
  )
}

/** Shorter than this and the infill stud is a shim, not a stud. */
const INFILL_STUD_MIN = inches(3)

/**
 * Framed infill above the plate on a wall the roof rises over — the gable
 * triangle, a shed's high-side pediment and its raking sides, a gambrel's end
 * profile. Studs at the wall's o.c. module stand ON the double top plate and
 * run up to the underside of the rafter over the wall, tops cut to the slope
 * (the box inscribes under it). PlanCrafters frames the same triangle
 * (framing.js: "the framing view showed an empty triangle with the end
 * rafters floating"); without it a shed's high wall has nothing above the
 * plate. Stud depth fits the wall the segment declares so the studs never
 * grow past the wall faces (the wall framer's fitAcross rule).
 *
 * `alongX`: the wall runs along the segment X axis at z = `at` and the
 * stations are x; otherwise it runs along Z at x = `at`. `topAt(u)` is the
 * rafter-underside height ABOVE the plate at station u; `topSlope` its
 * |dy/du|, which sets the plumb-cut inset.
 */
/**
 * Where the infill studs sit across the wall line. A segment over a real wall
 * (`wallThickness` > 0) centres the studs on the wall line, depth fitted to
 * the wall. A synthetic inner shape (the dutch gablet: `wallThickness` 0 —
 * nothing below its plate but the skirt) stands its studs INBOARD of the
 * line at full depth, so they never reach over the skirt deck. `inboard` is
 * how far the stud zone extends inside the wall line — the ceiling joists'
 * and purlins' end bands stop there.
 */
function infillZone(
  spec: FramingSpec,
  roof: RoofSegmentSlice,
): { depth: number; inboard: number; offset: number } {
  const [, studDepth] = LUMBER_CROSS_SECTIONS[spec.exteriorStudSize]
  const wall = roof.wallThickness ?? 0.1
  if (wall > EPS) {
    const depth = Math.min(studDepth, wall)
    return { depth, inboard: depth / 2, offset: 0 }
  }
  return { depth: studDepth, inboard: studDepth, offset: studDepth / 2 }
}

/** Table R602.3(5) laterally-unsupported stud heights: bearing walls 10 ft
 * (any listed size); non-bearing 2x4 14 ft, 2x6 20 ft. Past them the wall is
 * an engineered / balloon-framed wall, and the stud says so. */
function infillHeightFlag(
  spec: FramingSpec,
  h: number,
  bearing: boolean,
  what: string,
): string | undefined {
  const limit = bearing ? feet(10) : spec.exteriorStudSize === '2x4' ? feet(14) : feet(20)
  if (h <= limit + EPS) return undefined
  return `${what} ${fmtM(h)} tall exceeds the Table R602.3(5) ${
    bearing
      ? 'bearing-wall 10 ft'
      : `non-bearing ${spec.exteriorStudSize} ${Math.round(limit / feet(1))} ft`
  } stud height — engineered or balloon-framed wall required (R602.3.1); verify`
}

function infillStuds(
  emit: Emit,
  spec: FramingSpec,
  roof: RoofSegmentSlice,
  opts: {
    plateY: number
    alongX: boolean
    at: number
    from: number
    to: number
    topAt: (u: number) => number
    topSlope: number
    label: string
    /** The studs carry rafter ends (a shed's high wall) — the bearing height limit applies. */
    bearing?: boolean
  },
) {
  const [t] = LUMBER_CROSS_SECTIONS[spec.exteriorStudSize]
  const zone = infillZone(spec, roof)
  const { plateY, alongX, at, from, to, topAt, topSlope, label, bearing = false } = opts
  // `at` is the wall line; a synthetic shape's studs shift inboard (toward the roof centre).
  const line = at - Math.sign(at) * zone.offset
  for (let u = from + spec.studSpacing; u < to - t / 2 - EPS; u += spec.studSpacing) {
    const h = topAt(u) - (t / 2) * topSlope
    if (h < INFILL_STUD_MIN) continue
    emit(
      'stud',
      spec.exteriorStudSize,
      [t, h, zone.depth],
      alongX ? [u, plateY + h / 2, line] : [line, plateY + h / 2, u],
      alongX ? 0 : -Math.PI / 2,
      0,
      h,
      'lumber',
      label,
      undefined,
      infillHeightFlag(spec, h, bearing, label.split(' ')[0] ?? 'Stud'),
    )
  }
}

const infillLabel = (spec: FramingSpec, what: string): string =>
  `${what} ${spec.exteriorStudSize} @ ${ocIn(spec.studSpacing)} o.c. — on the top plate, cut to the rafter`

function frameGable(
  roof: RoofSegmentSlice,
  spec: FramingSpec,
  members: Member[],
  walls: readonly WallSlice[] = [],
) {
  const emit = emitter(roof, members)
  const [t, rd] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  const halfT = t / 2
  const theta = roof.pitch
  const tan = Math.tan(theta)
  const cosT = Math.cos(theta)
  const run = roof.depth / 2
  const rise = run * tan
  // The rafter's BOTTOM face bears on the plate: its centre line runs `seat`
  // (half the plumb depth) above the plane through the plate top — the way
  // PlanCrafters lifts every rafter and the flat framer already seats its
  // joists. Plate-bound members (ceiling joists, ties, struts) keep `plateY`;
  // everything that rides the rafters follows `eaveY`.
  const plateY = roof.wallHeight
  const seat = rd / (2 * cosT)
  const eaveY = plateY + seat
  const ridgeY = eaveY + rise
  const halfWall = infillZone(spec, roof).inboard
  // Rafters bear on the ridge FACES: each plumb cut stops half the ridge
  // thickness short of the centerline (round-10 gate: centerline rafters
  // buried themselves in the ridge AND in the opposite slope's rafters).
  const [ridgeT] = LUMBER_CROSS_SECTIONS[ridgeSizeFor(spec.rafterSize)]
  const ridgeFaceZ = ridgeT / 2
  const ridgeFaceY = ridgeY - ridgeFaceZ * tan

  // ---- rafters, both slopes ----
  // Slope length: overhung eave tip to the ridge face, along the slope.
  // Both ends are PLUMB cuts; a square-ended box's corners overshoot each
  // cut plane by (rd/2)·tanθ, so the box is inscribed — pulled back that
  // much per end (centers stay on the face→tip midpoint).
  const plumbInset = (rd / 2) * tan
  const slopeLen = run / cosT + roof.overhang - ridgeFaceZ / cosT - 2 * plumbInset
  const cuts = rafterCutData(spec, theta, rd)
  const xs = layout(-roof.width / 2, roof.width / 2, spec.rafterSpacing, halfT)

  // ---- span discipline (R802.4.1): mid-span purlin fix, or the honest flag ----
  // Ceiling-joist stock decides the strut bearing plane (they exist in every
  // gable — the rafter ties of R802.4.2), so it is resolved up here. W15:
  // the joists are planned against the interior partitions — sized per
  // station from the table, lapped over the partition under them — and
  // the strut gate below rides the deepest joist the plan emits.
  const cjPlan = planCeilingJoists(roof, walls, spec, {
    spansZ: true,
    span: roof.depth,
    bandHalf: roof.width / 2,
    parallel: xs,
    parallelHalfT: halfT,
    stationHalfFor: () => roof.width / 2 - halfWall,
  })
  const cjT = cjPlan.t
  const cjD = cjPlan.dMax
  const allowable = rafterAllowable(spec)
  const overSpan = allowable !== undefined && run > allowable + EPS
  // Purlin line at half the run: the rafter UNDERSIDE there (centerline lies
  // on the tip→ridge-face slope line; the bottom face sits rd/(2cosθ) below
  // it measured vertically), purlin plumb on edge right under, struts to the
  // ceiling joists. A plumb purlin meets the SLOPED underside at its DOWNHILL
  // top corner — the top face drops (t/2)·tanθ below the plane at the line so
  // the corner touches instead of burying itself (SAT gate; shimmed on site).
  const purlinZ = run / 2
  const purlinYUnder = ridgeFaceY - (purlinZ - ridgeFaceZ) * tan - rd / (2 * cosT)
  const purlinTop = purlinYUnder - (t / 2) * tan
  const strutTop = purlinTop - rd // purlin stock = rafter stock, on edge
  const strutBot = plateY + cjD // ceiling-joist top face
  // The purlin fix only holds when the HALVED projection fits the table AND
  // the struts have real height down to the ceiling-joist bearing (S1: no
  // floating struts) AND the roof is wide enough for a real purlin between
  // the end rafters — otherwise keep the flag instead of fake support.
  const purlinFix =
    overSpan &&
    run / 2 <= (allowable ?? 0) + EPS &&
    strutTop - strutBot >= inches(3) &&
    (xs[xs.length - 1] ?? 0) - (xs[0] ?? 0) - t > 0.3
  const rafterFlag =
    overSpan && !purlinFix
      ? rafterOverSpanFlag(spec, run, allowable as number)
      : purlinFix
        ? undefined
        : spec.detail === '200'
          ? undefined
          : onePieceFlag('Rafter', slopeLen)
  const purlinNote = purlinFix
    ? ` — purlin-supported @ mid-span (R802.5.1)${
        slopeLen > MAX_ONE_PIECE + EPS ? '; splice over purlin bearing' : ''
      }`
    : ''

  // Rake detail (below) lays flat outlookers OVER the gable-end rafters —
  // those two rafters DROP by the outlooker thickness so the ladder passes
  // (the conventional dropped-gable detail; round-10 gate).
  const [olT, olW] = LUMBER_CROSS_SECTIONS['2x4']
  const hasRake = spec.detail !== '200' && roof.overhang >= MIN_RAKE_OVERHANG
  const dropped = new Set(hasRake ? [xs[0], xs[xs.length - 1]] : [])
  for (const x of xs) {
    for (const side of [1, -1] as const) {
      // Center of the rafter: midpoint of the slope segment from the
      // overhung eave tip to the ridge face, measured in the segment frame.
      const tipZ = side * (run + roof.overhang * cosT)
      const tipY = eaveY - roof.overhang * Math.sin(theta)
      const midZ = (tipZ + side * ridgeFaceZ) / 2
      // Dropped-gable detail: the top surface sits one outlooker thickness
      // below the roof plane ALONG THE NORMAL — vertically that's olT/cosθ.
      const midY = (tipY + ridgeFaceY) / 2 - (dropped.has(x) ? olT / cosT : 0)
      // Euler [0, ψ, θ]: Rz(θ) lifts +X in the XY plane, Ry(ψ) yaws it into
      // the slope. +Z side rises toward -Z ⇒ ψ = +π/2; -Z side ⇒ ψ = -π/2.
      emit(
        'rafter',
        spec.rafterSize,
        [slopeLen, rd, t],
        [x, midY, midZ],
        (side * Math.PI) / 2,
        theta,
        slopeLen,
        'lumber',
        `Rafter ${spec.rafterSize}${cuts}${purlinNote}`,
        undefined,
        rafterFlag,
      )
      if (spec.hurricaneTies) tieAt(emit, spec, x, side * run, plateY)
    }
  }

  // ---- rake framing: barge rafters + outlookers over the gable ends ----
  // The roof plane cantilevers `overhang` past the end walls along X; a
  // barge (verge) rafter carries the rake edge, held by flat 2x4 outlookers
  // laid over a dropped end rafter, cantilevering 2:1 back to the first
  // interior rafter (conventional rake detail — R802 has no prescriptive
  // table for it).
  if (hasRake) {
    for (const sx of [1, -1] as const) {
      // The ladder spans from the FIRST INTERIOR rafter's inner-side face to
      // the barge's inner face. Derived from the ACTUAL xs positions —
      // layout() snugs the last grid rafter beside the dropped end rafter on
      // wide roofs, and the nominal-spacing ladder impaled it (round-14).
      const ordered = sx === 1 ? [...xs].sort((a, b) => a - b) : [...xs].sort((a, b) => b - a)
      const inner = ordered[ordered.length - 2] ?? ordered[ordered.length - 1] ?? 0
      const bargeX = sx * (roof.width / 2 + roof.overhang)
      const innerFace = inner + sx * halfT
      const outerFace = bargeX - sx * halfT
      const olLen = Math.abs(outerFace - innerFace)
      const olCx = (innerFace + outerFace) / 2
      // barge rafters, both slopes, at the rake line
      for (const side of [1, -1] as const) {
        const tipZ = side * (run + roof.overhang * cosT)
        const tipY = eaveY - roof.overhang * Math.sin(theta)
        emit(
          'rafter',
          spec.rafterSize,
          [slopeLen, rd, t],
          [
            sx * (roof.width / 2 + roof.overhang),
            (tipY + ridgeFaceY) / 2,
            (tipZ + side * ridgeFaceZ) / 2,
          ],
          (side * Math.PI) / 2,
          theta,
          slopeLen,
          'lumber',
          `Barge rafter ${spec.rafterSize} (rake)${splicedNote(spec, slopeLen, 'outlooker bearings')}`,
        )
      }
      // outlookers ladder up both slopes at 4' o.c.
      const cx = olCx
      for (const side of [1, -1] as const) {
        for (let z = OUTLOOKER_SPACING / 2; z < run - EPS; z += OUTLOOKER_SPACING) {
          // Flat 2x4 lying IN the roof plane (rolled about its long axis) —
          // a horizontal box crossed the sloped plane within its own width
          // (round-10 gate). The SHEATHING plane is the rafter TOP — rd/2
          // above the centerline plane along the normal (0, cosθ, side·sinθ);
          // the outlooker hangs half its thickness under that.
          const up = rd / 2 - olT / 2
          const y = ridgeY - z * tan + up * cosT
          const zc = side * z + side * up * Math.sin(theta)
          emit(
            'outlooker',
            '2x4',
            [olLen, olT, olW],
            [cx, y, zc],
            0,
            0,
            olLen,
            'lumber',
            'Outlooker 2x4 flat @ 4ft (rake)',
            side * theta,
          )
        }
      }
    }
  }

  // ---- fascia (sub + finish) along both eave tips (LOD 400) ----
  if (spec.detail === '400') {
    const [, fD] = LUMBER_CROSS_SECTIONS[FASCIA_SIZE]
    const fasciaLen = roof.width + 2 * roof.overhang
    const fasciaY = eaveY - roof.overhang * Math.sin(theta) + fD / 2
    for (const side of [1, -1] as const) {
      fasciaPair(
        emit,
        true,
        fasciaLen,
        0,
        side * (run + roof.overhang * cosT),
        fasciaY,
        splicedNote(spec, fasciaLen, 'rafter tails (scarf joints)'),
      )
    }
    // B6c: rake drip edge rides the deck edge over each barge — plumb-
    // lifted to the deck TOP plane (+2 mm seam) so it caps the panel edge
    // without sharing volume with barge or deck.
    if (hasRake) {
      const lift = (rd / 2 + ROOF_DECK_T + DRIP_T / 2) / cosT + 0.002
      for (const sx of [1, -1] as const) {
        for (const side of [1, -1] as const) {
          const tipZ = side * (run + roof.overhang * cosT)
          const tipY = eaveY - roof.overhang * Math.sin(theta)
          emit(
            'drip-edge',
            undefined,
            [slopeLen, DRIP_T, DRIP_W],
            [
              // outer edge flush with the BARGE's outer face — the rake
              // metal never grows the plan envelope (round-1 F1b)
              sx * (roof.width / 2 + roof.overhang + t / 2 - DRIP_W / 2),
              (tipY + ridgeFaceY) / 2 + lift,
              (tipZ + side * ridgeFaceZ) / 2,
            ],
            (side * Math.PI) / 2,
            theta,
            slopeLen,
            'steel',
            'Drip edge — rake (R905.2.8.5)',
          )
        }
      }
    }
  }

  // ---- ridge board along X at the peak ----
  // B8a (see ridgeBeamFlagFor): sub-3:12 ridge boards PRINT the R802.4.3
  // gap instead of upgrading to a beam silently. 200 stays schematic.
  const ridgeBeamFlag = ridgeBeamFlagFor(spec, tan)
  const ridgeSize = ridgeSizeFor(spec.rafterSize)
  const [rt, rdd] = LUMBER_CROSS_SECTIONS[ridgeSize]
  const ridgeLen = roof.width + 2 * roof.overhang
  emit(
    'ridge',
    ridgeSize,
    [ridgeLen, rdd, rt],
    // top flush with the rafter tops — one plumb half-depth above the centre-line apex
    [0, ridgeY + seat - rdd / 2, 0],
    0,
    0,
    ridgeLen,
    'lumber',
    `Ridge ${ridgeSize}${spec.detail === '400' ? ` — rafter plumb cuts ${Math.round((theta * 180) / Math.PI)}°` : ''}${splicedNote(spec, ridgeLen, 'rafter pairs (ridge board)')}`,
    undefined,
    ridgeBeamFlag,
  )

  // ---- deck on both slope planes (LOD-400 B6, R803.2) ----
  // Full rectangles ridge line → eave tip; the rake overhang widens the
  // plane past the barges when the ladder is framed. The panel's normal
  // offset (rafter top + half deck) leaves the conventional vent gap at
  // the ridge instead of crossing the centerline.
  for (const side of [1, -1] as const) {
    const gapTop = ridgeDeckGap(theta, rt)
    deckPlane(emit, spec, {
      theta,
      side,
      alongXAxis: true,
      u0: hasRake ? -(roof.width / 2 + roof.overhang) : -roof.width / 2,
      u1: hasRake ? roof.width / 2 + roof.overhang : roof.width / 2,
      zTop: gapTop,
      zBot: run + roof.overhang * cosT - deckGap(theta),
      yTop: ridgeY - gapTop * tan,
      rafterDepth: rd,
    })
  }

  // ---- ceiling joists across the depth at the eave line ----
  // Running parallel to the rafter span, they double as the RAFTER TIES of
  // R802.4.2 (thrust) — distinct from the collar ties below (uplift, upper
  // third, R802.4.6). The 400 label spells that distinction out.
  // (cjT/cjD hoisted above — the purlin struts bear on these joists.)
  // A joist landing on a rafter plane sisters BESIDE it (framers face-nail
  // ties to the rafter side) — snapped toward the roof center so the end
  // joists never leave the footprint (round-10 gate).
  const besideRafter = (x0: number, half: number): number => {
    const clash = xs.find((rx) => Math.abs(rx - x0) < halfT + half - EPS)
    if (clash === undefined) return x0
    return clash + (clash >= 0 ? -1 : 1) * (halfT + half)
  }
  // Stations stay inside the end walls' inner faces — the gable studs own the wall plane.
  const cjStations = layout(
    -(roof.width / 2 - halfWall),
    roof.width / 2 - halfWall,
    cjPlan.spacing,
    cjT / 2,
  ).map((x0) => besideRafter(x0, cjT / 2))
  // B6: the deck rides the rafter-TOP plane, and near the eave a square
  // joist END would poke through it — real ends are field-clipped to the
  // rafter slope (the R802.4.2 tie still reaches the plate), so the box
  // INSCRIBES inside the clip exactly like the rafters' plumb-cut boxes.
  // Span/flag math stays on the FULL depth (the buy length). LOD 200 has
  // no deck and keeps the schematic full box.
  const cjClipFor = (d: number) =>
    spec.detail === '200' || tan <= EPS ? 0 : Math.max(0, (d - rd / cosT) / tan + 0.002)
  // W15: per station — the plan's size, its pieces lapped over the
  // partition below. +X box yawed onto +Z: ψ = -π/2 (three: +X → (cosψ, 0, -sinψ)).
  const cjLabel = (size: LumberSize) =>
    `Ceiling joist ${size}${spec.detail === '400' ? ' — rafter tie (R802.4.2), ends clipped to the roof slope' : ''}`
  for (const x of cjStations) {
    emitCeilingJoistPieces(emit, cjPlan, x, true, roof.depth, cjClipFor, plateY, cjLabel)
  }

  // ---- gable-end infill: studs on the plate up to the end rafter ----
  {
    const endDrop = hasRake ? olT / cosT : 0
    for (const sx of [1, -1] as const) {
      infillStuds(emit, spec, roof, {
        plateY,
        alongX: false,
        at: sx * (roof.width / 2),
        from: -roof.depth / 2,
        to: roof.depth / 2,
        topAt: (z) => (run - Math.abs(z)) * tan - endDrop,
        topSlope: tan,
        label: infillLabel(spec, 'Gable stud'),
      })
    }
  }

  // ---- mid-span purlin + 2x4 struts (R802.5.1) when the table ran out ----
  // Purlin stock = rafter stock, on edge under the rafters at half the run;
  // struts ≤ 4 ft o.c. drop to the CEILING JOISTS (the only modeled bearing
  // below — labeled as the assumption). The purlin stops at the end rafters'
  // INNER faces: the dropped gable-end rafters sit an outlooker thickness
  // lower, and a full-width purlin would clip them.
  if (purlinFix) {
    const first = xs[0] ?? -roof.width / 2
    const last = xs[xs.length - 1] ?? roof.width / 2
    // …and inside the gable studs' wall plane at either end.
    const purlinHalf = Math.min((last - first - t) / 2, roof.width / 2 - halfWall - 0.002)
    const purlinLen = 2 * purlinHalf
    if (purlinLen > 0.3) {
      const cx = (first + last) / 2
      const [sT, sW] = LUMBER_CROSS_SECTIONS[STRUT_SIZE]
      const strutLen = strutTop - strutBot
      // Strut stations at ≤ 4 ft o.c. along the purlin, each SNAPPED onto the
      // nearest ceiling joist so the foot lands on real wood (S1).
      const stations = new Set<number>()
      for (let sx = first + t / 2 + STRUT_SPACING / 2; sx < last - t / 2; sx += STRUT_SPACING) {
        let best = cjStations[0] ?? sx
        for (const cj of cjStations) if (Math.abs(cj - sx) < Math.abs(best - sx)) best = cj
        if (best >= first + t / 2 - EPS && best <= last - t / 2 + EPS) stations.add(best)
      }
      for (const side of [1, -1] as const) {
        emit(
          'ridge',
          spec.rafterSize,
          [purlinLen, rd, t],
          [cx, purlinTop - rd / 2, side * purlinZ],
          0,
          0,
          purlinLen,
          'lumber',
          `Purlin ${spec.rafterSize} @ mid-span under rafters (R802.5.1) — halves the ${fmtM(run)} projection${splicedNote(spec, purlinLen, 'struts')}`,
        )
        for (const sx of stations) {
          // W15: the foot lands on the joist piece under THIS purlin line —
          // the lapped piece sits one thickness over, and may be deeper.
          const footX = sx + cjPlan.lapOffsetAt(sx, side * purlinZ)
          const footY = plateY + (cjPlan.pieceAt(sx, side * purlinZ)?.d ?? cjPlan.dMax)
          const len = strutTop - footY
          if (len < inches(3)) continue
          emit(
            'post',
            STRUT_SIZE,
            [sT, len, sW],
            [footX, (strutTop + footY) / 2, side * purlinZ],
            0,
            0,
            len,
            'lumber',
            `Purlin strut ${STRUT_SIZE} @ ≤4 ft o.c. — bears on ceiling joists (assumed bearing, R802.5.1)`,
          )
        }
      }
    }
  }

  // ---- collar ties in the upper third, every other rafter pair ----
  // R802.4.6: collar ties in the upper third of the attic space, 4' o.c. max
  // (every other rafter at 24" o.c.).
  // Upper third — but never INTO the ridge: at ≤12° pitch the upper-third
  // line sits above the ridge's bottom face (round-14). Clamp beneath it.
  const [, ctDepth] = LUMBER_CROSS_SECTIONS['2x4']
  const ridgeBottom = ridgeY + seat - rdd
  const collarY = Math.min(eaveY + (2 / 3) * rise, ridgeBottom - ctDepth / 2 - 0.005)
  const collarLen = (2 * (ridgeY - collarY)) / tan
  if (collarLen > 0.3 && collarY > eaveY + 0.2) {
    const [ctT, ctD] = LUMBER_CROSS_SECTIONS['2x4']
    xs.forEach((x, i) => {
      // Interior pairs only, every other one: the gable-end pair is braced by
      // the gable studs standing in the wall under it (a tie there would
      // share the studs' volume), and R802.4.6's 4 ft o.c. is kept between
      // the ties that remain.
      if (i === 0 || i === xs.length - 1 || (i - 1) % 2 !== 0) return
      // Face-nailed to the rafter side (toward the roof center) — a tie ON
      // the rafter plane interpenetrates both slopes' rafters.
      const cx = x + (x >= 0 ? -1 : 1) * (halfT + ctT / 2)
      emit(
        'collar-tie',
        '2x4',
        [collarLen, ctD, ctT],
        [cx, collarY, 0],
        -Math.PI / 2,
        0,
        collarLen,
        'lumber',
        'Collar tie 2x4',
        undefined,
        // a TENSION member cannot field-splice — over-stock ties flag
        spec.detail === '200' ? undefined : onePieceFlag('Collar tie', collarLen),
      )
    })
  }
}

/**
 * Manufactured-truss span limit (carport.js:34-41 — the one truss generator
 * in PlanCrafters: `trussMaxFt: 40`). Past it the package needs girders /
 * piggybacks — an engineered design, so the gap prints instead of a fake.
 */
const TRUSS_MAX_SPAN = feet(40)
/** Chord + web stock: metal-plate-connected trusses build from 2x4s (carport.js:693). */
const TRUSS_STOCK: LumberSize = '2x4'
/** Struts join the king post only when the half-span is long enough for a
 * lone post to read as a fake (a 3 m cottage truss IS a king-post truss). */
const TRUSS_STRUT_MIN_RUN = 1.5

/**
 * Gable TRUSS framing (spec.roofSystem 'truss'). What a pre-engineered
 * truss roof actually is, and what it is not:
 *  - top chords at rafter spacing on the SAME slope planes as rafters, so
 *    the deck, rake ladder and fascia are emitted identically to the stick
 *    gable (they ride the chord top);
 *  - a bottom chord per truss bearing FLAT on the wall line — trusses don't
 *    notch (carport.js:734) — which IS the rafter tie of R802.4.2 and the
 *    ceiling member ("a truss's bottom chord is its own tie", carport.js:
 *    702). So: NO separate ceiling joists, NO collar ties, NO purlin/strut
 *    span fix, and NO structural ridge — opposing chords meet on a plated
 *    peak joint;
 *  - webbing drawn as a king post + two struts: REPRESENTATIVE. Web layout,
 *    chord grades and plates are the truss manufacturer's engineered design
 *    (deferred submittal). Every bottom chord's label says so, and a span
 *    past TRUSS_MAX_SPAN flags engineering on the takeoff Flags row.
 */
function frameGableTruss(roof: RoofSegmentSlice, spec: FramingSpec, members: Member[]) {
  const emit = emitter(roof, members)
  const [t, cd] = LUMBER_CROSS_SECTIONS[TRUSS_STOCK] // chord thickness, depth
  const halfT = t / 2
  const theta = roof.pitch
  const tan = Math.tan(theta)
  const cosT = Math.cos(theta)
  const run = roof.depth / 2
  const rise = run * tan
  const plateY = roof.wallHeight
  // Heel joint: the top chord bears ON the bottom chord over the plate, so
  // its centre line runs one chord depth plus half its plumb depth above the
  // plate at the wall line (the bottom chord lies flat on the plate).
  const seat = cd + cd / (2 * cosT)
  const eaveY = plateY + seat
  const ridgeY = eaveY + rise
  // No ridge board: each chord's plumb cut lands ON the centerline (the
  // stick gable's ridgeFaceZ = 0); the inscribed plumb inset keeps the two
  // opposing boxes off each other at the peak.
  const plumbInset = (cd / 2) * tan
  const slopeLen = run / cosT + roof.overhang - 2 * plumbInset
  const xs = layout(-roof.width / 2, roof.width / 2, spec.rafterSpacing, halfT)
  const tipY = eaveY - roof.overhang * Math.sin(theta)
  const deferred =
    'design by truss manufacturer — deferred submittal (webbing shown representative)'
  const spanFlag =
    spec.detail !== '200' && roof.depth > TRUSS_MAX_SPAN + EPS
      ? `truss span ${fmtM(roof.depth)} exceeds ${fmtM(TRUSS_MAX_SPAN)} — girder/piggyback truss package required (engineered design; a single common truss is modeled)`
      : undefined

  // Dropped gable-end TRUSS: the rake ladder lays flat outlookers over the
  // end trusses, which drop by the outlooker thickness — the same detail
  // as the stick gable's dropped end rafters.
  const [olT, olW] = LUMBER_CROSS_SECTIONS['2x4']
  const hasRake = spec.detail !== '200' && roof.overhang >= MIN_RAKE_OVERHANG
  const dropped = new Set(hasRake ? [xs[0], xs[xs.length - 1]] : [])

  for (const x of xs) {
    const drop = dropped.has(x) ? olT / cosT : 0
    // ---- top chords, both slopes ----
    for (const side of [1, -1] as const) {
      const tipZ = side * (run + roof.overhang * cosT)
      emit(
        'truss-chord',
        TRUSS_STOCK,
        [slopeLen, cd, t],
        [x, (tipY + ridgeY) / 2 - drop, tipZ / 2],
        (side * Math.PI) / 2,
        theta,
        slopeLen,
        'lumber',
        `Truss top chord ${TRUSS_STOCK}${dropped.has(x) ? ' (dropped gable-end truss)' : ''}`,
      )
      if (spec.hurricaneTies) tieAt(emit, spec, x, side * run, plateY)
    }
    // ---- bottom chord: flat on the wall line, wall line to wall line ----
    // Its top corner at the eave would poke through the deck plane exactly
    // like a ceiling joist's end — the box inscribes under the chord slope;
    // the span/buy length stays the full depth. 200 keeps the schematic box.
    // The heel puts the top chord's underside exactly on the bottom chord's
    // top face at the wall line — only the seam margin is needed.
    const clip = spec.detail === '200' || tan <= EPS ? 0 : 0.002
    const bcLen = roof.depth - 2 * clip
    if (bcLen > 0.3) {
      emit(
        'truss-chord',
        TRUSS_STOCK,
        [bcLen, cd, t],
        [x, plateY + cd / 2 - drop, 0],
        -Math.PI / 2,
        0,
        bcLen,
        'lumber',
        `Truss bottom chord ${TRUSS_STOCK}${dropped.has(x) ? ' (dropped gable-end truss)' : ''} — rafter tie + ceiling member (R802.4.2); ${deferred}`,
        undefined,
        spanFlag,
      )
    }
    // A gable-END truss is a different product — vertical webs at the wall's
    // stud module (framed below as infill studs), no king post or struts.
    if (x === xs[0] || x === xs[xs.length - 1]) continue
    // ---- webbing (representative): king post + two struts ----
    const webBot = plateY + cd - drop // bottom chord top face
    const peakUnder = ridgeY - cd / (2 * cosT) - drop // top-chord underside at the peak
    const kpLen = peakUnder - webBot
    if (kpLen > 0.25) {
      emit(
        'truss-web',
        TRUSS_STOCK,
        [t, kpLen, cd],
        [x, (webBot + peakUnder) / 2, 0],
        0,
        0,
        kpLen,
        'lumber',
        `Truss web (king post) ${TRUSS_STOCK} — representative`,
      )
    }
    if (run > TRUSS_STRUT_MIN_RUN) {
      // King-post foot out to each top chord's mid-slope underside.
      const zEnd = run / 2
      const yEnd = ridgeY - zEnd * tan - cd / (2 * cosT) - drop
      const dy = yEnd - webBot
      const len = Math.hypot(zEnd, dy) - cd // inset so the ends don't bury in the chords
      if (len > 0.25 && dy > 0.05) {
        const tilt = Math.atan2(dy, zEnd)
        for (const side of [1, -1] as const) {
          // Rises TOWARD +Z on the +side — the mirror of a rafter, which rises
          // toward the center: ψ flips sign (see frameGable's euler note).
          emit(
            'truss-web',
            TRUSS_STOCK,
            [len, cd, t],
            [x, (webBot + yEnd) / 2, (side * zEnd) / 2],
            (-side * Math.PI) / 2,
            tilt,
            len,
            'lumber',
            `Truss web (strut) ${TRUSS_STOCK} — representative`,
          )
        }
      }
    }
  }

  // ---- gable-end truss verticals: studs on the plate up to the end chord ----
  {
    const endDrop = hasRake ? olT / cosT : 0
    for (const sx of [1, -1] as const) {
      infillStuds(emit, spec, roof, {
        plateY,
        alongX: false,
        at: sx * (roof.width / 2),
        from: -roof.depth / 2,
        to: roof.depth / 2,
        // chord underside = plate + one chord depth at the wall line
        topAt: (z) => cd + (run - Math.abs(z)) * tan - endDrop,
        topSlope: tan,
        label: `Gable-end truss vertical ${spec.exteriorStudSize} @ ${ocIn(spec.studSpacing)} o.c. — manufacturer's gable-end truss`,
      })
    }
  }

  // ---- rake framing: barge + outlookers, the stick gable's detail verbatim ----
  if (hasRake) {
    for (const sx of [1, -1] as const) {
      const ordered = sx === 1 ? [...xs].sort((a, b) => a - b) : [...xs].sort((a, b) => b - a)
      const inner = ordered[ordered.length - 2] ?? ordered[ordered.length - 1] ?? 0
      const bargeX = sx * (roof.width / 2 + roof.overhang)
      const innerFace = inner + sx * halfT
      const outerFace = bargeX - sx * halfT
      const olLen = Math.abs(outerFace - innerFace)
      const olCx = (innerFace + outerFace) / 2
      for (const side of [1, -1] as const) {
        const tipZ = side * (run + roof.overhang * cosT)
        emit(
          'rafter',
          TRUSS_STOCK,
          [slopeLen, cd, t],
          [bargeX, (tipY + ridgeY) / 2, tipZ / 2],
          (side * Math.PI) / 2,
          theta,
          slopeLen,
          'lumber',
          `Barge rafter ${TRUSS_STOCK} (rake)${splicedNote(spec, slopeLen, 'outlooker bearings')}`,
        )
      }
      for (const side of [1, -1] as const) {
        for (let z = OUTLOOKER_SPACING / 2; z < run - EPS; z += OUTLOOKER_SPACING) {
          const up = cd / 2 - olT / 2
          const y = ridgeY - z * tan + up * cosT
          const zc = side * z + side * up * Math.sin(theta)
          emit(
            'outlooker',
            '2x4',
            [olLen, olT, olW],
            [olCx, y, zc],
            0,
            0,
            olLen,
            'lumber',
            'Outlooker 2x4 flat @ 4ft (rake)',
            side * theta,
          )
        }
      }
    }
  }

  // ---- deck on both slope planes (rides the chord top, as on rafters) ----
  for (const side of [1, -1] as const) {
    deckPlane(emit, spec, {
      theta,
      side,
      alongXAxis: true,
      u0: hasRake ? -(roof.width / 2 + roof.overhang) : -roof.width / 2,
      u1: hasRake ? roof.width / 2 + roof.overhang : roof.width / 2,
      zTop: deckGap(theta),
      zBot: run + roof.overhang * cosT - deckGap(theta),
      yTop: ridgeY - deckGap(theta) * tan,
      rafterDepth: cd,
    })
  }

  // ---- fascia (sub + finish) + rake drip edge (LOD 400) ----
  if (spec.detail === '400') {
    const [, fD] = LUMBER_CROSS_SECTIONS[FASCIA_SIZE]
    const fasciaLen = roof.width + 2 * roof.overhang
    const fasciaY = tipY + fD / 2
    for (const side of [1, -1] as const) {
      fasciaPair(
        emit,
        true,
        fasciaLen,
        0,
        side * (run + roof.overhang * cosT),
        fasciaY,
        splicedNote(spec, fasciaLen, 'truss tails (scarf joints)'),
      )
    }
    if (hasRake) {
      const lift = (cd / 2 + ROOF_DECK_T + DRIP_T / 2) / cosT + 0.002
      for (const sx of [1, -1] as const) {
        for (const side of [1, -1] as const) {
          const tipZ = side * (run + roof.overhang * cosT)
          emit(
            'drip-edge',
            undefined,
            [slopeLen, DRIP_T, DRIP_W],
            [
              sx * (roof.width / 2 + roof.overhang + t / 2 - DRIP_W / 2),
              (tipY + ridgeY) / 2 + lift,
              tipZ / 2,
            ],
            (side * Math.PI) / 2,
            theta,
            slopeLen,
            'steel',
            'Drip edge — rake (R905.2.8.5)',
          )
        }
      }
    }
  }
}

function frameShed(roof: RoofSegmentSlice, spec: FramingSpec, members: Member[]) {
  const emit = emitter(roof, members)
  const [t, rd] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  const theta = roof.pitch
  const cosT = Math.cos(theta)
  // ATTACHED (the porch roof, `metadata.roof.attach: 'high'`): the high edge
  // bears on a LEDGER at the house wall — no overhang past it, no pediment,
  // rafters on hangers. OPEN (`metadata.roof.open`): posts and a beam under
  // the low eave, the sides open — no rake studs.
  const attached = roof.attach === 'high'
  const open = roof.open === true
  const highOverhang = attached ? 0 : roof.overhang
  // Single plane over the whole depth, rising toward +Z's opposite: the host
  // shed rises across the full depth (run = depth).
  const slopeLen = roof.depth / cosT + roof.overhang + highOverhang
  const tan = Math.tan(theta)
  const plateY = roof.wallHeight
  const seat = rd / (2 * cosT) // bottom face bears on the plates (see frameGable)
  const lowY = plateY + seat
  const midY = lowY + (roof.depth / 2) * tan
  // The rafter box is centred on its own span: with an attached high edge the
  // span is one overhang shorter, so its centre moves down-slope by half.
  const zCentre = attached ? (roof.overhang * cosT) / 2 : 0
  const yCentre = midY - zCentre * tan
  // Span discipline: the shed's horizontal projection is the FULL depth and
  // no ceiling joists exist below to strut a purlin to — flag only (S1).
  const shedFlag = slopeRafterFlag(spec, roof.depth, slopeLen)
  const stations = layout(-roof.width / 2, roof.width / 2, spec.rafterSpacing, t / 2)
  for (const x of stations) {
    emit(
      'rafter',
      spec.rafterSize,
      [slopeLen, rd, t],
      [x, yCentre, zCentre],
      Math.PI / 2,
      theta,
      slopeLen,
      'lumber',
      `Rafter ${spec.rafterSize} (shed${attached ? ', on the ledger' : ''})`,
      undefined,
      shedFlag,
    )
    if (spec.hurricaneTies) {
      tieAt(emit, spec, x, roof.depth / 2, plateY)
      if (!attached) tieAt(emit, spec, x, -roof.depth / 2, plateY + roof.depth * tan)
    }
  }

  if (attached) {
    // The ledger: the rafter-size board on the wall face along the high edge,
    // its top flush with the rafter tops there; one face-mount hanger per
    // rafter. The Simpson model is sized to the rafter (LUS-series for
    // sawn 2x); its nailing is the catalogue's — not restated here.
    const highRafterY = lowY + roof.depth * tan // rafter centreline at the high edge
    const topAtWall = highRafterY + rd / (2 * cosT)
    emit(
      'ledger',
      spec.rafterSize,
      [roof.width, rd, t],
      [0, topAtWall - rd / 2, -roof.depth / 2 + t / 2],
      0,
      0,
      roof.width,
      'lumber',
      `Ledger ${spec.rafterSize} at the house wall — fastened to the wall framing, rafters on face-mount hangers`,
    )
    for (const x of stations) {
      emit(
        'hanger',
        undefined,
        [inches(3), rd, inches(0.75)],
        [x, topAtWall - rd / 2, -roof.depth / 2 + t + inches(0.75) / 2],
        0,
        0,
        inches(3),
        'steel',
        partLabel(hangerFor(spec.rafterSize), `${spec.rafterSize} porch rafter to the ledger`),
      )
    }
  } else {
    // ---- infill above the plate: the high-side pediment (the plane rises
    // from the low eave at +Z to the high edge at −Z). This is the shed's
    // "front wall" — real studs on the plate, not a picture.
    infillStuds(emit, spec, roof, {
      plateY,
      alongX: true,
      at: -roof.depth / 2,
      from: -roof.width / 2,
      to: roof.width / 2,
      topAt: () => roof.depth * tan,
      topSlope: 0,
      label: infillLabel(spec, 'Pediment stud (shed high wall)'),
      bearing: true,
    })
  }
  if (!open) {
    for (const sx of [1, -1] as const) {
      infillStuds(emit, spec, roof, {
        plateY,
        alongX: false,
        at: sx * (roof.width / 2),
        from: -roof.depth / 2,
        to: roof.depth / 2,
        topAt: (z) => (roof.depth / 2 - z) * tan,
        topSlope: tan,
        label: infillLabel(spec, 'Rake stud (shed side wall)'),
      })
    }
  }

  // ---- deck over the single plane (B6): high tip → low tip, both
  // overhangs included (slopeLen spans them, plan extension o·cosθ each).
  deckPlane(emit, spec, {
    theta,
    side: 1,
    alongXAxis: true,
    u0: -roof.width / 2,
    u1: roof.width / 2,
    zTop: -roof.depth / 2 - highOverhang * cosT + deckGap(theta),
    zBot: roof.depth / 2 + roof.overhang * cosT - deckGap(theta),
    yTop: midY + (roof.depth / 2 + roof.overhang * cosT - deckGap(theta)) * Math.tan(theta),
    rafterDepth: rd,
    // F4 (round-1 skeptic): the shed's zero-drip state is a STATED gap on
    // paper, not a commit-message aside — no fascia is modeled on sheds at
    // LOD 400, so the eave metal has nothing to cap (trim rides the
    // eventual shed fascia work).
    flag:
      spec.detail === '400'
        ? 'shed roof: fascia + drip edge not modeled at LOD 400 — eave/rake metal by trim schedule (R905.2.8.5)'
        : undefined,
  })
}

function frameHip(
  roof: RoofSegmentSlice,
  spec: FramingSpec,
  members: Member[],
  walls: readonly WallSlice[] = [],
) {
  const emit = emitter(roof, members)
  const [t, rd] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  const halfT = t / 2
  const theta = roof.pitch
  const tan = Math.tan(theta)
  const cosT = Math.cos(theta)
  const run = Math.min(roof.width, roof.depth) / 2
  const rise = run * tan
  // Bottom-on-plate bearing (see frameGable): commons and jacks ride `eaveY`.
  const plateY = roof.wallHeight
  const seat = rd / (2 * cosT)
  const eaveY = plateY + seat
  const ridgeY = eaveY + rise
  // Ridge shrinks by the hip run at each end, along the LONG axis.
  const alongX = roof.width >= roof.depth
  const longHalf = Math.max(roof.width, roof.depth) / 2
  const ridgeHalf = Math.max(0, longHalf - run)

  // ---- ridge ----
  if (ridgeHalf > 0.05) {
    const ridgeSize = ridgeSizeFor(spec.rafterSize)
    const [rt, rdd] = LUMBER_CROSS_SECTIONS[ridgeSize]
    emit(
      'ridge',
      ridgeSize,
      [ridgeHalf * 2, rdd, rt],
      [0, ridgeY + seat - rdd / 2, 0],
      alongX ? 0 : -Math.PI / 2,
      0,
      ridgeHalf * 2,
      'lumber',
      `Ridge ${ridgeSize} (hip)${
        spec.detail === '400' ? ` — rafter plumb cuts ${Math.round((theta * 180) / Math.PI)}°` : ''
      }${splicedNote(spec, ridgeHalf * 2, 'rafter pairs (ridge board)')}`,
      undefined,
      // B8a extension (NIGHT-10): the slope CARRYING the hip ridge is the
      // long-plane commons' pitch — sub-3:12 prints the R802.4.3 flag; the
      // mansard crown inherits this via the inner frameHip (its computed
      // crown pitch answers, not the schema pitch).
      ridgeBeamFlagFor(spec, tan),
    )
  }

  // ---- hip members to the four corners ----
  // Each hip runs from a ridge end down to its footprint corner: horizontal
  // run = run·√2 (45° plan diagonal), drop = rise.
  const hipTilt = Math.atan2(rise, run * Math.SQRT2)
  // A hip bears bottom-on-plate too, lifted by ITS plumb half-depth — shallower
  // than the commons', so its top sits a little under the commons' top planes:
  // the dropped hip the sheathing wants.
  const hipEaveY = plateY + rd / (2 * Math.cos(hipTilt))
  const hipRidgeY = hipEaveY + rise
  // The hip's top cut bears on the ridge END, not inside it: pull the upper
  // end down-slope until the box clears the ridge body (half ridge thickness
  // + half hip thickness in plan, diagonal at 45°) plus the plumb-cut inset
  // of the square-ended box (round-10 gate).
  const [hipRidgeT] = LUMBER_CROSS_SECTIONS[ridgeSizeFor(spec.rafterSize)]
  const hipInset = Math.SQRT2 * (hipRidgeT / 2 + t / 2) + (rd / 2) * Math.tan(hipTilt)
  // Long-plane common stations (also consumed by the apex trim below and the
  // collar-tie band): layout() guarantees an end station at ridgeHalf − halfT.
  const commons = layout(-ridgeHalf, ridgeHalf, spec.rafterSpacing, halfT)
  // NIGHT-10 square-hip apex trim: with NO ridge board (ridgeHalf ≤ 0.05 —
  // the degenerate pyramid apex, width ≈ depth and the square mansard crown)
  // the hips' top cuts bear on the apex COMMON pair instead of a ridge end.
  // layout()'s guaranteed end station snaps that pair OFF-CENTER (u =
  // ridgeHalf − halfT, box overhanging one thickness past the negative ridge
  // end), so the hips pointing at the overhung side must trim past the
  // pair's FAR face — the exact mirror of the clearance the opposite hips
  // already have (which SAT-pass). Plan per-axis overhang beyond each ridge
  // end, converted to slope inset along the 45° diagonal. Rectangular hips
  // (ridge board present) keep extra = 0 — byte-identical (the pre-existing
  // class was 2 hip×common SAT pairs at the ridge point, never gated).
  const apexExtra = (se: 1 | -1): number => {
    if (ridgeHalf > 0.05) return 0
    const overhang =
      se === 1
        ? Math.max(...commons) + halfT - ridgeHalf
        : -ridgeHalf - (Math.min(...commons) - halfT)
    return overhang > EPS ? (Math.SQRT2 * overhang) / Math.cos(hipTilt) : 0
  }
  for (const se of [1, -1] as const) {
    const insetSe = hipInset + apexExtra(se)
    const hipLenSe = Math.hypot(run * Math.SQRT2, rise) - insetSe
    // Hips carry jacks — table spans are a rafter concept, but a field-spliced
    // hip is no more a structural member than a spliced common (one-piece check).
    const hipFlagSe = spec.detail === '200' ? undefined : onePieceFlag('Hip', hipLenSe)
    for (const sc of [1, -1] as const) {
      // Ridge end (segment frame) and its corner.
      const end: [number, number] = alongX ? [se * ridgeHalf, 0] : [0, se * ridgeHalf]
      const corner: [number, number] = [
        alongX ? se * (ridgeHalf + run) : sc * run,
        alongX ? sc * run : se * (ridgeHalf + run),
      ]
      const dx = corner[0] - end[0]
      const dz = corner[1] - end[1]
      const planLen = Math.hypot(dx, dz)
      // Slide the START point down the diagonal by the inset's plan component.
      const slide = (insetSe * Math.cos(hipTilt)) / planLen
      const start: [number, number] = [end[0] + dx * slide, end[1] + dz * slide]
      const startY = hipRidgeY - insetSe * Math.sin(hipTilt)
      const yawTo = Math.atan2(-dz, dx) // +X box onto the plan diagonal
      emit(
        'hip',
        spec.rafterSize,
        [hipLenSe, rd, t],
        [(start[0] + corner[0]) / 2, (startY + hipEaveY) / 2, (start[1] + corner[1]) / 2],
        yawTo + Math.PI, // point downhill (from ridge end toward the corner)
        hipTilt,
        hipLenSe,
        'lumber',
        `Hip ${spec.rafterSize}${
          spec.detail === '400'
            ? ` — plumb ${Math.round((hipTilt * 180) / Math.PI)}°, side cuts 45°`
            : ''
        }`,
        undefined,
        hipFlagSe,
      )
    }
  }

  // ---- ceiling joists across the short span (LOD-400 B7a, R802.4.2) ----
  // The gable machinery mirrored: joists at o.c. stations along the LONG
  // axis span the short footprint dimension at the eave line — the rafter
  // ties that resist the commons' thrust (the audit's hip modeled a
  // non-structural ridge board with NO tie below it and no ceiling frame
  // for the storey under, R802.4.2). Stations cover the ridge portion and
  // continue into the end bands only while the END planes' rafters and the
  // hip boxes stay clear above the joist top: past longHalf − cjEndClear a
  // jack/king underside descends into the joist — the small triangular end
  // ceilings ride a stub-joist follow-up (honesty over fake wood).
  const shortSpan = 2 * run
  // Sister BESIDE any parallel rafter plane — the long-plane commons AND
  // the side-plane jacks past the ridge ends (both run with the joists) —
  // snapped toward the roof center (the gable besideRafter convention).
  const cjParallel: number[] = [...commons]
  if (spec.detail !== '200') {
    for (let d = spec.rafterSpacing; d < run - halfT; d += spec.rafterSpacing) {
      cjParallel.push(ridgeHalf + d, -(ridgeHalf + d))
    }
  }
  // The joists CROSS the ridge line at plan center — on a near-flat hip
  // (an inner mansard crown can compute a ~5° pitch) the ridge board's
  // underside descends INTO the joist band; no room = no fake wood (the
  // collar-tie low-pitch skip convention; the hip/crown ridge's own
  // R802.4.3 flag rides the ridge member itself — B8a extension, NIGHT-10).
  // W15: that headroom also CAPS the stock the planner may size up to.
  const [, cjRidgeD] = LUMBER_CROSS_SECTIONS[ridgeSizeFor(spec.rafterSize)]
  const cjHeadroom =
    ridgeHalf <= 0.05 ? Number.POSITIVE_INFINITY : ridgeY + seat - cjRidgeD - plateY - 0.002
  // Clearance vs the end-plane rafter UNDERSIDES (centerline − rd/(2cosθ)
  // vertical, descending to the end eave at tanθ); + one hip thickness for
  // the hip boxes' plan band crossing the joist line at the corner runs.
  const cjEndClearFor = (d: number) => (tan <= EPS ? longHalf : d / tan + t + 0.002)
  // W15: planned against the interior partitions — the long axis is the
  // ridge axis, so a partition running with the ridge carries the lap;
  // the band and the ridge check ride the deepest joist the plan emits.
  const cjPlan = planCeilingJoists(roof, walls, spec, {
    spansZ: alongX,
    span: shortSpan,
    bandHalf: longHalf,
    maxDepth: cjHeadroom,
    parallel: cjParallel,
    parallelHalfT: halfT,
    stationHalfFor: (d) => longHalf - cjEndClearFor(d),
  })
  const cjT = cjPlan.t
  const cjD = cjPlan.dMax
  const cjEndClear = cjEndClearFor(cjD)
  const cjBandHalf = longHalf - cjEndClear
  const besideRafter = (u0: number, half: number): number => {
    const clash = cjParallel.find((ru) => Math.abs(ru - u0) < halfT + half - EPS)
    if (clash === undefined) return u0
    return clash + (clash >= 0 ? -1 : 1) * (halfT + half)
  }
  // B6 end-clip vs the LONG planes at the joists' own ends: the box
  // inscribes inside the field clip to the rafter slope so its end top
  // corner never pokes the deck riding the rafter TOPs. Span/flag math
  // stays on the FULL short span (the buy length); LOD 200 has no deck and
  // keeps the schematic full box (the gable cjClip convention).
  const cjClipFor = (d: number) =>
    spec.detail === '200' || tan <= EPS ? 0 : Math.max(0, (d - rd / cosT) / tan + 0.002)
  const cjLen = shortSpan - 2 * cjClipFor(cjD)
  // B7 fix round (skeptic F1): the END planes' thrust story must PRINT,
  // not live in code comments — the two end planes' rafters (jacks +
  // kings, thrusting along the LONG axis at the end eaves) get no
  // parallel tie and the station band deliberately stops short of the
  // end triangles; near-square hips additionally carry no collar ties at
  // all (no ridge portion — the parenthetical subsumes that zero-tie
  // case). One statement class on the joists at 400 (the B6 shed-drip
  // stated-gap convention), composed ' | ' onto whatever over-span
  // honesty a joist already carries (the M2 flag-composition rule).
  const cjEndGapFlag =
    spec.detail === '400'
      ? 'hip end planes: rafter ties parallel to the end-plane span + end-triangle stub joists not modeled (collar ties ride the ridge portion only) — verify tie detail (R802.4.2)'
      : undefined
  const cjClearsRidge = ridgeHalf <= 0.05 || plateY + cjD + 0.002 <= ridgeY + seat - cjRidgeD
  // the stations are shared with the purlin struts below (W16b)
  const cjStations: number[] = []
  if (cjLen >= 0.3 && cjBandHalf > cjT && cjClearsRidge) {
    // Two neighboring stations can snap beside the SAME jack (the layout's
    // guaranteed end station lands next to a grid station at some pitches)
    // — collapse any snapped pair closer than one joist thickness.
    const snapped = layout(-cjBandHalf, cjBandHalf, cjPlan.spacing, cjT / 2)
      .map((u0) => besideRafter(u0, cjT / 2))
      .sort((a, b) => a - b)
    for (const u of snapped) {
      const prev = cjStations[cjStations.length - 1]
      if (prev !== undefined && u - prev < cjT - EPS) continue
      cjStations.push(u)
    }
    const cjLabel = (size: LumberSize) =>
      `Ceiling joist ${size} — rafter tie (R802.4.2)${
        spec.detail === '400' ? ', ends clipped to the roof slope' : ''
      }`
    for (const u of cjStations) {
      emitCeilingJoistPieces(
        emit,
        cjPlan,
        u,
        alongX,
        shortSpan,
        cjClipFor,
        plateY,
        cjLabel,
        cjEndGapFlag,
      )
    }
  }

  // ---- common rafters on the two long planes, between the hips ----
  const commonCuts = rafterCutData(spec, theta, rd)
  // Same ridge-face bearing + inscribed plumb cuts as the gable commons.
  const cRidgeFace = hipRidgeT / 2
  const cPlumbInset = (rd / 2) * tan
  const commonSlopeLen = run / cosT + roof.overhang - cRidgeFace / cosT - 2 * cPlumbInset
  const commonFaceY = ridgeY - cRidgeFace * tan
  // ---- span discipline (R802.4.1): the mid-run purlin fix, or the honest flag ----
  // Hip commons / kings / long jacks project `run` horizontally. W16b: the
  // gable's purlin + 2x4 strut fix on all four planes — a purlin under each
  // plane at half the run (stock = rafter stock, on edge), struts ≤ 4 ft
  // o.c. down to the ceiling joists. The long-plane purlins cross the joist
  // stations (a strut on every joist line); an END-plane purlin runs WITH
  // the joists, so it sits over the joist station nearest half the end run
  // and its struts all bear on that one joist (said on the label — verify
  // it). The fix holds only when the halved run fits the table, the struts
  // have real height above the joists, and joists exist to bear on; each
  // member is then checked on its longest projection between supports.
  const allowable = rafterAllowable(spec)
  const overSpan = allowable !== undefined && run > allowable + EPS
  const purlinRun = run / 2
  // The purlin under a plane at run `r` from its eave: underside off the
  // rafter centre line (bottom-on-plate seating, see frameGable), a plumb
  // board meeting the sloped underside at its downhill top corner.
  const purlinTopAt = (r: number) => eaveY + r * tan - rd / (2 * cosT) - (t / 2) * tan
  const purlinTop = purlinTopAt(purlinRun)
  const strutTop = purlinTop - rd
  const strutBot = plateY + cjD
  // A purlin's plan extent stops short of the hip lines (the box meets the
  // 45° hip face √2·t/2 before the line; one more thickness clears the drop).
  const purlinSetback = (Math.SQRT2 * t) / 2 + t
  const longPurlinHalf = ridgeHalf + purlinRun - purlinSetback
  const purlinFix =
    spec.detail !== '200' &&
    overSpan &&
    purlinRun <= (allowable ?? 0) + EPS &&
    strutTop - strutBot >= inches(3) &&
    cjStations.length > 0 &&
    longPurlinHalf > 0.15
  type EndPurlin = { line: number; runFromEave: number; half: number; top: number }
  const endPurlinFor = (se: 1 | -1): EndPurlin | null => {
    if (!purlinFix) return null
    const want = se * (ridgeHalf + purlinRun)
    let line: number | undefined
    for (const u of cjStations) {
      if (line === undefined || Math.abs(u - want) < Math.abs(line - want)) line = u
    }
    // a joist line more than a bay off the half-run line is no bearing here
    if (line === undefined || Math.abs(line - want) > cjPlan.spacing + EPS) return null
    const runFromEave = ridgeHalf + run - Math.abs(line)
    const half = Math.abs(line) - ridgeHalf - purlinSetback
    const top = purlinTopAt(runFromEave)
    if (half < 0.15 || runFromEave < 0.1 || top - rd - strutBot < inches(3)) return null
    return { line, runFromEave, half, top }
  }
  const endPurlinPos = endPurlinFor(1)
  const endPurlinNeg = endPurlinFor(-1)
  const endPurlinOf = (se: 1 | -1) => (se === 1 ? endPurlinPos : endPurlinNeg)
  /** The span check with a purlin at run `purlinAt` from the eave (null =
   * none): the member's longest projection between supports. */
  const slopeFlagFixed = (
    bearingRun: number,
    len: number,
    purlinAt: number | null,
    what = 'Rafter',
  ) => {
    if (purlinAt === null || bearingRun <= purlinAt + EPS) {
      return slopeRafterFlag(spec, bearingRun, len, what)
    }
    // purlin-supported: the longer piece either side of the purlin must fit
    // the table; the stock-length story rides the label's splice note
    const effective = Math.max(purlinAt, bearingRun - purlinAt)
    const allowable = rafterAllowable(spec)
    return allowable !== undefined && effective > allowable + EPS
      ? rafterOverSpanFlag(spec, effective, allowable, what)
      : undefined
  }
  const purlinNoteFor = (bearingRun: number, purlinAt: number | null, len: number) =>
    purlinAt !== null && bearingRun > purlinAt + EPS
      ? ` — purlin-supported @ mid-run (R802.5.1)${
          len > MAX_ONE_PIECE + EPS ? '; splice over purlin bearing' : ''
        }`
      : ''
  const longPurlinAt = purlinFix ? purlinRun : null
  const commonFlag = slopeFlagFixed(run, commonSlopeLen, longPurlinAt)
  for (const u of commons) {
    for (const side of [1, -1] as const) {
      const tipPlan = run + roof.overhang * cosT
      const x = alongX ? u : side * ((tipPlan + cRidgeFace) / 2)
      const z = alongX ? side * ((tipPlan + cRidgeFace) / 2) : u
      // Rising axis must point from the ±X eave tip toward the ridge at x=0:
      // +X side ⇒ horizontal −X ⇒ ψ = π; −X side ⇒ ψ = 0.
      const psi = alongX ? (side * Math.PI) / 2 : side === 1 ? Math.PI : 0
      emit(
        'rafter',
        spec.rafterSize,
        [commonSlopeLen, rd, t],
        [x, (eaveY - roof.overhang * Math.sin(theta) + commonFaceY) / 2, z],
        psi,
        theta,
        commonSlopeLen,
        'lumber',
        `Rafter ${spec.rafterSize} (hip common)${commonCuts}${purlinNoteFor(run, longPurlinAt, commonSlopeLen)}`,
        undefined,
        commonFlag,
      )
      if (spec.hurricaneTies) {
        tieAt(emit, spec, alongX ? u : side * run, alongX ? side * run : u, plateY)
      }
    }
  }

  // ---- jack rafters on the four triangular planes (LOD 350) ----
  // Side planes: past each ridge end the trapezoid tapers — jacks at o.c.
  // shorten from the full common run down to nothing at the corner, each
  // landing on the hip (plan line |cross| = |long| − ridgeHalf).
  // End planes: mirrored — jacks run along the LONG axis from the end eave
  // to the hip, with a full-run king common on the plane's centerline.
  if (spec.detail !== '200') {
    const cuts = rafterCutData(spec, theta, rd)
    const jackLabel = (jackRun: number) =>
      `Jack rafter ${spec.rafterSize}${
        spec.detail === '400' ? ` — ${formatIn(jackRun / cosT)} slope, cheek 45°` : ''
      }${cuts}`
    // A jack's cheek bears on the hip's SIDE FACE, not its centerline: in
    // plan the 45° hip face sits √2·t/2 before the line, the jack's own
    // half-thickness adds t/2, and the square-ended box needs its plumb
    // inset — all pulled off the top of the run (round-10 gate).
    const jackSetback = (Math.SQRT2 * t) / 2 + t / 2 + (rd / 2) * Math.sin(theta)
    const emitSloped = (
      role: Member['role'],
      long: number,
      cross: number,
      longIsX: boolean,
      psi: number,
      jackRun: number,
      label: string,
      purlinAt: number | null,
    ) => {
      // Member from eave tip (cross extent run + overhang·cosT) up to the
      // hip bearing (cross extent = run − jackRun + setback).
      const bearingRun = jackRun - jackSetback
      if (bearingRun / cosT + roof.overhang < 0.2) return
      // Tail plumb cut: inscribe the square-ended box like the gable commons.
      const tailPlan = (rd / 2) * Math.sin(theta)
      const tipCross = run + roof.overhang * cosT - tailPlan
      const topCross = run - bearingRun
      const midCross = ((tipCross + topCross) / 2) * Math.sign(cross)
      const tipY = eaveY - roof.overhang * Math.sin(theta) + tailPlan * tan
      const topY = eaveY + bearingRun * tan
      const len = bearingRun / cosT + roof.overhang - (rd / 2) * tan
      emit(
        role,
        spec.rafterSize,
        [len, rd, t],
        longIsX ? [long, (tipY + topY) / 2, midCross] : [midCross, (tipY + topY) / 2, long],
        psi,
        theta,
        len,
        'lumber',
        `${label}${purlinNoteFor(bearingRun, purlinAt, len)}`,
        undefined,
        // a near-full-length jack is the same span class as a common —
        // checked on its OWN bearing run (short corner jacks stay quiet);
        // with the purlin fix a jack crossing the purlin line is halved
        slopeFlagFixed(bearingRun, len, purlinAt, 'Jack rafter'),
      )
    }
    for (const se of [1, -1] as const) {
      // side-plane jacks: stations past the ridge end toward the corner
      for (let d = spec.rafterSpacing; d < run - halfT; d += spec.rafterSpacing) {
        const jackRun = run - d
        for (const sc of [1, -1] as const) {
          const long = se * (ridgeHalf + d)
          const psi = alongX ? (sc * Math.PI) / 2 : sc === 1 ? Math.PI : 0
          emitSloped(
            'jack-rafter',
            long,
            sc,
            alongX,
            psi,
            jackRun,
            jackLabel(jackRun),
            longPurlinAt,
          )
          // Uplift path applies to every bearing rafter — jacks included
          // (round-2 advisory: hip jacks had no ties in high-wind specs).
          if (spec.hurricaneTies) {
            tieAt(emit, spec, alongX ? long : sc * run, alongX ? sc * run : long, plateY)
          }
        }
      }
      // end-plane: king common on the centerline runs the full hip run…
      {
        const psi = alongX ? (se === 1 ? Math.PI : 0) : (se * Math.PI) / 2
        const tipCross = run + roof.overhang * cosT
        const tipY = eaveY - roof.overhang * Math.sin(theta)
        // The king's top bears where the two HIPS converge, not on ridge
        // end-grain alone: pull back like a jack cheek (half hip thickness
        // at 45° + the plumb inset) — at 60° pitch the un-set-back king
        // buried its top corner in both hips (round-14).
        const kingSetback = (Math.SQRT2 * t) / 2 + (rd / 2) * Math.sin(theta)
        const midLong = se * (ridgeHalf + kingSetback + (tipCross - kingSetback) / 2)
        // Inscribed: both ends are plumb cuts (hip junction + tail).
        const len = (run - kingSetback) / cosT + roof.overhang - 2 * cPlumbInset
        // Center height at the box's own top cut (ridgeY − setback·tanθ),
        // NOT the apex — averaging tipY with the full apex floated the box
        // ~t·sinθ·√2/2 proud of the slope plane along its normal while the
        // plan center honored the setback (latent round-14 residue the B6
        // deck exposed: king × deck SAT hits on every hip).
        const kingMidY = (tipY + ridgeY - kingSetback * tan) / 2
        emit(
          'rafter',
          spec.rafterSize,
          [len, rd, t],
          alongX ? [midLong, kingMidY, 0] : [0, kingMidY, midLong],
          psi,
          theta,
          len,
          'lumber',
          `King common ${spec.rafterSize} (hip end)${cuts}${purlinNoteFor(run, endPurlinOf(se)?.runFromEave ?? null, len)}`,
          undefined,
          slopeFlagFixed(run, len, endPurlinOf(se)?.runFromEave ?? null),
        )
        if (spec.hurricaneTies) {
          tieAt(
            emit,
            spec,
            alongX ? se * (ridgeHalf + run) : 0,
            alongX ? 0 : se * (ridgeHalf + run),
            plateY,
          )
        }
      }
      // …and jacks step down each side of it
      for (let v = spec.rafterSpacing; v < run - halfT; v += spec.rafterSpacing) {
        const jackRun = run - v
        for (const sv of [1, -1] as const) {
          // On the end plane the RUN direction is the long axis: reuse
          // emitSloped with axes swapped (long ↔ cross).
          const psi = alongX ? (se === 1 ? Math.PI : 0) : (se * Math.PI) / 2
          const bearingRun = jackRun - jackSetback
          if (bearingRun / cosT + roof.overhang < 0.2) continue
          const tailPlan = (rd / 2) * Math.sin(theta)
          const tipCross = ridgeHalf + run + roof.overhang * cosT - tailPlan
          const topCross = ridgeHalf + v + jackSetback
          const midLong = (se * (tipCross + topCross)) / 2
          const tipY = eaveY - roof.overhang * Math.sin(theta) + tailPlan * tan
          const topY = eaveY + bearingRun * tan
          const len = bearingRun / cosT + roof.overhang - (rd / 2) * tan
          emit(
            'jack-rafter',
            spec.rafterSize,
            [len, rd, t],
            alongX ? [midLong, (tipY + topY) / 2, sv * v] : [sv * v, (tipY + topY) / 2, midLong],
            psi,
            theta,
            len,
            'lumber',
            `${jackLabel(jackRun)}${purlinNoteFor(bearingRun, endPurlinOf(se)?.runFromEave ?? null, len)}`,
            undefined,
            slopeFlagFixed(bearingRun, len, endPurlinOf(se)?.runFromEave ?? null, 'Jack rafter'),
          )
          if (spec.hurricaneTies) {
            tieAt(
              emit,
              spec,
              alongX ? se * (ridgeHalf + run) : sv * v,
              alongX ? sv * v : se * (ridgeHalf + run),
              plateY,
            )
          }
        }
      }
    }
  }

  // ---- mid-run purlins + 2x4 struts on the four planes (W16b, R802.5.1) ----
  if (purlinFix) {
    const purlinSize = spec.rafterSize
    const [sT, sW] = LUMBER_CROSS_SECTIONS[STRUT_SIZE]
    const strutLabel = (onOne: boolean) =>
      `Purlin strut ${STRUT_SIZE} @ ≤4 ft o.c. — bears on ceiling joist${
        onOne
          ? ' (every strut of this end purlin on ONE joist line — verify the joist for the strut loads)'
          : 's (assumed bearing, R802.5.1)'
      }`
    // the joist stations run along the LONG axis; `spansZ` = the joists run
    // along local Z (alongX: the ridge on X)
    const spansZ = alongX
    /** A strut from the joist piece under (station, u) up to a purlin underside at `top`. */
    const strut = (station: number, u: number, top: number, onOne: boolean) => {
      const piece = cjPlan.pieceAt(station, u)
      const footY = plateY + (piece?.d ?? cjPlan.dMax)
      const len = top - rd - footY
      if (len < inches(3)) return
      const x = station + cjPlan.lapOffsetAt(station, u)
      emit(
        'post',
        STRUT_SIZE,
        [sT, len, sW],
        spansZ ? [x, top - rd - len / 2, u] : [u, top - rd - len / 2, x],
        spansZ ? 0 : Math.PI / 2,
        0,
        len,
        'lumber',
        strutLabel(onOne),
      )
    }
    // long planes: a purlin along the ridge axis at ±run/2, a strut on every
    // joist line nearest the ≤ 4 ft stations
    const longLen = 2 * longPurlinHalf
    for (const side of [1, -1] as const) {
      const cross = side * purlinRun
      emit(
        'ridge',
        purlinSize,
        [longLen, rd, t],
        alongX ? [0, purlinTop - rd / 2, cross] : [cross, purlinTop - rd / 2, 0],
        alongX ? 0 : -Math.PI / 2,
        0,
        longLen,
        'lumber',
        `Purlin ${purlinSize} @ mid-run under the long-plane rafters (R802.5.1) — halves the ${fmtM(run)} projection${splicedNote(spec, longLen, 'struts')}`,
      )
      const lines = cjStations.filter((u) => Math.abs(u) <= longPurlinHalf - sT / 2 + EPS)
      const feet = new Set<number>()
      for (
        let sx = -longPurlinHalf + sT / 2 + STRUT_SPACING / 2;
        sx < longPurlinHalf - sT / 2;
        sx += STRUT_SPACING
      ) {
        let best: number | undefined
        for (const u of lines) {
          if (best === undefined || Math.abs(u - sx) < Math.abs(best - sx)) best = u
        }
        if (best !== undefined) feet.add(best)
      }
      for (const u of feet) strut(u, cross, purlinTop, false)
    }
    // end planes: a purlin ACROSS the ridge axis over the joist line nearest
    // half the end run; its struts all bear on that joist
    for (const se of [1, -1] as const) {
      const ep = endPurlinOf(se)
      if (ep === null) continue
      const endLen = 2 * ep.half
      emit(
        'ridge',
        purlinSize,
        [endLen, rd, t],
        alongX ? [ep.line, ep.top - rd / 2, 0] : [0, ep.top - rd / 2, ep.line],
        alongX ? -Math.PI / 2 : 0,
        0,
        endLen,
        'lumber',
        `Purlin ${purlinSize} @ ${fmtM(ep.runFromEave)} up the end-plane rafters (R802.5.1) — set over the ceiling joist line ${fmtM(Math.abs(ep.line))} off centre; splits the ${fmtM(run)} projection${splicedNote(spec, endLen, 'struts')}`,
      )
      for (
        let su = -ep.half + sW / 2 + STRUT_SPACING / 2;
        su < ep.half - sW / 2;
        su += STRUT_SPACING
      ) {
        strut(ep.line, su, ep.top, true)
      }
    }
  }

  // ---- collar ties on the ridge portion, upper third (LOD-400 B7b) ----
  // R802.4.6: collar ties in the upper third of the attic space, 4 ft o.c.
  // max — every other common pair on the ridge portion (the end planes'
  // uplift resolves through the hips/kings at the ridge ends; the tie band
  // stays between them so nothing reaches the hip boxes). Geometry mirrors
  // the gable: face-nailed beside the rafter toward the roof center,
  // clamped beneath the ridge bottom at low pitches (round-14 convention).
  if (ridgeHalf > 0.05 && tan > EPS) {
    const [ctT, ctD] = LUMBER_CROSS_SECTIONS['2x4']
    const [, ctRdd] = LUMBER_CROSS_SECTIONS[ridgeSizeFor(spec.rafterSize)]
    const ridgeBottom = ridgeY + seat - ctRdd
    const collarY = Math.min(eaveY + (2 / 3) * rise, ridgeBottom - ctD / 2 - 0.005)
    const collarLen = (2 * (ridgeY - collarY)) / tan
    if (collarLen > 0.3 && collarY > eaveY + 0.2) {
      commons.forEach((u, i) => {
        if (i % 2 !== 0) return
        const cu = u + (u >= 0 ? -1 : 1) * (halfT + ctT / 2)
        emit(
          'collar-tie',
          '2x4',
          [collarLen, ctD, ctT],
          alongX ? [cu, collarY, 0] : [0, collarY, cu],
          alongX ? -Math.PI / 2 : 0,
          0,
          collarLen,
          'lumber',
          'Collar tie 2x4 — upper third (R802.4.6)',
          undefined,
          // a TENSION member cannot field-splice — over-stock ties flag
          spec.detail === '200' ? undefined : onePieceFlag('Collar tie', collarLen),
        )
      })
    }
  }

  // ---- deck on the four planes (B6): strip-tiled tapered planes ----
  // Long planes: trapezoid ridge (2·ridgeHalf) → eave; end planes: triangle
  // off each ridge END. Strips stay INSIDE the 45° hip lines (each band's
  // width taken at its UPHILL edge − clearance) — conservative under-tile
  // at the hips, stated on the label.
  if (spec.detail !== '200') {
    const deckR = run + roof.overhang * cosT
    const gap = deckGap(theta)
    // the ridge board rides the rafter tops (frameGable) — the first strip clears its body
    const gapRidge = ridgeHalf > 0.05 ? ridgeDeckGap(theta, hipRidgeT) : gap
    const panels: DeckPanelSpec[] = []
    for (let z0 = 0; z0 < deckR - EPS; z0 += DECK_STRIP) {
      const z1 = Math.min(z0 + DECK_STRIP, deckR)
      // ridge/eave seams: first strip clears the mirrored plane, last
      // strip clears the fascia band (in-plane strip joints stay exact).
      const zt = Math.max(z0, gapRidge)
      const zb = Math.min(z1, deckR - gap)
      const hwLong = ridgeHalf + z0 - DECK_CLEAR
      const hwEnd = z0 - DECK_CLEAR
      for (const side of [1, -1] as const) {
        panels.push({
          theta,
          side,
          alongXAxis: alongX,
          u0: -hwLong,
          u1: hwLong,
          zTop: zt,
          zBot: zb,
          yTop: ridgeY - zt * tan,
        })
        panels.push({
          theta,
          side,
          alongXAxis: !alongX,
          u0: -hwEnd,
          u1: hwEnd,
          zTop: ridgeHalf + zt,
          zBot: ridgeHalf + zb,
          yTop: ridgeY - zt * tan,
        })
      }
    }
    // Plane truth: 2 trapezoids (ridge 2·ridgeHalf → eave) + 2 triangles
    // off the ridge ends, overhang included — the note states the EXACT
    // coverage the strips achieve on THIS compose (F2).
    const planeArea = (2 * (2 * ridgeHalf + deckR) * deckR + 2 * deckR * deckR) / cosT
    const { note } = tiledDeckNote(panels, planeArea, 'hip lines')
    for (const p of panels) deckPlane(emit, spec, { ...p, rafterDepth: rd, note })
  }

  // ---- fascia (sub + finish) around all four eaves (LOD 400) ----
  if (spec.detail === '400') {
    const [, fD] = LUMBER_CROSS_SECTIONS[FASCIA_SIZE]
    const tipOut = roof.overhang * cosT
    const fasciaY = eaveY - roof.overhang * Math.sin(theta) + fD / 2
    const halfW = roof.width / 2 + tipOut
    const halfD = roof.depth / 2 + tipOut
    for (const side of [1, -1] as const) {
      fasciaPair(
        emit,
        true,
        2 * halfW,
        0,
        side * halfD,
        fasciaY,
        splicedNote(spec, 2 * halfW, 'rafter tails (scarf joints)'),
      )
      fasciaPair(
        emit,
        false,
        2 * halfD,
        0,
        side * halfW,
        fasciaY,
        splicedNote(spec, 2 * halfD, 'rafter tails (scarf joints)'),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Flat / gambrel / mansard / dutch (round-1 gap: these emitted nothing)
// ---------------------------------------------------------------------------

/**
 * Flat roof — joist-style platform with a rim, per the rubric ("flat =
 * joist-style with rim"). The host deck extends `overhang` past the footprint
 * on every side (cosθ = 1), so the platform covers footprint + overhang.
 * ASSUMPTION: the drainage slope (min ¼:12, R903.4) is built with tapered
 * insulation above the deck, not by sloping the joists — labels call it out.
 */
function frameFlat(roof: RoofSegmentSlice, spec: FramingSpec, members: Member[]) {
  const emit = emitter(roof, members)
  const [t, rd] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  const halfW = roof.width / 2 + roof.overhang
  const halfD = roof.depth / 2 + roof.overhang
  const centerY = roof.wallHeight + rd / 2 // resting on the plates, deck above
  const spansX = halfW <= halfD // joists span the SHORT axis
  // Joists stop at the rim INNER faces; the station band also pulls in one
  // thickness so end joists don't share the perpendicular rims' volume
  // (round-14: 36 joist×rim interpenetrations).
  const span = 2 * Math.min(halfW, halfD) - 2 * t
  const stationHalf = Math.max(halfW, halfD) - t
  // Span discipline: a dead-level joist's horizontal projection IS its
  // length. No mid-span bearing is modeled — flag only (S1).
  const flatFlag = slopeRafterFlag(spec, span, span, 'Flat roof joist')
  // B8b: the R802.11 uplift path exists on FLAT roofs too — the audit gap:
  // shed tied BOTH bearing ends while frameFlat never called tieAt (the FL
  // flat-roof market is exactly the ≥130 mph mandate zone). One tie at each
  // bearing end of every joist, at the plate line (footprint edge, joist
  // underside plane y = wallHeight). The connector nails to the joist FACE:
  // placed beside it toward the roof center (the besideRafter convention)
  // and held inside the end rims' inner faces, so the hardware composes
  // SAT-clean with joists and rims — takeoff books the ties by
  // role+material+system for free.
  const tieBear = Math.min(
    Math.min(roof.width, roof.depth) / 2,
    Math.min(halfW, halfD) - t - inches(1.5),
  )
  const tieClear = t / 2 + inches(1.5)
  // B8b fix round (skeptic F1): the beside-offset assumed the nearest joist
  // is a full bay away, but layout()'s guaranteed END station can survive as
  // close as one joist thickness to its grid neighbor — the end tie offset
  // 'toward center' INTO the neighboring joist and the two end-side ties
  // shared volume (~12% of widths per spacing period hit the window; repro
  // 6.9×5). Direction resolves per STATION now: toward center first, flipped
  // OUTWARD when any station sits inside the clearance window on that side;
  // a station blocked both ways (the end joist butts the rim band — outward
  // never fits the t/2 gap there) OMITS its ties and says so on the joist,
  // composed ' | ' onto its span honesty (M2) — steel through lumber is
  // never an option, and silence isn't either. Opposing-direction tie×tie
  // would need stations straddling the center, which the o.c. grid keeps a
  // full bay apart — the same-direction window is the only live class.
  const tieHalf = inches(1.5)
  const tieWindow = tieClear + tieHalf + t / 2
  const rimInnerU = Math.max(halfW, halfD) - t / 2
  const stations = layout(-stationHalf, stationHalf, spec.rafterSpacing, t / 2)
  const tieSpotFor = (u: number): number | undefined => {
    const inward = u >= 0 ? -1 : 1
    for (const dir of [inward, -inward]) {
      const blockedByJoist = stations.some(
        (v) => v !== u && Math.sign(v - u) === dir && Math.abs(v - u) < tieWindow - EPS,
      )
      const spot = u + dir * tieClear
      const blockedByRim = Math.abs(spot) + tieHalf > rimInnerU - 0.002
      if (!blockedByJoist && !blockedByRim) return spot
    }
    return undefined
  }
  const tieOmitFlag =
    'hurricane tie not placeable at this joist — face blocked by the adjacent end joist and the rim band (R802.11) — strap on site, verify uplift path'
  for (const u of stations) {
    const tieSpot = spec.hurricaneTies ? tieSpotFor(u) : null
    emit(
      'rafter',
      spec.rafterSize,
      [span, rd, t],
      spansX ? [0, centerY, u] : [u, centerY, 0],
      spansX ? 0 : -Math.PI / 2,
      0,
      span,
      'lumber',
      `Flat roof joist ${spec.rafterSize} — slope to drains with tapered insulation (¼:12 min, R903.4)`,
      undefined,
      tieSpot === undefined
        ? [flatFlag, tieOmitFlag].filter((f): f is string => f !== undefined).join(' | ')
        : flatFlag,
    )
    if (typeof tieSpot === 'number') {
      for (const side of [1, -1] as const) {
        if (spansX) tieAt(emit, spec, side * tieBear, tieSpot, roof.wallHeight)
        else tieAt(emit, spec, tieSpot, side * tieBear, roof.wallHeight)
      }
    }
  }
  // Long-axis rims run full; short-axis rims BUTT between them.
  const longIsX = halfW >= halfD
  const rimLabel = (len: number) =>
    `Rim / fascia (flat roof)${splicedNote(spec, len, 'joist ends')}`
  for (const side of [1, -1] as const) {
    if (longIsX) {
      emit(
        'rim-joist',
        spec.rafterSize,
        [2 * halfW, rd, t],
        [0, centerY, side * halfD],
        0,
        0,
        2 * halfW,
        'lumber',
        rimLabel(2 * halfW),
      )
      emit(
        'rim-joist',
        spec.rafterSize,
        [2 * halfD - 2 * t, rd, t],
        [side * halfW, centerY, 0],
        -Math.PI / 2,
        0,
        2 * halfD - 2 * t,
        'lumber',
        rimLabel(2 * halfD - 2 * t),
      )
    } else {
      emit(
        'rim-joist',
        spec.rafterSize,
        [2 * halfW - 2 * t, rd, t],
        [0, centerY, side * halfD],
        0,
        0,
        2 * halfW - 2 * t,
        'lumber',
        rimLabel(2 * halfW - 2 * t),
      )
      emit(
        'rim-joist',
        spec.rafterSize,
        [2 * halfD, rd, t],
        [side * halfW, centerY, 0],
        -Math.PI / 2,
        0,
        2 * halfD,
        'lumber',
        rimLabel(2 * halfD),
      )
    }
  }

  // ---- deck over the whole platform (B6) — dead level on the joist tops;
  // drainage stays the tapered-insulation assumption the joists carry.
  deckPlane(emit, spec, {
    theta: 0,
    side: 1,
    alongXAxis: true,
    u0: -halfW,
    u1: halfW,
    zTop: -halfD,
    zBot: halfD,
    yTop: centerY,
    rafterDepth: rd,
  })

  // ---- B6c: perimeter drip (gravel-stop analog) at the deck edge, LOD 400.
  // Long-axis runs full, short-axis runs BUTT between them — the rim
  // convention (real corners lap; boxes can't share the corner volume).
  if (spec.detail === '400') {
    const dripY = centerY + rd / 2 + ROOF_DECK_T + UNDERLAYMENT_T + DRIP_T / 2 + 0.001
    const label = 'Drip edge — eave (R905.2.8.5)'
    // Outer edges flush with the RIM outer faces — the gravel stop never
    // grows the plan envelope the rims already set (round-1 F1b).
    const dz = halfD + t / 2 - DRIP_W / 2
    const dx = halfW + t / 2 - DRIP_W / 2
    for (const side of [1, -1] as const) {
      if (longIsX) {
        emit(
          'drip-edge',
          undefined,
          [2 * halfW, DRIP_T, DRIP_W],
          [0, dripY, side * dz],
          0,
          0,
          2 * halfW,
          'steel',
          label,
        )
        emit(
          'drip-edge',
          undefined,
          [2 * halfD - 2 * DRIP_W, DRIP_T, DRIP_W],
          [side * dx, dripY, 0],
          -Math.PI / 2,
          0,
          2 * halfD - 2 * DRIP_W,
          'steel',
          label,
        )
      } else {
        emit(
          'drip-edge',
          undefined,
          [2 * halfW - 2 * DRIP_W, DRIP_T, DRIP_W],
          [0, dripY, side * dz],
          0,
          0,
          2 * halfW - 2 * DRIP_W,
          'steel',
          label,
        )
        emit(
          'drip-edge',
          undefined,
          [2 * halfD, DRIP_T, DRIP_W],
          [side * dx, dripY, 0],
          -Math.PI / 2,
          0,
          2 * halfD,
          'steel',
          label,
        )
      }
    }
  }
}

/**
 * Gambrel — two planes per side meeting at a purlin. Host geometry: the
 * steep LOWER face carries the schema `pitch` and spans
 * `(depth/2)·gambrelLowerWidthRatio` horizontally, rising
 * `gambrelLowerHeightRatio` of the way to the peak; the shallow upper face
 * finishes the run to the ridge (getPrimarySlopeRun/-RiseFraction in
 * @pascal-app/core).
 */
function frameGambrel(
  roof: RoofSegmentSlice,
  spec: FramingSpec,
  members: Member[],
  walls: readonly WallSlice[] = [],
) {
  const emit = emitter(roof, members)
  const [t, rd] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  const halfT = t / 2
  const theta = roof.pitch
  const tan = Math.tan(theta)
  const cosT = Math.cos(theta)
  const wr = roof.gambrelLowerWidthRatio ?? SHAPE_DEFAULTS.gambrelLowerWidthRatio
  const hr = roof.gambrelLowerHeightRatio ?? SHAPE_DEFAULTS.gambrelLowerHeightRatio
  const run = roof.depth / 2
  const lowerRun = run * wr
  const lowerRise = lowerRun * tan
  const activeRh = lowerRise / hr
  const upperRise = activeRh - lowerRise
  const upperRun = run - lowerRun
  const phi = Math.atan2(upperRise, upperRun)
  // Bottom-on-plate bearing on the lower plane (see frameGable).
  const plateY = roof.wallHeight
  const seat = rd / (2 * cosT)
  const eaveY = plateY + seat
  const breakY = eaveY + lowerRise
  const halfWall = infillZone(spec, roof).inboard
  const ridgeY = eaveY + activeRh
  const breakZ = upperRun // kink plan line: |z| = run − lowerRun
  const lowerLen = lowerRun / cosT + roof.overhang
  const upperLen = Math.hypot(upperRun, upperRise)
  const cuts = rafterCutData(spec, theta, rd)
  const phiDeg = Math.round((phi * 180) / Math.PI)

  // Purlin/ridge stock decides the bearing faces (round-14: lower and
  // upper planes shared 59mm at every kink and both buried in the ridge).
  const [gRt] = LUMBER_CROSS_SECTIONS[ridgeSizeFor(spec.rafterSize)]
  const lowerInset = (rd / 2) * tan // plumb-cut inscribing, lower plane
  const tanPhi = Math.tan(phi)
  const upperInset = (rd / 2) * tanPhi
  // lower top stops at the purlin face; upper spans purlin face → ridge face
  const lowerTopZ = breakZ + gRt / 2
  const lowerTopY = breakY - (gRt / 2) * tan
  const lowerLen2 = (run + roof.overhang * cosT - lowerTopZ) / cosT - 2 * lowerInset
  const upperLoZ = breakZ - gRt / 2
  const upperLoY = breakY + (gRt / 2) * tanPhi
  const upperHiZ = gRt / 2
  const upperHiY = ridgeY - (gRt / 2) * tanPhi
  const upperLen2 = Math.hypot(upperLoZ - upperHiZ, upperHiY - upperLoY) - 2 * upperInset

  // Span discipline per PLANE: the lower rafters bear eave → break purlin,
  // the uppers purlin → ridge, so each plane's horizontal projection is
  // checked on its own (the break purlins below are real bearing).
  const lowerFlag = slopeRafterFlag(spec, lowerRun, lowerLen2)
  const upperFlag = slopeRafterFlag(spec, upperRun, upperLen2)

  const xs = layout(-roof.width / 2, roof.width / 2, spec.rafterSpacing, halfT)
  // B8d rake port (the frameGable dropped-gable detail): flat outlookers lay
  // OVER the two gable-end rafters — those drop by the outlooker thickness
  // along each PLANE's own normal (vertically olT/cosθ resp. olT/cosφ) so
  // the ladder passes. The audit gambrel cantilevered `overhang` past its
  // ends with no rake framing at all.
  const [olT, olW] = LUMBER_CROSS_SECTIONS['2x4']
  const hasRake = spec.detail !== '200' && roof.overhang >= MIN_RAKE_OVERHANG
  const dropped = new Set(hasRake ? [xs[0], xs[xs.length - 1]] : [])
  const cosPhi = Math.cos(phi)
  for (const x of xs) {
    const dropLower = dropped.has(x) ? olT / cosT : 0
    const dropUpper = dropped.has(x) ? olT / cosPhi : 0
    for (const side of [1, -1] as const) {
      const tipZ = side * (run + roof.overhang * cosT)
      const tipY = eaveY - roof.overhang * Math.sin(theta)
      emit(
        'rafter',
        spec.rafterSize,
        [lowerLen2, rd, t],
        [x, (tipY + lowerTopY) / 2 - dropLower, (tipZ + side * lowerTopZ) / 2],
        (side * Math.PI) / 2,
        theta,
        lowerLen2,
        'lumber',
        `Rafter ${spec.rafterSize} (gambrel lower)${cuts}`,
        undefined,
        lowerFlag,
      )
      emit(
        'rafter',
        spec.rafterSize,
        [upperLen2, rd, t],
        [x, (upperLoY + upperHiY) / 2 - dropUpper, (side * (upperLoZ + upperHiZ)) / 2],
        (side * Math.PI) / 2,
        phi,
        upperLen2,
        'lumber',
        `Rafter ${spec.rafterSize} (gambrel upper${spec.detail === '400' ? ` — plumb ${phiDeg}°` : ''})`,
        undefined,
        upperFlag,
      )
      if (spec.hurricaneTies) tieAt(emit, spec, x, side * run, plateY)
    }
  }

  // ---- gable-end infill under the gambrel profile (eave → break → ridge) ----
  {
    const endDrop = hasRake ? olT / cosT : 0
    const under = (z: number): number => {
      const d = Math.abs(z)
      return d >= breakZ ? (run - d) * tan : lowerRise + (breakZ - d) * tanPhi
    }
    for (const sx of [1, -1] as const) {
      infillStuds(emit, spec, roof, {
        plateY,
        alongX: false,
        at: sx * (roof.width / 2),
        from: -roof.depth / 2,
        to: roof.depth / 2,
        topAt: (z) => under(z) - endDrop,
        topSlope: tan,
        label: infillLabel(spec, 'Gable stud'),
      })
    }
  }

  // ---- rake framing: barge rafters + outlookers over the gambrel ends ----
  // frameGable's hasRake rake-ladder block, ported per PLANE (B8d): a barge
  // pair carries each rake edge (steep lower + shallow upper), held by flat
  // 2x4 outlookers laid over the dropped end rafters. Ladders span the
  // FIRST INTERIOR rafter's inner face to the barge's inner face, derived
  // from the ACTUAL xs positions (the gable round-14 convention).
  if (hasRake) {
    for (const sx of [1, -1] as const) {
      const ordered = sx === 1 ? [...xs].sort((a, b) => a - b) : [...xs].sort((a, b) => b - a)
      const inner = ordered[ordered.length - 2] ?? ordered[ordered.length - 1] ?? 0
      const bargeX = sx * (roof.width / 2 + roof.overhang)
      const innerFace = inner + sx * halfT
      const outerFace = bargeX - sx * halfT
      const olLen = Math.abs(outerFace - innerFace)
      const olCx = (innerFace + outerFace) / 2
      const upOl = rd / 2 - olT / 2
      for (const side of [1, -1] as const) {
        const tipZ = side * (run + roof.overhang * cosT)
        const tipY = eaveY - roof.overhang * Math.sin(theta)
        // barge rafters, both planes, at the rake line (undropped — the
        // ladder passes over the dropped END rafters, never the barges)
        emit(
          'rafter',
          spec.rafterSize,
          [lowerLen2, rd, t],
          [bargeX, (tipY + lowerTopY) / 2, (tipZ + side * lowerTopZ) / 2],
          (side * Math.PI) / 2,
          theta,
          lowerLen2,
          'lumber',
          `Barge rafter ${spec.rafterSize} (rake)${splicedNote(spec, lowerLen2, 'outlooker bearings')}`,
        )
        emit(
          'rafter',
          spec.rafterSize,
          [upperLen2, rd, t],
          [bargeX, (upperLoY + upperHiY) / 2, (side * (upperLoZ + upperHiZ)) / 2],
          (side * Math.PI) / 2,
          phi,
          upperLen2,
          'lumber',
          `Barge rafter ${spec.rafterSize} (rake)${splicedNote(spec, upperLen2, 'outlooker bearings')}`,
        )
        // outlookers ladder each plane at 4' o.c. — flat 2x4 rolled INTO its
        // plane, hanging half a thickness under the sheathing plane (the
        // gable convention); upper plane ridge → break, lower break → eave.
        for (let z = OUTLOOKER_SPACING / 2; z < breakZ - EPS; z += OUTLOOKER_SPACING) {
          const y = ridgeY - z * tanPhi + upOl * cosPhi
          const zc = side * z + side * upOl * Math.sin(phi)
          emit(
            'outlooker',
            '2x4',
            [olLen, olT, olW],
            [olCx, y, zc],
            0,
            0,
            olLen,
            'lumber',
            'Outlooker 2x4 flat @ 4ft (rake)',
            side * phi,
          )
        }
        for (let z = breakZ + OUTLOOKER_SPACING / 2; z < run - EPS; z += OUTLOOKER_SPACING) {
          const y = breakY - (z - breakZ) * tan + upOl * cosT
          const zc = side * z + side * upOl * Math.sin(theta)
          emit(
            'outlooker',
            '2x4',
            [olLen, olT, olW],
            [olCx, y, zc],
            0,
            0,
            olLen,
            'lumber',
            'Outlooker 2x4 flat @ 4ft (rake)',
            side * theta,
          )
        }
      }
    }
  }

  // ---- deck on all four planes (B6): lower steep + upper shallow per side.
  // The centerline planes extrapolate to the break (breakZ, breakY) and the
  // ridge apex (0, ridgeY); at the convex kink the normal offsets open a
  // gap exactly like the ridge vent gap. B8d retired the old F4 rake-metal
  // deck flag: the rake ladder + rake drip edge are REAL members now, and
  // the deck widens past the barges exactly like the gable's (a tiny
  // overhang below MIN_RAKE_OVERHANG follows the gable convention — the
  // sheathing cantilevers, no ladder, no rake drip, no flag).
  for (const side of [1, -1] as const) {
    deckPlane(emit, spec, {
      theta,
      side,
      alongXAxis: true,
      u0: hasRake ? -(roof.width / 2 + roof.overhang) : -roof.width / 2,
      u1: hasRake ? roof.width / 2 + roof.overhang : roof.width / 2,
      zTop: breakZ + deckGap(theta),
      zBot: run + roof.overhang * cosT - deckGap(theta),
      yTop: breakY - deckGap(theta) * tan,
      rafterDepth: rd,
    })
    deckPlane(emit, spec, {
      theta: phi,
      side,
      alongXAxis: true,
      u0: hasRake ? -(roof.width / 2 + roof.overhang) : -roof.width / 2,
      u1: hasRake ? roof.width / 2 + roof.overhang : roof.width / 2,
      zTop: ridgeDeckGap(phi, gRt),
      zBot: breakZ - deckGap(phi),
      yTop: ridgeY - ridgeDeckGap(phi, gRt) * tanPhi,
      rafterDepth: rd,
    })
  }

  // ceiling-joist stations, HOISTED — the break struts below bear on them
  // (same math + order as the old inline loop: byte-equal joists).
  // W15: planned against the interior partitions (the gable convention).
  const cjPlan = planCeilingJoists(roof, walls, spec, {
    spansZ: true,
    span: roof.depth,
    bandHalf: roof.width / 2,
    parallel: xs,
    parallelHalfT: halfT,
    stationHalfFor: () => roof.width / 2 - halfWall,
  })
  const cjT = cjPlan.t
  const cjD = cjPlan.dMax
  // B6: end boxes inscribe inside the field clip to the STEEP lower plane
  // (the gable convention above) — the deck rides the rafter tops.
  const cjClipFor = (d: number) =>
    spec.detail === '200' || tan <= EPS ? 0 : Math.max(0, (d - rd / cosT) / tan + 0.002)
  const cjLen = roof.depth - 2 * cjClipFor(cjD)
  const cjStations: number[] =
    cjLen < 0.3
      ? []
      : layout(
          -(roof.width / 2 - halfWall),
          roof.width / 2 - halfWall,
          cjPlan.spacing,
          cjT / 2,
        ).map((x0) => {
          // sister BESIDE a coincident rafter plane, toward the center (round-14)
          const clash = xs.find((rx) => Math.abs(rx - x0) < halfT + cjT / 2 - EPS)
          return clash === undefined ? x0 : clash + (clash >= 0 ? -1 : 1) * (halfT + cjT / 2)
        })

  // ridge + a purlin under each kink (the classic gambrel joint support)
  const ridgeSize = ridgeSizeFor(spec.rafterSize)
  const [rt, rdd] = LUMBER_CROSS_SECTIONS[ridgeSize]
  const ridgeLen = roof.width + 2 * roof.overhang
  // B8a fix-round advisory: the gambrel MAIN ridge is carried by the shallow
  // UPPER planes — their slope φ decides the R802.4.3 question, same code
  // class as the gable (a 15° gambrel composes with sub-3:12 uppers).
  emit(
    'ridge',
    ridgeSize,
    [ridgeLen, rdd, rt],
    [0, ridgeY + seat - rdd / 2, 0],
    0,
    0,
    ridgeLen,
    'lumber',
    `Ridge ${ridgeSize}${splicedNote(spec, ridgeLen, 'rafter pairs (ridge board)')}`,
    undefined,
    ridgeBeamFlagFor(spec, tanPhi),
  )

  // B8d: R802.5.1 — the break purlins carried EVERY rafter joint with ZERO
  // struts. 2x4 struts ≤ 4 ft o.c. drop from the purlin underside to the
  // ceiling joists (the only modeled bearing below — the gable purlin-fix
  // convention: stations SNAP onto real joist lines, no floating struts,
  // labeled as the assumption). When no joist bearing exists (degenerate
  // break too low for a real strut, or no joists at all) the purlin FLAGS
  // instead of bearing on air — members preferred, honesty as fallback.
  const [sT, sW] = LUMBER_CROSS_SECTIONS[STRUT_SIZE]
  // The break purlin's top meets the rafter UNDERSIDES at the kink — `seat`
  // below the centre-line break.
  const strutTop = breakY - seat - rdd // purlin underside
  const strutBot = plateY + cjD // ceiling-joist top face
  const strutLen = strutTop - strutBot
  const strutStations = new Set<number>()
  if (spec.detail !== '200' && strutLen >= inches(3) && cjStations.length > 0) {
    for (
      let sx = -roof.width / 2 + t / 2 + STRUT_SPACING / 2;
      sx < roof.width / 2 - t / 2;
      sx += STRUT_SPACING
    ) {
      let best = cjStations[0] ?? sx
      for (const cj of cjStations) if (Math.abs(cj - sx) < Math.abs(best - sx)) best = cj
      if (best >= -roof.width / 2 + t / 2 - EPS && best <= roof.width / 2 - t / 2 + EPS) {
        strutStations.add(best)
      }
    }
  }
  const strutsLand = strutStations.size > 0
  // the break purlins stop inside the gable studs' wall zone at either end
  const purlinLen = roof.width - 2 * halfWall - 0.004
  const breakPurlinFlag =
    spec.detail === '200' || strutsLand
      ? undefined
      : 'gambrel break purlin unsupported — 2x4 struts ≤ 4 ft o.c. to bearing required (R802.5.1); no modeled joist bearing below — verify support detail'
  for (const side of [1, -1] as const) {
    emit(
      'ridge',
      ridgeSize,
      [purlinLen, rdd, rt],
      [0, breakY - seat - rdd / 2, side * breakZ],
      0,
      0,
      purlinLen,
      'lumber',
      `Purlin ${ridgeSize} @ gambrel break${
        strutsLand
          ? splicedNote(spec, purlinLen, 'struts')
          : splicedNote(spec, purlinLen, 'rafter joints — verify strut support (R802.5.1)')
      }`,
      undefined,
      breakPurlinFlag,
    )
    for (const sx of strutStations) {
      // W15: the foot lands on the joist piece under THIS purlin line.
      const footX = sx + cjPlan.lapOffsetAt(sx, side * breakZ)
      const footY = plateY + (cjPlan.pieceAt(sx, side * breakZ)?.d ?? cjPlan.dMax)
      const len = strutTop - footY
      if (len < inches(3)) continue
      emit(
        'post',
        STRUT_SIZE,
        [sT, len, sW],
        [footX, (strutTop + footY) / 2, side * breakZ],
        0,
        0,
        len,
        'lumber',
        `Purlin strut ${STRUT_SIZE} @ ≤4 ft o.c. — bears on ceiling joists (assumed bearing, R802.5.1)`,
      )
    }
  }

  // ceiling joists at the eave + collar ties in the upper third
  const cjLabel = (size: LumberSize) =>
    `Ceiling joist ${size}${spec.detail === '400' ? ' — rafter tie (R802.4.2), ends clipped to the roof slope' : ''}`
  for (const x of cjStations) {
    emitCeilingJoistPieces(emit, cjPlan, x, true, roof.depth, cjClipFor, plateY, cjLabel)
  }
  const collarY = eaveY + (2 / 3) * activeRh
  if (collarY > breakY) {
    const collarLen = (2 * (ridgeY - collarY) * upperRun) / upperRise
    if (collarLen > 0.3) {
      const [ctT, ctD] = LUMBER_CROSS_SECTIONS['2x4']
      xs.forEach((x, i) => {
        // interior pairs only, every other one — the gable studs brace the end pair (frameGable)
        if (i === 0 || i === xs.length - 1 || (i - 1) % 2 !== 0) return
        // face-nailed beside the rafter, toward the roof center (round-14)
        const cx = x + (x >= 0 ? -1 : 1) * (halfT + ctT / 2)
        emit(
          'collar-tie',
          '2x4',
          [collarLen, ctD, ctT],
          [cx, collarY, 0],
          -Math.PI / 2,
          0,
          collarLen,
          'lumber',
          'Collar tie 2x4',
          undefined,
          spec.detail === '200' ? undefined : onePieceFlag('Collar tie', collarLen),
        )
      })
    }
  }

  // fascia (sub + finish) at the two lower eave tips (LOD 400)
  if (spec.detail === '400') {
    const [, fD] = LUMBER_CROSS_SECTIONS[FASCIA_SIZE]
    const fasciaY = eaveY - roof.overhang * Math.sin(theta) + fD / 2
    for (const side of [1, -1] as const) {
      fasciaPair(
        emit,
        true,
        ridgeLen,
        0,
        side * (run + roof.overhang * cosT),
        fasciaY,
        splicedNote(spec, ridgeLen, 'rafter tails (scarf joints)'),
      )
    }
    // B8d: rake drip edge rides the deck edge over each barge, both planes —
    // plumb-lifted to the deck TOP plane (+2 mm seam), outer edge flush with
    // the barge's outer face (the gable F1b convention: rake metal never
    // grows the plan envelope). This lands the metal the retired F4 deck
    // flag used to confess about.
    if (hasRake) {
      const dripUp = (plane: number) =>
        (rd / 2 + ROOF_DECK_T + DRIP_T / 2) / Math.cos(plane) + 0.002
      for (const sx of [1, -1] as const) {
        const dripX = sx * (roof.width / 2 + roof.overhang + t / 2 - DRIP_W / 2)
        for (const side of [1, -1] as const) {
          const tipZ = side * (run + roof.overhang * cosT)
          const tipY = eaveY - roof.overhang * Math.sin(theta)
          emit(
            'drip-edge',
            undefined,
            [lowerLen2, DRIP_T, DRIP_W],
            [dripX, (tipY + lowerTopY) / 2 + dripUp(theta), (tipZ + side * lowerTopZ) / 2],
            (side * Math.PI) / 2,
            theta,
            lowerLen2,
            'steel',
            'Drip edge — rake (R905.2.8.5)',
          )
          emit(
            'drip-edge',
            undefined,
            [upperLen2, DRIP_T, DRIP_W],
            [dripX, (upperLoY + upperHiY) / 2 + dripUp(phi), (side * (upperLoZ + upperHiZ)) / 2],
            (side * Math.PI) / 2,
            phi,
            upperLen2,
            'steel',
            'Drip edge — rake (R905.2.8.5)',
          )
        }
      }
    }
  }
}

/** Shared steep-skirt framing for mansard/dutch: perimeter rafters + arris hips. */
function frameSkirt(
  roof: RoofSegmentSlice,
  spec: FramingSpec,
  members: Member[],
  opts: {
    /** Horizontal skirt run on the ±Z (long-face) sides. */
    sideRun: number
    /** Horizontal skirt run on the ±X (end-face) sides. */
    endRun: number
    /** Vertical rise of the skirt. */
    rise: number
    label: string
  },
  walls: readonly WallSlice[] = [],
) {
  const emit = emitter(roof, members)
  const [t, rd] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  const halfT = t / 2
  const plateY = roof.wallHeight
  const { sideRun, endRun, rise, label } = opts
  const sideTheta = Math.atan2(rise, sideRun)
  const endTheta = Math.atan2(rise, endRun)

  const face = (
    stations: number[],
    stationIsX: boolean,
    half: number,
    runH: number,
    theta: number,
  ) => {
    const cosT = Math.cos(theta)
    // Inscribed like the hip family (round-14): the tail plumb cut pulls
    // (rd/2)·tanθ in, and the TOP bears short of the arris junction by the
    // jack-style cheek setback so band-edge rafters, the perpendicular
    // face's rafters and the arris hips never share the corner volume.
    const topSetback = (Math.SQRT2 * t) / 2 + (rd / 2) * Math.sin(theta)
    const tailInset = (rd / 2) * Math.tan(theta)
    const len = (runH - topSetback) / cosT + roof.overhang - 2 * tailInset
    if (len < 0.2) return
    // Span discipline: skirt planes project `runH` horizontally; nothing is
    // modeled to strut a purlin to inside a skirt — flag only (S1).
    const faceFlag = slopeRafterFlag(spec, runH, len)
    const tipOut = half + roof.overhang * cosT
    const topOut = half - runH + topSetback
    const seat = rd / (2 * cosT) // bottom face bears on the plate (see frameGable)
    const tipY = plateY + seat - roof.overhang * Math.sin(theta)
    const topY = plateY + seat + rise - topSetback * Math.tan(theta)
    for (const u of stations) {
      for (const side of [1, -1] as const) {
        const cross = (side * (tipOut + topOut)) / 2
        const psi = stationIsX ? (side * Math.PI) / 2 : side === 1 ? Math.PI : 0
        emit(
          'rafter',
          spec.rafterSize,
          [len, rd, t],
          stationIsX ? [u, (tipY + topY) / 2, cross] : [cross, (tipY + topY) / 2, u],
          psi,
          theta,
          len,
          'lumber',
          `${label} ${spec.rafterSize}${rafterCutData(spec, theta, rd)}`,
          undefined,
          faceFlag,
        )
        if (spec.hurricaneTies)
          tieAt(emit, spec, stationIsX ? u : side * half, stationIsX ? side * half : u, plateY)
      }
    }
  }

  // long faces (slopes facing ±Z), stations along X between the arris lines
  // — bands pull one thickness in so edge stations clear the arris tops.
  face(
    layout(-(roof.width / 2 - endRun - t), roof.width / 2 - endRun - t, spec.rafterSpacing, halfT),
    true,
    roof.depth / 2,
    sideRun,
    sideTheta,
  )
  // end faces (slopes facing ±X), stations along Z
  face(
    layout(
      -(roof.depth / 2 - sideRun - t),
      roof.depth / 2 - sideRun - t,
      spec.rafterSpacing,
      halfT,
    ),
    false,
    roof.width / 2,
    endRun,
    endTheta,
  )

  // ---- deck on the four skirt planes (B6): the hip strip pattern with the
  // arris plan slope crossRun/runH (mansard/dutch arrises aren't 45° when
  // endRun ≠ sideRun). Strips stay inside the arris lines — conservative
  // under-tile, stated on the label.
  if (spec.detail !== '200') {
    const panels: DeckPanelSpec[] = []
    let planeArea = 0
    const deckFace = (
      stationIsX: boolean,
      half: number,
      runH: number,
      crossRun: number,
      crossHalf: number,
      theta: number,
    ) => {
      if (runH <= EPS) return
      const cosT = Math.cos(theta)
      const gap = deckGap(theta)
      const zTopEdge = half - runH
      const deckR = half + roof.overhang * cosT
      // Plane truth per face PAIR (F2): each trapezoid's exact slope area
      // incl. the overhang band, width interpolating along the arris slope:
      // ∫ 2·hw(z) dz / cosθ with hw(z) = (crossHalf−crossRun) + z'·(crossRun/runH).
      const L = deckR - zTopEdge
      const oneFace = (2 * (crossHalf - crossRun) * L + (crossRun / runH) * L * L) / cosT
      planeArea += 2 * oneFace
      for (let z0 = zTopEdge; z0 < deckR - EPS; z0 += DECK_STRIP) {
        const z1 = Math.min(z0 + DECK_STRIP, deckR)
        // seams: top strip clears the inner shape's deck at the knuckle,
        // bottom strip clears the fascia band.
        const zt = Math.max(z0, zTopEdge + gap)
        const zb = Math.min(z1, deckR - gap)
        const hw = crossHalf - crossRun + (z0 - zTopEdge) * (crossRun / runH) - DECK_CLEAR
        for (const side of [1, -1] as const) {
          panels.push({
            theta,
            side,
            alongXAxis: stationIsX,
            u0: -hw,
            u1: hw,
            zTop: zt,
            zBot: zb,
            yTop: plateY + rd / (2 * cosT) + rise - (zt - zTopEdge) * Math.tan(theta),
          })
        }
      }
    }
    deckFace(true, roof.depth / 2, sideRun, endRun, roof.width / 2, sideTheta)
    deckFace(false, roof.width / 2, endRun, sideRun, roof.depth / 2, endTheta)
    const { note } = tiledDeckNote(panels, planeArea, 'arris lines')
    for (const p of panels) deckPlane(emit, spec, { ...p, rafterDepth: rd, note })
  }

  // four arris hips: footprint corner → top corner of the skirt, inscribed
  // between their plumb cuts (round-14)
  const hipPlan = Math.hypot(endRun, sideRun)
  const hipTilt = Math.atan2(rise, hipPlan)
  const hipInset = (rd / 2) * Math.tan(hipTilt)
  const hipLen = Math.hypot(hipPlan, rise) - 2 * hipInset
  for (const sx of [1, -1] as const) {
    for (const sz of [1, -1] as const) {
      const corner: [number, number] = [sx * (roof.width / 2), sz * (roof.depth / 2)]
      const top: [number, number] = [
        sx * (roof.width / 2 - endRun),
        sz * (roof.depth / 2 - sideRun),
      ]
      const yawTo = Math.atan2(-(corner[1] - top[1]), corner[0] - top[0])
      emit(
        'hip',
        spec.rafterSize,
        [hipLen, rd, t],
        [
          (corner[0] + top[0]) / 2,
          plateY + rd / (2 * Math.cos(hipTilt)) + rise / 2,
          (corner[1] + top[1]) / 2,
        ],
        yawTo + Math.PI,
        hipTilt,
        hipLen,
        'lumber',
        `Hip ${spec.rafterSize} (${label.toLowerCase()} arris)`,
      )
    }
  }

  // ---- ceiling joists across the short span (LOD-400 B7c, R802.4.2) ----
  // The storey below a mansard/dutch had NO ceiling frame at all while
  // gable/gambrel model theirs (audit B7). The hip band logic mirrored:
  // joists span the short footprint axis at the eave line, ends inscribed
  // inside the B6 field clip to the near skirt planes (the deck rides the
  // rafter tops), stations pulled off the far faces where the end-skirt
  // rafters and the arris hips descend to joist-top height. The upper
  // thrust story rides the INNER shapes — the mansard's hip crown and the
  // dutch gablet model their own joists + R802.4.6 collar ties at the
  // skirt top. A degenerate skirt whose planes never rise clear of the
  // joist band emits nothing (honesty over buried wood).
  const spansZ = roof.depth <= roof.width // joists run along the short axis
  const shortSpan = Math.min(roof.width, roof.depth)
  const longHalf = Math.max(roof.width, roof.depth) / 2
  const spanTheta = spansZ ? sideTheta : endTheta // planes at the joist ENDS
  const spanRun = spansZ ? sideRun : endRun
  const bandTheta = spansZ ? endTheta : sideTheta // planes bounding the stations
  const bandRun = spansZ ? endRun : sideRun
  const spanTan = Math.tan(spanTheta)
  const bandTan = Math.tan(bandTheta)
  // the parallel skirt rafters (the two faces whose rafter stations run
  // with the joists) — the planner keeps the lapped piece out of them
  const spanStationHalf = spansZ ? roof.width / 2 - endRun - t : roof.depth / 2 - sideRun - t
  const parallel = layout(-spanStationHalf, spanStationHalf, spec.rafterSpacing, halfT)
  const cjEndClearFor = (d: number) =>
    bandTan <= EPS ? Number.POSITIVE_INFINITY : d / bandTan + t + 0.002
  // W15: planned against the interior partitions (the hip convention).
  const cjPlan = planCeilingJoists(roof, walls, spec, {
    spansZ,
    span: shortSpan,
    bandHalf: longHalf,
    parallel,
    parallelHalfT: halfT,
    stationHalfFor: (d) => longHalf - cjEndClearFor(d),
  })
  const cjT = cjPlan.t
  const cjD = cjPlan.dMax
  const cjClipFor = (d: number) =>
    spec.detail === '200'
      ? 0
      : spanTan <= EPS
        ? Number.POSITIVE_INFINITY
        : Math.max(0, (d - rd / Math.cos(spanTheta)) / spanTan + 0.002)
  const cjClip = cjClipFor(cjD)
  const cjEndClear = cjEndClearFor(cjD)
  const cjLen = shortSpan - 2 * cjClip
  const cjBandHalf = longHalf - cjEndClear
  if (cjLen >= 0.3 && cjBandHalf > cjT && cjClip <= spanRun && cjEndClear <= bandRun) {
    // sister BESIDE the parallel skirt rafters, snapped toward the center,
    // snapped pairs deduped — the hip/gable convention.
    const besideRafter = (u0: number): number => {
      const clash = parallel.find((ru) => Math.abs(ru - u0) < halfT + cjT / 2 - EPS)
      if (clash === undefined) return u0
      return clash + (clash >= 0 ? -1 : 1) * (halfT + cjT / 2)
    }
    const snapped = layout(-cjBandHalf, cjBandHalf, cjPlan.spacing, cjT / 2)
      .map(besideRafter)
      .sort((a, b) => a - b)
    const cjStations: number[] = []
    for (const u of snapped) {
      const prev = cjStations[cjStations.length - 1]
      if (prev !== undefined && u - prev < cjT - EPS) continue
      cjStations.push(u)
    }
    // B7 fix round (skeptic F1): the same end-plane thrust statement the
    // hip prints — the skirt END faces' rafters get no parallel tie and
    // the band stops short of the corner triangles. 400-only (B6 stated-
    // gap convention), composed onto over-span honesty (M2 rule).
    const cjEndGapFlag =
      spec.detail === '400'
        ? `${label.toLowerCase()} end faces: rafter ties parallel to the end-face span + end-triangle stub joists not modeled — verify tie detail (R802.4.2)`
        : undefined
    const cjLabel = (size: LumberSize) =>
      `Ceiling joist ${size} — rafter tie (R802.4.2)${
        spec.detail === '400' ? ', ends clipped to the roof slope' : ''
      }`
    for (const u of cjStations) {
      emitCeilingJoistPieces(
        emit,
        cjPlan,
        u,
        spansZ,
        shortSpan,
        cjClipFor,
        plateY,
        cjLabel,
        cjEndGapFlag,
      )
    }
  }
}

/** Inner sections reuse the primary shapes without doubling 400 trim/ties. */
function innerSpec(spec: FramingSpec): FramingSpec {
  return { ...spec, hurricaneTies: false, detail: spec.detail === '200' ? '200' : '300' }
}

/**
 * Mansard — steep skirt on all four sides (run = min(width,depth)·
 * mansardSteepWidthRatio at the schema pitch, rising mansardSteepHeightRatio
 * of the peak height), finished with a shallow hip over the inset rectangle.
 */
function frameMansard(
  roof: RoofSegmentSlice,
  spec: FramingSpec,
  members: Member[],
  walls: readonly WallSlice[] = [],
) {
  const swr = roof.mansardSteepWidthRatio ?? SHAPE_DEFAULTS.mansardSteepWidthRatio
  const shr = roof.mansardSteepHeightRatio ?? SHAPE_DEFAULTS.mansardSteepHeightRatio
  const minSpan = Math.min(roof.width, roof.depth)
  const inset = minSpan * swr
  const skirtRise = inset * Math.tan(roof.pitch)
  const activeRh = skirtRise / shr
  const upperRise = activeRh - skirtRise

  frameSkirt(
    roof,
    spec,
    members,
    {
      sideRun: inset,
      endRun: inset,
      rise: skirtRise,
      label: 'Mansard skirt',
    },
    walls,
  )

  // upper deck: a shallow hip over the inset rectangle
  const innerRun = minSpan / 2 - inset
  if (innerRun > 0.2 && upperRise > EPS) {
    const beforeCrown = members.length
    frameHip(
      {
        ...roof,
        width: roof.width - 2 * inset,
        depth: roof.depth - 2 * inset,
        pitch: Math.atan2(upperRise, innerRun),
        overhang: 0,
        wallHeight: roof.wallHeight + skirtRise,
      },
      innerSpec(spec),
      members,
    )
    // B7 fix round (skeptic advisory): the crown's ceiling joists bear on
    // NOTHING modeled at their ends — the skirt-top junction, not a plate.
    // Say so on the label (the purlin-strut assumed-bearing convention;
    // the dutch gablet ships the same class from the gable machinery).
    for (let i = beforeCrown; i < members.length; i++) {
      const m = members[i] as Member
      if (m.role === 'ceiling-joist') {
        m.label = `${m.label} (assumed bearing at skirt top — verify)`
      }
    }
  }

  // perimeter fascia — sub + finish (LOD 400)
  if (spec.detail === '400') {
    const emit = emitter(roof, members)
    const [, fD] = LUMBER_CROSS_SECTIONS[FASCIA_SIZE]
    const [, rdS] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
    const tipOut = roof.overhang * Math.cos(roof.pitch)
    // the skirt rafters bear bottom-on-plate (frameSkirt): the fascia rides their lifted tails
    const fasciaY =
      roof.wallHeight +
      rdS / (2 * Math.cos(roof.pitch)) -
      roof.overhang * Math.sin(roof.pitch) +
      fD / 2
    const halfW = roof.width / 2 + tipOut
    const halfD = roof.depth / 2 + tipOut
    for (const side of [1, -1] as const) {
      fasciaPair(
        emit,
        true,
        2 * halfW,
        0,
        side * halfD,
        fasciaY,
        splicedNote(spec, 2 * halfW, 'rafter tails (scarf joints)'),
      )
      fasciaPair(
        emit,
        false,
        2 * halfD,
        0,
        side * halfW,
        fasciaY,
        splicedNote(spec, 2 * halfD, 'rafter tails (scarf joints)'),
      )
    }
  }
}

/**
 * Dutch gable — a hip skirt rising dutchHipHeightRatio of the peak height
 * (inset = min(width,depth)·dutchHipWidthRatio), topped by a gablet over the
 * waist rectangle (getDutchRoofMetrics in @pascal-app/core; the gablet barge
 * rake is treated as 0 — the waist end-walls carry the gablet).
 */
function frameDutch(
  roof: RoofSegmentSlice,
  spec: FramingSpec,
  members: Member[],
  walls: readonly WallSlice[] = [],
) {
  const dwr = roof.dutchHipWidthRatio ?? SHAPE_DEFAULTS.dutchHipWidthRatio
  const dhr = roof.dutchHipHeightRatio ?? SHAPE_DEFAULTS.dutchHipHeightRatio
  const waistRatio = roof.dutchWaistLengthRatio ?? SHAPE_DEFAULTS.dutchWaistLengthRatio
  const alongX = roof.width >= roof.depth
  const minSpan = Math.min(roof.width, roof.depth)
  const maxSpan = Math.max(roof.width, roof.depth)
  const inset = minSpan * dwr
  const skirtRise = inset * Math.tan(roof.pitch)
  const activeRh = skirtRise / dhr
  const upperRise = activeRh - skirtRise
  const waistHalfLong = Math.max(0, (maxSpan / 2 - inset) * waistRatio)
  const waistHalfShort = Math.max(0, minSpan / 2 - inset)
  const endRun = maxSpan / 2 - waistHalfLong

  frameSkirt(
    roof,
    spec,
    members,
    {
      sideRun: alongX ? inset : endRun,
      endRun: alongX ? endRun : inset,
      rise: skirtRise,
      label: 'Dutch skirt',
    },
    walls,
  )

  // gablet over the waist rectangle
  if (waistHalfLong > 0.2 && waistHalfShort > 0.1 && upperRise > EPS) {
    const gablet: RoofSegmentSlice = {
      ...roof,
      yaw: alongX ? roof.yaw : roof.yaw + Math.PI / 2,
      width: 2 * waistHalfLong,
      depth: 2 * waistHalfShort,
      pitch: Math.atan2(upperRise, waistHalfShort),
      overhang: 0,
      wallHeight: roof.wallHeight + skirtRise,
      // no wall under the gablet's plate — its infill studs stand inboard (infillZone)
      wallThickness: 0,
    }
    frameGable(gablet, innerSpec(spec), members)
  }

  // perimeter fascia — sub + finish (LOD 400)
  if (spec.detail === '400') {
    const emit = emitter(roof, members)
    const [, fD] = LUMBER_CROSS_SECTIONS[FASCIA_SIZE]
    const [, rdS] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
    const tipOut = roof.overhang * Math.cos(roof.pitch)
    // the skirt rafters bear bottom-on-plate (frameSkirt): the fascia rides their lifted tails
    const fasciaY =
      roof.wallHeight +
      rdS / (2 * Math.cos(roof.pitch)) -
      roof.overhang * Math.sin(roof.pitch) +
      fD / 2
    const halfW = roof.width / 2 + tipOut
    const halfD = roof.depth / 2 + tipOut
    for (const side of [1, -1] as const) {
      fasciaPair(
        emit,
        true,
        2 * halfW,
        0,
        side * halfD,
        fasciaY,
        splicedNote(spec, 2 * halfW, 'rafter tails (scarf joints)'),
      )
      fasciaPair(
        emit,
        false,
        2 * halfD,
        0,
        side * halfW,
        fasciaY,
        splicedNote(spec, 2 * halfD, 'rafter tails (scarf joints)'),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Valleys — a wing joining a main roof at right angles (LOD 350)
// ---------------------------------------------------------------------------

export type ValleyLine = {
  major: RoofSegmentSlice
  /** The penetrating segment's id — its deck overlays the major (B6 note). */
  minorId: string
  /** Eave foot of the valley, in the MAJOR segment's frame. */
  foot: readonly [number, number, number]
  /** Apex where the minor ridge pierces the major slope (major frame). */
  apex: readonly [number, number, number]
}

/** A wing's eave may sit this far ABOVE the main eave and still join (tolerance). */
const VALLEY_EAVE_TOLERANCE = 0.05
/** A foot closer than this to the wing ridge is no valley (the wing barely clears the eave). */
const VALLEY_MIN_FOOT_RUN = 0.1

/**
 * The main roof's frame for a join: the half-length of the LONG plane the
 * wing may pierce (a gable's full width; a hip's ridge portion — the wing
 * must stay clear of the hip ends), null for shapes not modeled (a hip
 * whose ridge runs across its depth, sheds, flats, gambrels, mansards).
 */
function valleyMajorFrame(major: RoofSegmentSlice): { longHalf: number } | null {
  if (major.roofType === 'gable') return { longHalf: major.width / 2 }
  if (major.roofType === 'hip' && major.width >= major.depth) {
    return { longHalf: Math.max(0, major.width / 2 - major.depth / 2) }
  }
  return null
}

/**
 * The wing's frame for a join: its ridge half-length along the main's Z
 * (a gable's full width; a hip's ridge portion) — a hip wing must carry
 * its ridge all the way to the pierce point, or its near hip end would sit
 * on the main roof (a hip-dormer termination this model does not frame).
 */
function valleyMinorFrame(minor: RoofSegmentSlice): { hip: boolean; ridgeHalf: number } | null {
  if (minor.roofType === 'gable') return { hip: false, ridgeHalf: minor.width / 2 }
  if (minor.roofType === 'hip' && minor.width >= minor.depth) {
    return { hip: true, ridgeHalf: Math.max(0, minor.width / 2 - minor.depth / 2) }
  }
  return null
}

/**
 * Detect valley lines where a WING (gable or hip) joins a MAIN roof (gable
 * or hip) at right angles — the classic L/T join and the porch gable into
 * the main slope. The valley is the intersection of the two slope planes:
 * it rises from the point where the wing's plane reaches the main eave
 * height on the main eave line to the point where the wing's ridge pierces
 * the main slope. A wing whose eave sits BELOW the main eave (the porch
 * roof on its lower plate — W16) joins with its feet moved inboard of the
 * wing eave by drop/tan(wing pitch) and its apex that much lower; a wing
 * whose eave is above the main eave is not modeled. ASSUMPTIONS: skewed
 * (non-perpendicular) crossings, joins onto a hip end plane and short hip
 * wings are not detected (they warn); the penetrating segment's rafters
 * overlay the main roof (overlay framing).
 */
export function detectValleys(roofs: RoofSegmentSlice[]): ValleyLine[] {
  const out: ValleyLine[] = []
  for (const major of roofs) {
    const majorFrame = valleyMajorFrame(major)
    if (majorFrame === null) continue
    for (const minor of roofs) {
      if (minor === major) continue
      const minorFrame = valleyMinorFrame(minor)
      if (minorFrame === null) continue
      const rel = minor.yaw - major.yaw
      if (Math.abs(Math.abs(Math.sin(rel)) - 1) > 0.01) continue // ⊥ only
      const eaveMajor = major.position[1] + major.wallHeight
      const eaveMinor = minor.position[1] + minor.wallHeight
      // the wing eave below the main eave (≥ 0), or a hair above
      const drop = Math.max(0, eaveMajor - eaveMinor)
      if (eaveMinor - eaveMajor > VALLEY_EAVE_TOLERANCE) continue
      // minor center in the major's segment frame (inverse of the emitter Ry)
      const dxl = minor.position[0] - major.position[0]
      const dzl = minor.position[2] - major.position[2]
      const cos = Math.cos(major.yaw)
      const sin = Math.sin(major.yaw)
      const cx = dxl * cos - dzl * sin
      const cz = dxl * sin + dzl * cos
      const run1 = major.depth / 2
      const tan1 = Math.tan(major.pitch)
      const rise1 = run1 * tan1
      const r2 = minor.depth / 2 // minor slope run — maps onto the major X axis
      const tan2 = Math.tan(minor.pitch)
      const rise2 = r2 * tan2 - drop // the wing ridge above the MAIN eave
      if (rise2 <= EPS) continue // never clears the main eave
      if (rise2 > rise1 + EPS) continue // minor tops out above the major ridge
      const halfAlong = minorFrame.ridgeHalf // minor ridge half-length, on major Z
      const near = Math.abs(cz) - halfAlong
      if (near >= run1 - EPS) continue // never reaches the major slope
      if (Math.abs(cz) + halfAlong <= run1 + EPS) continue // fully buried
      if (Math.abs(cx) + r2 > majorFrame.longHalf + EPS) continue // past the long plane
      const zApex = run1 - rise2 / tan1
      if (minorFrame.hip && near > zApex + EPS) continue // the hip ridge stops short
      // the foot: where the wing plane reaches the main eave height, inboard
      // of the wing eave by drop/tanθ₂ (zero for a level join)
      const footRun = r2 - drop / tan2
      if (footRun < VALLEY_MIN_FOOT_RUN) continue
      const sz = cz >= 0 ? 1 : -1
      for (const s of [1, -1] as const) {
        out.push({
          major,
          minorId: minor.id,
          foot: [cx + s * footRun, major.wallHeight, sz * run1],
          apex: [cx, major.wallHeight + rise2, sz * zApex],
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Buried parallel wings (W16c) — a wing whose ridge runs WITH the main's and
// whose roof lies at or under the main's wherever they overlap: the garage
// wing set beside and behind the house, its rear plane continuing the
// main's, its west end inside the house. The wing's members inside the
// main's footprint are fake wood (the main's rafters ARE that plane; the
// wing's front plane there sits in the main's attic), and the main's rake
// overhang over the wing's continuing plane is fake trim. Both are cut.
// ---------------------------------------------------------------------------

export type BuriedWing = {
  major: RoofSegmentSlice
  minor: RoofSegmentSlice
  /** The wing's buried extent along the main's ridge axis (main frame). */
  x0: number
  x1: number
}

/** The wing's roof may stand this far above the main's and still count as under it. */
const BURIAL_TOLERANCE = 0.02
/** Eave trim (fascia, drip edge) hangs this far past the overhang tip — inside the zones. */
const EAVE_TRIM = 0.3

/**
 * Rafter centre-plane height (level y, seat excluded) of a gable or hip at
 * a segment-local plan point — the plane keeps going past the eaves (the
 * overhang) and past a hip end; null for shapes the burial test skips.
 */
export function roofPlaneAt(roof: RoofSegmentSlice, xl: number, zl: number): number | null {
  const tan = Math.tan(roof.pitch)
  const base = roof.position[1] + roof.wallHeight
  if (roof.roofType === 'gable') return base + (roof.depth / 2 - Math.abs(zl)) * tan
  if (roof.roofType === 'hip') {
    const alongX = roof.width >= roof.depth
    const run = Math.min(roof.width, roof.depth) / 2
    const longHalf = Math.max(roof.width, roof.depth) / 2
    const cross = alongX ? Math.abs(zl) : Math.abs(xl)
    const long = alongX ? Math.abs(xl) : Math.abs(zl)
    return base + Math.min(run - cross, longHalf - long) * tan
  }
  return null
}

/** Level plan point → a segment's local (x along its ridge axis, z across). */
function toSegmentPlan(roof: RoofSegmentSlice, px: number, pz: number): [number, number] {
  const dx = px - roof.position[0]
  const dz = pz - roof.position[2]
  const cos = Math.cos(roof.yaw)
  const sin = Math.sin(roof.yaw)
  return [dx * cos - dz * sin, dx * sin + dz * cos]
}

/** The plan reach of a segment's eave overhang. */
const tipOf = (roof: RoofSegmentSlice) => roof.overhang * Math.cos(roof.pitch)

/**
 * Parallel pairs where the WING (minor) lies at or under the MAIN (major)
 * across their whole overlap — sampled on a 0.2 m grid over the overlap of
 * the main's footprint (plus its eave zone) with the wing's. A pair that
 * qualifies both ways (two equal roofs side by side) keeps the larger
 * footprint as the main. Wings that rise above the main anywhere in the
 * overlap are a real intersection and stay with the unframed warning.
 */
export function detectBuriedWings(roofs: RoofSegmentSlice[]): BuriedWing[] {
  const found = new Map<string, BuriedWing>()
  for (const major of roofs) {
    if (roofPlaneAt(major, 0, 0) === null) continue
    for (const minor of roofs) {
      if (minor === major || roofPlaneAt(minor, 0, 0) === null) continue
      if (Math.abs(Math.sin(minor.yaw - major.yaw)) > 0.01) continue // parallel ridges only
      // vertical envelopes must interleave — a cupola floating above the
      // ridge is stacking, not a join (the B8c reporter's own screen)
      if (
        minor.position[1] >= segPeakY(major) - EPS ||
        major.position[1] >= segPeakY(minor) - EPS
      ) {
        continue
      }
      const [cx, cz] = toSegmentPlan(major, minor.position[0], minor.position[2])
      const fx0 = Math.max(-major.width / 2, cx - minor.width / 2)
      const fx1 = Math.min(major.width / 2, cx + minor.width / 2)
      const fz0 = Math.max(-major.depth / 2, cz - minor.depth / 2)
      const fz1 = Math.min(major.depth / 2, cz + minor.depth / 2)
      if (fx1 - fx0 < 0.1 || fz1 - fz0 < 0.1) continue // footprints must overlap
      // sample the overlap, the main's eave zone included
      const tip = tipOf(major)
      const z0 = Math.max(-major.depth / 2 - tip, cz - minor.depth / 2)
      const z1 = Math.min(major.depth / 2 + tip, cz + minor.depth / 2)
      const nx = Math.max(2, Math.ceil((fx1 - fx0) / 0.2) + 1)
      const nz = Math.max(2, Math.ceil((z1 - z0) / 0.2) + 1)
      let under = true
      for (let i = 0; i < nx && under; i++) {
        const x = fx0 + ((fx1 - fx0) * i) / (nx - 1)
        for (let j = 0; j < nz; j++) {
          const z = z0 + ((z1 - z0) * j) / (nz - 1)
          const yMajor = roofPlaneAt(major, x, z) as number
          // the wing's plane at the same level point (its surfaces are symmetric — a
          // reversed wing reads the same)
          const yMinor = roofPlaneAt(minor, x - cx, z - cz) as number
          if (yMinor > yMajor + BURIAL_TOLERANCE) {
            under = false
            break
          }
        }
      }
      if (!under) continue
      const key = major.id < minor.id ? `${major.id}|${minor.id}` : `${minor.id}|${major.id}`
      const prior = found.get(key)
      if (
        prior !== undefined &&
        prior.major.width * prior.major.depth >= major.width * major.depth
      ) {
        continue
      }
      found.set(key, { major, minor, x0: fx0, x1: fx1 })
    }
  }
  return [...found.values()]
}

/** A member's long axis (its box +X) as a level unit vector, from the three XYZ euler. */
export function memberAxis(m: Member): [number, number, number] {
  const [rx, ry, rz] = m.rotation
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  return [cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz]
}

/**
 * Cut a member to the parts NOT covered by `covered(px, pz)`: sampled every
 * 0.1 m along its axis, each boundary bisected to 5 mm; pieces under 0.15 m
 * are dropped; a member with no plan length (a strut, a stud) is kept or
 * dropped whole by its centre. Kept pieces carry `note` on the label.
 */
export function clipMemberBy(
  m: Member,
  covered: (px: number, pz: number) => boolean,
  note: string,
): Member[] {
  const axis = memberAxis(m)
  const L = m.dims[0]
  const plan = Math.hypot(axis[0], axis[2])
  const at = (s: number): [number, number, number] => [
    m.position[0] + axis[0] * s,
    m.position[1] + axis[1] * s,
    m.position[2] + axis[2] * s,
  ]
  const coveredAt = (s: number) => {
    const p = at(s)
    return covered(p[0], p[2])
  }
  if (plan < 0.3 || L < 0.2) return coveredAt(0) ? [] : [m]
  const n = Math.max(2, Math.ceil(L / 0.1) + 1)
  const step = L / (n - 1)
  const cov: boolean[] = []
  for (let i = 0; i < n; i++) cov.push(coveredAt(-L / 2 + step * i))
  if (cov.every((c) => !c)) return [m]
  if (cov.every((c) => c)) return []
  const edge = (sIn: number, sOut: number): number => {
    // bisect between an uncovered sample (sIn) and a covered one (sOut)
    let a = sIn
    let b = sOut
    for (let k = 0; k < 6; k++) {
      const mid = (a + b) / 2
      if (coveredAt(mid)) b = mid
      else a = mid
    }
    return (a + b) / 2
  }
  const out: Member[] = []
  let i = 0
  while (i < n) {
    if (cov[i]) {
      i++
      continue
    }
    let j = i
    while (j + 1 < n && !cov[j + 1]) j++
    const a = i === 0 ? -L / 2 : edge(-L / 2 + step * i, -L / 2 + step * (i - 1))
    const b = j === n - 1 ? L / 2 : edge(-L / 2 + step * j, -L / 2 + step * (j + 1))
    const len = b - a
    if (len >= 0.15) {
      const sMid = (a + b) / 2
      out.push({
        ...m,
        position: at(sMid),
        length: Math.abs(m.length - L) < 1e-9 ? len : (m.length * len) / L,
        dims: [len, m.dims[1], m.dims[2]],
        label: `${m.label ?? ''}${note}`,
      })
    }
    i = j + 1
  }
  return out
}

/**
 * Apply the burials: the wing's members inside the main's footprint (and
 * its eave zone) go; the main's overhang members over the wing's continuing
 * plane (its rake ladder and barge beyond the gable line where the wing's
 * plane carries on at or above the main's) go too. Straddling members —
 * the wing's ridge, purlins, fascia, deck courses; the main's outlookers
 * and barges — are cut at the boundary and say so.
 */
export function buryWings(roofs: RoofSegmentSlice[], members: Member[]): Member[] {
  const wings = detectBuriedWings(roofs)
  if (wings.length === 0) return members
  let out = members
  for (const w of wings) {
    const { major, minor } = w
    const tipM = tipOf(major)
    const tipW = tipOf(minor)
    const inMajorFootprint = (px: number, pz: number) => {
      const [x, z] = toSegmentPlan(major, px, pz)
      return Math.abs(x) <= major.width / 2 + EPS && Math.abs(z) <= major.depth / 2 + EPS
    }
    const inMajorEaveZone = (px: number, pz: number) => {
      const [x, z] = toSegmentPlan(major, px, pz)
      return (
        Math.abs(x) <= major.width / 2 + EPS &&
        Math.abs(z) <= major.depth / 2 + tipM + EAVE_TRIM + EPS
      )
    }
    const inMinorReach = (px: number, pz: number) => {
      const [x, z] = toSegmentPlan(minor, px, pz)
      return (
        Math.abs(x) <= minor.width / 2 + minor.overhang + EAVE_TRIM + EPS &&
        Math.abs(z) <= minor.depth / 2 + tipW + EAVE_TRIM + EPS
      )
    }
    const minorCovered = (px: number, pz: number) => inMajorEaveZone(px, pz)
    const majorCovered = (px: number, pz: number) => {
      // only the main's RAKE zone past its gable line — its own eave tails
      // over the shared eave stay (the wing's duplicates are the ones removed)
      const [xm, zm] = toSegmentPlan(major, px, pz)
      if (Math.abs(xm) <= major.width / 2 + EPS || !inMinorReach(px, pz)) return false
      const [xw, zw] = toSegmentPlan(minor, px, pz)
      const yMajor = roofPlaneAt(major, xm, zm) as number
      const yMinor = roofPlaneAt(minor, xw, zw) as number
      return yMajor <= yMinor + BURIAL_TOLERANCE
    }
    const minorNote = ` — cut at the main roof ${major.id} (the wing runs under it there; bearing / ledger at the main wall — verify)`
    const majorNote = ` — cut where the wing ${minor.id} carries the plane on (no rake there)`
    const next: Member[] = []
    for (const m of out) {
      if (m.sourceId === minor.id) next.push(...clipMemberBy(m, minorCovered, minorNote))
      else if (m.sourceId === major.id) next.push(...clipMemberBy(m, majorCovered, majorNote))
      else next.push(m)
    }
    out = next
  }
  return out
}

/** The level warnings for buried wings — the junction the model does not draw. */
export function buriedWingWarnings(roofs: RoofSegmentSlice[]): string[] {
  return detectBuriedWings(roofs).map(
    (w) =>
      `wing ${w.minor.id} runs under roof ${w.major.id} (ridges parallel, the wing's roof at or below the main's over ${fmtM(w.x1 - w.x0)} of overlap): the wing's members inside the main's footprint are removed and its ridge, purlins and eave members cut at the main's end-wall line, the main's rake trim cut where the wing's plane carries on — flashing where the wing's planes die into the main roof, a ledger or bearing at the main's end wall, and (a garage wing) the dwelling–garage separation carried to the roof deck (R302.6): verify the junction detail`,
  )
}

// ---------------------------------------------------------------------------
// B8c: unframed roof intersections — the labeling contract, never silent
// ---------------------------------------------------------------------------

/** Real penetration below this (shared edges, mm-scale grazes between
 * adjacent wings) is composition, not an intersection. */
const INTERSECT_MARGIN = 0.05

/** Segment peak height (level-local): origin + wallHeight + the shape's own
 * rise — the vertical envelope for the intersection screen. Generous per
 * shape; flat uses a nominal platform depth. */
function segPeakY(r: RoofSegmentSlice): number {
  const tan = Math.tan(r.pitch)
  const minSpan = Math.min(r.width, r.depth)
  let rise: number
  switch (r.roofType) {
    case 'shed':
      rise = r.depth * tan
      break
    case 'flat':
      rise = 0.3
      break
    case 'gambrel': {
      const wr = r.gambrelLowerWidthRatio ?? SHAPE_DEFAULTS.gambrelLowerWidthRatio
      const hr = r.gambrelLowerHeightRatio ?? SHAPE_DEFAULTS.gambrelLowerHeightRatio
      rise = ((r.depth / 2) * wr * tan) / Math.max(hr, EPS)
      break
    }
    case 'mansard': {
      const swr = r.mansardSteepWidthRatio ?? SHAPE_DEFAULTS.mansardSteepWidthRatio
      const shr = r.mansardSteepHeightRatio ?? SHAPE_DEFAULTS.mansardSteepHeightRatio
      rise = (minSpan * swr * tan) / Math.max(shr, EPS)
      break
    }
    case 'dutch': {
      const dwr = r.dutchHipWidthRatio ?? SHAPE_DEFAULTS.dutchHipWidthRatio
      const dhr = r.dutchHipHeightRatio ?? SHAPE_DEFAULTS.dutchHipHeightRatio
      rise = (minSpan * dwr * tan) / Math.max(dhr, EPS)
      break
    }
    case 'hip':
      rise = (minSpan / 2) * tan
      break
    default:
      rise = (r.depth / 2) * tan
  }
  return r.position[1] + r.wallHeight + Math.max(0, rise)
}

/** Plan-rectangle overlap (2D OBB SAT on the two segments' yawed footprints),
 * requiring REAL penetration past INTERSECT_MARGIN on every axis. */
function footprintsOverlap(a: RoofSegmentSlice, b: RoofSegmentSlice): boolean {
  // Local +X / +Z in the (x, z) plan under a three Y-rotation — the emitter
  // convention: +X → (cosψ, −sinψ), +Z → (sinψ, cosψ).
  const axesOf = (r: RoofSegmentSlice): [number, number][] => {
    const c = Math.cos(r.yaw)
    const s = Math.sin(r.yaw)
    return [
      [c, -s],
      [s, c],
    ]
  }
  const ax = axesOf(a)
  const bx = axesOf(b)
  const t: [number, number] = [b.position[0] - a.position[0], b.position[2] - a.position[2]]
  const halfA = [a.width / 2, a.depth / 2]
  const halfB = [b.width / 2, b.depth / 2]
  const radius = (axes: [number, number][], half: number[], axis: [number, number]): number =>
    axes.reduce(
      (sum, u, i) => sum + Math.abs((u[0] ?? 0) * axis[0] + (u[1] ?? 0) * axis[1]) * (half[i] ?? 0),
      0,
    )
  for (const axis of [...ax, ...bx]) {
    const proj = Math.abs(t[0] * (axis[0] ?? 0) + t[1] * (axis[1] ?? 0))
    if (proj > radius(ax, halfA, axis) + radius(bx, halfB, axis) - INTERSECT_MARGIN) return false
  }
  return true
}

/**
 * B8c: overlapping segment pairs the valley detector does NOT serve. A hip
 * wing into a gable main — or a skewed, parallel, buried or eave-mismatched
 * gable pair — frames straight through with NO members, and the detector's
 * perpendicular-gable×gable assumption used to live only in its docblock:
 * silence broke the labeling contract. Every non-qualifying overlap now
 * surfaces as ONE computeLevel warning per pair ('roof intersection not
 * framed — valley detail required …'), printed verbatim in the P4 schedules
 * flag block. Full hip-plane valley framing stays out of scope (v1 = the
 * warning). Touching edges (adjacent wings) and vertically separated stacks
 * (a cupola floating above the main ridge) never warn; pairs detectValleys
 * frames are already served — their members ARE the answer.
 */
export function detectUnframedRoofIntersections(roofs: RoofSegmentSlice[]): string[] {
  const key = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`)
  const served = new Set<string>()
  for (const v of detectValleys(roofs)) served.add(key(v.major.id, v.minorId))
  for (const w of detectBuriedWings(roofs)) served.add(key(w.major.id, w.minor.id))
  const out: string[] = [...buriedWingWarnings(roofs)]
  for (let i = 0; i < roofs.length; i++) {
    for (let j = i + 1; j < roofs.length; j++) {
      const a = roofs[i] as RoofSegmentSlice
      const b = roofs[j] as RoofSegmentSlice
      if (served.has(key(a.id, b.id))) continue
      // vertical envelopes must interleave — plan overlap alone is stacking
      if (a.position[1] >= segPeakY(b) - EPS || b.position[1] >= segPeakY(a) - EPS) continue
      if (!footprintsOverlap(a, b)) continue
      out.push(
        `roof intersection not framed — valley detail required (${a.roofType} ${a.id} × ${b.roofType} ${b.id}: only a gable / hip wing joining a gable / hip main at right angles on its long plane, ridge reaching the main slope, wing eave at or below the main eave, is modeled)`,
      )
    }
  }
  return out
}

/** Emit one valley member (one size deeper than the rafters — it carries jacks). */
function emitValley(valley: ValleyLine, spec: FramingSpec, members: Member[]) {
  const emit = emitter(valley.major, members)
  const size = ridgeSizeFor(spec.rafterSize)
  const [t, rd] = LUMBER_CROSS_SECTIONS[size]
  const { foot, apex } = valley
  const ux = apex[0] - foot[0]
  const uy = apex[1] - foot[1]
  const uz = apex[2] - foot[2]
  const plan = Math.hypot(ux, uz)
  const len = Math.hypot(plan, uy)
  if (len < 0.2) return
  const psi = Math.atan2(-uz, ux) // +X toward the uphill direction
  const tilt = Math.atan2(uy, plan)
  // The valley line is the plane intersection; the board bears bottom-on-plate
  // at its foot like every rafter (see frameGable), lifted by its plumb half-depth.
  const seat = rd / (2 * Math.cos(tilt))
  emit(
    'valley',
    size,
    [len, rd, t],
    [(foot[0] + apex[0]) / 2, (foot[1] + apex[1]) / 2 + seat, (foot[2] + apex[2]) / 2],
    psi,
    tilt,
    len,
    'lumber',
    `Valley ${size}${
      spec.detail === '400' ? ` — plumb ${Math.round((tilt * 180) / Math.PI)}°, cheek cuts 45°` : ''
    }`,
    undefined,
    spec.detail === '200' ? undefined : onePieceFlag('Valley', len),
  )

  // ---- valley jacks (LOD 400 completion of the 350 valley line) ----
  // The penetrating wing's rafters shorten onto the valley (California-
  // valley practice): at each o.c. station along the wing ridge (the major's
  // Z axis here), a jack runs on the WING's slope from its ridge line down
  // to the valley, with a cheek cut where it lands.
  const [jt, jd] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  const s = Math.sign(foot[0] - apex[0]) // which side of the wing ridge
  const r2 = Math.abs(foot[0] - apex[0]) // wing slope run (along major X)
  const rise2 = apex[1] - foot[1]
  const theta2 = Math.atan2(rise2, r2)
  const jackSeat = jd / (2 * Math.cos(theta2))
  const zSpan = foot[2] - apex[2] // signed: apex → eave foot along major Z
  const cx = apex[0]
  for (let dz = spec.rafterSpacing; Math.abs(dz) < Math.abs(zSpan) - jt; dz += spec.rafterSpacing) {
    const z = apex[2] + Math.sign(zSpan) * dz
    // valley point at this station: linear from apex (run 0) to foot (run r2)
    const frac = Math.abs(dz / zSpan)
    const jackRun = r2 * frac
    if (jackRun < 0.15) continue
    const xv = cx + s * jackRun
    const yv = apex[1] - jackRun * Math.tan(theta2)
    const jackLen = Math.hypot(jackRun, apex[1] - yv)
    emit(
      'jack-rafter',
      spec.rafterSize,
      [jackLen, jd, jt],
      [(cx + xv) / 2, (apex[1] + yv) / 2 + jackSeat, z],
      s === 1 ? Math.PI : 0, // +X (uphill) points toward the wing ridge
      theta2,
      jackLen,
      'lumber',
      `Valley jack ${spec.rafterSize}${spec.detail === '400' ? ' — cheek 45° at the valley' : ''}`,
      undefined,
      slopeRafterFlag(spec, jackRun, jackLen, 'Valley jack'),
    )
  }
}
