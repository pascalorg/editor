/**
 * Wall assembly layers — pure function: (WallSlice[], RoomSlice[], spec) →
 * Member[] with roles drywall / sheathing / wrb / cladding.
 *
 * The drawn wall is the FRAMING envelope; finishes stack OUTWARD from its
 * faces per data/wall-assemblies.json (researched, every layer cited):
 *  - interior partition: 1/2" gypsum on both faces (R702.3.5);
 *  - exterior wall, inside→out: 1/2" gypsum, then past the studs 7/16" WSP
 *    sheathing (Table R602.3(3)), the WRB (R703.2 — No.15 felt/housewrap,
 *    rendered 1/16" symbolic, DOUBLED under stucco per R703.7.3), and the
 *    jurisdiction's default cladding family (thickness per R703 subsection);
 *  - openings punch through every layer (band segments around the RO).
 *
 * Which face is exterior comes from the room polygons: the face whose probe
 * point sits in no room faces outdoors. Corner treatment mirrors the
 * framing run insets: a butting wall's layers stop at the through wall's
 * face, the through wall's layers run past (how drywall is actually hung).
 *
 * Per-wall overrides (full wall engineering panel): `cladding` swaps the
 * exterior finish family for THAT wall (falls back to the state default);
 * `insulation` ≠ 'none' fills the stud bays with labeled batt members
 * (role 'insulation', laid out against the framing engine's own trimmed
 * runs/backing bays via frameHints so batts and studs never share volume);
 * absent overrides keep today's output byte-equal.
 */

import assemblies from '../../data/wall-assemblies.json'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Member, MemberRole, RoomSlice, SlabSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import {
  DOUBLE_TRIMMER_SPAN,
  FIRE_BLOCK_HEIGHT,
  type FrameHints,
  frameHints,
  specForWall,
  studPositions,
  studSizeFor,
  type WallFramingOverride,
} from './wall-framing'
import {
  LGS_JACKS_PER_SIDE,
  LGS_STUD_THICKNESS,
  LGS_TRACK_FLANGE,
} from './lgs-wall-framing'

type Pt = readonly [number, number]

type LayerSpec = { role: string; thicknessIn: number; material: string; citation: string }
type ZoneInsulation = { value?: string; battThicknessIn?: number }
type Assemblies = {
  interior: { layers: LayerSpec[] }
  exterior: {
    sheathing: { layers: LayerSpec[] }
    wrb: { layers: LayerSpec[]; stuccoDoubleLayer?: boolean }
    claddings: Record<string, { layers: LayerSpec[] }>
    defaultCladdingByState: Record<string, string>
    stateClimateZone?: Record<string, string>
    insulationByClimateZone?: Record<string, ZoneInsulation>
    vaporRetarderClassByZone?: Record<string, { required?: string }>
  }
}
const DATA = assemblies as unknown as Assemblies

/**
 * Per-wall engineering the layer engine consumes — a projection of the
 * resolved WallOverride object (framing/compute.ts hands the same map to
 * frameWalls, so both engines read one truth).
 */
export type WallLayerOverride = WallFramingOverride & {
  insulation?: 'none' | 'batt' | 'blown' | 'spray-foam'
  insulationR?: number
  cladding?: string
}

function pointInPolygon(p: Pt, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i] as readonly [number, number]
    const [xj, zj] = polygon[j] as readonly [number, number]
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** Plan normal of a wall for side +1: rotate dir by -90° (matches faceOf). */
const normalOf = (wall: WallSlice, side: 1 | -1): Pt => [
  -wall.dir[1] * side,
  wall.dir[0] * side,
]

/** Which side (+1/−1) of an exterior wall faces OUTDOORS. FLOORING is the
 * automatic signal (round-13 user feedback): the side standing over a slab
 * is inside — slabs exist wherever rooms do, even before zones are drawn.
 * Room polygons are the fallback; null = ambiguous (treated as interior). */
