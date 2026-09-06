/**
 * The porch — PlanCrafters' entrance tool (gen.js `applyPorch` /
 * `addEntrance`, model.js `makeEntrance` / `entranceGeom` /
 * `entranceFlight`), built from Pascal's own nodes:
 *
 *   - a `slab` landing stepped `PORCH_FLOOR_DROP` below the finish floor
 *     (a real step down; concrete, poured with the house slab);
 *   - `column` posts at the outer corners, ≤ 8 ft apart, sized and shaped by
 *     the style (craftsman tapers them);
 *   - `fence` guards (36 in, IRC R312) on a full porch — and on any landing
 *     more than 30 in above grade, where the code demands one;
 *   - a `stair` flight down to grade, centred on the door, risers solved the
 *     way PlanCrafters solves them (ceil(rise / 7¾ in) then relaxed while the
 *     riser still passes R311.7.5.1), 11 in treads, ≥ 36 in wide;
 *   - a porch roof as a `roof-segment` seated on the beam line
 *     (`PORCH_COVER_HEIGHT` above the finish floor): a gable or hip whose
 *     ridge runs square to the house wall and reaches into the main roof by
 *     its run so the planes meet (the same wing convention the auto roof
 *     uses), or a flat canopy for the modern styles.
 *
 * POLICY (PlanCrafters, verbatim): the entrance centres on the placed front
 * door; its width never cantilevers past a house corner (it shrinks to stay
 * centred within the door wall's own span — with a garage the facade is the
 * short wall beside it); 'full' porches span the living + entry bay clamped
 * 10–20 ft, 'entry' porches are 8 ft, and the no-porch styles still get a
 * modest covered stoop (4–7 ft, 5 ft deep, two slim posts, flat canopy).
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

/** The porch slab steps 4 in below the interior finish floor (PlanCrafters PORCH_FLOOR_DROP). */
export const PORCH_FLOOR_DROP = inches(4)
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

export type PorchPolicy = 'full' | 'entry' | 'none'
export type PorchRoofForm = 'gable' | 'hip' | 'shed' | 'flat'
/**
 * How the porch roof meets the house. `valley`: the door wall carries a
 * slope above it (an eave or a hip end), so a gable / hip porch ridge runs
 * square to the wall INTO that slope and the box reaches in by its run — the
 * auto roof's wing convention, framed as a valley. `ledger`: the wall is a
 * gable end, a rake, a shed's high wall or under a flat roof — there is no
 * slope to die into, so the porch roof stops at the wall face on a ledger
 * (a shed for the pitched styles), PlanCrafters' "no die-in" case.
 */
export type PorchAttach = 'valley' | 'ledger'

