/**
 * Wall framing engine — the heart of Bones. Pure functions: WallSlices +
 * FramingSpec → the US platform-framing member set:
 *
 *   bottom plate · top plate(s) · common studs at o.c. spacing · per opening:
 *   king studs, trimmers (doubled past 6 ft), header (sized by span), sill,
 *   cripples · and across walls: California corner assemblies, partition
 *   backing at tees, alternating cap-plate laps · at LOD 400: fire blocking
 *   over 10 ft plates and plate-splice call-outs.
 *
 * Geometry convention: the wall frame has X along the wall (from `start`),
 * Y up, Z across the thickness. Every member is an axis-aligned box in that
 * frame — verticals are just taller-than-wide boxes — so the whole wall
 * shares one Y rotation (`yaw`) when mapped into level space.
 *
 * Cross-wall fabrication (corners/tees/laps) lives in `frameWalls`, which
 * computes per-wall FrameHints and hands them to `frameWall`. `frameWall`
 * alone still frames a standalone wall correctly (hints default to none).
 */

import { DEFAULT_SPEC, type FramingSpec, headerFor } from '../core/spec'
import type { Member, OpeningSlice, WallSlice } from '../core/types'
import { feet, formatFtIn, formatIn, inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS, type LumberSize } from '../lumber'
import {
  BRACED_PANEL_MIN_LENGTH,
  PORTAL_OPENING_MIN_SPAN,
  portalMinPanelWidth,
} from './wall-bracing'

const EPS = 1e-6
/** RO width beyond which each side gets a second trimmer (jack). Exported so
 * the layer engine's insulation batts clear the same opening-frame span. */
export const DOUBLE_TRIMMER_SPAN = feet(6)
/** Fire blocking required over 10 ft of concealed stud cavity (IRC R302.11).
 * Exported so batts split around the same rows. */
export const FIRE_BLOCK_HEIGHT = feet(10)
/** Stock plate length — splices called out past this (min 24" lap, R602.3.2). */
const PLATE_STOCK = feet(20)
/** CS-PF portal strap: flat ~18ga steel, surface-mounted on the framing
 * face — thinner than the 2 mm SAT skin so it never registers as an
 * interpenetration against the studs it laps (checklist S1). */
const PORTAL_STRAP_THICKNESS = 0.0012

// ---- high-wind wall uplift path (R802.11 / R301.2.1 WFCM — LOD-400 B10) --
/** The B10 uplift hardware rides B9's surface-steel convention (S13):
 * ~1.2 mm symbolic steel against the framing face, under the SAT skin. */
const UPLIFT_STEEL_THICKNESS = PORTAL_STRAP_THICKNESS
/** Flat-strap width (1-1/4" coil-strap class). */
const UPLIFT_STRAP_WIDTH = inches(1.25)
/** Stud-to-plate connector extent: laps the stud top AND the plate pack
 * (H2.5-class connectors are ~5" of lap across the joint). */
const UPLIFT_CONNECTOR_HEIGHT = inches(5)
/** Plate-to-foundation strap spacing along slab-bearing plates. WFCM
 * strapping schedules are wind/geometry-specific — 48" o.c. is the
 * conservative layout convention here; the member labels route the real
 * schedule to the installer. Exported for the gates. */
export const FOUNDATION_STRAP_SPACING = feet(4)
/** Foundation strap height above the slab line: laps the 1.5" plate and
 * the stud foot; the concrete anchorage below y=0 is per schedule (the
 * advisory says so — symbolic, never invented embedment geometry). */
const FOUNDATION_STRAP_HEIGHT = inches(6)
/** Plan distance under which a foundation strap and an existing foundation
 * anchor (R403.1.6 J-bolt / seismic HDU) are ONE anchorage point — the
 * R403.1.6 12" end-distance window. `dedupeFoundationStraps` drops the
 * strap there: the bolt already clamps the plate, and two bookings of one
 * spot would double-buy the anchor (B18/B9 cross-ref precedent). */
export const UPLIFT_ANCHOR_DEDUPE_TOL = 0.3

export type WallFrame = {
  wall: WallSlice
  yaw: number
  /** Map wall-local (u, y, v) → level-local position. */
  place: (u: number, y: number, v?: number) => [number, number, number]
}

/** Wall-local frame (u along the wall, y up, v across) → level space.
 * Exported so the LGS steel engine places its members in the EXACT same
 * frame the lumber engine uses (one geometry truth per wall). */
export function frameOf(wall: WallSlice): WallFrame {
  const [dx, dz] = wall.dir
  const [sx, sz] = wall.start
  // Rotating a +X-aligned box by yaw about Y maps +X → [cos, 0, -sin];
  // we need +X → [dx, 0, dz], hence yaw = atan2(-dz, dx).
  const yaw = Math.atan2(-dz, dx)
  return {
    wall,
    yaw,
    place: (u, y, v = 0) => [sx + dx * u - dz * v, y, sz + dz * u + dx * v],
  }
}

/**
 * Nominal stud sizes the prescriptive wall table covers, by DRESSED depth.
 * IRC 2021 Table R602.3(5) ("Size, Height and Spacing of Wood Studs") is
 * written per nominal size — 2x4 and 2x6 are the two rows a house wall uses —
 * and the dressed depths are the standard American Softwood Lumber Standard
 * (PS 20) surfaced dimensions the IRC assumes: 2x4 = 1-1/2" x 3-1/2",
 * 2x6 = 1-1/2" x 5-1/2". `LUMBER_CROSS_SECTIONS` carries the same numbers;
 * this map is the INVERSE lookup (depth -> nominal) the assembly needs.
 */
const STUD_DEPTH_TO_SIZE: { depth: number; size: LumberSize }[] = [
  { depth: inches(3.5), size: '2x4' },
  { depth: inches(5.5), size: '2x6' },
]
/** How far a declared assembly depth may sit from a tabulated dressed depth
 * and still BE that stud (1/8" — rounding/units slop, not a size change). */
const STUD_DEPTH_TOLERANCE = inches(0.125)

/**
 * Stud size for a wall.
 *
 * FIRST truth: the host wall's declared assembly core (`wall.framingDepth`,
 * editor WS5) — the architect drew a 3-1/2" or 5-1/2" structural core, so
 * that IS the stud (IRC Table R602.3(5) rows). Only a wood/LGS core counts;
 * a CMU or ICF core is not a stud wall and falls through.
 *
 * FALLBACK (no assembly on the wall — pre-WS5 scenes, MCP-drawn walls): the
 * historical heuristic, total wall thickness >= `thickWallThreshold` -> the
 * exterior size. That heuristic is why an exterior 2x4 stack (5-3/16" total)
 * framed as 2x6 and then reported itself "compressed": total thickness
 * conflates finishes with the core. The assembly path removes the guess.
 */
export function studSizeFor(wall: WallSlice, spec: FramingSpec): LumberSize {
  // An explicit per-wall studSize override pins BOTH spec sizes (see
  // `specForWall`) — the user's stated size beats both the assembly and the
  // heuristic. With one size on the spec there is nothing to choose anyway.
  if (spec.interiorStudSize === spec.exteriorStudSize) return spec.interiorStudSize
  const declared = wall.framingDepth
  if (
    declared !== undefined &&
    (wall.framingKind === undefined || wall.framingKind === 'wood' || wall.framingKind === 'lgs')
  ) {
    for (const row of STUD_DEPTH_TO_SIZE) {
      if (Math.abs(declared - row.depth) <= STUD_DEPTH_TOLERANCE) return row.size
    }
    // A declared core that matches NO tabulated stud depth (a 2x8 wall, a
    // double-stud superinsulated wall, a metric core): fall through to the
    // heuristic rather than round it into a size the architect didn't draw.
  }
  return wall.thickness >= spec.thickWallThreshold ? spec.exteriorStudSize : spec.interiorStudSize
}

