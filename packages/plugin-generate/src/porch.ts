/**
 * Entrances — PlanCrafters' entrance tool (gen.js `applyPorch` /
 * `addEntrance`, model.js `makeEntrance` / `entranceGeom` /
 * `entranceFlight`), built from Pascal's own nodes. One builder serves the
 * FRONT porch and the REAR entrance:
 *
 *   - the landing: a concrete `slab` stepped `PORCH_FLOOR_DROP` below the
 *     finish floor on a slab house, or a WOOD DECK (`metadata.floor: 'deck'`,
 *     decking one inch below the threshold so it sheds water) on a raised
 *     house — Bones frames the deck (ledger, joists, beam on posts, pads);
 *   - `column` posts at the outer corners, ≤ 8 ft apart, sized and shaped by
 *     the style (craftsman tapers them, the stucco ranch gets 13 in piers);
 *   - `fence` guards (36 in, IRC R312) on a full porch and every deck — and
 *     on any landing more than 30 in above grade, where the code demands
 *     one: balusters at a 4 in-sphere gap, or cable rail for the moderns;
 *   - a `stair` flight down to grade, centred on the door, risers solved the
 *     way PlanCrafters solves them (ceil(rise / 7¾ in) then relaxed while the
 *     riser still passes R311.7.5.1), 11 in treads, ≥ 36 in wide;
 *   - a cover as a `roof-segment` seated on the beam line (`PORCH_COVER_HEIGHT`
 *     above the finish floor): a gable or hip whose ridge runs square to the
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
import type { StylePreset } from './styles'

export type Pt = [number, number]

const IN = 0.0254
const FT = 0.3048
const inches = (n: number): number => n * IN

/** A concrete landing steps 4 in below the interior finish floor (PlanCrafters PORCH_FLOOR_DROP). */
export const PORCH_FLOOR_DROP = inches(4)
/** Wood decking rides 1 in below the threshold so water sheds away from the door (PlanCrafters entranceFlight). */
export const DECK_DROP = inches(1)
/** Decking boards (5/4 or 2x) — the deck node's own thickness; Bones hangs the joists under it. */
export const DECKING_THICKNESS = inches(1.5)
/** Post / cover height above the finish floor (PlanCrafters entrance.ceilingH = 96). */
export const PORCH_COVER_HEIGHT = inches(96)
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
  /** Grade, level-local y (negative when the building stands above the site). */
  gradeY: number
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