export interface PorchInput {
  policy: PorchPolicy
  style: StylePreset
  levelId: string
  /** The front door's wall, level-local metres, centreline. */
  wall: { start: Pt; end: Pt; thickness: number }
  /** Distance from `wall.start` to the door's centre, metres. */
  doorAt: number
  doorWidth: number
  /** Unit normal pointing OUT of the house across the wall. */
  outward: Pt
  /** Living + entry room widths along the front, metres (the 'full' porch bay). */
  bayWidth: number
  /** Finish floor: the house slab's walking surface, level-local y. */
  floorElevation: number
  /** Grade, level-local y (negative when the building stands above the site). */
  gradeY: number
  /** Eave overhang for the porch roof, metres along the slope. */
  overhang: number
  /** The door wall's roof role from the auto roof (`metadata.roof.role`); absent = stop at the wall. */
  wallRole?: string
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
  policy: PorchPolicy
  widthFt: number
  depthFt: number
  roof: PorchRoofForm | 'none'
  attach: PorchAttach
  posts: number
  rails: number
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

/** How the porch roof meets the house, from the door wall's roof role. */
export function porchAttach(wallRole: string | undefined): PorchAttach {
  return wallRole === 'eave' || wallRole === 'hip-end' ? 'valley' : 'ledger'
}

/**
 * The porch roof form: gable styles gable and hip styles hip when the wall
 * carries a slope to die into; a shed on a ledger when it does not; a flat
 * canopy for the shed / no-porch styles.
 */
export function porchRoofForm(style: StylePreset, policy: PorchPolicy, attach: PorchAttach = 'valley'): PorchRoofForm {
  if (policy === 'none') return 'flat'
  if (style.roofForm === 'shed' || style.roofForm === 'flat') return 'flat'
  if (attach === 'ledger') return 'shed'
  return style.roofForm === 'hip' ? 'hip' : 'gable'
}

export function porchFor(input: PorchInput, ids: PorchIds): PorchResult {
  const warnings: string[] = []
  const { style, policy, wall, outward } = input
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLen = Math.hypot(dx, dz)
  if (wallLen < 1e-6)
    return { ops: [], summary: null, warnings: ['the front door wall has no length — no porch.'] }
  const ax = dx / wallLen
  const az = dz / wallLen
  // door centre on the wall centreline, then out to the exterior face
  const cx = wall.start[0] + ax * input.doorAt
  const cz = wall.start[1] + az * input.doorAt
  const faceX = cx + outward[0] * (wall.thickness / 2)
  const faceZ = cz + outward[1] * (wall.thickness / 2)

  // ── width and depth (PlanCrafters applyPorch) ─────────────────────────
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
  } else {
    width = snap6(clamp(Math.min(maxCentered, 6 * FT), 4 * FT, 7 * FT))
    depth = 5 * FT
  }
  if (maxCentered < width - 1e-6) {
    warnings.push(
      `the porch is ${(width / FT).toFixed(0)}' wide but the front door sits ${(maxCentered / 2 / FT).toFixed(1)}' from a corner — it will pass the corner.`,
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
  const porchTop = input.floorElevation - PORCH_FLOOR_DROP
  const rise = porchTop - input.gradeY
  const guard = policy === 'full' || rise > GUARD_REQUIRED_ABOVE
  const meta = {
    generatedBy: 'pascal:generate',
    porch: { policy, width: round(width), depth: round(depth) },
  }

  // ── landing ───────────────────────────────────────────────────────────
  ops.push({
    node: {
      id: ids.slab,
      type: 'slab',
      name: 'Porch',
      parentId: input.levelId,
      polygon: corners,
      holes: [],
      elevation: round(porchTop),
      thickness: inches(4),
      // Poured with the house slab (PlanCrafters: a slab house's porch is concrete).
      materialPreset: 'concrete-raw',
      metadata: meta,
    },
    parentId: input.levelId,
  })

  // ── posts ─────────────────────────────────────────────────────────────
  const postSize = policy === 'full' ? inches(7) : policy === 'entry' ? inches(5.5) : inches(6)
  const tapered = style.key === 'craftsman' && policy !== 'none'
  const inset = Math.min(inches(6), hw / 3, depth / 3)
  const postHeight = input.floorElevation + PORCH_COVER_HEIGHT - porchTop
  const along: number[] = []
  const bays = Math.max(1, Math.ceil((width - 2 * inset) / MAX_POST_SPACING))
  for (let i = 0; i <= bays; i++) along.push(-hw + inset + ((width - 2 * inset) * i) / bays)
  for (const a of along) {
    const [px, pz] = P(a, depth - inset)
    ops.push({
      node: {
        id: ids.column(),
        type: 'column',
        name: 'Porch post',
        parentId: input.levelId,
        position: [px, 0, pz],
        rotation: round(Math.atan2(-az, ax)),
        supportSlabId: ids.slab,
        height: round(postHeight),
        style: 'plain',
        crossSection: 'square',
        width: round(postSize),
        depth: round(postSize),
        shaftProfile: tapered ? 'tapered' : 'straight',
        shaftTaper: tapered ? 0.3 : 0,
        baseStyle: 'none',
        capitalStyle: 'none',
        edgeSoftness: 0.008,
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
    // beyond the porch edge and the top tread meets the landing.
    const [bx, bz] = P(0, depth + run)
    const inward: Pt = [-outward[0], -outward[1]]
    ops.push({
      node: {
        id: ids.stair,
        type: 'stair',
        name: 'Porch steps',
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
        fillToFloor: true,
        materialPreset: 'concrete-raw',
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
        fillToFloor: true,
        thickness: inches(4),
        metadata: meta,
      },
      parentId: ids.stair,
    })
  }

  // ── guards ────────────────────────────────────────────────────────────
  let rails = 0
  if (guard) {
    const railInset = postSize / 2
    const rail = (a0: number, o0: number, a1: number, o1: number) => {
      const s = P(a0, o0)
      const e = P(a1, o1)
      if (Math.hypot(e[0] - s[0], e[1] - s[1]) < inches(12)) return
      rails++
      ops.push({
        node: {
          id: ids.fence(),
          type: 'fence',
          name: 'Porch rail',
          parentId: input.levelId,
          start: s,
          end: e,
          style: 'rail',
          height: round(GUARD_HEIGHT),
          thickness: inches(1.5),
          postSpacing: inches(72),
          postSize: inches(3.5),
          baseHeight: inches(3),
          baseStyle: 'grounded',
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

  // ── roof ──────────────────────────────────────────────────────────────
  const attach = porchAttach(input.wallRole)
  const form = porchRoofForm(style, policy, attach)
  const plateY = input.floorElevation + PORCH_COVER_HEIGHT
  const pitch =
    form === 'flat' ? 0 : form === 'shed' ? Math.min(style.pitch, MAX_SHED_PORCH_PITCH) : Math.min(style.pitch, MAX_PORCH_PITCH)
  const pitchDeg = Math.atan(pitch / 12) * (180 / Math.PI)
  // The roof bears on the beam over the posts (one inset in from the
  // landing's outer edge); its eave overhangs the landing from there.
  const beamLine = depth - inset
  let segWidth: number
  let segDepth: number
  let centre: Pt
  let yaw: number
  let roofMeta: Record<string, unknown>
  if (form === 'gable' || form === 'hip') {
    // Ridge square to the wall (segment x along `outward`); the box spans
    // the porch width across and reaches INTO the house by its run so its
    // planes meet the main roof at a valley — the auto roof's wing
    // convention. Rotation turns segment +x onto −outward (into the house).
    const run_ = width / 2
    segWidth = beamLine + run_
    segDepth = width
    centre = P(0, (beamLine - run_) / 2)
    yaw = Math.atan2(outward[1], -outward[0])
    roofMeta = { role: 'porch', open: true }
  } else if (form === 'shed') {
    // Shed on a ledger: the plane rises from the low eave at the beam
    // (segment +z, pointing outward) to the high edge at the wall face
    // (segment −z); Bones frames the high edge as a ledger with hangers and
    // no pediment, the sides open (no rake studs).
    segWidth = width
    segDepth = beamLine
    centre = P(0, beamLine / 2)
    yaw = Math.atan2(outward[0], outward[1])
    roofMeta = { role: 'porch', attach: 'high', open: true }
  } else {
    // Flat canopy: the box stops one overhang short of the wall so its back
    // overhang meets the wall face.
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
      name: 'Porch roof',
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
      name: form === 'flat' ? 'Porch canopy' : `Porch ${form}`,
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

  return {
    ops,
    warnings,
    summary: {
      policy,
      widthFt: round(width / FT),
      depthFt: round(depth / FT),
      roof: form,
      attach,
      posts: along.length,
      rails,
      risers,
      riserIn: risers > 0 ? rise / risers / IN : 0,
      guard,
    },
  }
}