export function exteriorSide(
  wall: WallSlice,
  rooms: RoomSlice[],
  slabs: SlabSlice[] = [],
): 1 | -1 | null {
  if (!wall.exterior) return null
  const mid: Pt = [
    wall.start[0] + (wall.dir[0] * wall.length) / 2,
    wall.start[1] + (wall.dir[1] * wall.length) / 2,
  ]
  const probeDist = wall.thickness / 2 + 0.15
  const probe = (side: 1 | -1): Pt => {
    const n = normalOf(wall, side)
    return [mid[0] + n[0] * probeDist, mid[1] + n[1] * probeDist]
  }
  const overSlab = (p: Pt): boolean => slabs.some((sl) => pointInPolygon(p, sl.polygon))
  const inRoom = (p: Pt): boolean => rooms.some((r) => pointInPolygon(p, r.polygon))
  const pPlus = probe(1)
  const pMinus = probe(-1)
  // flooring first
  const plusFloor = overSlab(pPlus)
  const minusFloor = overSlab(pMinus)
  if (plusFloor !== minusFloor) return plusFloor ? -1 : 1
  // rooms fallback
  const plusRoom = inRoom(pPlus)
  const minusRoom = inRoom(pMinus)
  if (plusRoom !== minusRoom) return plusRoom ? -1 : 1
  return null
}

/** u-intervals of the wall NOT covered by an opening whose vertical extent
 * intersects [y0, y1] — plus the over/under bands for partly-tall openings. */
type Band = { u0: number; u1: number; y0: number; y1: number }

function bandsAround(wall: WallSlice, height: number): Band[] {
  const bands: Band[] = []
  const cuts = wall.openings
    .map((o) => ({
      lo: Math.max(0, o.u - o.roughWidth / 2),
      hi: Math.min(wall.length, o.u + o.roughWidth / 2),
      yLo: o.sillHeight,
      yHi: Math.min(height, o.sillHeight + o.roughHeight),
    }))
    .sort((a, b) => a.lo - b.lo)
  let cursor = 0
  for (const cut of cuts) {
    if (cut.lo > cursor + 0.01) bands.push({ u0: cursor, u1: cut.lo, y0: 0, y1: height })
    // bands above and below the opening itself
    if (cut.yLo > 0.01) bands.push({ u0: cut.lo, u1: cut.hi, y0: 0, y1: cut.yLo })
    if (cut.yHi < height - 0.01) bands.push({ u0: cut.lo, u1: cut.hi, y0: cut.yHi, y1: height })
    cursor = Math.max(cursor, cut.hi)
  }
  if (cursor < wall.length - 0.01) bands.push({ u0: cursor, u1: wall.length, y0: 0, y1: height })
  return bands.filter((b) => b.u1 - b.u0 > 0.01 && b.y1 - b.y0 > 0.01)
}

/** Corner + TEE run insets, mirroring frameWalls: butting layers stop at
 * the through wall's face. Corners re-derive from endpoint coincidence;
 * tees (endpoint on another wall's centerline interior) inset the stem by
 * the angle-aware (t/2)/sinθ — without it the stem's face layers ran to
 * the through CENTERLINE, straight through its studs and plates (36-78
 * SAT pairs per house, night-board queue; both stem directions covered
 * since both endpoints are probed). */
function runInsets(wall: WallSlice, walls: WallSlice[]): { start: number; end: number } {
  const insets = { start: 0, end: 0 }
  const ends: { which: 'start' | 'end'; p: Pt }[] = [
    { which: 'start', p: wall.start },
    { which: 'end', p: wall.end },
  ]
  for (const { which, p } of ends) {
    for (const other of walls) {
      if (other.id === wall.id || other.curved) continue
      const tol = Math.max(wall.thickness, other.thickness) * 0.75
      const dEnds = Math.min(
        Math.hypot(p[0] - other.start[0], p[1] - other.start[1]),
        Math.hypot(p[0] - other.end[0], p[1] - other.end[1]),
      )
      if (dEnds <= tol) {
        // Round-14: '>' left EQUAL-length corners (every drawn rectangle!)
        // with neither wall inset — 20 layer clashes on the default house.
        // Tie breaks by id so exactly one wall runs through.
        const through =
          other.length > wall.length || (other.length === wall.length && other.id < wall.id)
        if (through) insets[which] = Math.max(insets[which], other.thickness / 2)
        // NO `continue`: a fat stem near the through wall's end can be a
        // corner-candidate that LOSES the tie-break AND a real tee — the
        // shadowing left its layers with zero inset (night-5 skeptic a).
      }
      // TEE: this endpoint lands on `other`'s centerline interior — the
      // stem always butts (mirrors detectTees' geometry + frameHints'
      // inset, including the parallelism splice guard).
      const crossRaw = wall.dir[0] * other.dir[1] - wall.dir[1] * other.dir[0]
      if (Math.abs(crossRaw) < 0.3) continue
      const proj = (p[0] - other.start[0]) * other.dir[0] + (p[1] - other.start[1]) * other.dir[1]
      if (proj < other.thickness || proj > other.length - other.thickness) continue
      const foot: Pt = [other.start[0] + other.dir[0] * proj, other.start[1] + other.dir[1] * proj]
      const dist = Math.hypot(p[0] - foot[0], p[1] - foot[1])
      if (dist > (other.thickness + wall.thickness) / 2 + 0.001) continue
      const cosTheta = Math.abs(wall.dir[0] * other.dir[0] + wall.dir[1] * other.dir[1])
      const sinTheta = Math.max(0.2, Math.abs(crossRaw))
      // Width-aware (S5 formula): the stem's finished footprint reaches
      // (w/2)·|cosθ| past its centerline at oblique angles.
      insets[which] = Math.max(
        insets[which],
        (other.thickness + wall.thickness * cosTheta) / (2 * sinTheta),
      )
    }
  }
  return insets
}