/**
 * Across-wall geometry depth that FITS the drawn wall: caps at the finish
 * cavity (thickness − 1") when the nominal depth overshoots by more than
 * the 2mm SAT-skin grace (the textbook 0.114m/2x4 partition stays
 * byte-equal). The stud-family analog of the S7 batt cap — members keep
 * their nominal size/label/takeoff identity; only the drawn geometry
 * compresses, landing the stud face exactly on the layer engine's
 * stackOrigin (night-4 Cavity-Fit design: 140 default-scene S1 pairs → 0).
 */
export function fitAcross(nominalDepth: number, wall: WallSlice): number {
  const cavity = wall.thickness - inches(1)
  return nominalDepth - cavity > 0.002 ? cavity : nominalDepth
}

/**
 * Per-wall engineering override the framing consumes — a projection of the
 * resolved WallOverride object (framing/compute.ts): stud size pins BOTH
 * spec sizes so the thickness heuristic can't argue, spacing replaces the
 * config's o.c. rhythm. Absent fields keep the spec untouched.
 */
export type WallFramingOverride = {
  studSize?: '2x4' | '2x6'
  /** o.c. spacing in inches — the IRC Table R602.3(5) columns (12|16|24). */
  spacingIn?: 12 | 16 | 24
  /** Wall construction when the caller knows it (compute passes its
   * resolved engineering map verbatim). frameHints uses it for exactly ONE
   * thing: cap-plate laps never cross a lumber↔steel ('lgs') corner — a
   * wood cap doesn't lap onto a steel top track, and a steel wall has no
   * cap to lap (LGS Phase 1). Absent = lumber assumed (byte-equal
   * default). */
  construction?: 'framed' | 'cmu' | 'lgs' | 'skip'
}

/**
 * The spec one wall frames with: the shared spec, unless the wall carries a
 * studSize/spacingIn override. Returns the SAME object when nothing is
 * overridden, so the default path stays byte-equal (and memo-friendly).
 */
export function specForWall(spec: FramingSpec, override?: WallFramingOverride): FramingSpec {
  if (!override || (override.studSize === undefined && override.spacingIn === undefined)) {
    return spec
  }
  return {
    ...spec,
    ...(override.studSize !== undefined
      ? { interiorStudSize: override.studSize, exteriorStudSize: override.studSize }
      : {}),
    ...(override.spacingIn !== undefined ? { studSpacing: inches(override.spacingIn) } : {}),
  }
}

/**
 * Cross-wall fabrication hints computed by `frameWalls` for one wall.
 * All distances in meters, u measured from the wall's `start`.
 */
export type FrameHints = {
  /**
   * Trim the whole framing RUN (plates + stud layout) at an end: a butting
   * wall's frame stops at the through wall's near FACE instead of running
   * to the centerline corner point (round-10 gate). Meters, ≥ 0.
   */
  startInset?: number
  endInset?: number
  /** Cap-plate length delta at the start end (+ extends past, − shortens). */
  capStartDelta?: number
  /** Cap-plate length delta at the end end. */
  capEndDelta?: number
  /** Extra full-height studs (California corner backing …). */
  extraStuds?: { u: number; label: string }[]
  /** Partition-backing ladder rows: flat blocks at `heights` centered on `u`. */
  backing?: { u: number; heights: number[] }[]
  /**
   * The wall bears on a concrete slab (ground level, slab-on-grade): the
   * BOTTOM plate is a sole plate in direct concrete contact and must be
   * preservative-treated or naturally durable wood — IRC R317.1(2). Only the
   * sole plate changes (material 'pt-lumber' + R317.1 label); studs, top and
   * cap plates bear on wood and stay untreated. Upper storeys (plates on a
   * framed floor) never set this. Set by `frameWalls` from its options —
   * compute.ts forwards the level's ground/slab context there (LOD-400
   * audit B5).
   */
  slabBearing?: boolean
  /**
   * A slabbed storey exists ABOVE this wall's level: the CS-PF portal
   * panel minimum widens to 24" (Figure R602.10.6.4, first-of-two-storeys
   * column — B9 round 2). Plumbed from compute's level list via
   * `FrameWallsOptions.storeyAbove`; ABSENT (standalone callers — tests,
   * the mixed-wall framed zone) means UNKNOWN → single-storey assumed and
   * the portal strap's advisory says so. `false` is a KNOWN single storey.
   */
  storeyAbove?: boolean
}

type Emit = (
  role: Member['role'],
  size: LumberSize,
  dims: [number, number, number],
  centerU: number,
  centerY: number,
  length: number,
  label?: string,
  flag?: string,
  material?: Member['material'],
) => void

/** Rough-opening vertical extent [bottom, top] above the subfloor. */
function roughExtent(opening: OpeningSlice): [number, number] {
  if (opening.kind === 'door') return [0, opening.roughHeight]
  return [opening.sillHeight, opening.sillHeight + opening.roughHeight]
}

/**
 * Frame one wall. Returns [] for curved walls (v1 — flagged upstream).
 */
