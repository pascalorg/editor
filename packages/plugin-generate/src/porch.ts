/**
 * Entrances — PlanCrafters' entrance tool (gen.js `applyPorch` /
 * `addEntrance`, model.js `makeEntrance` / `entranceGeom` /
 * `entranceFlight`), built from Pascal's own nodes. One builder serves the
 * FRONT porch and the REAR entrance:
 *
 *   - the landing: a concrete `slab` stepped `PORCH_FLOOR_DROP` (1½ in) below
 *     the finish floor on a slab house — every slab house gets its concrete
 *     porches, front and rear — or a WOOD DECK (`metadata.floor: 'deck'`,
 *     decking one inch below the threshold so it sheds water) on a raised
 *     house — Bones frames the deck (ledger, joists, beam on posts, pads);
 *   - `column` posts (6x6) at the outer corners, one each side of the flight,
 *     ≤ 8 ft apart, shaped by the style (craftsman tapers them, the stucco
 *     ranch gets 13 in piers); on a deck each runs from grade to the beam;
 *   - `fence` guards (36 in, IRC R312) on a full porch and every deck — and
 *     on any landing more than 30 in above grade, where the code demands
 *     one: balusters at a 4 in-sphere gap, or cable rail for the moderns;
 *   - a `stair` flight down to grade, centred on the door, risers solved the
 *     way PlanCrafters solves them (ceil(rise / 7¾ in) then relaxed while the
 *     riser still passes R311.7.5.1), 11 in treads, ≥ 36 in wide;
 *   - a cover as a `roof-segment` seated on the beam line (`PORCH_COVER_HEIGHT`
 *     — 9 ft — above the finish floor, or the house plate if that is higher):
 *     a gable or hip whose ridge runs square to the
 *     house wall INTO the slope above it (the auto roof's wing convention),
 *     a shed on a ledger where the wall has no slope to die into, a flat
 *     canopy for the modern styles, or none (a bare landing).
 *
 * POLICY (PlanCrafters, verbatim): the entrance centres on the placed door;
 * its width never cantilevers past a house corner (it shrinks to stay
 * centred within the door wall's own span — with a garage the facade is the
 * short wall beside it); 'full' porches span the living + entry bay clamped
 * 10–20 ft, 'entry' porches are 8 ft, the no-porch styles still get a modest
 * covered stoop (4–7 ft, 5 ft deep, two slim posts, flat canopy); at the
 * rear a covered 'patio' is 10 × 7 ft, a plain 'landing' 10 × 6 ft, and a
 * raised-house 'deck' is 12 ft deep and 12–20 ft wide, covered for the
 * porch-loving styles.
 *
 * Coordinates: LEVEL-LOCAL metres, x along the plan, z into the lot (the
 * house front is −z), y up from the level plane. Pure — the caller supplies
 * ids and writes the ops.
 */
import type { NodeOp } from './build'
// Bones by relative path (see plugin-roof/run.ts): the cover's slab is the
// rafter depth plus sheathing Bones frames.
import { porchBeam, porchPostSize, roofShellThickness } from '../../plugin-bones/src/core/shell-sync'
import type { StylePreset } from './styles'

export type Pt = [number, number]

const IN = 0.0254
const FT = 0.3048
const inches = (n: number): number => n * IN

/**
 * A porch floor always steps DOWN out of the house, front or back, and by
 * very little: 1 in to 1½ in max below the interior finish floor (Steve,
 * 2026-09-06 — PlanCrafters' 4 in drop is not how the houses are built).
 * Concrete takes the full 1½ in.
 */
export const PORCH_FLOOR_DROP = inches(1.5)
/** Wood decking rides 1 in below the threshold so water sheds away from the door (PlanCrafters entranceFlight). */
export const DECK_DROP = inches(1)
/** Decking boards (5/4 or 2x) — the deck node's own thickness; Bones hangs the joists under it. */
export const DECKING_THICKNESS = inches(1.5)
/**
 * The porch ceiling — the cover beam over the finish floor: 9 ft (Steve,
 * 2026-09-06: "8'6 ceiling on an 8' house, or maybe 9' … then somewhere the
 * top plate matches"), and never under the house plate — a 9 ft house
 * matches plates, a taller house lifts the porch beam to its own plate
 * (`coverGeometry`). PlanCrafters' entrance.ceilingH was 96.
 */