const ROLE_OF: Record<string, MemberRole> = {
  drywall: 'drywall',
  sheathing: 'sheathing',
  wrb: 'wrb',
  cladding: 'cladding',
  // Brick veneer + EIFS families (verify round: their layer roles were
  // unmapped, so selecting them emitted NO members — TX's brick default
  // rendered bare). Air gaps stay unmapped (air is not a member); the
  // EIFS drainage plane behaves as a WRB.
  veneer: 'cladding',
  lamina: 'cladding',
  foam: 'cladding',
  drainage: 'wrb',
}

/**
 * Primary IECC zone for a state: display label ('5A') + data key ('5';
 * marine 4C → '4M'). stateClimateZone values are free-text zone LABELS
 * ('5A (4A NYC/LI, 6A Adk)', '3A (2A coast)') while insulationByClimateZone
 * and vaporRetarderClassByZone are keyed '1'..'8'/'4M' — the raw value
 * never hit either map, so the cavity-R/vapor labels were DEAD in all 51
 * states (LOD-400 audit B4 appendix rider). One normalization, shared with
 * the batt path, so both sides read the same zone.
 */
function climateZoneOf(state: string): { label: string | null; key: string | null } {
  const raw = DATA.exterior.stateClimateZone?.[state]
  const m = raw ? /^(\d)([ABC])?/.exec(raw.trim()) : null
  if (!m) return { label: null, key: null }
  return {
    label: `${m[1]}${m[2] ?? ''}`,
    key: m[1] === '4' && m[2] === 'C' ? '4M' : (m[1] as string),
  }
}