export function frameWall(
  wall: WallSlice,
  spec: FramingSpec = DEFAULT_SPEC,
  hints: FrameHints = {},
): Member[] {
  if (wall.curved) return []
  const members: Member[] = []
  const { yaw, place } = frameOf(wall)
  const studSize = studSizeFor(wall, spec)
  const [t, w] = LUMBER_CROSS_SECTIONS[studSize] // t = 1.5", w = 3.5"/5.5"
  // Cavity-fit: geometry compresses to what the drawn wall holds (labels,
  // takeoff and cut lengths stay nominal). One exact flag string per
  // (size, thickness) class so Takeoff → Flags aggregates with a count.
  const wFit = fitAcross(w, wall)
  const compressionFlag =
    wFit < w
      ? `${studSize} framing compressed to ${formatIn(wFit)} — ${wall.thickness.toFixed(3)}m drawn wall holds ${formatIn(wFit)} + finishes; deepen to ${(w + inches(1)).toFixed(3)}m for full-depth ${studSize}`
      : undefined
  const len = wall.length
  const H = wall.height

  // Trimmed framing run: [u0, u1] — the centerline span minus corner/tee
  // insets, so a butting wall's plates and end stud stop at the through
  // wall's face.
  const u0 = Math.max(0, hints.startInset ?? 0)
  const u1 = Math.max(u0 + 4 * t, len - Math.max(0, hints.endInset ?? 0))
  const runLen = u1 - u0

  const emit: Emit = (role, size, dims, centerU, centerY, length, label, flag, material) => {
    members.push({
      system: 'wall-framing',
      role,
      size,
      dims,
      length,
      position: place(centerU, centerY),
      rotation: [0, yaw, 0],
      material: material ?? 'lumber',
      sourceId: wall.id,
      label,
      // Member-specific flags (engineered header, RO clamp) win; every
      // other member on a compressed wall carries the aggregate flag.
      flag: flag ?? compressionFlag,
    })
  }

  // ---- plates ----
  // Splice call-out: plate stock tops out at 20 ft — longer runs are built
  // from spliced sticks (min 24" lap on the double top plate, R602.3.2).
  // Splice call-out arithmetic (round-10): a run needs ceil(len/stock)
  // sticks and one fewer splices — the old floor()*20 read "40ft stock" on
  // a 40ft+ wall.
  const sticks = Math.ceil(runLen / PLATE_STOCK)
  const spliceNote =
    sticks > 1
      ? ` — spliced from ${sticks}× 20ft stock (${sticks - 1} splice${sticks > 2 ? 's' : ''}, min 24" lap)`
      : ''
  const plateDims: [number, number, number] = [runLen, t, wFit]
  const runMid = (u0 + u1) / 2
  // Slab-bearing sole plate (LOD-400 audit B5): untreated lumber in direct
  // concrete contact violates IRC R317.1(2) — the ground-level bottom plate
  // emits as PT stock (the takeoff's `<size> PT` SKU split books it on its
  // own row for free). The label carries the cite so paper says why.
  emit(
    'bottom-plate',
    studSize,
    plateDims,
    runMid,
    t / 2,
    runLen,
    hints.slabBearing ? `PT sole plate on slab (R317.1)${spliceNote}` : `Bottom plate${spliceNote}`,
    undefined,
    hints.slabBearing ? 'pt-lumber' : undefined,
  )
  emit('top-plate', studSize, plateDims, runMid, H - t / 2, runLen, `Top plate${spliceNote}`)
  if (spec.topPlateCount === 2) {
    // Cap plate: corner hints extend it over the abutting wall's top plate
    // (or pull it short so the neighbor's cap can lap over this one).
    const startDelta = hints.capStartDelta ?? 0
    const endDelta = hints.capEndDelta ?? 0
    const capLen = Math.max(0.1, runLen + startDelta + endDelta)
    // Start edge sits at u0 - startDelta, end edge at u1 + endDelta.
    const capMid = (u0 - startDelta + u1 + endDelta) / 2
    emit(
      'cap-plate',
      studSize,
      [capLen, t, wFit],
      capMid,
      H - t - t / 2,
      capLen,
      `Cap plate${spliceNote}${startDelta > 0 || endDelta > 0 ? ' — laps corner' : ''}`,
    )
  }

  const studBottom = t
  const studTop = H - (spec.topPlateCount === 2 ? 2 * t : t)
  const studHeight = studTop - studBottom
  if (studHeight <= t) return members // degenerate pony wall — plates only

  const studDims: [number, number, number] = [t, studHeight, wFit]
  const halfT = t / 2

  // ---- high-wind uplift path (LOD-400 B10) ----
  // ≥130 mph (spec.highWindUplift, applyJurisdiction) the roof's hurricane
  // ties are only the FIRST link — R802.11/WFCM want the uplift carried
  // stud → plate → foundation. Exterior walls book the continuation as
  // symbolic surface steel (S13, the B9 portal-strap convention): honest
  // 'install per schedule' labels, capacity/nailing per WFCM stated as not
  // modeled. Interior partitions carry no roof uplift — no hardware.
  const uplift = spec.highWindUplift && wall.exterior
  /** Every full-height vertical (grid stud / king / portal post / corner
   * backing) collects here — one stud-to-plate connector each (census). */
  const upliftVerticalUs: number[] = []
  const surfaceSteel = (
    role: Member['role'],
    u: number,
    y0: number,
    y1: number,
    label: string,
    advisory: string,
  ): void => {
    members.push({
      system: 'wall-framing',
      role,
      dims: [UPLIFT_STRAP_WIDTH, y1 - y0, UPLIFT_STEEL_THICKNESS],
      length: y1 - y0,
      position: place(u, (y0 + y1) / 2, -(wFit / 2 + UPLIFT_STEEL_THICKNESS / 2)),
      rotation: [0, yaw, 0],
      material: 'steel',
      sourceId: wall.id,
      label,
      advisory,
    })
  }

  // ---- opening frames (kings / trimmers / header / sill / cripples) ----
  type KeepOut = { min: number; max: number }
  const keepOuts: KeepOut[] = []

  // Frame geometry of every opening, resolved BEFORE the emission loop: the
  // bracing pass (R602.10, LOD-400 B9) must know whether the segment between
  // an opening and the run end contains ANOTHER opening — that segment is an
  // inter-opening pier, not a return. Same math as before, computed once.
  const openingFrames = wall.openings.flatMap((opening) => {
    const ro = Math.min(opening.roughWidth, runLen - 4 * t)
    if (ro <= 0) return []
    // Openings past 6 ft bear on DOUBLE trimmers (jack studs) per side —
    // header reactions grow with span (R602.7.5 jack stud requirements).
    const trimmersPerSide: 1 | 2 = ro > DOUBLE_TRIMMER_SPAN ? 2 : 1
    const frameSide = trimmersPerSide * t
    const u = Math.min(
      Math.max(opening.u, u0 + ro / 2 + frameSide + t),
      u1 - ro / 2 - frameSide - t,
    )
    return [{ opening, ro, trimmersPerSide, frameSide, u }]
  })
  // Portal hold-down posts already placed on this wall (cross-opening
  // conflict awareness) — see the bracing block below.
  const portalPostUs: number[] = []
  /** Every co-planar surface-steel piece already emitted on this wall's
   * face (B9 portal straps at kings, B10 opening straps at trimmers,
   * placed connectors) — u plus vertical extent. The B10 stud-to-plate
   * connector dodges pieces it would actually touch — two flat steel
   * pieces never share a drawn spot (HI: seismic AND high-wind puts a
   * portal strap on the exact king the connector would ride, reaching
   * studTop when the header fills the depth). */
  const surfaceSpots: { u: number; y0: number; y1: number }[] = []
  const clampedExtraStudUs = (hints.extraStuds ?? []).map((e) =>
    Math.min(Math.max(e.u, u0 + halfT), u1 - halfT),
  )

  for (const { opening, ro, trimmersPerSide, frameSide, u } of openingFrames) {
    // The drawn opening doesn't fit where it was placed — the frame slid it
    // to clear the wall end / corner. Surface that instead of silently
    // moving the RO (round-10).
    const roClampFlag =
      Math.abs(u - opening.u) > 0.005
        ? `RO shifted ${((u - opening.u) * 100).toFixed(1)}cm to fit the framed run — verify the drawn position`
        : undefined
    const [roBottom, roTopRaw] = roughExtent(opening)
    const roTop = Math.min(roTopRaw, studTop - t) // leave room for the header
    // The vertical clamp fact (LOD-400 audit B1): a drawn RO taller than
    // the framed run fits gets its head pulled DOWN. Folded into the depth
    // flag below — whenever the head clamps, the header depth also
    // collapses (min(hw, t)), so a separate branch was dead code (verify
    // night-6: zero prints across a 115-case sweep).
    const roHeadClampCm = roTopRaw - roTop > 0.005 ? (roTopRaw - roTop) * 100 : 0

    // Header: bears on the trimmers, so it spans RO + trimmer packs.
    const headerSize = headerFor(spec, ro)
    const [ht, hw] = LUMBER_CROSS_SECTIONS[headerSize]
    const headerLength = ro + 2 * frameSide
    const headerDepth = Math.min(hw, studTop - roTop)
    const headerY = roTop + headerDepth / 2
    const engineered = ro > spec.engineeredHeaderSpan
    // LOD-400 audit B1 (blocker): when the RO crowds the plates the header
    // collapsed to a 1.5" sliver while the takeoff booked the full 4x8 —
    // booked-but-absent. The geometry stays honest; the flag says what a
    // builder must do about it (the over-SPAN case has its own flag).
    const headerDepthFlag =
      headerDepth < hw - 0.005
        ? `header ${headerSize} does not fit between the RO and the plates ` +
          `(${(headerDepth / 0.0254).toFixed(1)}" of ${(hw / 0.0254).toFixed(1)}")` +
          (roHeadClampCm > 0 ? ` — RO head lowered ${roHeadClampCm.toFixed(1)}cm` : '') +
          ` — raise the wall, lower the opening, or use an engineered flat header`
        : undefined
    // COMPOSE the applicable truths (verify night-6: single-slot precedence
    // silenced round-10's roClampFlag whenever depth collapsed, and an
    // ENGINEERED span hid the depth collapse while the takeoff booked the
    // full stick — a warning silently dropped is a lie on paper, P4).
    const headerFlagParts = [
      engineered ? 'ENGINEERED BEAM REQUIRED — exceeds prescriptive header span' : undefined,
      headerDepthFlag,
      roClampFlag,
    ].filter((f): f is string => f !== undefined)
    // An over-span header is a supplier SKU, not the prescriptive stick —
    // material 'engineered' routes it to the takeoff's by-supplier line
    // (verify night-6 PARTIAL: the buy list booked a full 4x12 + 48 bd-ft
    // for a member the flag itself says must be replaced).
    // Heavy-snow bands size from Table R602.7(1)'s snow columns (LOD-400
    // B11), which also key on BUILDING WIDTH — the spec doesn't carry it,
    // so every band-sized header states the assumption on its label
    // (label, never a guess; unset in the low-snow band → byte-equal).
    const headerAssumption = spec.headerAssumption ? ` — ${spec.headerAssumption}` : ''
    emit(
      'header',
      headerSize,
      [headerLength, headerDepth, fitAcross(Math.min(ht, wall.thickness), wall)],
      u,
      headerY,
      headerLength,
      engineered
        ? `Engineered header over ${opening.kind} (drawn as ${headerSize} — size by supplier)${headerAssumption}`
        : `Header ${headerSize} over ${opening.kind}${headerAssumption}`,
      headerFlagParts.length > 0 ? headerFlagParts.join(' | ') : undefined,
      engineered ? 'engineered' : undefined,
    )

    // ---- wall bracing at the returns (R602.10, LOD-400 B9 v1) ----
    // A wide opening (clear span ≥ 6 ft — where R602.10.6.4's CS-PF
    // header-span range starts) whose RETURN to the run end is shorter than
    // the 48" braced-panel minimum (Table R602.10.5, WSP baseline) is
    // portal-frame territory. SDC D+ (spec.seismicHoldDowns) builds the
    // CS-PF member set when the return can host it (≥ the Table R602.10.5
    // CS-PF minimum: 16"/18"/20" by wall height, snapped up); anything the
    // geometry can't host — or a low-seismic jurisdiction where v1 doesn't
    // model the hardware — gets an explicit flag on the king stud. NEVER
    // plain kings+trimmers silently.
    type ReturnBracing = { kingFlag?: string; portal?: { postUs: number[] } }
    const bracingOf = (side: -1 | 1): ReturnBracing => {
      if (spec.detail === '200' || !wall.exterior || ro < PORTAL_OPENING_MIN_SPAN) return {}
      const kingU = u + side * (ro / 2 + frameSide + halfT)
      const edge = u + side * (ro / 2 + frameSide + t) // outer king face
      const panelMin = side === -1 ? u0 : edge
      const panelMax = side === -1 ? edge : u1
      const panel = panelMax - panelMin
      // Another opening inside the interval → inter-opening pier, not a
      // return. v1 doesn't evaluate piers — say so instead of guessing.
      const pier = openingFrames.some((f) => {
        if (f.opening.id === opening.id) return false
        const fMin = f.u - f.ro / 2 - f.frameSide - t
        const fMax = f.u + f.ro / 2 + f.frameSide + t
        return fMax > panelMin + EPS && fMin < panelMax - EPS
      })
      if (pier) {
        return {
          kingFlag: `wall ${wall.id}: bracing between adjacent openings not evaluated (v1) — verify R602.10 braced panel beside the ${formatIn(ro)} opening`,
        }
      }
      if (panel >= BRACED_PANEL_MIN_LENGTH) return {} // a full braced panel fits
      if (!spec.seismicHoldDowns) {
        // Low-seismic v1: honest flag, no invented hardware — R602.10 still
        // applies everywhere, but only SDC D+ models the portal set.
        return {
          kingFlag:
            `wall ${wall.id}: narrow ${formatIn(panel)} return beside ${formatIn(ro)} opening — under the 48" ` +
            `braced-panel minimum (Table R602.10.5); portal frame (R602.10.6.4) or engineered ` +
            `bracing required — not modeled`,
        }
      }
      // CS-PF DOMAIN (skeptic round 1): the portal method ends at 10-ft wall
      // height — Table R602.10.5's column stops at 20" @ 10 ft and Figure
      // R602.10.6.4 caps the frame there. A taller SDC-D wall gets the
      // engineered flag, never extrapolated hardware (an unflagged portal
      // set outside the table is an implicit compliance claim).
      const minBase = portalMinPanelWidth(H)
      if (minBase === null) {
        return {
          kingFlag:
            `wall ${wall.id}: ⚠ portal frame required — not modeled: ${formatFtIn(H)} wall exceeds ` +
            `the 10 ft CS-PF maximum height (Figure R602.10.6.4) — engineered shear wall required`,
        }
      }
      // Figure R602.10.6.4, first-of-two-storeys column: under a SECOND
      // storey the portal panel minimum widens to 24". compute plumbs the
      // real storey context (FrameHints.storeyAbove); an ABSENT hint is a
      // standalone caller — single-storey ASSUMED, stated on the strap
      // advisory below.
      const minW = hints.storeyAbove === true ? Math.max(minBase, inches(24)) : minBase
      if (panel < minW) {
        return {
          kingFlag:
            `wall ${wall.id}: ⚠ portal frame required — not modeled: ${formatIn(panel)} return beside ` +
            `${formatIn(ro)} opening is under the ${formatIn(minW)} CS-PF minimum ` +
            `(Table R602.10.5${hints.storeyAbove === true ? ' — 24" under a second storey, Figure R602.10.6.4' : ''}) — engineered shear wall required`,
        }
      }
      // CS-PF portal set fits: hold-down end posts DOUBLE the existing panel
      // edge studs — one new full-height post beside the king stud, one
      // beside the run-end stud. Posts dodge California-corner backing studs
      // and other portal posts by sliding one thickness toward the panel
      // interior; a return too congested to host them flags instead.
      const resolvePost = (start: number, dir: -1 | 1): number | null => {
        let p = start
        for (let tries = 0; tries < 4; tries++) {
          const clash = [...clampedExtraStudUs, ...portalPostUs].some(
            (o) => Math.abs(o - p) < 2 * halfT - EPS,
          )
          if (!clash && p > panelMin + halfT - EPS && p < panelMax - halfT + EPS) return p
          p += dir * t
        }
        return null
      }
      const besideKing = resolvePost(kingU + side * t, side)
      const endStudU = side === -1 ? u0 + halfT : u1 - halfT
      const besideEnd = resolvePost(endStudU - side * t, -side as -1 | 1)
      if (besideKing === null || besideEnd === null || Math.abs(besideKing - besideEnd) < t) {
        return {
          kingFlag: `wall ${wall.id}: ⚠ portal frame required — not modeled: ${formatIn(panel)} return too congested for CS-PF hold-down posts (R602.10.6.4) — verify detail`,
        }
      }
      portalPostUs.push(besideKing, besideEnd)
      return { portal: { postUs: [besideKing, besideEnd] } }
    }
    const bracing: Record<'-1' | '1', ReturnBracing> = {
      '-1': bracingOf(-1),
      '1': bracingOf(1),
    }

    // Trimmers (jack studs): floor plate → header bottom, tight to the RO.
    const trimmerHeight = roTop - studBottom
    const trimmerDims: [number, number, number] = [t, trimmerHeight, wFit]
    for (const side of [-1, 1] as const) {
      for (let k = 0; k < trimmersPerSide; k++) {
        emit(
          'trimmer',
          studSize,
          trimmerDims,
          u + side * (ro / 2 + halfT + k * t),
          studBottom + trimmerHeight / 2,
          trimmerHeight,
          trimmersPerSide === 2 ? 'Trimmer (doubled — RO > 6 ft)' : undefined,
        )
      }
    }

    // King studs: full height, outside the trimmer pack. A king at a
    // bracing-flagged return CARRIES that flag (composed with the wall's
    // aggregate compression flag — a flag silently dropped is a lie, P4).
    for (const side of [-1, 1] as const) {
      const kingFlag = bracing[String(side) as '-1' | '1'].kingFlag
      const kingU = u + side * (ro / 2 + frameSide + halfT)
      if (uplift) upliftVerticalUs.push(kingU)
      emit(
        'king-stud',
        studSize,
        studDims,
        kingU,
        studBottom + studHeight / 2,
        studHeight,
        undefined,
        kingFlag !== undefined && compressionFlag !== undefined
          ? `${kingFlag} | ${compressionFlag}`
          : kingFlag,
      )
    }

    // Header/king uplift straps (B10 b): the header's uplift reaction lands
    // on the jack pack — one strap per side at the INNERMOST trimmer line
    // (the stick the header bears on), lapping header side and trimmer.
    // Deliberately NOT at the king line: B9's CS-PF portal strap mounts
    // there on SDC-D + high-wind states (HI) — two hardware pieces never
    // share one drawn spot.
    if (uplift) {
      const strapBottom = Math.max(studBottom, roTop - inches(12))
      const strapTop = Math.min(studTop, roTop + Math.max(headerDepth, inches(3)))
      if (strapTop - strapBottom > inches(6)) {
        for (const side of [-1, 1] as const) {
          surfaceSpots.push({ u: u + side * (ro / 2 + halfT), y0: strapBottom, y1: strapTop })
          surfaceSteel(
            'uplift-strap',
            u + side * (ro / 2 + halfT),
            strapBottom,
            strapTop,
            `Header uplift strap over ${opening.kind} — high-wind (WFCM) — install per strapping schedule`,
            'high-wind uplift v1 — surface hardware, symbolic: coil-strap-class header-to-jack tie ' +
              'on the framing face; uplift capacity + nailing per the WFCM/manufacturer schedule, not modeled',
          )
        }
      }
    }

    // Portal member set (CS-PF, R602.10.6.4) where the analysis above fits
    // one: hold-down end posts as doubled studs + the 1000-lb header-to-jack
    // strap at the panel's opening edge. The strap is SURFACE hardware —
    // ~1.2 mm flat steel against the framing face (under the 2 mm SAT skin,
    // never inside a stud volume); its label carries the cite, its advisory
    // says what v1 does not model.
    for (const side of [-1, 1] as const) {
      const portal = bracing[String(side) as '-1' | '1'].portal
      if (!portal) continue
      for (const pu of portal.postUs) {
        if (uplift) upliftVerticalUs.push(pu)
        emit(
          'post',
          studSize,
          studDims,
          pu,
          studBottom + studHeight / 2,
          studHeight,
          'Portal hold-down post (doubled stud) — CS-PF (R602.10.6.4)',
        )
        // Grid studs yield to the posts (contact allowed, overlap never).
        keepOuts.push({ min: pu - t + EPS, max: pu + t - EPS })
      }
      const kingU = u + side * (ro / 2 + frameSide + halfT)
      const strapBottom = Math.max(studBottom, roTop - inches(12))
      const strapTop = Math.min(studTop, roTop + Math.max(headerDepth, inches(3)))
      const strapLen = strapTop - strapBottom
      if (strapLen > inches(6)) {
        surfaceSpots.push({ u: kingU, y0: strapBottom, y1: strapTop })
        members.push({
          system: 'wall-framing',
          role: 'strap',
          dims: [inches(1.25), strapLen, PORTAL_STRAP_THICKNESS],
          length: strapLen,
          position: place(
            kingU,
            (strapBottom + strapTop) / 2,
            -(wFit / 2 + PORTAL_STRAP_THICKNESS / 2),
          ),
          rotation: [0, yaw, 0],
          material: 'steel',
          sourceId: wall.id,
          label: 'Portal strap 1000 lb — header to jack (CS-PF, R602.10.6.4)',
          // Symbolic surface hardware (examiner round 1): the box mounts on
          // the −v framing face regardless of which side is exterior and
          // laps the king at the face plane — placement is schematic, the
          // figure's nail schedule governs the install.
          advisory:
            'CS-PF v1 — surface strap, symbolic: install per the Figure R602.10.6.4 nail schedule; ' +
            'panel sheathing nailing and header continuation to the wall end not modeled' +
            (hints.storeyAbove === undefined
              ? '; single-storey assumed (24" min panel under a second storey)'
              : '') +
            '; verify portal detail',
        })
      }
    }

    // Cripples above the header, continuing the common-stud rhythm.
    const crippleTopHeight = studTop - (roTop + headerDepth)
    if (crippleTopHeight > t) {
      const crippleDims: [number, number, number] = [t, crippleTopHeight, wFit]
      for (const cu of studPositions(len, spec.studSpacing, halfT)) {
        if (Math.abs(cu - u) < ro / 2 - halfT) {
          emit(
            'cripple',
            studSize,
            crippleDims,
            cu,
            roTop + headerDepth + crippleTopHeight / 2,
            crippleTopHeight,
          )
        }
      }
    }

    // Windows: rough sill + cripples below it.
    if (opening.kind === 'window' && roBottom > studBottom + t) {
      const sillY = roBottom - t / 2
      emit('sill', studSize, [ro, t, wFit], u, sillY, ro, 'Rough sill')
      const crippleBottomHeight = roBottom - t - studBottom
      if (crippleBottomHeight > t) {
        const crippleDims: [number, number, number] = [t, crippleBottomHeight, wFit]
        const cus = new Set<number>()
        for (const cu of studPositions(runLen, spec.studSpacing, halfT)) {
          if (Math.abs(cu + u0 - u) < ro / 2 - halfT) cus.add(cu + u0)
        }
        cus.add(u - ro / 2 + halfT)
        cus.add(u + ro / 2 - halfT)
        for (const cu of cus) {
          emit(
            'cripple',
            studSize,
            crippleDims,
            cu,
            studBottom + crippleBottomHeight / 2,
            crippleBottomHeight,
          )
        }
      }
    }

    // The opening's keep-out is the king's OUTER FACE plus half a stud: a
    // grid stud is dropped when its BODY would overlap the king, not merely
    // when its center falls inside the frame (a center 1" outside the king
    // face still buries 1/2" of stud in it — the SAT gate caught exactly
    // that once the layout moved onto the true 16" module). Contact is
    // allowed, overlap never.
    keepOuts.push({
      min: u - ro / 2 - frameSide - t - halfT + EPS,
      max: u + ro / 2 + frameSide + t + halfT - EPS,
    })
  }

  // ---- common studs at o.c. spacing (ends always get a stud) ----
  // IRC 2021 Table R602.3(5) governs: studs are laid out at a FIXED
  // on-center spacing measured from the wall start along the plate — one of
  // the table's three columns (24" / 16" / 12", 16" the field default) —
  // with a stud at each end of the framed run. `studPositions` is that
  // layout; it never divides the wall length into equal bays (which would
  // put studs off the 16" module and break sheathing/gypsum joints, which
  // land on 48" multiples of the module per Table R602.3(3)).
  // Stud DEPTH follows the wall's declared assembly core (`studSizeFor`
  // above): 3-1/2" for 2x4, 5-1/2" for 2x6; width is 1-1/2" for both
  // (PS 20 dressed sizes, `LUMBER_CROSS_SECTIONS`).
  const studUs = studPositions(runLen, spec.studSpacing, halfT).map((su) => su + u0)
  for (const su of studUs) {
    if (keepOuts.some((k) => su > k.min && su < k.max)) continue
    if (uplift) upliftVerticalUs.push(su)
    emit('stud', studSize, studDims, su, studBottom + studHeight / 2, studHeight)
  }

  // ---- cross-wall extras (California corner backing studs) ----
  for (const extra of hints.extraStuds ?? []) {
    const eu = Math.min(Math.max(extra.u, u0 + halfT), u1 - halfT)
    if (uplift) upliftVerticalUs.push(eu)
    emit('stud', studSize, studDims, eu, studBottom + studHeight / 2, studHeight, extra.label)
  }

  // ---- high-wind uplift hardware (B10 a + c) ----
  if (uplift) {
    // (a) ONE stud-to-plate connector at every full-height vertical's top —
    // the wall-side mirror of the roof's per-rafter tieAt booking. Coverage
    // is therefore the stud rhythm itself (o.c. spacing), stated on the
    // takeoff row. Co-planar surface steel never shares a drawn spot: a
    // connector whose spot is taken (a B9 portal strap on that exact king,
    // an opening strap, a neighbor's connector) walks a DETERMINISTIC
    // ±1, ±2, ±3 strap-width ladder — away from the run middle first —
    // until clear (the GES dodge-ladder convention); side-by-side is the
    // real install. An undodgeable spot keeps its position (census over
    // geometry — the S1 compose gate owns the proof that this never
    // happens on real frames).
    const cBottom = studTop - UPLIFT_CONNECTOR_HEIGHT / 2
    const cTop = Math.min(H, studTop + UPLIFT_CONNECTOR_HEIGHT / 2)
    const clearOf = (p: number): boolean =>
      surfaceSpots.every(
        (s) => Math.abs(s.u - p) >= UPLIFT_STRAP_WIDTH - EPS || s.y1 <= cBottom || s.y0 >= cTop,
      ) &&
      p >= u0 + UPLIFT_STRAP_WIDTH / 2 - EPS &&
      p <= u1 - UPLIFT_STRAP_WIDTH / 2 + EPS
    for (const cu of upliftVerticalUs) {
      let target = cu
      if (!clearOf(target)) {
        const dir = cu <= runMid ? -1 : 1
        for (const k of [1, -1, 2, -2, 3, -3]) {
          const candidate = cu + dir * k * UPLIFT_STRAP_WIDTH
          if (clearOf(candidate)) {
            target = candidate
            break
          }
        }
      }
      surfaceSpots.push({ u: target, y0: cBottom, y1: cTop })
      surfaceSteel(
        'uplift-connector',
        target,
        studTop - UPLIFT_CONNECTOR_HEIGHT / 2,
        Math.min(H, studTop + UPLIFT_CONNECTOR_HEIGHT / 2),
        'Stud-to-plate connector — high-wind uplift (R802.11 path / WFCM) — install per strapping schedule',
        'high-wind uplift v1 — surface hardware, symbolic: H2.5-class stud-to-plate connector on the ' +
          'framing face regardless of exterior side; uplift capacity + nailing per the WFCM/manufacturer ' +
          'schedule, not modeled',
      )
    }
    // (c) plate-to-foundation straps: only where the plate actually bears
    // on concrete (hints.slabBearing — the same context that makes it a PT
    // sole plate, B5). 48" o.c. with guaranteed end coverage
    // (studPositions' own contract), skipping door ROs — the plate is
    // interrupted there and a strap would anchor nothing (the S12 lesson).
    // Straps that land where a foundation J-bolt/HDU already anchors are
    // DEDUPED by compute (`dedupeFoundationStraps`) — one anchorage point,
    // one booking.
    if (hints.slabBearing) {
      const doorSpans = openingFrames
        .filter((f) => f.opening.kind === 'door')
        .map((f) => [f.u - f.ro / 2, f.u + f.ro / 2] as const)
      for (const su of studPositions(runLen, FOUNDATION_STRAP_SPACING, halfT)) {
        const fu = su + u0
        if (doorSpans.some(([a, b]) => fu > a && fu < b)) continue
        surfaceSteel(
          'foundation-strap',
          fu,
          0,
          FOUNDATION_STRAP_HEIGHT,
          'Plate-to-foundation uplift strap — high-wind (WFCM) — install per strapping schedule',
          'high-wind uplift v1 — surface hardware, symbolic: plate-to-foundation strap drawn to the ' +
            'slab line; concrete anchorage/embedment per the WFCM/manufacturer schedule, not modeled',
        )
      }
    }
  }

  // ---- partition backing at tees (ladder blocking, flat 2x) ----
  for (const tee of hints.backing ?? []) {
    // Flat blocks CLIPPED to the actual stud bay around the tee (round-10:
    // a nominal-bay block swallowed the grid stud inside it). Wide face out
    // so drywall on both sides of the abutting partition has bite.
    const uu = Math.min(Math.max(tee.u, u0 + t), u1 - t)
    const left = Math.max(u0 + halfT, ...studUs.filter((su) => su < uu - EPS))
    const right = Math.min(u1 - halfT, ...studUs.filter((su) => su > uu + EPS))
    const blockLen = right - left - t
    if (blockLen < inches(3)) continue
    const bu = (left + right) / 2
    for (const y of tee.heights) {
      if (y > studTop - t) continue
      emit('backing', studSize, [blockLen, t, wFit], bu, y, blockLen, 'Partition backing (ladder)')
    }
  }

  // ---- fire blocking (LOD 400): cap concealed cavities every ≤10 ft ----
  // R302.11(2): max 10 ft vertical intervals — a 22 ft balloon wall needs
  // TWO rows, not one (round-10).
  if (spec.detail === '400') {
    const bay = spec.studSpacing - t
    for (let rowY = FIRE_BLOCK_HEIGHT; rowY < studTop - t; rowY += FIRE_BLOCK_HEIGHT) {
      for (let i = 0; i + 1 < studUs.length; i++) {
        const a = studUs[i] as number
        const b = studUs[i + 1] as number
        const mid = (a + b) / 2
        if (keepOuts.some((k) => mid > k.min && mid < k.max)) continue
        const blockLen = Math.min(bay, b - a - t)
        if (blockLen < inches(3)) continue
        emit(
          'fire-blocking',
          studSize,
          [blockLen, t, wFit],
          mid,
          rowY,
          blockLen,
          'Fire blocking @ 10ft (R302.11)',
        )
      }
    }
  }

  return members
}