export const PORCH_COVER_HEIGHT = 9 * FT
/** IRC R312.1.1: a guard where the walking surface is more than 30 in above grade. */
export const GUARD_REQUIRED_ABOVE = inches(30)
export const GUARD_HEIGHT = inches(36)
/** IRC R311.7.5.1 / R311.7.5.2 / R311.7.1. */
export const MAX_RISER = inches(7.75)
export const TREAD_RUN = inches(11)
export const MIN_STAIR_WIDTH = inches(36)
/** Posts at both ends and no more than 8 ft apart (PlanCrafters framing.js porchWall). */
export const MAX_POST_SPACING = 8 * FT
/** Porch roof pitch never steeper than 6:12 — a porch reads low-slung. */
export const MAX_PORCH_PITCH = 6
/** A shed porch roof against the house never steeper than 4:12. */
export const MAX_SHED_PORCH_PITCH = 4
/** A gable / hip cover's ridge runs at least this far INTO the house slope past the wall (3 ft). */
export const PIERCE_MIN = 0.9
/** A shed cover's ledger sits at least this far under the house plate. */
export const LEDGER_CLEAR = inches(2)
/** The lowest cover beam over the porch floor (headroom). */
export const MIN_COVER_HEIGHT = 7 * FT
/** The flattest shed cover before it becomes a flat canopy. */
export const MIN_SHED_PITCH = 1
/** The stucco ranch's entry piers (PlanCrafters "grand stucco entrance"): 13 in square. */
export const STUCCO_PIER = inches(13)
/**
 * The cover's bearing band the shell shows (Steve, 2026-09-06: "none of the
 * generated porches show the beam, the post should go to the below of the
 * beam"): PlanCrafters' 6x8 beam (7¼ in) under its single 2x plate (1½ in),
 * 5½ in wide — the roof segment's wall band on a gable / hip / flat cover,
 * a beam slab along the low eave of a shed on a ledger. The posts stop
 * under it; Bones frames the girder, plate and posts to the same lines.
 */
const BEAM = porchBeam()
export const PORCH_BEAM_D = BEAM.depth
export const PORCH_BEAM_W = BEAM.width
export const PORCH_BAND = BEAM.band

export type PorchPolicy = 'full' | 'entry' | 'none' | 'patio' | 'landing' | 'deck'
export type PorchRoofForm = 'gable' | 'hip' | 'shed' | 'flat' | 'none'
export type PorchLanding = 'concrete' | 'wood'
export type RailStyle = 'baluster' | 'cable'
/**
 * How the cover meets the house. `valley`: the door wall carries a slope
 * above it (an eave or a hip end), so a gable / hip ridge runs square to
 * the wall INTO that slope and the box reaches in by its run — the auto
 * roof's wing convention, framed as a valley. `ledger`: the wall is a gable
 * end, a rake, a shed's high wall or under a flat roof — there is no slope
 * to die into, so the cover stops at the wall face on a ledger (a shed for
 * the pitched styles), PlanCrafters' "no die-in" case.
 */
export type PorchAttach = 'valley' | 'ledger'

export interface PorchInput {
  policy: PorchPolicy
  style: StylePreset
  levelId: string
  /** The door's wall, level-local metres, centreline. */
  wall: { start: Pt; end: Pt; thickness: number }
  /** Distance from `wall.start` to the door's centre, metres. */
  doorAt: number
  doorWidth: number
  /** Unit normal pointing OUT of the house across the wall. */
  outward: Pt
  /** Living + entry room widths along the front (the 'full' bay), or the rear room's width, metres. */
  bayWidth: number
  /** Finish floor: the house floor's walking surface, level-local y. */
  floorElevation: number
  /** Grade at the foot of the steps, level-local y (negative when the building stands above the site). */
  gradeY: number
  /** Grade under any plan point, level-local y — a deck's posts run down to it. Default: `gradeY` everywhere. */
  gradeAt?: (x: number, z: number) => number
  /**
   * The site carries a terrain field. The viewer lifts a ground-hosted
   * node (`supportSlabId: 'ground'`) by the sculpted ground under it, so on
   * a terrain site a post or flight to grade is authored at y = 0 and the
   * ground puts it down; on a flat site the ground lift is 0 and the node
   * carries its grade itself. Default false.
   */
  terrain?: boolean
  /** Eave overhang for the cover, metres along the slope. */
  overhang: number
  /** The door wall's roof role from the auto roof (`metadata.roof.role`); absent = stop at the wall. */
  wallRole?: string
  /**
   * The house's top plate, level-local y (the auto roof's origin). With
   * `housePitch` the cover is sized against the house roof: a gable / hip
   * cover pitched up and carried in until its ridge pierces the slope a
   * full PIERCE_MIN inside the wall (Bones lays the valley sleepers on the
   * plate then), a shed cover's ledger kept under the house eave.
   */
  housePlateY?: number
  /** The house roof's pitch in twelfths (with `housePlateY`). */
  housePitch?: number
  /** Concrete (slab house) or a wood deck (raised house). Default concrete. */
  landing?: PorchLanding
  /** Front porch or rear entrance — names and the summary. Default front. */
  entrance?: 'front' | 'rear'
}

export interface PorchIds {
  slab: string
  roof: string
  segment: string
  /** The cover's beam slab (a shed on a ledger) and its ceiling. */
  beam: string
  ceiling: string
  stair: string
  stairSegment: string
  column: () => string
  fence: () => string
}