export function layoutWallLayers(
  walls: WallSlice[],
  rooms: RoomSlice[],
  spec: FramingSpec = DEFAULT_SPEC,
  /** Resolved state code (drives cladding family + climate labels). */
  stateCode = 'NY',
  /** Floor slabs — the automatic inside/outside signal. */
  slabs: SlabSlice[] = [],
  /** Per-wall engineering overrides, keyed by wall id (see WallLayerOverride). */
  overrides?: ReadonlyMap<string, WallLayerOverride>,
): Member[] {
  const members: Member[] = []
  if (spec.detail === '200') return members

  const state = stateCode
  const defaultCladdingKey = DATA.exterior.defaultCladdingByState[state] ?? 'vinyl'
  const { label: zone, key: zoneKey } = climateZoneOf(state)
  const rValue = zoneKey ? DATA.exterior.insulationByClimateZone?.[zoneKey]?.value : undefined

  // Insulation batts lay out against the framing's OWN trimmed runs and
  // backing bays — derive the (identical) hint pass only when some wall
  // actually asks for batts, so the default path costs nothing.
  const wantsBatts = (o?: WallLayerOverride): boolean =>
    o?.insulation !== undefined && o.insulation !== 'none'
  const battHints =
    overrides && walls.some((w) => wantsBatts(overrides.get(w.id)))
      ? frameHints(walls, spec, overrides)
      : null
  const battZone = battHints ? battZoneInfo(state) : null

  for (const wall of walls) {
    if (wall.curved || wall.length < 0.2) continue
    const override = overrides?.get(wall.id)
    // Per-wall exterior finish: the override key when it names a known
    // cladding family, else the jurisdiction default.
    const claddingKey =
      override?.cladding && DATA.exterior.claddings[override.cladding]
        ? override.cladding
        : defaultCladdingKey
    const cladding = DATA.exterior.claddings[claddingKey] ?? DATA.exterior.claddings.vinyl
    const inset = runInsets(wall, walls)
    const extSide = exteriorSide(wall, rooms, slabs)
    const bands = bandsAround(wall, wall.height)

    /** Emit one layer stack outward from face `side`, starting at the
     * framing face, ordered inside→out. */
    // The DRAWN thickness already includes the finishes (4.5in = 0.5 gypsum
    // + 3.5 studs + 0.5 gypsum): stacks start at the STUD face, so the
    // interior gypsum's outer face lands flush with the drawn wall face
    // (round-14 — layers floated 12.6mm proud and fattened every wall).
    const wallSpec = specForWall(spec, override)
    const studDepth = LUMBER_CROSS_SECTIONS[studSizeFor(wall, wallSpec)][1]
    const stackOrigin = Math.min(studDepth, wall.thickness - inches(1)) / 2

    const emitStack = (side: 1 | -1, layers: LayerSpec[], noteSuffix = '') => {
      const n = normalOf(wall, side)
      let offset = stackOrigin
      // The note describes the CAVITY the stack bounds (vapor retarder
      // class / cavity R) — it rides the INNERMOST rendered layer only
      // (gypsum on the interior stack, sheathing on the exterior), so
      // outer cladding labels — and the takeoff items derived from them
      // via `label.split(' (')` — stay clean.
      let note = noteSuffix
      for (const layer of layers) {
        const t = inches(layer.thicknessIn)
        const role = ROLE_OF[layer.role]
        if (!role) {
          // Space-occupying but non-rendered (the brick veneer's 1" air
          // gap): skipping WITHOUT advancing collapsed the airspace and
          // parked the wythe flush against the WRB (verify round S9).
          offset += t
          continue
        }
        const center = offset + t / 2
        for (const band of bands) {
          const len = band.u1 - band.u0 - (band.u0 < 0.02 ? inset.start : 0) - (band.u1 > wall.length - 0.02 ? inset.end : 0)
          if (len < 0.02) continue
          const u0 = band.u0 + (band.u0 < 0.02 ? inset.start : 0)
          const uMid = u0 + len / 2
          const yaw = Math.atan2(-wall.dir[1], wall.dir[0])
          members.push({
            system: 'wall-framing',
            role,
            dims: [len, band.y1 - band.y0, t],
            length: len,
            position: [
              wall.start[0] + wall.dir[0] * uMid + n[0] * center,
              (band.y0 + band.y1) / 2,
              wall.start[1] + wall.dir[1] * uMid + n[1] * center,
            ],
            rotation: [0, yaw, 0],
            material: 'lumber',
            sourceId: wall.id,
            label: `${layer.material}${note} (${layer.citation})`,
            face: [n[0], n[1]],
          })
        }
        note = ''
        offset += t
      }
    }

    const gypsum = DATA.interior.layers.filter((l) => l.role === 'drywall').slice(0, 1)
    if (extSide === null) {
      // interior partition: gypsum both faces
      emitStack(1, gypsum)
      emitStack(-1, gypsum)
    } else {
      // interior face: gypsum (+ vapor retarder note by climate zone —
      // keyed by the NORMALIZED zone, and the map holds objects whose
      // `required` field is the printable class; the old raw-value lookup
      // never hit, and a hit would have printed '[object Object]')
      const vapor = zoneKey
        ? DATA.exterior.vaporRetarderClassByZone?.[zoneKey]?.required
        : undefined
      emitStack(
        (-extSide) as 1 | -1,
        gypsum,
        vapor ? ` — vapor retarder ${vapor}, R702.7` : '',
      )
      // exterior face, inside→out: sheathing → WRB (×2 under stucco) → cladding
      const wrbLayers = [...DATA.exterior.wrb.layers]
      if (claddingKey === 'stucco' && wrbLayers[0]) {
        wrbLayers.push({ ...wrbLayers[0], material: `${wrbLayers[0].material} (2nd layer under stucco)` })
      }
      emitStack(
        extSide,
        [
          ...DATA.exterior.sheathing.layers,
          ...wrbLayers,
          ...(cladding?.layers ?? []),
        ],
        rValue ? ` — cavity ${rValue} (zone ${zone})` : '',
      )
    }

    // Insulation batts in the stud bays (per-wall override, ≠ 'none').
    if (battHints && battZone && wantsBatts(override) && override) {
      members.push(
        ...insulationBatts(wall, wallSpec, override, battHints.get(wall.id) ?? {}, battZone),
      )
    }
  }
  return members
}