/**
 * Common-stud center positions: layout on o.c. centers from the wall start,
 * clamped inside the wall, with a guaranteed end stud and NO bay wider than
 * the o.c. spacing — a grid stud that collides with the end stud is pulled
 * adjacent to it rather than dropped (the round-1 reviewer proved dropping
 * it opened a 25.5" bay at 24" o.c.).
 */
export function studPositions(length: number, spacing: number, halfT: number): number[] {
  const out: number[] = []
  const endU = length - halfT
  // End stud: its OUTSIDE face flush with the start of the plate, so its
  // center sits half a stud in.
  out.push(halfT)
  // Grid studs on the MODULE — centers at exact multiples of the o.c.
  // spacing measured from the wall start (16", 32", 48" …), not offset by
  // the end stud's half thickness. This is the layout IRC Table R602.3(5)'s
  // spacing column means and the one 4 ft sheet goods need: a 48"/96" panel
  // edge lands ON a stud center (Table R602.3(3) fastening at panel edges),
  // which an end-stud-offset rhythm (0.75", 16.75", 32.75" …) misses.
  for (let u = spacing; u < endU - EPS; u += spacing) {
    if (u - halfT > 2 * halfT - EPS) out.push(u)
  }
  out.push(endU)
  // Resolve collisions at the end: if the last grid stud sits within one stud
  // thickness of the end stud, snug it against the end stud instead of
  // dropping it — the bay before it stays <= spacing.
  if (out.length >= 2) {
    const last = out[out.length - 1] as number
    const prev = out[out.length - 2] as number
    if (last - prev <= 2 * halfT + EPS) {
      const snug = last - 2 * halfT
      // Only keep the snugged stud if it still clears the stud before it.
      const before = out.length >= 3 ? (out[out.length - 3] as number) : Number.NEGATIVE_INFINITY
      if (snug - before > 2 * halfT) out[out.length - 2] = snug
      else out.splice(out.length - 2, 1)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Cross-wall fabrication: corners, tees, cap laps
// ---------------------------------------------------------------------------

type Corner = {
  through: WallSlice
  butting: WallSlice
  /** Which end of each wall meets the corner. */
  throughEnd: 'start' | 'end'
  buttingEnd: 'start' | 'end'
}

const endPoint = (wall: WallSlice, which: 'start' | 'end'): readonly [number, number] =>
  which === 'start' ? wall.start : wall.end

/**
 * Detect L-corners: two walls whose endpoints coincide (within the larger
 * wall thickness). The LONGER wall runs through the corner (tie: lower id) —
 * a deterministic, testable convention.
 */
export function detectCorners(walls: WallSlice[]): Corner[] {
  const corners: Corner[] = []
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i] as WallSlice
      const b = walls[j] as WallSlice
      const tol = Math.max(a.thickness, b.thickness) * 0.75
      for (const ea of ['start', 'end'] as const) {
        for (const eb of ['start', 'end'] as const) {
          const pa = endPoint(a, ea)
          const pb = endPoint(b, eb)
          if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > tol) continue
          // Parallel walls butting end-to-end are a splice, not a corner.
          const cross = Math.abs(a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0])
          if (cross < 0.3) continue
          const aThrough = a.length > b.length || (a.length === b.length && a.id <= b.id)
          corners.push({
            through: aThrough ? a : b,
            butting: aThrough ? b : a,
            throughEnd: aThrough ? ea : eb,
            buttingEnd: aThrough ? eb : ea,
          })
        }
      }
    }
  }
  return corners
}