export interface PorchSummary {
  entrance: 'front' | 'rear'
  policy: PorchPolicy
  landing: PorchLanding
  widthFt: number
  depthFt: number
  roof: PorchRoofForm
  /** The cover's pitch in twelfths (0 for a canopy) and its beam height over the floor, inches. */
  roofPitch: number
  coverHeightIn: number
  /** A gable / hip cover's ridge pierce point inside the wall, metres (0 without house data). */
  roofPierceM: number
  attach: PorchAttach
  posts: number
  rails: number
  railStyle: RailStyle | null
  risers: number
  riserIn: number
  guard: boolean
}

export interface PorchResult {
  ops: NodeOp[]
  summary: PorchSummary | null
  warnings: string[]
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const round = (v: number): number => Math.round(v * 1e6) / 1e6
/** Snap to the 6 in plan grid (PlanCrafters `snap`). */
const snap6 = (m: number): number => Math.round(m / inches(6)) * inches(6)

/** Riser count the way PlanCrafters solves it: the code minimum, relaxed while the riser still passes 7¾ in. */
export function riserCount(rise: number): number {
  if (rise <= inches(0.5)) return 0
  let n = Math.max(1, Math.ceil(rise / MAX_RISER))
  while (n > 1 && rise / (n - 1) <= MAX_RISER) n--
  return n
}

/** How the cover meets the house, from the door wall's roof role. */
export function porchAttach(wallRole: string | undefined): PorchAttach {
  return wallRole === 'eave' || wallRole === 'hip-end' ? 'valley' : 'ledger'
}

/**
 * The cover form: gable styles gable and hip styles hip when the wall
 * carries a slope to die into; a shed on a ledger when it does not; a flat
 * canopy for the shed / no-porch styles; none for a bare landing or a deck
 * behind a no-porch style (PlanCrafters: the rear cover is for the
 * porch-loving styles).
 */
export function porchRoofForm(
  style: StylePreset,
  policy: PorchPolicy,
  attach: PorchAttach = 'valley',
): PorchRoofForm {
  if (policy === 'landing') return 'none'
  if (policy === 'deck' && style.porch === 'none') return 'none'
  if (policy === 'none') return 'flat'
  if (style.roofForm === 'shed' || style.roofForm === 'flat') return 'flat'
  if (attach === 'ledger') return 'shed'
  return style.roofForm === 'hip' ? 'hip' : 'gable'
}

/** Guard infill by style: cable rail for the moderns, balusters for the rest (PlanCrafters railInfill). */
export function railStyleFor(style: StylePreset): RailStyle {
  return style.key.startsWith('modern') ? 'cable' : 'baluster'
}

/** The entrance post: a 6x6 (Steve, 2026-09-06: "nice 6x6 posts typically on these entrances, not 4x4"). */
export const ENTRANCE_POST = porchPostSize()

/**
 * The posts: a 6x6 everywhere (craftsman's tapered), the stucco ranch's
 * 13 in piers (PlanCrafters pillarStyle). The size is the user's to change
 * on the porch afterwards (G15).
 */
export function pillarFor(
  style: StylePreset,
  policy: PorchPolicy,
): { size: number; stucco: boolean } {
  if (policy === 'none') return { size: ENTRANCE_POST, stucco: false }
  // every stucco house takes the built-up pier (Steve: "way more stucco
  // options like stucco pillars"); Bones frames it as a 2x4 box on a 4x4
  const stucco = style.exteriorAssembly === 'exterior-2x6-stucco'
  if (stucco) return { size: STUCCO_PIER, stucco: true }
  // the craftsman's tapered box column is a wrap around the same 6x6 —
  // not drawn: the post the shell shows IS the post Bones frames
  return { size: ENTRANCE_POST, stucco: false }
}

/** What the cover becomes once it is sized against the house roof. */
export interface CoverGeometry {
  form: PorchRoofForm
  /** The cover's beam / plate line, level-local y. */
  coverY: number
  /** Twelfths. */
  pitch: number
  /** How far a gable / hip box runs INTO the house past the wall face (0 for a shed / canopy). */
  into: number
  /** The ridge's pierce point inside the wall, metres (gable / hip with house data). */
  pierce: number
}

/**
 * Size the cover against the house roof (PlanCrafters sizes the porch by
 * style alone; Bones frames the join, so the join must be a real one).
 * A gable / hip cover rides over the house slope: its beam at the porch
 * ceiling height or the house plate, whichever is higher (a porch plate
 * never sits under the house plate); the style pitch (capped at
 * MAX_PORCH_PITCH), steepened if the ridge would pierce the house slope
 * less than PIERCE_MIN inside the wall (a beam level with the plate under
 * a steep main roof); the box runs in to the pierce point, a hip one run
 * further so its near hip end buries itself under the house roof. A shed
 * cover hangs on a ledger, so it is the one cover that must stay UNDER the
 * plate: the ledger held LEDGER_CLEAR below it, the pitch flattened toward
 * 1:12, then the beam lowered to the headroom floor, then a flat canopy.
 * Without house data the legacy sizes hold (one run in, the style pitch).
 */
export function coverGeometry(
  input: Pick<PorchInput, 'floorElevation' | 'housePlateY' | 'housePitch'>,
  style: Pick<StylePreset, 'pitch'>,
  form: PorchRoofForm,
  run: number,
  shedDepth: number,
  /** Half the door wall: the box starts at the wall FACE, the house roof's plate line is the wall centreline. */
  wallHalf = 0,
): CoverGeometry {
  const floorCover = input.floorElevation + PORCH_COVER_HEIGHT
  if (form === 'flat' || form === 'none')
    return { form, coverY: floorCover, pitch: 0, into: 0, pierce: 0 }
  const houseY = input.housePlateY
  if (form === 'shed') {
    const stylePitch = Math.min(style.pitch, MAX_SHED_PORCH_PITCH)
    if (houseY === undefined)
      return { form, coverY: floorCover, pitch: stylePitch, into: 0, pierce: 0 }
    const ledgerY = houseY - LEDGER_CLEAR
    const fit = (cy: number) =>
      Math.min(stylePitch, ((ledgerY - cy) / Math.max(shedDepth, 0.1)) * 12)
    let coverY = floorCover
    let pitch = fit(coverY)
    if (pitch < MIN_SHED_PITCH - 1e-9) {
      coverY = Math.max(
        input.floorElevation + MIN_COVER_HEIGHT,
        ledgerY - (shedDepth * MIN_SHED_PITCH) / 12,
      )
      pitch = fit(coverY)
    }
    if (pitch < MIN_SHED_PITCH - 1e-9)
      return { form: 'flat', coverY: floorCover, pitch: 0, into: 0, pierce: 0 }
    return { form, coverY, pitch, into: 0, pierce: 0 }
  }
  const stylePitch = Math.min(style.pitch, MAX_PORCH_PITCH)
  const houseTan = input.housePitch !== undefined ? input.housePitch / 12 : 0
  if (houseY === undefined || houseTan <= 0) {
    return { form, coverY: floorCover, pitch: stylePitch, into: run, pierce: 0 }
  }
  const pierceAt = (cy: number, p: number) => ((run * p) / 12 - (houseY - cy)) / houseTan
  // the beam never under the house plate: a 9 ft house matches plates, a
  // taller one lifts the porch ceiling to its own plate
  const coverY = Math.max(floorCover, houseY)
  let pitch = stylePitch
  if (pierceAt(coverY, pitch) < PIERCE_MIN) {
    pitch = Math.min(MAX_PORCH_PITCH, ((houseY - coverY + PIERCE_MIN * houseTan) / run) * 12)
  }
  const pierce = Math.max(0, pierceAt(coverY, pitch))
  return {
    form,
    coverY,
    pitch,
    into: wallHalf + pierce + 0.05 + (form === 'hip' ? run : 0),
    pierce,
  }
}

/**
 * The joist / rim band a deck's edge shows under its decking: the joist
 * depth its span wants (the deck joist table's 2x8 / 2x10 / 2x12 ladder,
 * by depth) — Bones sizes the joists themselves.
 */
export function deckRimDepth(depth: number): number {
  if (depth <= 8 * FT) return inches(7.25)
  if (depth <= 12 * FT) return inches(9.25)
  return inches(11.25)
}

export function porchFor(input: PorchInput, ids: PorchIds): PorchResult {
  const warnings: string[] = []
  const { style, policy, wall, outward } = input
  const entrance = input.entrance ?? 'front'
  const landing = input.landing ?? 'concrete'
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLen = Math.hypot(dx, dz)
  if (wallLen < 1e-6) {
    return {
      ops: [],
      summary: null,
      warnings: [`the ${entrance} door wall has no length — no entrance.`],
    }
  }
  const ax = dx / wallLen
  const az = dz / wallLen
  // door centre on the wall centreline, then out to the exterior face
  const cx = wall.start[0] + ax * input.doorAt
  const cz = wall.start[1] + az * input.doorAt
  const faceX = cx + outward[0] * (wall.thickness / 2)
  const faceZ = cz + outward[1] * (wall.thickness / 2)

  // ── width and depth (PlanCrafters applyPorch / addEntrance) ──────────
  // The entrance may never cantilever past a house corner: centred on the
  // door, it shrinks to fit the door wall's own span with 6 in to spare.
  const maxCentered = 2 * Math.min(input.doorAt - inches(6), wallLen - input.doorAt - inches(6))
  let width: number
  let depth: number
  if (policy === 'full') {
    const bay = snap6(clamp(input.bayWidth - inches(24), 10 * FT, 20 * FT))
    width = snap6(clamp(Math.min(bay, maxCentered), 5 * FT, 20 * FT))
    depth = 7 * FT
  } else if (policy === 'entry') {
    width = snap6(clamp(Math.min(8 * FT, maxCentered), 5 * FT, 20 * FT))
    depth = 6 * FT
  } else if (policy === 'patio') {
    width = snap6(clamp(Math.min(10 * FT, maxCentered), 5 * FT, 20 * FT))
    depth = 7 * FT
  } else if (policy === 'landing') {
    width = snap6(clamp(Math.min(10 * FT, maxCentered), 4 * FT, 20 * FT))
    depth = 6 * FT
  } else if (policy === 'deck') {
    // ≥ 16 ft wide when the room allows, never past 20, never past the corners
    const want = Math.max(16 * FT, Math.min(input.bayWidth, 20 * FT))
    width = snap6(clamp(Math.min(want, maxCentered), 12 * FT, 20 * FT))
    depth = 12 * FT
  } else {
    width = snap6(clamp(Math.min(maxCentered, 6 * FT), 4 * FT, 7 * FT))
    depth = 5 * FT
  }
  if (maxCentered < width - 1e-6) {
    warnings.push(
      `the ${entrance} ${policy === 'deck' ? 'deck' : 'porch'} is ${(width / FT).toFixed(0)}' wide but its door sits ${(maxCentered / 2 / FT).toFixed(1)}' from a corner — it will pass the corner.`,
    )
  }
  const hw = width / 2

  // Corners: inner-left, inner-right, outer-right, outer-left (PlanCrafters entranceGeom).
  const P = (a: number, o: number): Pt => [
    round(faceX + ax * a + outward[0] * o),
    round(faceZ + az * a + outward[1] * o),
  ]
  const corners: Pt[] = [P(-hw, 0), P(hw, 0), P(hw, depth), P(-hw, depth)]

  const ops: NodeOp[] = []
  const wood = landing === 'wood'
  const landingTop = input.floorElevation - (wood ? DECK_DROP : PORCH_FLOOR_DROP)
  const rise = landingTop - input.gradeY
  const guard = policy === 'full' || policy === 'deck' || wood || rise > GUARD_REQUIRED_ABOVE
  const railStyle = guard ? railStyleFor(style) : null
  // The flight (built below): its width sets the guard opening and the
  // posts that flank it.
  const risers = riserCount(rise)
  const stairWidth = Math.max(MIN_STAIR_WIDTH, Math.min(inches(60), width - inches(4)))
  // The front is a porch whatever its floor; the rear is named by what it is.
  const name =
    entrance === 'front'
      ? 'Porch'
      : wood
        ? 'Rear deck'
        : policy === 'patio'
          ? 'Rear patio'
          : policy === 'landing'
            ? 'Rear landing'
            : 'Rear porch'
  const meta = {
    generatedBy: 'pascal:generate',
    porch: { entrance, policy, landing, width: round(width), depth: round(depth) },
  }

  // ── landing ───────────────────────────────────────────────────────────
  ops.push({
    node: {
      id: ids.slab,
      type: 'slab',
      name,
      parentId: input.levelId,
      polygon: corners,
      holes: [],
      elevation: round(landingTop),
      // A deck's slab is the decking AND the joist / rim band under it, so
      // its edge reads as the fascia board it is; Bones frames the joists
      // under the decking thickness it is told (`metadata.decking`).
      thickness: wood ? DECKING_THICKNESS + deckRimDepth(depth) : inches(4),
      materialPreset: wood ? 'library:wood-floorplank1' : 'library:concrete-raw',
      // Bones: a 'deck' is framed (ledger, joists, beam on posts to grade); a
      // 'porch-slab' is poured at its elevation.
      metadata: {
        ...meta,
        floor: wood ? 'deck' : 'porch-slab',
        ...(wood ? { decking: DECKING_THICKNESS } : {}),
      },
    },
    parentId: input.levelId,
  })

  // ── posts (for a cover) ───────────────────────────────────────────────
  const attach = porchAttach(input.wallRole)
  const pillar = pillarFor(style, policy)
  const inset = Math.min(inches(6), hw / 3, depth / 3)
  // The cover bears on the beam over the posts (one inset in from the
  // landing's outer edge); its eave overhangs the landing from there.
  const beamLine = depth - inset
  // The beam band is centred on the post lines the way Bones' girder is —
  // its outer faces flush with the posts' outer faces (Steve: "the posts
  // still don't go to the end of the beam"): the cover's box runs out to
  // the front posts' outer face and across to the corner posts' outer
  // faces; the house side is unchanged. The eave overhangs from there.
  const postHalf = pillar.size / 2
  const beamOut = beamLine + postHalf
  const across = 2 * (hw - inset) + pillar.size
  const cover = coverGeometry(
    input,
    style,
    porchRoofForm(style, policy, attach),
    across / 2,
    beamOut,
    wall.thickness / 2,
  )
  const form = cover.form
  if (form === 'flat' && porchRoofForm(style, policy, attach) === 'shed') {
    warnings.push(
      `${name}: a shed cover would not fit under the house eave even at 1:12 with the beam at 7 ft — a flat canopy instead.`,
    )
  }
  if (
    (form === 'gable' || form === 'hip') &&
    input.housePlateY !== undefined &&
    cover.pierce < PIERCE_MIN - 1e-6
  ) {
    warnings.push(
      `${name}: the ${form} cover's ridge pierces the house slope only ${cover.pierce.toFixed(2)} m inside the wall (${PIERCE_MIN} m wanted) — the valley lands near the eave; verify the join.`,
    )
  }
  // the posts stop under the beam band; the band's top is the bearing line
  const beamBottom = cover.coverY - PORCH_BAND
  const postHeight = beamBottom - landingTop
  // Posts: one at each outer corner, one each side of the stair opening
  // (the flight is centred on the door, a = 0), and the bays between them
  // never over 8 ft. A stair so wide that its flanking posts would crowd
  // the corners lets the corner posts flank it.
  const along: number[] = []
  /** Where the flight's flanking pair stands, either side of a = 0 (null: no flight). */
  let flankAt: number | null = null
  if (form !== 'none') {
    const edge = hw - inset
    const flank = risers > 0 ? stairWidth / 2 + pillar.size / 2 + inches(1) : null
    flankAt = flank
    const anchors =
      flank !== null && flank < edge - 2 * pillar.size
        ? [-edge, -flank, flank, edge]
        : [-edge, edge]
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a0 = anchors[i] as number
      const a1 = anchors[i + 1] as number
      along.push(a0)
      const bays = Math.max(1, Math.ceil((a1 - a0) / MAX_POST_SPACING))
      for (let b = 1; b < bays; b++) along.push(a0 + ((a1 - a0) * b) / bays)
    }
    along.push(anchors[anchors.length - 1] as number)
  }
  for (const a of along) {
    const [px, pz] = P(a, depth - inset)
    // A deck's post is one 6x6 from its footing to the beam, through the
    // deck's edge (Steve: "the posts should go down to the grade wherever
    // that might be"); a concrete porch's stands on the slab, which is on
    // grade itself.
    const footY = wood ? round(input.gradeAt?.(px, pz) ?? input.gradeY) : null
    ops.push({
      node: {
        id: ids.column(),
        type: 'column',
        name: pillar.stucco ? 'Porch pier' : 'Porch post',
        parentId: input.levelId,
        // A deck's post is hosted on the GROUND, never elected onto the deck
        // it passes through (the viewer's floor stacking would lift it onto
        // the decking); on a terrain site the ground lift puts it down.
        position: [px, footY === null || input.terrain ? 0 : footY, pz],
        rotation: round(Math.atan2(-az, ax)),
        supportSlabId: footY === null ? ids.slab : 'ground',
        height: round(footY === null ? postHeight : beamBottom - footY),
        style: 'plain',
        crossSection: 'square',
        width: round(pillar.size),
        depth: round(pillar.size),
        // one sawn post: square, sharp-cornered, no rings — the column
        // renderer's rounded corners and segment seams read as a tube
        shaftProfile: 'straight',
        shaftTaper: 0,
        shaftSegmentCount: 1,
        shaftCornerRadius: 0,
        // the shaft IS the post's full section (the column renderer's default
        // shaft is 72 % of the width — a 6x6 read as a 4x4 beside Bones' 6x6)
        shaftStartScale: 1,
        shaftEndScale: 1,
        baseStyle: 'none',
        capitalStyle: 'none',
        edgeSoftness: 0,
        ...(pillar.stucco ? { materialPreset: 'library:concrete-stucco' } : {}),
        // the pair each side of the flight: the posts that follow a moved
        // stair (porch-follow.ts)
        metadata: {
          ...meta,
          post: {
            flank: flankAt !== null && Math.abs(Math.abs(a) - flankAt) < 1e-6,
            // a built-up pier: Bones frames the 2x4 box around its 4x4
            ...(pillar.stucco ? { pier: true } : {}),
          },
        },
      },
      parentId: input.levelId,
    })
  }