// ---------------------------------------------------------------------------
// Insulation batts (full wall engineering panel)
// ---------------------------------------------------------------------------

type BattZone = { zoneLabel: string | null; minR: number; thicknessIn: number }

/**
 * Climate-zone batt data for a state: primary IECC zone label ("2A"), the
 * prescriptive cavity minimum R, and the batt thickness the data prescribes
 * (3.5" for R-13/15 bays, 5.5" for deeper). Zone-less codes (INTL) fall
 * back to R-13 / 3.5" with no zone tag on the label.
 */
function battZoneInfo(state: string): BattZone {
  const { label, key } = climateZoneOf(state)
  // Zone-less codes (INTL) assume zone 4 — the SAME assumption the
  // characteristics engine (and so the panel's 'code min' hint) makes; a
  // private R-13 fallback here left members labeled R-13 under a hint
  // reading R-30 (verify round S6 parity finding).
  const entry = DATA.exterior.insulationByClimateZone?.[key ?? '4']
  const minR = entry?.value ? Number.parseInt(entry.value.replace(/^R/i, ''), 10) || 13 : 13
  return {
    zoneLabel: label,
    minR,
    thicknessIn: entry?.battThicknessIn ?? 3.5,
  }
}

/**
 * Batt members for one framed wall: one box per clear stud bay, mirroring
 * the framing engine's OWN layout — the trimmed run (corner insets), the
 * grid + California-backing stud rhythm, opening-frame keep-outs (kings/
 * trimmers/cripples own that span), partition-backing bays, and LOD-400
 * fire-blocking rows (batts split around them) — so batts and framing
 * touch but never share volume (S1). Thickness comes from the climate
 * zone's batt data, capped at the stud depth; label reads
 * 'batt R-13 (zone 2A)' style with the override's type + R.
 */