/** The posts: craftsman tapered, the stucco ranch's 13 in piers, else square (PlanCrafters pillarStyle). */
export function pillarFor(
  style: StylePreset,
  policy: PorchPolicy,
): { size: number; tapered: boolean; stucco: boolean } {
  if (policy === 'none') return { size: inches(6), tapered: false, stucco: false }
  const stucco = style.exteriorAssembly === 'exterior-2x6-stucco' && style.roofForm === 'hip'
  if (stucco) return { size: STUCCO_PIER, tapered: false, stucco: true }
  return {
    size: policy === 'full' || policy === 'deck' ? inches(7) : inches(5.5),
    tapered: style.key === 'craftsman',
    stucco: false,
  }
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
 * A gable / hip cover dying into the slope: the style pitch (capped at
 * MAX_PORCH_PITCH), steepened until the ridge pierces the house slope
 * PIERCE_MIN inside the wall, then — if the cap still leaves it short —
 * the beam raised toward the plate; the box runs in to the pierce point,
 * a hip one run further so its near hip end buries itself under the
 * house roof. A shed cover: the ledger held LEDGER_CLEAR under the plate,
 * the pitch flattened toward 1:12, then the beam lowered to the headroom
 * floor, then a flat canopy. Without house data the legacy sizes hold
 * (one run in, the style pitch).
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
  let coverY = floorCover
  let pitch = stylePitch
  if (pierceAt(coverY, pitch) < PIERCE_MIN) {
    pitch = Math.min(MAX_PORCH_PITCH, ((houseY - coverY + PIERCE_MIN * houseTan) / run) * 12)
  }
  if (pierceAt(coverY, pitch) < PIERCE_MIN) {
    coverY = Math.min(houseY - LEDGER_CLEAR, houseY - ((run * pitch) / 12 - PIERCE_MIN * houseTan))
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
      thickness: wood ? DECKING_THICKNESS : inches(4),
      materialPreset: wood ? 'library:wood-floorplank1' : 'library:concrete-raw',
      // Bones: a 'deck' is framed (ledger, joists, beam on posts to grade); a
      // 'porch-slab' is poured at its elevation.
      metadata: { ...meta, floor: wood ? 'deck' : 'porch-slab' },
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
  const cover = coverGeometry(
    input,
    style,
    porchRoofForm(style, policy, attach),
    width / 2,
    beamLine,
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
  const postHeight = cover.coverY - landingTop
  const along: number[] = []
  if (form !== 'none') {
    const bays = Math.max(1, Math.ceil((width - 2 * inset) / MAX_POST_SPACING))
    for (let i = 0; i <= bays; i++) along.push(-hw + inset + ((width - 2 * inset) * i) / bays)
  }
  for (const a of along) {
    const [px, pz] = P(a, depth - inset)
    ops.push({
      node: {
        id: ids.column(),
        type: 'column',
        name: pillar.stucco ? 'Porch pier' : 'Porch post',
        parentId: input.levelId,
        position: [px, 0, pz],
        rotation: round(Math.atan2(-az, ax)),
        supportSlabId: ids.slab,
        height: round(postHeight),
        style: 'plain',
        crossSection: 'square',
        width: round(pillar.size),
        depth: round(pillar.size),
        shaftProfile: pillar.tapered ? 'tapered' : 'straight',
        shaftTaper: pillar.tapered ? 0.3 : 0,
        baseStyle: 'none',
        capitalStyle: 'none',
        edgeSoftness: 0.008,
        ...(pillar.stucco ? { materialPreset: 'library:concrete-stucco' } : {}),
        metadata: meta,
      },
      parentId: input.levelId,
    })
  }

  // ── steps to grade ────────────────────────────────────────────────────
  const risers = riserCount(rise)
  const stairWidth = Math.max(MIN_STAIR_WIDTH, Math.min(inches(60), width - inches(4)))
  let run = 0
  if (risers > 0) {
    run = risers * TREAD_RUN
    // The flight climbs along its local +x; rotation turns +x onto the
    // inward direction (−outward), so the bottom of the flight sits `run`
    // beyond the landing edge and the top tread meets the landing.
    const [bx, bz] = P(0, depth + run)
    const inward: Pt = [-outward[0], -outward[1]]
    ops.push({
      node: {
        id: ids.stair,
        type: 'stair',
        name: `${name} steps`,
        parentId: input.levelId,
        position: [bx, round(input.gradeY), bz],
        rotation: round(Math.atan2(-inward[1], inward[0])),
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
        railingMode: rise > GUARD_REQUIRED_ABOVE ? 'both' : 'none',
        railingHeight: inches(34),
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
  if (guard && railStyle) {
    const railInset = Math.max(pillar.size, inches(3.5)) / 2
    const cable = railStyle === 'cable'
    const rail = (a0: number, o0: number, a1: number, o1: number) => {
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
          // balusters: vertical infill under the 4 in-sphere rule (R312.1.3);
          // cable: horizontal runs 3 in apart on slim posts
          style: cable ? 'horizontal' : 'slat',
          height: round(GUARD_HEIGHT),
          thickness: cable ? inches(0.5) : inches(1.5),
          slatGap: cable ? inches(3) : inches(3.5),
          postSpacing: inches(cable ? 48 : 72),
          postSize: inches(cable ? 2 : 3.5),
          baseHeight: inches(3),
          baseStyle: 'grounded',
          postCap: 'flat',
          supportSlabId: ids.slab,
          metadata: meta,
        },
        parentId: input.levelId,
      })
    }
    const o = depth - railInset
    // sides, from the wall face to the outer post line
    rail(-hw + railInset, 0, -hw + railInset, o)
    rail(hw - railInset, 0, hw - railInset, o)
    // the outer edge, either side of the stair opening
    const half = risers > 0 ? stairWidth / 2 : 0
    if (risers > 0) {
      rail(-hw + railInset, o, -half, o)
      rail(half, o, hw - railInset, o)
    } else {
      rail(-hw + railInset, o, hw - railInset, o)
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
      segWidth = beamLine + cover.into
      segDepth = width
      centre = P(0, (beamLine - cover.into) / 2)
      yaw = Math.atan2(outward[1], -outward[0])
      roofMeta = { role: 'porch', open: true }
    } else if (form === 'shed') {
      // Shed on a ledger: the plane rises from the low eave at the beam
      // (segment +z, pointing outward) to the high edge at the wall face
      // (segment −z); Bones frames the high edge as a ledger with hangers
      // and no pediment, the sides open (no rake studs).
      segWidth = width
      segDepth = beamLine
      centre = P(0, beamLine / 2)
      yaw = Math.atan2(outward[0], outward[1])
      roofMeta = { role: 'porch', attach: 'high', open: true }
    } else {
      // Flat canopy: the box stops one overhang short of the wall so its
      // back overhang meets the wall face.
      segWidth = beamLine - input.overhang
      segDepth = width
      centre = P(0, (beamLine + input.overhang) / 2)
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
    ops.push({
      node: {
        id: ids.segment,
        type: 'roof-segment',
        name: form === 'flat' ? `${name} canopy` : `${name} ${form}`,
        parentId: ids.roof,
        position: [centre[0], round(plateY), centre[1]],
        rotation: round(yaw),
        roofType: form,
        width: round(segWidth),
        depth: round(segDepth),
        wallHeight: 0,
        wallThickness: 0,
        pitch: round(pitchDeg),
        overhang: round(input.overhang),
        metadata: { ...meta, roof: roofMeta },
      },
      parentId: ids.roof,
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