  // The guard's line: the POST line (6 in inside the landing edge, where
  // the 6x6s stand) when there is a cover, the deck edge when there is
  // none — the flight's guard reaches the same line.
  const guardInset = along.length > 0 ? inset : Math.max(pillar.size, inches(3.5)) / 2
  const guardLine = depth - guardInset
  const guardEdge = hw - guardInset
  const cable = railStyle === 'cable'

  // ── steps to grade ────────────────────────────────────────────────────
  let run = 0
  if (risers > 0) {
    run = risers * TREAD_RUN
    // The stair node's run ascends along its OWN local +Z (the low end is
    // its −Z side — see the stair definition's facing indicator), and its
    // yaw maps local +Z onto (sin θ, cos θ). Turning +Z onto the inward
    // direction (−outward) puts the bottom of the flight `run` beyond the
    // landing edge and the top tread at the landing.
    const [bx, bz] = P(0, depth + run)
    const inward: Pt = [-outward[0], -outward[1]]
    ops.push({
      node: {
        id: ids.stair,
        type: 'stair',
        name: `${name} steps`,
        parentId: input.levelId,
        // the flight rests on the ground: on a terrain site the viewer's
        // ground lift is its grade, on a flat site it carries the grade itself
        position: [bx, input.terrain ? 0 : round(input.gradeY), bz],
        rotation: round(Math.atan2(inward[0], inward[1])),
        stairType: 'straight',
        fromLevelId: null,
        toLevelId: null,
        deckSlabId: ids.slab,
        slabOpeningMode: 'none',
        width: round(stairWidth),
        totalRise: round(rise),
        stepCount: risers,
        thickness: inches(4),
        fillToFloor: !wood,
        materialPreset: wood ? 'library:wood-floorplank1' : 'library:concrete-raw',
        // handrails down the flight: PlanCrafters gives a flight of three or
        // more risers its rails (IRC R311.7.8 asks at four); a guarded
        // landing's flight always has them
        railingMode: risers >= 3 || rise > GUARD_REQUIRED_ABOVE ? 'both' : 'none',
        railingHeight: inches(34),
        // a deck stair's guard: 4x4 posts ≤ 4 ft apart, top and bottom rails,
        // pickets — and no top post where the porch's flanking 6x6 already
        // stands, so the rail dies into it (Steve, 2026-09-06)
        // the flight's guard is the landing's guard carried down the flight
        // (Steve: "carry the guardrail style to the stair too"): cable on the
        // moderns, balusters elsewhere; with a guard on the landing its top
        // rails run past the landing edge along the slope into the post the
        // guard already stands there (the flanking 6x6 on the post line, or
        // the guard's own 4x4 at the flight's edge) — no post of its own
        railingStyle: railStyleFor(style) === 'cable' ? 'cable' : 'post-and-rail',
        railingTopPost: !(guard && railStyle),
        railingTopReach: guard && railStyle ? round(guardInset) : 0,
        children: [ids.stairSegment],
        metadata: meta,
      },
      parentId: input.levelId,
    })
    ops.push({
      node: {
        id: ids.stairSegment,
        type: 'stair-segment',
        name: 'Flight',
        parentId: ids.stair,
        segmentType: 'stair',
        width: round(stairWidth),
        length: round(run),
        height: round(rise),
        stepCount: risers,
        fillToFloor: !wood,
        thickness: inches(4),
        metadata: meta,
      },
      parentId: ids.stair,
    })
  }