function insulationBatts(
  wall: WallSlice,
  wallSpec: FramingSpec,
  override: WallLayerOverride,
  hints: FrameHints,
  zone: BattZone,
): Member[] {
  const members: Member[] = []
  const studSize = studSizeFor(wall, wallSpec)
  const [tLumber, w] = LUMBER_CROSS_SECTIONS[studSize]
  // Steel (LGS) walls carry the same batts in the same bays, but the bay
  // arithmetic mirrors the STEEL engine's members: C-stud flanges are
  // 1-5/8" (vs 1.5" lumber), the cavity runs track-flange to track-flange
  // (one top track, no double plate), openings frame ONE jack per side
  // (LGS_JACKS_PER_SIDE — R603.7 minimum), and there are no lumber fire
  // rows to split around. Lumber walls are byte-untouched.
  const steel = override.construction === 'lgs'
  const t = steel ? LGS_STUD_THICKNESS : tLumber
  const halfT = t / 2
  const len = wall.length
  const u0 = Math.max(0, hints.startInset ?? 0)
  const u1 = Math.max(u0 + 4 * t, len - Math.max(0, hints.endInset ?? 0))
  const runLen = u1 - u0
  const studBottom = steel ? LGS_TRACK_FLANGE : tLumber
  const studTop = steel
    ? wall.height - LGS_TRACK_FLANGE
    : wall.height - (wallSpec.topPlateCount === 2 ? 2 * tLumber : tLumber)
  if (studTop - studBottom <= t) return members // pony wall — plates only

  // The stud rhythm the framing actually emits: o.c. grid on the trimmed
  // run, plus the cross-wall extra studs (California corner backing).
  const gridUs = studPositions(runLen, wallSpec.studSpacing, halfT).map((su) => su + u0)
  const studUs = [...gridUs]
  for (const extra of hints.extraStuds ?? []) {
    studUs.push(Math.min(Math.max(extra.u, u0 + halfT), u1 - halfT))
  }
  studUs.sort((a, b) => a - b)

  // Keep-outs: the opening frame owns its span (kings/trimmers/header/
  // cripples), and a partition-backing ladder fills its whole bay.
  type Span = { min: number; max: number }
  const keepOuts: Span[] = []
  for (const opening of wall.openings) {
    const ro = Math.min(opening.roughWidth, runLen - 4 * t)
    if (ro <= 0) continue
    const frameSide = steel ? LGS_JACKS_PER_SIDE * t : (ro > DOUBLE_TRIMMER_SPAN ? 2 : 1) * t
    const u = Math.min(
      Math.max(opening.u, u0 + ro / 2 + frameSide + t),
      u1 - ro / 2 - frameSide - t,
    )
    keepOuts.push({ min: u - ro / 2 - frameSide - t, max: u + ro / 2 + frameSide + t })
  }
  for (const tee of hints.backing ?? []) {
    const uu = Math.min(Math.max(tee.u, u0 + t), u1 - t)
    const left = Math.max(u0 + halfT, ...gridUs.filter((su) => su < uu - 1e-6))
    const right = Math.min(u1 - halfT, ...gridUs.filter((su) => su > uu + 1e-6))
    keepOuts.push({ min: left, max: right })
  }

  // Vertical segments: the full cavity, split around LOD-400 fire rows —
  // lumber only (the steel engine emits no fire-blocking members; a split
  // there would leave a gap around nothing).
  const ySegments: [number, number][] = []
  let yCursor = studBottom
  if (wallSpec.detail === '400' && !steel) {
    for (let rowY = FIRE_BLOCK_HEIGHT; rowY < studTop - t; rowY += FIRE_BLOCK_HEIGHT) {
      ySegments.push([yCursor, rowY - halfT])
      yCursor = rowY + halfT
    }
  }
  ySegments.push([yCursor, studTop])

  const type = override.insulation ?? 'batt'
  const r = override.insulationR ?? zone.minR
  // The batt can only fill the cavity the LAYER stacks leave: they start at
  // stackOrigin = min(studDepth, thickness-1")/2 from center, so a nominal
  // 5.5" zone-5 batt in a 0.15m wall must compress or it shares volume with
  // the gypsum (verify round S1 finding: 7.55mm overlap, 30 SAT pairs).
  const cavity = Math.min(w, wall.thickness - inches(1))
  const depth = Math.min(inches(zone.thicknessIn), cavity)
  // Flag the compression only when it's real (> 1/4"): a 2x4 bay shaves a
  // 3.5" batt by ~0.3mm on 0.114m walls, which no installer would call
  // compressed. Flag, not label: takeoff rows key off the label, and flags
  // aggregate to one warning row with a count.
  const compressed = depth < inches(zone.thicknessIn) - inches(0.25)
  const flag = compressed
    ? `${zone.thicknessIn}" batt compressed into a shallower cavity — R derated below R-${r}`
    : undefined
  const label = `${type} R-${r}${zone.zoneLabel ? ` (zone ${zone.zoneLabel})` : ''}`
  const yaw = Math.atan2(-wall.dir[1], wall.dir[0])

  for (let i = 0; i + 1 < studUs.length; i++) {
    // clear bay between two studs, minus every keep-out
    let spans: Span[] = [
      { min: (studUs[i] as number) + halfT, max: (studUs[i + 1] as number) - halfT },
    ]
    for (const k of keepOuts) {
      const next: Span[] = []
      for (const s of spans) {
        if (k.max <= s.min || k.min >= s.max) {
          next.push(s)
          continue
        }
        if (k.min > s.min) next.push({ min: s.min, max: k.min })
        if (k.max < s.max) next.push({ min: k.max, max: s.max })
      }
      spans = next
    }
    for (const s of spans) {
      const bayLen = s.max - s.min
      if (bayLen < inches(3)) continue
      const uMid = (s.min + s.max) / 2
      for (const [yLo, yHi] of ySegments) {
        const segH = yHi - yLo
        if (segH < inches(3)) continue
        members.push({
          system: 'wall-framing',
          role: 'insulation',
          dims: [bayLen, segH, depth],
          length: bayLen,
          position: [
            wall.start[0] + wall.dir[0] * uMid,
            (yLo + yHi) / 2,
            wall.start[1] + wall.dir[1] * uMid,
          ],
          rotation: [0, yaw, 0],
          material: 'lumber',
          sourceId: wall.id,
          label,
          flag,
        })
      }
    }
  }
  return members
}