type Tee = { through: WallSlice; u: number; stem: WallSlice; stemEnd: 'start' | 'end' }

/**
 * Detect T-joints: a wall endpoint landing on another wall's run (not near
 * its ends). The through wall receives partition backing there.
 */
export function detectTees(walls: WallSlice[]): Tee[] {
  const tees: Tee[] = []
  for (const partition of walls) {
    for (const which of ['start', 'end'] as const) {
      const p = endPoint(partition, which)
      for (const through of walls) {
        if (through.id === partition.id) continue
        // Parallelism filter (mirrors detectCorners' splice guard): a
        // back-to-back PARALLEL wall offset by ~a thickness is a drawing
        // artifact, not a tee — without this it registered with sinθ≈0,
        // hit the 0.2 floor and silently ate 0.57m of run per end
        // (night-5 skeptic d2, NEW regression class).
        const cross = Math.abs(
          partition.dir[0] * through.dir[1] - partition.dir[1] * through.dir[0],
        )
        if (cross < 0.3) continue
        const [ax, az] = through.start
        const proj = (p[0] - ax) * through.dir[0] + (p[1] - az) * through.dir[1]
        if (proj < through.thickness || proj > through.length - through.thickness) continue
        const foot: [number, number] = [ax + through.dir[0] * proj, az + through.dir[1] * proj]
        const dist = Math.hypot(p[0] - foot[0], p[1] - foot[1])
        if (dist > (through.thickness + partition.thickness) / 2 + EPS) continue
        tees.push({ through, u: proj, stem: partition, stemEnd: which })
      }
    }
  }
  return tees
}