  // ── guards ────────────────────────────────────────────────────────────
  let rails = 0
  // The guard runs on the POST line (Steve: "the rail would go into the
  // bigger posts … never a 4x4 post by it"): along the 6x6s' line one
  // section per bay, each dying into the 6x6 at its ends, and down the
  // sides from a 4x4 at the house wall into the corner 6x6. A landing
  // without a cover has no 6x6s: its guard runs at the deck edge on its
  // own 4x4s. Every section is the DCA 6 deck guard (fence style 'guard'),
  // its infill the style's — balusters or cable.
  if (guard && railStyle) {
    const station = (a: number) => along.some((s) => Math.abs(s - a) < 1e-6)
    const rail = (
      a0: number,
      o0: number,
      a1: number,
      o1: number,
      startPost: boolean,
      endPost: boolean,
    ) => {
      const s = P(a0, o0)
      const e = P(a1, o1)
      if (Math.hypot(e[0] - s[0], e[1] - s[1]) < inches(12)) return
      rails++
      ops.push({
        node: {
          id: ids.fence(),
          type: 'fence',
          name: cable ? `${name} cable rail` : `${name} rail`,
          parentId: input.levelId,
          start: s,
          end: e,
          // AWC DCA 6: 4x4 posts ≤ 6 ft apart, a 2x6 cap flat over a 2x4
          // top rail; balusters 2x2 on a 2x4 bottom rail 3½ in over the
          // decking at a 3½ in clear gap (R312.1.3's 4 in sphere); cable
          // ½ in runs 3 in apart from 3 in over the decking
          style: 'guard',
          guardInfill: cable ? 'cable' : 'balusters',
          height: round(GUARD_HEIGHT),
          thickness: inches(0.75),
          slatGap: inches(cable ? 3 : 3.5),
          postSpacing: 6 * FT,
          postSize: inches(3.5),
          groundClearance: inches(cable ? 3 : 3.5),
          // false: the rails die into the post already standing there
          startPost,
          endPost,
          postCap: 'flat',
          supportSlabId: ids.slab,
          metadata: meta,
        },
        parentId: input.levelId,
      })
    }
    // sides: a 4x4 at the wall, the rails into the corner post
    rail(-guardEdge, 0, -guardEdge, guardLine, true, !station(-guardEdge))
    rail(guardEdge, 0, guardEdge, guardLine, true, !station(guardEdge))
    // the outer edge, either side of the stair opening, one section per
    // bay between the 6x6s; a bay end that is no 6x6 (the flight's edge
    // when the corner posts flank it, an uncovered landing) gets a 4x4
    const outer = (a0: number, a1: number) => {
      const stops = [a0, ...along.filter((a) => a > a0 + 1e-6 && a < a1 - 1e-6), a1]
      for (let i = 0; i + 1 < stops.length; i++) {
        const s0 = stops[i] as number
        const s1 = stops[i + 1] as number
        rail(s0, guardLine, s1, guardLine, !station(s0), !station(s1))
      }
    }
    if (risers > 0) {
      const stop = flankAt ?? stairWidth / 2
      outer(-guardEdge, -stop)
      outer(stop, guardEdge)
    } else {
      outer(-guardEdge, guardEdge)
    }
  }

  // ── cover ─────────────────────────────────────────────────────────────
  if (form !== 'none') {
    const plateY = cover.coverY
    const pitch = cover.pitch
    const pitchDeg = Math.atan(pitch / 12) * (180 / Math.PI)
    let segWidth: number
    let segDepth: number
    let centre: Pt
    let yaw: number
    let roofMeta: Record<string, unknown>
    if (form === 'gable' || form === 'hip') {
      // Ridge square to the wall (segment x along `outward`); the box spans
      // the width across and reaches INTO the house to the ridge's pierce
      // point (a hip one run further, burying its near hip end) so its
      // planes meet the main roof at a valley — the auto roof's wing
      // convention. Rotation turns segment +x onto −outward (into the house).
      segWidth = beamOut + cover.into
      segDepth = across
      centre = P(0, (beamOut - cover.into) / 2)
      yaw = Math.atan2(outward[1], -outward[0])
      roofMeta = { role: 'porch', open: true }
    } else if (form === 'shed') {
      // Shed on a ledger: the plane rises from the low eave at the beam
      // (segment +z, pointing outward) to the high edge at the wall face
      // (segment −z); Bones frames the high edge as a ledger with hangers
      // and no pediment, the sides open (no rake studs).
      segWidth = width
      segDepth = beamOut
      centre = P(0, beamOut / 2)
      yaw = Math.atan2(outward[0], outward[1])
      roofMeta = { role: 'porch', attach: 'high', open: true }
    } else {
      // Flat canopy: the box stops one overhang short of the wall so its
      // back overhang meets the wall face.
      segWidth = beamOut - input.overhang
      segDepth = across
      centre = P(0, (beamOut + input.overhang) / 2)
      yaw = Math.atan2(outward[1], -outward[0])
      roofMeta = { role: 'porch', open: true }
    }
    ops.push({
      node: {
        id: ids.roof,
        type: 'roof',
        name: `${name} roof`,
        parentId: input.levelId,
        position: [0, 0, 0],
        rotation: 0,
        metadata: { ...meta, autoRoof: { porch: true } },
        children: [ids.segment],
      },
      parentId: input.levelId,
    })
    // A gable / hip / flat cover carries its beam as the segment's wall
    // band: the band's top is the bearing line, its bottom the posts' top.
    // A shed on a ledger keeps no band (its raked sides would close the
    // porch) — its beam is a slab along the low eave, post to post.
    const banded = roofMeta.attach !== 'high'
    ops.push({
      node: {
        id: ids.segment,
        type: 'roof-segment',
        name: form === 'flat' ? `${name} canopy` : `${name} ${form}`,
        parentId: ids.roof,
        position: [centre[0], round(banded ? plateY - PORCH_BAND : plateY), centre[1]],
        rotation: round(yaw),
        roofType: form,
        width: round(segWidth),
        depth: round(segDepth),
        wallHeight: banded ? round(PORCH_BAND) : 0,
        wallThickness: banded ? round(PORCH_BEAM_W) : 0,
        pitch: round(pitchDeg),
        overhang: round(input.overhang),
        // the slab is the rafter and its sheathing — what Bones frames
        deckThickness: round(roofShellThickness()),
        metadata: { ...meta, roof: roofMeta },
      },
      parentId: ids.roof,
    })
    if (!banded && along.length >= 2) {
      const a0 = Math.min(...along) - pillar.size / 2
      const a1 = Math.max(...along) + pillar.size / 2
      const o = depth - inset
      ops.push({
        node: {
          id: ids.beam,
          type: 'slab',
          name: `${name} beam`,
          parentId: input.levelId,
          polygon: [
            P(a0, o - PORCH_BEAM_W / 2),
            P(a1, o - PORCH_BEAM_W / 2),
            P(a1, o + PORCH_BEAM_W / 2),
            P(a0, o + PORCH_BEAM_W / 2),
          ],
          holes: [],
          elevation: round(plateY),
          thickness: round(PORCH_BAND),
          metadata: { ...meta, floor: 'porch-beam' },
        },
        parentId: input.levelId,
      })
    }
    // the porch ceiling — a flat ceiling under the cover at the beam's underside
    ops.push({
      node: {
        id: ids.ceiling,
        type: 'ceiling',
        name: `${name} ceiling`,
        parentId: input.levelId,
        polygon: corners,
        holes: [],
        height: round(plateY - PORCH_BAND),
        metadata: meta,
      },
      parentId: input.levelId,
    })
  }

  return {
    ops,
    warnings,
    summary: {
      entrance,
      policy,
      landing,
      widthFt: round(width / FT),
      depthFt: round(depth / FT),
      roof: form,
      roofPitch: round(cover.pitch),
      coverHeightIn: Math.round(((cover.coverY - input.floorElevation) / IN) * 10) / 10,
      roofPierceM: round(cover.pierce),
      attach,
      posts: along.length,
      rails,
      railStyle,
      risers,
      riserIn: risers > 0 ? round(rise / risers / IN) : 0,
      guard,
    },
  }
}