/**
 * Cross-wall fabrication hints for a SET of walls — the corner/tee pass
 * frameWalls runs before framing each wall. Exported so the layer engine's
 * insulation batts can lay out against the SAME trimmed runs and backing
 * bays the studs actually occupy (wall-layers.ts) instead of re-deriving a
 * diverging approximation. Per-wall studSize overrides feed the corner
 * arithmetic exactly like the framing pass.
 */
export function frameHints(
  walls: WallSlice[],
  spec: FramingSpec = DEFAULT_SPEC,
  overrides?: ReadonlyMap<string, WallFramingOverride>,
): Map<string, FrameHints> {
  const hints = new Map<string, FrameHints>()
  const hintFor = (wall: WallSlice): FrameHints => {
    let h = hints.get(wall.id)
    if (!h) {
      h = {}
      hints.set(wall.id, h)
    }
    return h
  }
  const wallSpec = (wall: WallSlice): FramingSpec => specForWall(spec, overrides?.get(wall.id))

  for (const corner of detectCorners(walls)) {
    const { through, butting, throughEnd, buttingEnd } = corner
    const [tt] = LUMBER_CROSS_SECTIONS[studSizeFor(through, wallSpec(through))]
    // California 3-stud corner: the through wall's end stud + the butting
    // wall's end stud + ONE backing stud in the through wall, set past the
    // butting wall's far face so interior drywall has backing.
    const setback = butting.thickness + tt / 2
    const throughHints = hintFor(through)
    throughHints.extraStuds = throughHints.extraStuds ?? []
    throughHints.extraStuds.push({
      u: throughEnd === 'start' ? setback : through.length - setback,
      label: 'California corner backing',
    })
    // Cap-plate lap: the through wall's cap runs OVER the butting wall's top
    // plate (extend by half the butting thickness past the corner); the
    // butting wall's cap pulls short so the two caps butt instead of
    // colliding. The pull-back clears whichever is wider — the through
    // wall's drawn thickness or its CAP PLATE width (a 2x4 cap is 3.5" wide,
    // so walls drawn thinner than that would otherwise still collide —
    // round-2 advisory).
    const [, throughCapW] = LUMBER_CROSS_SECTIONS[studSizeFor(through, wallSpec(through))]
    // Oblique multiplier (round-14, ported from foundation): perpendicular
    // corners give k = 1; at 20–60° the square-cut run must retreat
    // (1+|cosθ|)/sinθ half-thicknesses to clear the through wall's sloped
    // face, and the cap lap extends the same factor. Capped at 4.
    const crossD = Math.abs(through.dir[0] * butting.dir[1] - through.dir[1] * butting.dir[0])
    const dotD = Math.abs(through.dir[0] * butting.dir[0] + through.dir[1] * butting.dir[1])
    const k = crossD < 0.1 ? 1 : Math.min(4, (1 + dotD) / crossD)
    const extend = (k * butting.thickness) / 2
    // The butting RUN already stops at the through face (startInset below);
    // the cap only needs the EXCESS when the through cap is wider than the
    // through wall itself (thin drawn walls — round-2 advisory).
    const shorten = -Math.max(0, (k * (throughCapW - through.thickness)) / 2)
    // Cap laps are a LUMBER-to-lumber corner detail: a steel (LGS) wall
    // has no cap plate to extend, and a wood cap extended OVER a steel
    // wall would run through its full-height C-studs (steel studs seat in
    // the top track at ~H, not under a double plate). Mixed-material
    // corners keep the run insets + California backing; the caps stay
    // home (LGS Phase 1). All-lumber corners are byte-untouched.
    const steelCorner =
      overrides?.get(through.id)?.construction === 'lgs' ||
      overrides?.get(butting.id)?.construction === 'lgs'
    if (!steelCorner) {
      if (throughEnd === 'start')
        throughHints.capStartDelta = (throughHints.capStartDelta ?? 0) + extend
      else throughHints.capEndDelta = (throughHints.capEndDelta ?? 0) + extend
      const buttingHints = hintFor(butting)
      if (buttingEnd === 'start')
        buttingHints.capStartDelta = (buttingHints.capStartDelta ?? 0) + shorten
      else buttingHints.capEndDelta = (buttingHints.capEndDelta ?? 0) + shorten
    }
    const buttingHints = hintFor(butting)
    // The butting wall's PLATES and end stud stop at the through wall's
    // near face — k half-thicknesses back from the centerline corner
    // (round-10 gate; round-14 obliques).
    const inset = (k * through.thickness) / 2
    if (buttingEnd === 'start')
      buttingHints.startInset = Math.max(buttingHints.startInset ?? 0, inset)
    else buttingHints.endInset = Math.max(buttingHints.endInset ?? 0, inset)
  }

  // Partition backing at tees (skip when it duplicates a corner) — and the
  // partition's own frame stops at the through wall's face, exactly like a
  // corner butt.
  for (const tee of detectTees(walls)) {
    const h = hintFor(tee.through)
    h.backing = h.backing ?? []
    h.backing.push({ u: tee.u, heights: [0.6, 1.2, 1.8] })
    const stemHints = hintFor(tee.stem)
    // WIDTH-AWARE oblique retreat (the S5 mixed-wall formula): the stem's
    // own width w reaches (w/2)·|cosθ| past its centerline along the
    // through wall, so clearing the through face takes
    // (t + w·|cosθ|)/(2·sinθ) along the stem — plain t/2 left oblique
    // stems interpenetrating (night-board queue; 45° repro showed plates
    // and end studs still inside the through body at (t/2)/sinθ too).
    // sinθ floors at 0.2 (≈11°): shallower tees are degenerate drawings.
    const cosTheta = Math.abs(
      tee.stem.dir[0] * tee.through.dir[0] + tee.stem.dir[1] * tee.through.dir[1],
    )
    const sinTheta = Math.max(
      0.2,
      Math.abs(tee.stem.dir[0] * tee.through.dir[1] - tee.stem.dir[1] * tee.through.dir[0]),
    )
    const inset = (tee.through.thickness + tee.stem.thickness * cosTheta) / (2 * sinTheta)
    if (tee.stemEnd === 'start') stemHints.startInset = Math.max(stemHints.startInset ?? 0, inset)
    else stemHints.endInset = Math.max(stemHints.endInset ?? 0, inset)
  }

  return hints
}

/** Level context shared by every wall in one `frameWalls` pass. */
export type FrameWallsOptions = {
  /** Walls bear on a concrete slab (ground level) — see FrameHints.slabBearing. */
  slabBearing?: boolean
  /** Walls that bear on concrete whatever the level does — the garage walls
   * on their pad at grade beside a raised platform (W11b). */
  slabBearingIds?: ReadonlySet<string>
  /** A slabbed storey exists above this level — see FrameHints.storeyAbove
   * (CS-PF 24" first-of-two-storeys minimum, Figure R602.10.6.4). Leave
   * undefined when unknown: single-storey is then ASSUMED and stated. */
  storeyAbove?: boolean
  /** Walls the corner/tee HINT graph is computed over when it is a
   * SUPERSET of the walls being framed — compute passes the combined
   * lumber + steel (LGS) list so junctions compose across materials while
   * each engine frames only its own walls. Absent = the framed walls
   * themselves (byte-equal default). */
  hintWalls?: WallSlice[]
}

/**
 * Frame a SET of walls with cross-wall fabrication:
 *  - California corner assembly stud in the through wall (3-stud corner),
 *  - alternating cap-plate laps (through cap extends over the butting
 *    wall's top plate; butting cap pulls short of the through wall),
 *  - partition backing (ladder blocking) at tees.
 * `overrides` (per wall id) re-sizes a wall's studs/spacing — the resolved
 * per-wall engineering from the framing config; absent = the shared spec.
 * `opts` carries level context (slab bearing → PT sole plates, R317.1);
 * absent options keep the output byte-equal.
 */
/**
 * Drop plate-to-foundation uplift straps that land where the FOUNDATION
 * already anchors the plate — an R403.1.6 J-bolt or a seismic HDU within
 * the 12" end-distance window is the SAME anchorage point, and booking a
 * strap on top of it would double-buy one anchor (LOD-400 B10 c). The bolt
 * wins (it is the modeled, embedded hardware); the surviving straps fill
 * the runs between bolts. Runs from compute when BOTH systems are in the
 * result (the B9c cross-ref convention — a toggled-off foundation is not
 * missing hardware, so a walls-only result keeps its full strap ladder).
 * Mutates in place; returns the number of straps removed.
 */
export function dedupeFoundationStraps(members: Member[]): number {
  const anchors = members.filter(
    (m) => m.system === 'foundation' && (m.role === 'anchor-bolt' || m.role === 'hold-down'),
  )
  if (anchors.length === 0) return 0
  let removed = 0
  for (let i = members.length - 1; i >= 0; i--) {
    const m = members[i] as Member
    if (m.role !== 'foundation-strap') continue
    const doubled = anchors.some(
      (a) =>
        Math.hypot(a.position[0] - m.position[0], a.position[2] - m.position[2]) <=
        UPLIFT_ANCHOR_DEDUPE_TOL,
    )
    if (doubled) {
      members.splice(i, 1)
      removed += 1
    }
  }
  return removed
}

/**
 * Uplift-path honesty at the roof seam (LOD-400 B10): when the WALL side
 * modeled its high-wind connectors but a roof in the same result frames
 * rafters with ZERO hurricane ties, the path the connectors continue is
 * never started at the roof bearing. B8b closed the flat-roof instance
 * (every shipped shape ties now — the S17b compose pins ties present AND
 * this warning absent), so this is the GUARD for any future tie-less
 * shape, kept non-vacuous by the synthetic-member matrix below. It is a
 * WARNING, not a label: it belongs to the level (P4 prints it on paper),
 * not to any one of the hundreds of connectors. A result with no roof
 * members stays silent — a missing system is a toggle, not missing
 * hardware (B9c convention).
 */
export function upliftPathWarnings(members: Member[]): string[] {
  if (!members.some((m) => m.role === 'uplift-connector')) return []
  const byRoof = new Map<string, { rafters: number; ties: number }>()
  for (const m of members) {
    if (m.system !== 'roof-framing') continue
    const entry = byRoof.get(m.sourceId) ?? { rafters: 0, ties: 0 }
    if (m.role === 'rafter') entry.rafters += 1
    if (m.role === 'blocking' && m.material === 'steel') entry.ties += 1
    byRoof.set(m.sourceId, entry)
  }
  const out: string[] = []
  for (const [roofId, e] of byRoof) {
    if (e.rafters > 0 && e.ties === 0) {
      out.push(
        `high-wind uplift: roof ${roofId} frames rafters with NO hurricane ties ` +
          `(this roof models no tie members at its bearing) — the wall uplift connectors below ` +
          `continue a path the roof never starts; R802.11 uplift path incomplete at the roof ` +
          `bearing, verify tie schedule`,
      )
    }
  }
  return out
}

export function frameWalls(
  walls: WallSlice[],
  spec: FramingSpec = DEFAULT_SPEC,
  overrides?: ReadonlyMap<string, WallFramingOverride>,
  opts?: FrameWallsOptions,
): Member[] {
  const hints = frameHints(opts?.hintWalls ?? walls, spec, overrides)
  // Level context folds into every wall's hints; nothing set = hints pass
  // through untouched (byte-equal default path).
  const level: Partial<FrameHints> = {}
  if (opts?.slabBearing) level.slabBearing = true
  if (opts?.storeyAbove !== undefined) level.storeyAbove = opts.storeyAbove
  const hasLevelContext = Object.keys(level).length > 0
  const members: Member[] = []
  for (const wall of walls) {
    const h = hints.get(wall.id) ?? {}
    const own = opts?.slabBearingIds?.has(wall.id) ? { slabBearing: true } : {}
    members.push(
      ...frameWall(
        wall,
        specForWall(spec, overrides?.get(wall.id)),
        hasLevelContext || opts?.slabBearingIds?.has(wall.id) ? { ...h, ...level, ...own } : h,
      ),
    )
  }
  return members
}
