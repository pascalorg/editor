/**
 * HVAC engine — ducted system layout. Pure function:
 * (WallSlice[], RoomSlice[], FramingSpec) → {members, fixtures}.
 *
 * Sizing and layout follow data/mep-rules.json / docs/research/mep.md
 * (Manual J/S/D are the real methods — every label says which rule sized it):
 *  - SYSTEM TONNAGE (IRC M1401.3 — equipment per ACCA Manual S from Manual J
 *    loads) from the MANUAL-J-LITE v1 sensible load (src/engines/manual-j.ts:
 *    envelope UA × per-zone design ΔT + glazing solar gain + internal gains
 *    + infiltration × conditioned volume — every assumption stated), selected
 *    in half-ton steps within the Manual S 95–115% band (out-of-band
 *    selections warn). ONE plan sizes the air handler, duct cfm, return
 *    grille AND the condenser row. FALLBACK (never silent): unknown climate
 *    zone / no exterior envelope / no conditioned volume → the labeled
 *    sqft-per-ton rule with the trigger on the label. Garages excluded
 *    either way;
 *  - the air handler lives in a CONDITIONED service space (laundry/utility >
 *    closet > hallway > largest conditioned room); the GARAGE is kept only
 *    when no conditioned service space exists — with a loud M1602.2(1)
 *    warning, and the open return grille NEVER goes there (IRC M1602.2(1)
 *    forbids taking return air from a garage; R302.5.2 restricts garage
 *    duct penetrations);
 *  - the trunk runs MANHATTAN along the hallway/corridor axis (else along
 *    the dominant register-spread axis), fed by a perpendicular leg from the
 *    equipment; branches leave the trunk at right angles to each register;
 *  - each register's cfm comes from the room's share of the conditioned
 *    area (400 cfm/ton split proportionally) and the trunk cross-section
 *    STEPS DOWN after each takeoff to match the remaining cfm;
 *  - one central return sized ~200 in² of grille per ton (≈2 cfm/in² face
 *    velocity), flagged when it can't carry the supply cfm; the grille lives
 *    in a CENTRAL conditioned room (hallway when there is one, never the
 *    garage) and a RETURN trunk — sized by the same schematic rule as the
 *    supply trunk — carries the air back to the air handler (M1602: supply
 *    without a modeled return path was air arriving by magic); closable
 *    rooms (a door on their boundary) get a transfer-path ASSUMPTION label
 *    on their supply register ('door undercut / jumper duct assumed',
 *    M1602.2) — v1 does not invent jumper-duct geometry;
 *  - DUCTS NEVER CROSS TOP PLATES: trunk + branches route at ATTIC elevation
 *    (above every wall's plate band) and supply registers are CEILING boots
 *    dropping through the ceiling plane like recessed lights. IRC R602.6/
 *    R602.6.1 limit plate notching/boring (a >50% bored plate needs a 16 ga
 *    tie) — a rectangular duct never fits those limits, so residential
 *    practice runs the trunk in the attic above the ceiling joists (M1601
 *    duct installation); see docs/research/mep.md §3.6;
 *  - bath exhaust fans (M1505) and a laundry dryer vent (M1502) run to
 *    exterior terminations BELOW the plate band (through a stud bay);
 *  - a thermostat mounts on an interior wall near the return (52" AFF);
 *  - the OUTDOOR AC CONDENSER ROW ships at EVERY LOD the air handler does
 *    (condenser-always fix — user report 'sometimes the HVAC does not add
 *    the outside heat pump': the row was LOD-400-gated while the AH + full
 *    duct network emitted at 200/300 with zero words; LOD 400 alone still
 *    adds the condensate drain): N units from the SHARED system plan —
 *    the Manual-J-lite load when it computes, else the labeled climate-zone
 *    divisor fallback (zones 1-2 ≈ 1 ton/450 sqft, 3-4 ≈ 550, 5+ ≈ 650 —
 *    an ASSUMPTION, Manual J/S govern) — one condenser per ≤ 5 tons,
 *    per-unit tonnage on every label. Each unit gets a 4"
 *    concrete pad + cabinet outside an exterior wall (AUTO anchors at 24"
 *    wall-face-to-cabinet-face clearance — condenserStandoff; ≥ 0.3 m off
 *    the face as the hard mfr floor for rows/verbatim drags, ≥ 0.6 m
 *    between units, clear of door/window ROs — per mfr clearance +
 *    IRC M1403), a refrigerant LINE-SET — suction ¾" (insulated) + liquid
 *    ⅜" running as a parallel pair — from the cabinet through ONE
 *    exterior-wall penetration at ~0.4 m (snapped clear of ROs), then
 *    following the WALL GRAPH to the air handler coil on the plumbing
 *    engine's routePipe rails (E1 RO detours, junction jumpers, flagged
 *    air-run fallback — never a straight diagonal through room air), and
 *    a wall disconnect + whip (NEC 440.14; the dedicated branch circuit is
 *    routed separately). A run longer than ~15 m carries a 'verify
 *    manufacturer max line-set length / oil return' advisory (mfr specs
 *    govern). The heat-pump service node still wins unit #1's
 *    position verbatim (checklist A4) and the row re-anchors to it. The
 *    AUTO anchor wall is ELECTED WITH VALIDATION (Julien-scene root cause
 *    2026-08-22): wall.exterior is input, not truth — host floor-coverage
 *    gaps flip interior partitions exterior=true, and trusting the nearest
 *    one pushed the pad 0.6 m 'outward' INTO the Bathroom. The election
 *    walks exterior candidates by distance until one's pad spot validates
 *    OUTDOORS (not inside an indoor zone, not under floor coverage, not in
 *    a wall body — outdoor zones like a courtyard garden are legitimate);
 *    an exhausted walk keeps the least-bad (nearest) spot, flags every
 *    pad/cabinet and warns — never silent. A
 *    footprint with NO straight exterior wall anchors the row at the
 *    least-bad spot near the AH instead of skipping — warned and every
 *    pad/cabinet '⚠ verify condenser placement' flagged, never silent.
 *    The climate-zone divisor keys off `context.stateCode` (compute.ts
 *    passes `stateCode: code`); unknown/INTL codes take the mid band (550).
 */

import mepRules from '../../data/mep-rules.json'
import wallAssemblies from '../../data/wall-assemblies.json'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Fixture, Member, RoomSlice, ServiceOverrides, WallSlice } from '../core/types'
import { inches, toFeet } from '../core/units'
import {
  buildWallGraph,
  clearOfOpenings,
  nearestWallPoint,
  openingSpans,
  overridePlanPoint,
  overrideWallPoint,
  pointInPolygon,
  polygonCentroid,
  segmentCrossesRo,
  wallPath,
  wallPlan,
} from './electrical'
import { MANUAL_S_MAX, MANUAL_S_MIN, manualJLite, manualSTons, type ManualJLiteLoad } from './manual-j'
import { routePipe, type PipeSpec } from './plumbing'

type Pt = readonly [number, number]

const rules = mepRules as {
  hvac?: {
    sizingRuleOfThumb?: { coolingSqftPerTon?: number }
    ducted?: { branchRoundIn?: number }
    attic?: { trunkAboveWallTopM?: number; topPlateBandM?: number }
    condenser?: {
      sqftPerTonByZoneBand?: { hot?: number; mid?: number; cold?: number }
      maxTonsPerUnit?: number
      minTons?: number
      padSideM?: number
      padThicknessM?: number
      unitDimsM?: number[]
      unitClearM?: number
      wallClearM?: number
      faceClearM?: number
      linesetSuctionDiaM?: number
      linesetLiquidDiaM?: number
      linesetHeightM?: number
      linesetMaxLenAdvisoryM?: number
      linesetLateralM?: number
      disconnectAboveUnitM?: number
    }
  }
}

const ASSEMBLIES = wallAssemblies as {
  exterior?: { stateClimateZone?: Record<string, string> }
}

const SQFT_PER_TON = rules.hvac?.sizingRuleOfThumb?.coolingSqftPerTon ?? 500
const TRUNK_W = inches(14)
const TRUNK_H = inches(8)
const TRUNK_MIN_W = inches(8)
const BRANCH_SIDE = inches(rules.hvac?.ducted?.branchRoundIn ?? 6)
const EXHAUST_SIDE = inches(4)
/** Trunk plane above the TALLEST wall plate — ceiling-joist depth + working
 * clearance (data/mep-rules.json hvac.attic; R602.6 + M1601 basis). */
const TRUNK_ATTIC_CLEARANCE = rules.hvac?.attic?.trunkAboveWallTopM ?? 0.3
/** Top-plate band no duct may enter: [wall.height − band, wall.height]. */
const PLATE_BAND = rules.hvac?.attic?.topPlateBandM ?? 0.09
/** Interior storeys (a storey stacked ABOVE) have no attic: the trunk caps
 * below the ceiling as a dropped-soffit run at ceiling − this drop. */
const SOFFIT_DROP = 0.35
/** Register grille hangs just BELOW the host ceiling mesh (like a recessed
 * light) — at/above the plane it disappears from inside the room (visual
 * round 2026-08-16: bare ceilings from below). */
const REGISTER_BELOW_CEILING = 0.04
/** The boot drops through the plane to meet the grille. */
const BOOT_BELOW_CEILING = 0.05
/** Thermostat mount height (device center) — 48–52" practice band. */
const TSTAT_AFF = inches(52)
/** Wall-less fallback stand-off for the heat-pump pad (no wall ⇒ no face to
 * measure from, no thickness to add): face clearance + half the cabinet
 * depth. Anchors WITH a wall use {@link condenserStandoff} instead. */
const PAD_OFFSET_NO_WALL = () => COND_FACE_CLEAR + COND_DIMS[2] / 2

// ---- AC condenser row (data/mep-rules.json hvac.condenser) ------------------
const COND = rules.hvac?.condenser
/** Cooling divisor (sqft/ton) by IECC zone band — ASSUMPTION, Manual J/S govern. */
const COND_SQFT_HOT = COND?.sqftPerTonByZoneBand?.hot ?? 450
const COND_SQFT_MID = COND?.sqftPerTonByZoneBand?.mid ?? 550
const COND_SQFT_COLD = COND?.sqftPerTonByZoneBand?.cold ?? 650
/** Residential condensers top out ~5 tons — bigger loads take more units. */
export const MAX_TONS_PER_CONDENSER = COND?.maxTonsPerUnit ?? 5
const COND_MIN_TONS = COND?.minTons ?? 1.5
/** 4" concrete equipment pad, 1.0 × 1.0 m (40"-class stock; IRC M1403) —
 * a ≥ 2.5 cm reveal per side around the 0.95 m cabinet footprint. */
const COND_PAD_SIDE = COND?.padSideM ?? 1.0
const COND_PAD_T = COND?.padThicknessM ?? 0.1016
/** Condenser cabinet W × H × D on the pad. Basis (unwarp round 2026-08-23,
 * Julien: native proportions): conventional TOP-DISCHARGE ducted heat-pump
 * outdoor units in the 2–4 ton class — Bosch IDS BOVA-36 37.4×37.4×33.4"
 * (0.95×0.95×0.85 m), Goodman GSZ 35.5×35.5×36.25", Carrier 25VNA4
 * 35.4×35.4×37" — a ~0.95 m SQUARE footprint, not the old slim 0.35 m
 * side-discharge form the box used to mimic. 0.95×0.85×0.95 additionally
 * equals the host 'AC block' asset's native bbox aspect (1.06×0.95×1.06 m)
 * within 0.2%, so the X-ray swap renders the model at TRUE proportions
 * (uniform ≈0.90 shrink — gate: condenser-asset.test.ts ratio pin). */
const COND_DIMS: readonly [number, number, number] = [
  COND?.unitDimsM?.[0] ?? 0.95,
  COND?.unitDimsM?.[1] ?? 0.85,
  COND?.unitDimsM?.[2] ?? 0.95,
]
/** The engine's condenser-cabinet truth, shared with the renderer side
 * (the A6 asset wrapper's uniformity gate + the service pick proxy). */
export const CONDENSER_UNIT_DIMS: readonly [number, number, number] = COND_DIMS
export const CONDENSER_PAD_THICKNESS: number = COND_PAD_T
/** Clear space BETWEEN units in the row — per mfr clearance + IRC M1403. */
const COND_UNIT_CLEAR = COND?.unitClearM ?? 0.6
/** HARD floor between the wall FACE and the cabinet face (12" mfr minimum)
 * — rows and verbatim overrides never stand closer. */
const COND_WALL_CLEAR = COND?.wallClearM ?? 0.3
/** AUTO-anchor face clearance: wall FACE → cabinet face, 24" (the mfr
 * service/airflow recommendation class for the house-side coil — e.g.
 * Bosch IDS & Carrier install guides ask 12" min / 24" recommended behind
 * the unit). The old constant 0.6 m CENTER stand-off left only ~0.42 m
 * centerline-to-face; with the true 0.95 m cabinet depth it would have
 * pinched the coil to ~7 cm off a typical wall face — the anchor now
 * derives from the face outward, wall-thickness aware. */
const COND_FACE_CLEAR = COND?.faceClearM ?? inches(24)
/** AUTO pad-anchor stand-off from the wall CENTERLINE: half the wall, the
 * 24" face clearance, half the cabinet depth — the stated-basis version of
 * the old flat 0.6 m. Row units keep {@link COND_WALL_CLEAR} as the floor. */
function condenserStandoff(wallThickness: number): number {
  return wallThickness / 2 + COND_FACE_CLEAR + COND_DIMS[2] / 2
}
/**
 * HOST EDITOR GRID (HP polish 2026-08-23, Julien: "by default it's not
 * aligned to the grid"; frame corrected in the verify round, F1): the host
 * convention for ITEM floor placement — read-only investigation of
 * private-editor — is the **WORLD XZ grid, the grid the editor renders**:
 * `floorStrategy` snaps `snapToGrid(event.position[0/2])` and runs it
 * through `snapWorldXZForActiveBuilding` "so item edges land on the
 * visible grid even when the active building is rotated"
 * (packages/editor/src/components/tools/item/placement-strategies.ts +
 * lib/world-grid-snap.ts). NOT the wall frame: on oblique walls a
 * wall-frame multiple sits visibly off the rendered lattice (skeptic
 * exhibit: azimuth atan2(2,3), world residuals 0.153/0.496).
 * Step basis: `useEditor.gridSnapStep` defaults to **0.5 m**, cyclable
 * through [0.5, 0.25, 0.1, 0.05] (store/use-editor.tsx). The host's
 * DEFAULT item snapping mode is 'lines' (getGridSnapStep() returns 0
 * unless the mode is 'grid' — placement-math.ts), i.e. interactive
 * placement is free + line-snap until the user opts into the grid; AUTO
 * placement has no gesture to align to, so the machine picks the tidy
 * default a user would — the 0.5 m world grid, the COARSEST host step
 * (every finer option divides it, so the spot sits on a grid line at
 * every setting). Verbatim overrides never snap here (checklist A4 — the
 * user's own snap already happened in the host move tool).
 */
export const EDITOR_GRID_STEP_M = 0.5
/** World-grid candidate window around the honest spot, in grid steps per
 * world axis (±): the search only TIDIES the RO-slid election result —
 * roaming farther would betray the slide/election, so an exhausted window
 * keeps the honest off-grid spot and flags it (COND_OFF_GRID_FLAG). */
const COND_GRID_WINDOW_STEPS = 3
/** Refrigerant line-set: suction ¾" (insulated) + liquid ⅜" pair, through
 * ONE wall penetration at ~0.4 m, then wall-following to the air handler. */
const LINESET_SUCTION_DIA = COND?.linesetSuctionDiaM ?? 0.019
const LINESET_LIQUID_DIA = COND?.linesetLiquidDiaM ?? 0.0095
const LINESET_Y = COND?.linesetHeightM ?? 0.4
/** The suction rides +2 cm / liquid −2 cm off LINESET_Y: a PARALLEL pair
 * with a 4 cm offset — two pipes, never one coincident stack. */
export const LINESET_PAIR_OFFSET = 0.02
/** Runs longer than this get the oil-return advisory — an ASSUMPTION class
 * (typical mfr line-set charts top out 15–30 m; the manufacturer governs). */
const LINESET_MAX_LEN_ADVISORY = COND?.linesetMaxLenAdvisoryM ?? 15
const LINESET_LONG_FLAG =
  'line-set over ~15 m — verify manufacturer max line-set length / oil return (mfr specs govern)'
/** Cross-trade LATERAL: the pair rides this far OFF the wall centerline
 * (across-wall, v-axis). Plumbing owns the centerline plane — supply
 * risers and the DWV stack stand exactly on it — and the post-merge seam
 * round counted 24 OBB hits from the pair sharing it (both pipes boring
 * through the 3" stack + 22 supply-riser hits). 3.5 cm clears a ½" supply
 * riser by ~4 mm even for the rolled-down riser (lateral − roll − both
 * radii − 2 mm skin); night-5 D2 set the trade-skin convention. Thin
 * walls CLAMP the offset (the suction riser must stay inside the wall
 * body) and carry a coordination flag — reduced clearance, never silent. */
export const LINESET_LATERAL = COND?.linesetLateralM ?? 0.035
const LINESET_THIN_WALL_FLAG =
  'line-set clamped in a thin wall — reduced trade clearance; coordinate with plumbing'
/** Compose honesty flags — the B1 ' | ' convention: APPEND, never
 * overwrite, never skip, never duplicate. Precedence guards (`!flag`)
 * MASKED truths: a clamped long run dropped the >15 m advisory, and a
 * flagged member never gained its crossing class (merge-gate F2 + the
 * closing-round F1 before it). Every flag writer goes through here. */
function composeFlag(existing: string | undefined, add: string): string {
  if (!existing) return add
  return existing.includes(add) ? existing : `${existing} | ${add}`
}
/** Disconnect box center above the unit top, on the wall face (NEC 440.14). */
const DISCONNECT_ABOVE_UNIT = COND?.disconnectAboveUnitM ?? 0.3
/** Pad + cabinet flag when the row anchors WITHOUT an exterior wall (the
 * least-bad fallback — condenser-always fix): never a silent guess. */
const COND_VERIFY_FLAG = '⚠ verify condenser placement — no exterior wall anchors the row'
/** Pad + cabinet flag when NO exterior-wall candidate yields a pad spot
 * that validates OUTDOORS (Julien-scene class: floor-coverage gaps flip
 * interior partitions exterior=true and every candidate's spot lands
 * inside a room or under cover) — the row keeps the least-bad (nearest)
 * election; the flag + level warning say so, never silent. */
const COND_UNVALIDATED_FLAG =
  '⚠ verify condenser placement — auto spot could not be validated outdoors'
const COND_UNVALIDATED_WARNING =
  'condenser auto spot could not be validated outdoors — every exterior-wall candidate lands inside a room or under floor coverage (exterior wall classification suspect); verify placement'
/** Pad + cabinet flag when the S1 cladding slide pushes the pad out past
 * the cabinet's 2.5 cm pad reveal — only a verbatim anchor tucked closer
 * than the exterior-assembly allowance can cause it (auto anchors clear it
 * by construction); the cabinet then overhangs its own slab. */
const COND_PAD_OVERHANG_FLAG =
  '⚠ cabinet overhangs its pad — the unit stands too close to the wall for the exterior assembly (R703.8); move it out'
/** The grid search came up empty (verify round F3 — the promised honesty
 * channel): clearance/openings/wall span leave NO 0.5 m world-grid spot
 * within the search window, so the unit stands at the honest un-snapped
 * position and SAYS SO — never a silent off-grid placement. */
const COND_OFF_GRID_FLAG =
  '⚠ off-grid — clearance/openings leave no 0.5 m grid position near the elected spot'
/**
 * A verbatim heat-pump override farther (plan) than this from EVERY
 * exterior wall warns — almost certainly a mis-drag into the yard.
 * Threshold basis: NEC 210.63's 25 ft HVAC service-receptacle radius
 * (7.62 m) — the code's own "serviceable from the dwelling" reach. The
 * in-file 15 m line-set advisory is the wrong ruler here: it is a run-
 * LENGTH class and would bless a unit 13 m into the garden (hunt 5f).
 */
const HP_OVERRIDE_FAR_M = 7.62
/**
 * Worst-case exterior assembly beyond the wall FACE the pad must clear:
 * brick veneer's 4.625" assembly offset (1" airspace + 3.625" wythe,
 * R703.8 / Table R703.3(1)) + 7/16" sheathing ≈ 0.129 m. The hvac engine
 * doesn't know this wall's cladding, so every pad keeps the worst-case
 * stand-off — the CABINET stays at its anchor (byte-stable), only the pad
 * slab slides outward under it when the anchor tucks it too close.
 */
const PAD_CLADDING_ALLOW = 0.13
/** ACCA rule of thumb: airflow per ton of cooling. */
export const CFM_PER_TON = 400
/** Return grille sizing: ~200 in² per ton keeps face velocity near 2 cfm/in². */
export const RETURN_IN2_PER_TON = 200
/**
 * Stock return-grille free areas (in², 10x10 → 20x40 nominal). A single
 * central return tops out at the biggest stock grille — larger systems
 * genuinely need a second return, which is exactly what the balance flag
 * calls out (a flag that can never fire is no flag — round-3 finding).
 */
export const RETURN_GRILLE_CATALOG_IN2 = [100, 144, 216, 288, 400, 600, 800] as const
/**
 * Clearance a RETURN vertical (trunk-section riser/drop) keeps off every
 * wall's plan band: the 14×8 section's half-diagonal (~0.20 m) exceeds the
 * 6" boot margin the register search uses — a grille cleared at 0.12 m put
 * the riser's corner samples inside the plate band (M1 harness).
 */
const RETURN_WALL_MARGIN = 0.25
/** The return drop meets the air handler this far (plan) from the supply
 * riser at the equipment centroid — the two trunk verticals must never
 * occupy the same space. */
const RETURN_DROP_OFFSET = 0.5
/** Clear gap between any return duct face and a supply duct face. */
const DUCT_CLEAR_GAP = 0.05
/**
 * DUCT×EQUIPMENT JUNCTION BURIAL (day-9 z-fight — Julien screenshots: striped
 * color oscillation where the supply trunk meets the AH/plenum stack). Two
 * parallel faces on ONE plane render at identical depth and the GPU picks a
 * winner per frame — the same class the heat-pump A/B round documented on the
 * condenser placeholder ("W×H identical → coplanar faces"). The emission had
 * two makers of coplanar pairs at equipment junctions:
 *  (a) MATCHED SECTIONS — the junction VERTICALS (trunk riser = the supply
 *      plenum stack, register boots, return riser/drop, the whip conduit
 *      drop) carried exactly the section of the run connecting into them, so
 *      wherever the run entered, both side planes coincided (a full-width
 *      trunk leaving the plenum, a 6" branch entering its boot);
 *  (b) SHARED CAP PLANES — every vertical capped exactly AT its run's center
 *      plane (trunkY / returnY), so two verticals meeting one run capped on
 *      the SAME plane (the equipment-room register: boot and plenum riser at
 *      one plan point, caps coplanar at trunkY — the visible patch ON TOP of
 *      the stack).
 * Physical truth: ducts connect INTO plenums/cabinets — the receiving body
 * is a hair larger than the duct it swallows. Every junction vertical grows
 * 2×BURY across its section (connecting runs bury ≥ BURY inside its sides)
 * and its junction cap leaves the run's center plane: plenum-class verticals
 * (riser/return riser/return drop) extend BURY PAST it, boot collars stop
 * 2×BURY SHORT of it — distinct planes in attic AND soffit routing, so no
 * two caps can coincide. The junction stays a legal S1 connection: the run
 * still terminates INSIDE the vertical (the whip/line-set terminating-INTO
 * precedent — MEP engines are out of the structural interpenetration gate's
 * scope by design, and the hvac suites own these junctions). Labels and
 * takeoff section names round to whole inches (14.4" → 14), so the grow
 * never renames a row; lf moves by mm and the junction sweep gate
 * (hvac.junctions.test.ts) holds the family closed.
 */
export const DUCT_JUNCTION_BURY = 0.005
/**
 * The RETURN plane rides one trunk-section height + gap off the SUPPLY
 * plane, so horizontal return legs can cross the supply corridor in plan
 * without sharing tin (skeptic round 1 BLOCKER: both trunks were emitted at
 * the identical trunkY — the return leg ran co-axially INSIDE the supply
 * trunk). Attic mode steps UP (headroom above the supply plane); soffit
 * mode steps DOWN (up would break the interior-storey ceiling cap).
 */
const RETURN_PLANE_OFFSET = TRUNK_H + DUCT_CLEAR_GAP

/** Shoelace polygon area (m²). */
export function polygonArea(polygon: readonly Pt[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i] as Pt
    const [x2, z2] = polygon[(i + 1) % polygon.length] as Pt
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

function centroid(polygon: readonly Pt[]): Pt {
  let x = 0
  let z = 0
  for (const [px, pz] of polygon) {
    x += px
    z += pz
  }
  const n = Math.max(1, polygon.length)
  return [x / n, z / n]
}

/** Clearance a register drop point keeps off every wall centerline: half the
 * wall body + the 6" boot's half section + working slack. */
const REGISTER_WALL_MARGIN = 0.12

/** The wall whose plan band (centerline ± thickness/2 + margin) holds `p`. */
function wallBandAt(p: Pt, walls: WallSlice[], margin = REGISTER_WALL_MARGIN): WallSlice | null {
  for (const w of walls) {
    if (w.curved || w.length < 0.1) continue
    const dx = p[0] - w.start[0]
    const dz = p[1] - w.start[1]
    const along = dx * w.dir[0] + dz * w.dir[1]
    if (along < -margin || along > w.length + margin) continue
    const off = Math.abs(-dx * w.dir[1] + dz * w.dir[0])
    if (off < w.thickness / 2 + margin) return w
  }
  return null
}

/**
 * Interior drop point for a room's ceiling register: the AREA centroid
 * (shoelace), nudged back inside the polygon and off every wall band. The
 * old VERTEX-AVERAGE centroid drifted onto (or past) walls in concave/L
 * rooms, so the supply boot bored through the plate band and the register
 * printed inside the wall (skeptic round 2026-08-16). Search: growing radial
 * ring (8 directions), then edge-midpoint pull-ins for degenerate slivers.
 */
export function roomInteriorPoint(polygon: readonly Pt[], walls: WallSlice[]): Pt {
  const c = polygonCentroid(polygon)
  const ok = (q: Pt): boolean => pointInPolygon(q, polygon) && wallBandAt(q, walls) === null
  if (ok(c)) return c
  for (let step = 0.15; step <= 1.66; step += 0.15) {
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4
      const q: Pt = [c[0] + Math.cos(ang) * step, c[1] + Math.sin(ang) * step]
      if (ok(q)) return q
    }
  }
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Pt
    const b = polygon[(i + 1) % polygon.length] as Pt
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const n = Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]))
    for (const s of [1, -1] as const) {
      const q: Pt = [mid[0] + (-(b[1] - a[1]) / n) * 0.3 * s, mid[1] + ((b[0] - a[0]) / n) * 0.3 * s]
      if (ok(q)) return q
    }
  }
  return c
}

/** Cooling tons from conditioned area, rounded up to the half ton, min 1.5.
 * LEGACY rule of thumb (1 ton/500 sqft) — `layoutHvac` sizes from
 * `sizeCoolingPlan` now; kept exported for direct callers/gates. */
export function tonsFor(conditionedAreaM2: number): number {
  const sqft = conditionedAreaM2 * 10.7639
  const raw = sqft / SQFT_PER_TON
  return Math.max(1.5, Math.ceil(raw * 2) / 2)
}

/** Smallest stock grille covering the tonnage — capped at the catalog top. */
export function returnGrilleIn2(tons: number): number {
  const need = tons * RETURN_IN2_PER_TON
  for (const size of RETURN_GRILLE_CATALOG_IN2) {
    if (size >= need) return size
  }
  return RETURN_GRILLE_CATALOG_IN2[RETURN_GRILLE_CATALOG_IN2.length - 1] as number
}

/**
 * Cooling divisor (sqft/ton) for a state, from its dominant IECC climate
 * zone (data/wall-assemblies.json exterior.stateClimateZone — same read the
 * wall-layers batt sizing does): zones 1-2 (FL/TX/AZ style heat) size at
 * 1 ton/450 sqft, zones 3-4 at 550, zones 5+ at 650. Unknown / zone-less
 * codes (INTL, AUTO unresolved) assume the mid band. ASSUMPTION only —
 * ACCA Manual J/S govern (IRC M1401.3); the labels say so.
 */
export function condenserSqftPerTon(stateCode?: string): {
  divisor: number
  zone: string | null
} {
  const raw = stateCode ? ASSEMBLIES.exterior?.stateClimateZone?.[stateCode] : undefined
  const m = raw ? /^(\d)([ABC])?/.exec(raw.trim()) : null
  if (!m) return { divisor: COND_SQFT_MID, zone: null }
  const z = Number(m[1])
  const zone = `${m[1]}${m[2] ?? ''}`
  if (z <= 2) return { divisor: COND_SQFT_HOT, zone }
  if (z <= 4) return { divisor: COND_SQFT_MID, zone }
  return { divisor: COND_SQFT_COLD, zone }
}

/**
 * Outdoor-unit plan for a conditioned area — the labeled sqft-per-ton
 * FALLBACK RULE (kept from the pre-Manual-J-lite engine): total tons at the
 * climate-band divisor (rounded UP to the half ton, min 1.5), one condenser
 * per ≤ 5 tons (unit count = ceil(total/5)), per-unit tonnage = total/count
 * rounded to the NEAREST half ton. A tiny home floors at 1 unit / 1.5 tons.
 * The PRIMARY sizing basis is `sizeCoolingPlan` (Manual-J-lite load per IRC
 * M1401.3); this rule sizes only when that load cannot compute, with the
 * reason stated on the label.
 */
export function condenserPlan(
  conditionedAreaM2: number,
  stateCode?: string,
): { totalTons: number; count: number; unitTons: number; divisor: number; zone: string | null } {
  const { divisor, zone } = condenserSqftPerTon(stateCode)
  const sqft = conditionedAreaM2 * 10.7639
  const totalTons = Math.max(COND_MIN_TONS, Math.ceil((sqft / divisor) * 2) / 2)
  const count = Math.max(1, Math.ceil(totalTons / MAX_TONS_PER_CONDENSER))
  const unitTons = Math.max(COND_MIN_TONS, Math.round((totalTons / count) * 2) / 2)
  return { totalTons, count, unitTons, divisor, zone }
}

/** ONE system tonnage for the level — air handler, ducts and the condenser
 * row all size from it (the old engine ran TWO rules of thumb side by side:
 * AH at 1 ton/500 sqft, condensers at 450/550/650 — incoherent). */
export type CoolingPlan = {
  totalTons: number
  count: number
  unitTons: number
  basis: 'manual-j-lite' | 'sqft-rule'
  /** Basis text for fixture labels, e.g. 'Manual J-lite, zone 2A design
   * 35°C' or 'assumed 1 ton/550 sqft — Manual J-lite fallback: …'. */
  sizingNote: string
  zone: string | null
  /** The computed load (manual-j-lite basis only). */
  load?: ManualJLiteLoad
  /** Stated fallback trigger (sqft-rule basis only). */
  fallbackReason?: string
  divisor?: number
  /** False when stock half-ton steps / the 1.5-ton floor push the Manual S
   * selection outside the 95–115% band — layoutHvac warns, never silent. */
  withinManualSBand: boolean
  /** count × unitTons — the capacity actually INSTALLED. Splitting rounds
   * each unit to the nearest stock half ton, so a 5.5-ton selection ships
   * as 2 × 3.0 = 6.0 tons of cabinets (skeptic F2: the plan total passed
   * the band while the installed sum quietly exceeded it, and the AH said
   * 5.5 while the cabinets said 6.0). */
  installedTons: number
  /** False when the INSTALLED sum leaves the Manual S 95–115% band
   * (manual-j basis; the fallback rule makes no band claim). */
  installedWithinBand: boolean
}

/**
 * SYSTEM COOLING TONNAGE (IRC M1401.3 — equipment per ACCA Manual S from
 * Manual J loads): the MANUAL-J-LITE v1 sensible load (envelope UA ×
 * per-zone design ΔT + glazing solar + internal gains + infiltration ×
 * conditioned volume — src/engines/manual-j.ts states every assumption)
 * selected in half-ton steps within the Manual S 95–115% band, split into
 * one condenser per ≤ 5 tons. FALLBACK (never silent): when the load
 * cannot compute — unknown climate zone (INTL/unset), no straight exterior
 * envelope, no conditioned volume — the labeled sqft-per-ton rule
 * (`condenserPlan`) sizes instead and the trigger goes ON THE LABEL. LOD
 * never gates the load (walls/rooms exist at every LOD).
 */
export function sizeCoolingPlan(
  walls: WallSlice[],
  rooms: RoomSlice[],
  conditionedAreaM2: number,
  stateCode?: string,
): CoolingPlan {
  const load = manualJLite(walls, rooms, stateCode)
  if (load.ok) {
    const sel = manualSTons(load.loadTons, COND_MIN_TONS)
    const totalTons = sel.tons
    const count = Math.max(1, Math.ceil(totalTons / MAX_TONS_PER_CONDENSER))
    const unitTons = Math.max(COND_MIN_TONS, Math.round((totalTons / count) * 2) / 2)
    // The LATENT COMPOSITION goes on the label (skeptic F1): the four-term
    // load is sensible-only, and in a humid zone the allowance moves the
    // selection — a reader of any consumer label must see all three
    // figures (sensible × factor → selected), not discover the omission
    // in a module docstring.
    const sens = Math.round(load.sensibleTons * 100) / 100
    const latentNote = load.moistureRegime
      ? `${sens} t sensible × ${load.latentFactor} latent (regime ${load.moistureRegime})`
      : `${sens} t sensible, no latent allowance (no regime letter)`
    // INSTALLED capacity (skeptic F2): per-unit rounding to stock half
    // tons makes count × unitTons ≥ the selection — band-check what is
    // actually bought, not only the plan figure.
    const installedTons = count * unitTons
    const installedWithinBand =
      installedTons >= MANUAL_S_MIN * load.loadTons &&
      installedTons <= MANUAL_S_MAX * load.loadTons + 1e-9
    return {
      totalTons,
      count,
      unitTons,
      basis: 'manual-j-lite',
      sizingNote: `Manual J-lite, zone ${load.zone} design ${load.outdoorDesignC}°C, ${latentNote}`,
      zone: load.zone,
      load,
      withinManualSBand: sel.withinBand,
      installedTons,
      installedWithinBand,
    }
  }
  const fallback = condenserPlan(conditionedAreaM2, stateCode)
  return {
    totalTons: fallback.totalTons,
    count: fallback.count,
    unitTons: fallback.unitTons,
    basis: 'sqft-rule',
    sizingNote:
      `assumed 1 ton/${fallback.divisor} sqft` +
      `${fallback.zone ? `, zone ${fallback.zone}` : ''}` +
      ` — Manual J-lite fallback: ${load.reason}`,
    zone: fallback.zone,
    fallbackReason: load.reason,
    divisor: fallback.divisor,
    // The fallback rule is its own labeled basis — it makes no Manual S
    // band claim (the label already says which rule sized it).
    withinManualSBand: true,
    installedTons: fallback.count * fallback.unitTons,
    installedWithinBand: true,
  }
}

/** A straight horizontal duct run between two plan points. */
function duct(
  from: Pt,
  to: Pt,
  y: number,
  w: number,
  h: number,
  sourceId: string,
  label: string,
  material: Member['material'] = 'duct',
  role: Member['role'] = 'duct-run',
  minLen = 0.15,
): Member | null {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  if (length < minLen) return null
  return {
    system: 'hvac',
    role,
    dims: [length, h, w],
    length,
    position: [(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2],
    rotation: [0, Math.atan2(-dz, dx), 0],
    material,
    sourceId,
    label,
  }
}

/** Vertical duct/pipe/conduit (riser/boot/drop) between two heights at one plan point. */
function ductDrop(
  at: Pt,
  y0: number,
  y1: number,
  w: number,
  h: number,
  sourceId: string,
  label: string,
  material: Member['material'] = 'duct',
  role: Member['role'] = 'duct-run',
): Member | null {
  const lo = Math.min(y0, y1)
  const hi = Math.max(y0, y1)
  const length = hi - lo
  if (length < 0.05) return null
  return {
    system: 'hvac',
    role,
    dims: [w, length, h],
    length,
    position: [at[0], (lo + hi) / 2, at[1]],
    rotation: [0, 0, 0],
    material,
    sourceId,
    label,
  }
}

/** Manhattan (X then Z) pair of runs. */
function manhattanDuct(
  members: Member[],
  from: Pt,
  to: Pt,
  y: number,
  w: number,
  h: number,
  sourceId: string,
  label: string,
  material: Member['material'] = 'duct',
  role: Member['role'] = 'duct-run',
): void {
  const elbow: Pt = [to[0], from[1]]
  const a = duct(from, elbow, y, w, h, sourceId, label, material, role)
  if (a) members.push(a)
  const b = duct(elbow, to, y, w, h, sourceId, label, material, role)
  if (b) members.push(b)
}

/** Closest point on segment [a,b] to p. */
function projectOnto(a: Pt, b: Pt, p: Pt): Pt {
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const len2 = abx * abx + abz * abz
  if (len2 < 1e-12) return a
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2))
  return [a[0] + abx * t, a[1] + abz * t]
}

/** Nearest point on any exterior wall (exhaust/service terminations) —
 * carries the wall so exhaust heights can key off the EXIT wall's height. */
function nearestExteriorExit(walls: WallSlice[], p: Pt): { at: Pt; wall: WallSlice } | null {
  let best: { at: Pt; wall: WallSlice } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const wall of walls) {
    if (!wall.exterior || wall.curved) continue
    const [ax, az] = wall.start
    const point = projectOnto([ax, az], [wall.end[0], wall.end[1]], p)
    const d = Math.hypot(point[0] - p[0], point[1] - p[1])
    if (d < bestDist) {
      bestDist = d
      best = { at: point, wall }
    }
  }
  return best
}

/** True when the plan segment a→b passes through `w`'s body (sampled). */
function segCrossesWall(a: Pt, b: Pt, w: WallSlice): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const steps = Math.max(1, Math.ceil(len / 0.1))
  for (let i = 0; i <= steps; i++) {
    const p: Pt = [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]
    const dx = p[0] - w.start[0]
    const dz = p[1] - w.start[1]
    const along = dx * w.dir[0] + dz * w.dir[1]
    if (along < 0 || along > w.length) continue
    if (Math.abs(-dx * w.dir[1] + dz * w.dir[0]) < w.thickness / 2 + 0.02) return true
  }
  return false
}

/**
 * The height budget for an exhaust run: the LOWEST wall it must pass through
 * — the exit wall plus every wall the Manhattan legs cross — capped at the
 * room ceiling. Keying off room.ceilingHeight alone put the duct inside a
 * SHORTER exit wall's own plate band (skeptic round 2026-08-16: 2.4 m wall
 * under a 2.5 m ceiling).
 */
function minWallHeightAlong(
  from: Pt,
  to: Pt,
  exitWall: WallSlice,
  roomCeiling: number,
  walls: WallSlice[],
): number {
  let minH = Math.min(roomCeiling, exitWall.height)
  const elbow: Pt = [to[0], from[1]]
  for (const w of walls) {
    if (w.curved || w.length < 0.1) continue
    if (segCrossesWall(from, elbow, w) || segCrossesWall(elbow, to, w)) {
      minH = Math.min(minH, w.height)
    }
  }
  return minH
}

/** Axis-aligned bounds of a polygon. */
function bounds(polygon: readonly Pt[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}

/** Closet-ish 'other' rooms read as conditioned service space — the room
 * categories carry no 'closet', so match the NAME (same trick classifyRoom
 * plays for utility → laundry). */
const CLOSET_RE = /closet|mech|furnace|placard/i

/**
 * Equipment room preference — CONDITIONED service space first (B19a):
 * laundry/utility > closet > hallway > garage > largest conditioned room.
 * The garage stays a candidate ABOVE the generic largest-room fallback (an
 * air handler doesn't live in the middle of a bedroom), but every
 * conditioned service space now outranks it — IRC M1602.2(1) forbids garage
 * return air and R302.5.2 restricts garage duct penetrations, so a
 * garage-mounted AH is a last resort that `layoutHvac` warns LOUDLY about
 * (and the open return grille never follows it there). The old order
 * (laundry > garage > hallway) parked the AH + open return in the garage
 * silently whenever the scene had no laundry.
 */
/** HVAC serves indoor space only: OUTDOOR zones (garden/patio/yard…) are
 * open air — no tonnage, no supply register, never the equipment room and
 * never a thermostat/heat-pump anchor room (starter-template report
 * 2026-08-22: the back-garden zone drew a ceiling register floating in the
 * yard and inflated the condenser sizing). Applied at EVERY exported
 * rooms-boundary so direct callers — the engine, service seeding, the
 * panel — share one view (A4 parity); the filter is idempotent. */
function hvacServedRooms(rooms: RoomSlice[]): RoomSlice[] {
  return rooms.filter((r) => r.category !== 'outdoor')
}

export function equipmentRoomOf(rooms: RoomSlice[]): RoomSlice {
  rooms = hvacServedRooms(rooms)
  const conditioned = rooms.filter((r) => r.category !== 'garage')
  const byArea = [...conditioned].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))
  return (
    rooms.find((r) => r.category === 'laundry') ??
    conditioned.find((r) => r.category === 'other' && CLOSET_RE.test(r.name)) ??
    rooms.find((r) => r.category === 'hallway') ??
    rooms.find((r) => r.category === 'garage') ??
    (byArea[0] as RoomSlice)
  )
}

// ---- supply keep-out model (B19 round-1 BLOCKER) -----------------------------

/** A supply duct's plan footprint: segment a→b with half-width `half`
 * (a === b for verticals — riser/boots). */
type PlanSeg = { a: Pt; b: Pt; half: number }

/** Plan distance from point q to the segment a→b. */
function planSegDist(seg: PlanSeg, q: Pt): number {
  const p = projectOnto(seg.a, seg.b, q)
  return Math.hypot(q[0] - p[0], q[1] - p[1])
}

/** True when a return piece of plan half-width `half` at `q` clears every
 * supply footprint by the duct gap. */
function clearOfSegs(segs: PlanSeg[], q: Pt, half: number): boolean {
  return segs.every((s) => planSegDist(s, q) >= s.half + half + DUCT_CLEAR_GAP)
}

/** Plan intersection point of segments a→b and c→d (null when disjoint). */
function segSegHit(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const d1: Pt = [b[0] - a[0], b[1] - a[1]]
  const d2: Pt = [d[0] - c[0], d[1] - c[1]]
  const den = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(den) < 1e-9) return null
  const t = ((c[0] - a[0]) * d2[1] - (c[1] - a[1]) * d2[0]) / den
  const s = ((c[0] - a[0]) * d1[1] - (c[1] - a[1]) * d1[0]) / den
  if (t < 0 || t > 1 || s < 0 || s > 1) return null
  return [a[0] + d1[0] * t, a[1] + d1[1] * t]
}

/**
 * True when the horizontal duct leg a→b (occupying [yLo, yHi], half-width
 * `halfW` along the crossed wall) passes through a ROUGH OPENING of any
 * wall it crosses — a duct through an open doorway is physically impossible
 * (round-3 finding: the soffit return leg crossed dead center of a door,
 * half a meter below the head). Attic legs ride above wall tops, so only
 * soffit paths consult this.
 */
function legCrossesRo(
  walls: WallSlice[],
  a: Pt,
  b: Pt,
  yLo: number,
  yHi: number,
  halfW: number,
): boolean {
  for (const w of walls) {
    if (w.curved || w.length < 0.1 || w.openings.length === 0) continue
    const hit = segSegHit(a, b, [w.start[0], w.start[1]], [w.end[0], w.end[1]])
    if (!hit) continue
    const u = (hit[0] - w.start[0]) * w.dir[0] + (hit[1] - w.start[1]) * w.dir[1]
    const spans = openingSpans(w, yLo, yHi)
    if (spans.some((s) => u > s.lo - halfW && u < s.hi + halfW)) return true
  }
  return false
}

/** Half the RETURN section's widest plan face (verticals present 14" × 8").
 * The emitted junction verticals ride 2×BURY fatter (junction-burial grow)
 * — the extra 5 mm per side spends from the 50 mm DUCT_CLEAR_GAP margin:
 * worst case BOTH bodies of a keep-out pair are grown (a supply boot booked
 * at 0.0762 emits 0.0812; a return vertical booked here at 0.1778 emits
 * 0.1828) against the 0.0762 + 0.1778 + 0.05 = 0.3040 enforced center
 * distance ⇒ 0.3040 − 0.2640 = ≥ 40 mm of true clearance remains. The half
 * itself stays UNGROWN so grille/drop elections (and their baselines)
 * don't move. */
const RETURN_VERT_HALF = Math.max(TRUNK_W, TRUNK_H) / 2

/**
 * The supply-side plan geometry the RETURN path must keep out of (skeptic
 * round 1: the return trunk ran co-axially INSIDE the supply trunk, the
 * riser stood in it, the drop punched through it — placeReturnGrilleSpot
 * cleared wall bands but never the supply network). Derived from the SAME
 * inputs the trunk emission uses, so the model always CONTAINS the emitted
 * network: the trunk spine books its full 14" width (conservative vs the
 * stepped-down segments), branches/boots their 6" round. `layoutHvac`'s
 * trunk block consumes this spine too — one axis computation, no drift.
 */
function supplySpineOf(
  walls: WallSlice[],
  rooms: RoomSlice[],
): {
  alongX: boolean
  axisCross: number
  equipAt: Pt
  registerAts: { room: RoomSlice; at: Pt }[]
  obstacles: PlanSeg[]
} | null {
  const conditioned = rooms.filter((r) => r.category !== 'garage')
  const habitable = conditioned.filter((r) => r.category !== 'hallway')
  if (habitable.length === 0) return null
  const equipAt = centroid(equipmentRoomOf(rooms).polygon)
  const registerAts = habitable.map((room) => ({
    room,
    at: roomInteriorPoint(room.polygon, walls),
  }))
  const hallway = rooms.find((r) => r.category === 'hallway')
  const axisSource = hallway ? bounds(hallway.polygon) : bounds(registerAts.map((r) => r.at))
  const alongX = axisSource.maxX - axisSource.minX >= axisSource.maxZ - axisSource.minZ
  const axisCross = hallway
    ? alongX
      ? (axisSource.minZ + axisSource.maxZ) / 2
      : (axisSource.minX + axisSource.maxX) / 2
    : alongX
      ? equipAt[1]
      : equipAt[0]
  const u = (p: Pt): number => (alongX ? p[0] : p[1])
  const onAxis = (uu: number): Pt => (alongX ? [uu, axisCross] : [axisCross, uu])
  const uEq = u(equipAt)
  const obstacles: PlanSeg[] = []
  // supply riser (vertical at the AH) + the feed leg to the axis
  obstacles.push({ a: equipAt, b: equipAt, half: RETURN_VERT_HALF })
  obstacles.push({ a: equipAt, b: onAxis(uEq), half: TRUNK_W / 2 })
  // the trunk spine between its extreme takeoffs — full width, conservative
  const us = [uEq, ...registerAts.map((r) => u(r.at))]
  obstacles.push({
    a: onAxis(Math.min(...us)),
    b: onAxis(Math.max(...us)),
    half: TRUNK_W / 2,
  })
  // branches to each register + the boot at its drop point
  for (const { at } of registerAts) {
    obstacles.push({ a: onAxis(u(at)), b: at, half: BRANCH_SIDE / 2 })
    obstacles.push({ a: at, b: at, half: BRANCH_SIDE / 2 })
  }
  return { alongX, axisCross, equipAt, registerAts, obstacles }
}

/**
 * Where the central RETURN GRILLE lives (B19a+c): a CENTRAL conditioned room
 * — the hallway when there is one, else the equipment room itself (when
 * conditioned), else the largest conditioned room — NEVER the garage
 * (M1602.2(1)). The point starts at the room's interior point and slides to
 * clear (1) every wall band by the return section's own margin, (2) the
 * whole SUPPLY network's plan footprint (trunk/feed/branches/boots/riser —
 * round-1 blocker: the riser stood inside the supply trunk), and (3) the
 * room's own supply register. `clear: false` marks a compromised placement
 * (relaxed passes) — callers must ⚠-flag it, never accept it silently
 * (round-1 findings 2/3). Exported so the thermostat auto-spot can target
 * the REAL return.
 */
export function placeReturnGrilleSpot(
  walls: WallSlice[],
  rooms: RoomSlice[],
): { room: RoomSlice; at: Pt; clear: boolean } | null {
  rooms = hvacServedRooms(rooms)
  const conditioned = rooms.filter((r) => r.category !== 'garage')
  if (conditioned.length === 0) return null
  const equip = equipmentRoomOf(rooms)
  const equipAt = centroid(equip.polygon)
  const spine = supplySpineOf(walls, rooms)
  const room =
    rooms.find((r) => r.category === 'hallway') ??
    (equip.category !== 'garage'
      ? equip
      : ([...conditioned].sort(
          (a, b) => polygonArea(b.polygon) - polygonArea(a.polygon),
        )[0] as RoomSlice))
  const base = roomInteriorPoint(room.polygon, walls)
  // Habitable rooms carry a supply register exactly at `base` — the open
  // return can't share the drop point with a supply boot. This floor holds
  // on EVERY pass (round-1 finding 3: the verbatim-base fallback parked the
  // grille ON the register).
  const hasRegister = room.category !== 'hallway'
  const registerClear = (q: Pt): boolean =>
    !hasRegister || Math.hypot(q[0] - base[0], q[1] - base[1]) >= 0.5
  const clearAt = (q: Pt, minEquip: number, checkSupply: boolean): boolean =>
    pointInPolygon(q, room.polygon) &&
    wallBandAt(q, walls, RETURN_WALL_MARGIN) === null &&
    Math.hypot(q[0] - equipAt[0], q[1] - equipAt[1]) >= minEquip &&
    (!checkSupply || spine === null || clearOfSegs(spine.obstacles, q, RETURN_VERT_HALF)) &&
    registerClear(q)
  const search = (minEquip: number, checkSupply: boolean): Pt | null => {
    if (clearAt(base, minEquip, checkSupply)) return base
    for (let step = 0.15; step <= 1.66; step += 0.15) {
      for (let k = 0; k < 8; k++) {
        const ang = (k * Math.PI) / 4
        const q: Pt = [base[0] + Math.cos(ang) * step, base[1] + Math.sin(ang) * step]
        if (clearAt(q, minEquip, checkSupply)) return q
      }
    }
    return null
  }
  // Pass 1 keeps the grille beyond the return drop (the trunk leg stays a
  // real member); pass 2 settles for supply clearance alone; pass 3 keeps
  // only the hard floors (wall bands + register) and reports the compromise.
  const at = search(RETURN_DROP_OFFSET + 0.55, true) ?? search(0.6, true)
  if (at) return { room, at, clear: true }
  const relaxed = search(0, false)
  if (relaxed) return { room, at: relaxed, clear: false }
  return { room, at: base, clear: false }
}

/**
 * True when a DOOR opening sits on the room's boundary (sampled just inside
 * both faces of the door's wall) — the room can be closed off from the
 * central return, so its supply register carries the transfer-path
 * assumption label (M1602.2). Rooms reached only through cased openings /
 * open plan carry no door and stay label-free.
 */
function doorTouchesRoom(walls: WallSlice[], room: RoomSlice): boolean {
  return walls.some(
    (w) =>
      !w.curved &&
      w.openings.some((o) => {
        if (o.kind !== 'door') return false
        const at = wallPointAt(w, o.u)
        const reach = w.thickness / 2 + 0.15
        const sides: Pt[] = [
          [at[0] - w.dir[1] * reach, at[1] + w.dir[0] * reach],
          [at[0] + w.dir[1] * reach, at[1] - w.dir[0] * reach],
        ]
        return sides.some((p) => pointInPolygon(p, room.polygon))
      }),
  )
}

/**
 * AUTO spot for the thermostat: the INTERIOR wall face nearest the return /
 * air handler (it must read mixed house air, not an exterior wall's envelope
 * temperature), device center 52" AFF, clear of rough openings. Exported so
 * the Bones panel's "Place service points" action seeds a `bones:service`
 * thermostat node exactly where the engine auto-places.
 */
export function placeThermostatSpot(
  walls: WallSlice[],
  rooms: RoomSlice[],
): { wall: WallSlice; u: number; heightAff: number } | null {
  rooms = hvacServedRooms(rooms)
  if (rooms.length === 0) return null
  const equipAt = centroid(equipmentRoomOf(rooms).polygon)
  // The tstat reads MIXED return air — target the actual central return
  // grille (B19: no longer glued to the air handler; it may sit in the
  // hallway while the AH lives in the laundry or, worst case, the garage).
  const target: Pt = placeReturnGrilleSpot(walls, rooms)?.at ?? [
    equipAt[0] + 0.5,
    equipAt[1] + 0.5,
  ]
  const straight = walls.filter((w) => !w.curved && w.length >= 0.1)
  const pick = (candidates: WallSlice[]): { wall: WallSlice; u: number } | null => {
    let best: { wall: WallSlice; u: number } | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const wall of candidates) {
      const [ax, az] = wall.start
      const point = projectOnto([ax, az], [wall.end[0], wall.end[1]], target)
      const d = Math.hypot(point[0] - target[0], point[1] - target[1])
      if (d < bestDist) {
        bestDist = d
        best = {
          wall,
          u: (point[0] - ax) * wall.dir[0] + (point[1] - az) * wall.dir[1],
        }
      }
    }
    return best
  }
  const spot = pick(straight.filter((w) => !w.exterior)) ?? pick(straight)
  if (!spot) return null
  const raw = Math.max(0, Math.min(spot.wall.length, spot.u))
  const u = clearOfOpenings(spot.wall, raw, TSTAT_AFF - 0.15, TSTAT_AFF + 0.15)
  return { wall: spot.wall, u, heightAff: TSTAT_AFF }
}

/** Floor-coverage polygons the outdoor-spot validation probes — compute's
 * probe slabs (this level's slabs, else the storey-below footprint, else
 * indoor-zone pseudo-slabs; probeSlabsFor owns the widening). Structural:
 * only `polygon` (+ `holes`) is read, so SlabSlice threads straight in. */
export type CoverageSlice = {
  polygon: readonly Pt[]
  holes?: readonly (readonly Pt[])[]
}

/**
 * True when a condenser pad spot stands in OPEN AIR (the B12 rod-scan
 * precedent — validate against the SCENE, not the wall label):
 *  (a) not inside any INDOOR room polygon — a pad in a bathroom is never
 *      right; an OUTDOOR zone (courtyard garden / patio / yard) IS open
 *      air, so it legitimizes the spot — a courtyard condenser is a real
 *      install (decided here: outdoor zones validate, they never block);
 *  (b) not inside any wall's body (checked before the outdoor-zone pass —
 *      zone polygons trace wall centerlines, and a spot in the wall band
 *      is in the WALL, whatever zone claims the area);
 *  (c) not under floor coverage — a covered-but-zoneless mid-plan void is
 *      still INSIDE the building (the Julien-scene gap region); slab HOLES
 *      are courtyards and don't count as cover.
 */
function spotIsOutdoors(
  spot: Pt,
  walls: WallSlice[],
  rooms: RoomSlice[],
  coverage: readonly CoverageSlice[],
): boolean {
  let outdoorZone = false
  for (const room of rooms) {
    if (!pointInPolygon(spot, room.polygon)) continue
    if (room.category !== 'outdoor') return false
    outdoorZone = true
  }
  if (wallBandAt(spot, walls, 0) !== null) return false
  if (outdoorZone) return true
  for (const cover of coverage) {
    if (!pointInPolygon(spot, cover.polygon)) continue
    if (cover.holes?.some((h) => h.length >= 3 && pointInPolygon(spot, h))) continue
    return false
  }
  return true
}

/**
 * CONDENSER ELECTION (Julien-scene root cause, 2026-08-22): wall.exterior
 * is INPUT, not truth — host floor-coverage gaps classify interior
 * partitions exterior=true, and trusting the NEAREST one pushed the pad
 * 0.6 m "outward" into the Bathroom at (-2.6, 3.25). Candidates walk BY
 * DISTANCE from the equipment room (shortest line-set among the walls
 * whose pad spot really is outdoors — spotIsOutdoors); when EVERY exterior
 * wall fails, the nearest (least-bad) election is kept with
 * `validated: false` so layoutHvac can flag the units + warn (never
 * silent). `rooms` is the UNFILTERED zone list — outdoor zones legitimize
 * a courtyard spot. The false-exterior classification itself is a separate
 * election-INPUT problem (its fix has its own byte-equality blast radius,
 * board-noted); the election is merely robust to it.
 */
export function electHeatPumpExit(
  walls: WallSlice[],
  rooms: RoomSlice[],
  coverage: readonly CoverageSlice[] = [],
): { wall: WallSlice; at: Pt; spot: Pt; validated: boolean } | null {
  const served = hvacServedRooms(rooms)
  if (served.length === 0) return null
  const equipAt = centroid(equipmentRoomOf(served).polygon)
  const candidates: { wall: WallSlice; at: Pt; d: number }[] = []
  for (const wall of walls) {
    if (!wall.exterior || wall.curved) continue
    const at = projectOnto([wall.start[0], wall.start[1]], [wall.end[0], wall.end[1]], equipAt)
    candidates.push({ wall, at, d: Math.hypot(at[0] - equipAt[0], at[1] - equipAt[1]) })
  }
  if (candidates.length === 0) return null
  // Stable sort keeps wall order on ties — the same wall nearestExteriorExit
  // (strict <, iteration order) elected before validation existed.
  candidates.sort((a, b) => a.d - b.d)
  // Per-candidate stand-off: t/2 + 24" face clearance + cabinet depth/2
  // (condenserStandoff) — the spot is the CABINET CENTER, so the face
  // clearance is honest for THIS wall's thickness, not a flat guess.
  const spotOf = (at: Pt, wall: WallSlice): Pt => {
    const ox = at[0] - equipAt[0]
    const oz = at[1] - equipAt[1]
    const n = Math.max(1e-6, Math.hypot(ox, oz))
    const off = condenserStandoff(wall.thickness)
    return [at[0] + (ox / n) * off, at[1] + (oz / n) * off]
  }
  for (const cand of candidates) {
    const spot = spotOf(cand.at, cand.wall)
    if (spotIsOutdoors(spot, walls, rooms, coverage)) {
      return { wall: cand.wall, at: cand.at, spot, validated: true }
    }
  }
  const nearest = candidates[0] as { wall: WallSlice; at: Pt; d: number }
  return {
    wall: nearest.wall,
    at: nearest.at,
    spot: spotOf(nearest.at, nearest.wall),
    validated: false,
  }
}

/**
 * AUTO plan point of the heat-pump / condenser pad: condenserStandoff
 * (t/2 + 24" face clearance + cabinet depth/2) outside the nearest exterior
 * wall whose spot VALIDATES as outdoors (shortest lineset among walls that
 * are really exterior — electHeatPumpExit; off the wall so the mfr
 * service/airflow clearance survives). Exported for the Bones panel action.
 */
export function placeHeatPumpSpot(
  walls: WallSlice[],
  rooms: RoomSlice[],
  coverage: readonly CoverageSlice[] = [],
): Pt | null {
  return electHeatPumpExit(walls, rooms, coverage)?.spot ?? null
}

/** Plan point on a wall centerline at distance `u` from its start. */
function wallPointAt(wall: WallSlice, u: number): Pt {
  return [wall.start[0] + wall.dir[0] * u, wall.start[1] + wall.dir[1] * u]
}

/** One placed outdoor unit: plan center, its wall anchor, outward normal. */
type CondenserSlot = {
  at: Pt
  /** Along-wall anchor (pad center + line-set penetration + disconnect). */
  u: number
  /** Unit outward normal (away from the house). */
  out: Pt
}

/**
 * The condenser row: unit #1 sits AT the anchor (the heat-pump service node
 * verbatim when present — checklist A4 — else the auto pad spot, slid along
 * the wall only if it fronts a door/window RO), subsequent units step along
 * the SAME exterior wall at pad + 0.6 m clear pitch, each ≥ 0.3 m off the
 * wall face, never in front of a rough opening (slide past it). When one
 * direction runs off the wall the row grows the other way; a row that
 * exhausts both directions keeps its pitch past the end and warns.
 */
/**
 * Where the heat-pump SERVICE NODE should seed: the engine's unit-#1 anchor
 * AFTER the condenser row's RO slide AND its grid snap (HP polish item 3 —
 * the seed must be the exact spot the engine composes, or creation alone
 * would move the unit; the ε-anchor's post-seed == auto byte parity rides
 * this identity) — seeding at the raw spot let the sign sit fronting a
 * window the engine had already slid away from (A4 seed parity, night-4
 * narrow round). equipAt only matters for the degenerate on-wall-anchor
 * fallback, so the anchor itself is a safe stand-in.
 */
export function placeCondenserSeedSpot(
  walls: WallSlice[],
  rooms: RoomSlice[],
  coverage: readonly CoverageSlice[] = [],
): Pt | null {
  const election = electHeatPumpExit(walls, rooms, coverage)
  if (!election) return null
  const anchor = election.spot
  const served = hvacServedRooms(rooms)
  // The REAL equipAt (dawn review 1d: passing `anchor` let the degenerate
  // on-wall fallback pick the opposite out-normal and seed inside-out).
  const equipAt = served.length > 0 ? centroid(equipmentRoomOf(served).polygon) : anchor
  const row = condenserRow(walls, anchor, false, 1, equipAt, election.wall)
  const slid = row.slots[0]?.at
  if (!slid) return anchor
  // Corner-flip guard (dawn review 1e, re-oracled round 2): the slid spot
  // must still DERIVE from the elected wall — its along-wall projection
  // stays within the wall's span; a slide that ran off the wall keeps the
  // raw anchor. The old oracle asked nearestExteriorExit(slid) — the exact
  // wrong-wall race the row fix retired: a garden fence 0.4 m from the pad
  // ALWAYS beats the elected wall (≥ 1 m by construction — condenserStandoff:
  // t/2 + 24" face clearance + cabinet depth/2), so the guard
  // bailed to the raw anchor and the seeded node recomposed dead-center on
  // the very RO the engine had slid past (round-2 finding). Compose-time
  // coherence for the seeded node is layoutHvac's ε-anchor.
  const u =
    (slid[0] - election.wall.start[0]) * election.wall.dir[0] +
    (slid[1] - election.wall.start[1]) * election.wall.dir[1]
  if (u < 0 || u > election.wall.length) return anchor
  return slid
}

function condenserRow(
  walls: WallSlice[],
  anchor: Pt,
  anchorVerbatim: boolean,
  count: number,
  equipAt: Pt,
  /** Pre-elected anchor wall (the VALIDATED election): the row must anchor
   * to the same wall the spot validated against — re-deriving by nearest
   * could re-elect a false-exterior partition standing closer to the pad.
   * Verbatim overrides keep the nearest-exit derivation (unchanged). */
  electedWall?: WallSlice,
): {
  wall: WallSlice | null
  slots: CondenserSlot[]
  warnings: string[]
  /** Unit #1's PRE-grid-snap spot (the pre-polish auto anchor) — the
   * ε-anchor consumes it so service nodes SEEDED BEFORE the grid snap
   * shipped are still recognized as the machine's own point (their row
   * keeps the elected wall; A4 — an old seed is never silently
   * re-anchored). Equals `slots[0].at` for verbatim anchors and whenever
   * the snap is an identity. */
  unit1Presnap: Pt | null
  /** True when the world-grid candidate window exhausted (clearance /
   * openings / wall span) and unit #1 stands at the honest UN-SNAPPED
   * spot — layoutHvac flags the pad + cabinet (COND_OFF_GRID_FLAG, verify
   * round F3). Always false for verbatim anchors (they never snap). */
  unit1OffGrid: boolean
} {
  const warnings: string[] = []
  const exit = electedWall
    ? {
        at: projectOnto(
          [electedWall.start[0], electedWall.start[1]],
          [electedWall.end[0], electedWall.end[1]],
          anchor,
        ),
        wall: electedWall,
      }
    : nearestExteriorExit(walls, anchor)
  if (!exit) {
    // No exterior wall at all — stack the row along +X from the anchor.
    const pitch = COND_PAD_SIDE + COND_UNIT_CLEAR
    const slots: CondenserSlot[] = Array.from({ length: count }, (_, i) => ({
      at: [anchor[0] + i * pitch, anchor[1]] as Pt,
      u: 0,
      out: [0, 1] as Pt,
    }))
    if (count > 0) warnings.push('no exterior wall — condenser row placed at the anchor, verify')
    // rowless: no snap runs (already ⚠-warned) — never the off-grid class
    return { wall: null, slots, warnings, unit1Presnap: slots[0]?.at ?? null, unit1OffGrid: false }
  }
  const wall = exit.wall
  const u0 = Math.max(0, Math.min(wall.length, (anchor[0] - wall.start[0]) * wall.dir[0] + (anchor[1] - wall.start[1]) * wall.dir[1]))
  // Out-normal foot from the SAME clamped-u lerp the slide/penetration math
  // uses — NOT exit.at: projectOnto's dot·axis/len² form drifts one ULP on
  // non-dyadic coordinates (e.g. a slid anchor at u = 6.15…95 footed back
  // at 6.15), handing the verbatim seed round-trip a ~1e-16 out-normal x
  // and breaking the ε-anchor's post-seed == auto BYTE equality (the old
  // keepout arithmetic only ever produced dyadic u values, which masked
  // the class — unwarp round 2026-08-23). Same clamp, same point, stable
  // bits.
  const foot = wallPointAt(wall, u0)
  // Outward normal: anchor relative to its wall foot; a degenerate on-wall
  // anchor falls back to "away from the equipment room".
  const ox = anchor[0] - foot[0]
  const oz = anchor[1] - foot[1]
  const off = Math.hypot(ox, oz)
  let out: Pt
  if (off > 1e-6) out = [ox / off, oz / off]
  else {
    const n: Pt = [-wall.dir[1], wall.dir[0]]
    const sign = (foot[0] - equipAt[0]) * n[0] + (foot[1] - equipAt[1]) * n[1] >= 0 ? 1 : -1
    out = [n[0] * sign, n[1] * sign]
  }
  // Row units keep the anchor's stand-off, floored at the mfr clearance:
  // wall face + 0.3 m + half the cabinet depth.
  const minOff = wall.thickness / 2 + COND_WALL_CLEAR + COND_DIMS[2] / 2
  const rowOff = Math.max(off, minOff)
  const halfW = COND_PAD_SIDE / 2
  // Keep-outs: rough openings whose vertical span reaches the unit/disconnect
  // zone [0, pad + cabinet + disconnect], padded by half a pad + slack.
  const keepouts = openingSpans(wall, 0, COND_PAD_T + COND_DIMS[1] + DISCONNECT_ABOVE_UNIT).map(
    (s) => ({ lo: s.lo - halfW - 0.05, hi: s.hi + halfW + 0.05 }),
  )
  const slide = (u: number, d: 1 | -1): number => {
    let v = u
    for (let guard = 0; guard < 24; guard++) {
      const hit = keepouts.find((k) => v > k.lo && v < k.hi)
      if (!hit) return v
      v = d > 0 ? hit.hi : hit.lo
    }
    return v
  }
  const inRange = (u: number): boolean => u >= halfW && u <= wall.length - halfW
  const inKeepout = (u: number): boolean => keepouts.some((k) => u > k.lo && u < k.hi)
  // Unit #1: verbatim override anchors exactly; the auto spot slides to the
  // NEAREST clear along-wall position when it fronts an RO.
  let u1 = u0
  if (!anchorVerbatim) {
    const fwd = slide(u0, 1)
    const bwd = slide(u0, -1)
    const cands = [fwd, bwd].filter((c) => inRange(c))
    u1 = cands.length > 0
      ? (cands.reduce((best, c) => (Math.abs(c - u0) < Math.abs(best - u0) ? c : best)) as number)
      : fwd
  }
  const unit1Presnap: Pt =
    anchorVerbatim || u1 === u0 ? anchor : (() => {
      const p = wallPointAt(wall, u1)
      return [p[0] + out[0] * rowOff, p[1] + out[1] * rowOff] as Pt
    })()
  // GRID SNAP — AUTO anchors only (HP polish, Julien: "let's make sure it's
  // aligned normally"; verify round F1 corrected the FRAME): the machine's
  // unit-#1 spot lands on **WORLD XZ** grid multiples
  // ({@link EDITOR_GRID_STEP_M} — the grid the editor renders, the host
  // floorStrategy convention), NOT wall-frame multiples (which sit visibly
  // off the lattice on oblique walls — the skeptic's 0.153/0.496 residual
  // exhibit). Deterministic candidate search over the world lattice within
  // ±{@link COND_GRID_WINDOW_STEPS} steps of the honest (RO-slid) spot:
  //  - VALID = on the wall span, clear of the RO keepouts, AND standing at
  //    least the honest stand-off from the wall line (the snap only ever
  //    moves AWAY from the wall — the ≥ 24" face clearance is a FLOOR);
  //  - PICK (round-2 F2a): LEAST STAND-OFF first — the accepted stand-off
  //    is the minimum the window permits, which is what makes the M2
  //    reach bounds provable — then nearest to the honest spot, then the
  //    smaller along-wall coordinate. TOTAL + DETERMINISTIC: two distinct
  //    lattice points cannot share both s and u (orthogonal coordinates
  //    of the plan), so the (s, d², u) triple always strictly orders
  //    distinct candidates; fixed iteration order breaks nothing else.
  //    On axis-parallel walls this picks EXACTLY what nearest-first
  //    picked (keepouts are u-only there, so every s-row offers the same
  //    u-columns and the minimal valid row always contained the overall
  //    nearest candidate) — PROVEN by the byte-identical E5 recapture,
  //    not assumed;
  //  - EXHAUSTED window (clearance/openings/span leave no lattice spot) =
  //    the honest un-snapped position + COND_OFF_GRID_FLAG (verify F3) —
  //    physics beats the grid, and it says so.
  // The chosen lattice point is taken VERBATIM as the anchor (exact world
  // multiples, no reconstruction dust) and u/out/stand-off re-derive from
  // it EXACTLY like the verbatim path — so the machine-seeded round-trip
  // (post-seed == auto) stays byte-equal by construction, oblique walls
  // included. Verbatim anchors never snap (A4 — the host move tool already
  // applied the user's own grid mode); row units 2..N share the final
  // stand-off but keep the mfr-clearance pitch (grid alignment is the
  // ANCHOR's property; unit spacing is a clearance truth).
  let uFinal = u1
  let outFinal = out
  let rowOffFinal = rowOff
  let at1: Pt = anchor
  let unit1OffGrid = false
  if (!anchorVerbatim) {
    const h = EDITOR_GRID_STEP_M
    const gx0 = Math.round(unit1Presnap[0] / h) * h
    const gz0 = Math.round(unit1Presnap[1] / h) * h
    let best: { g: Pt; d2: number; s: number; u: number } | null = null
    for (let i = -COND_GRID_WINDOW_STEPS; i <= COND_GRID_WINDOW_STEPS; i++) {
      for (let j = -COND_GRID_WINDOW_STEPS; j <= COND_GRID_WINDOW_STEPS; j++) {
        const g: Pt = [gx0 + i * h, gz0 + j * h]
        const uG =
          (g[0] - wall.start[0]) * wall.dir[0] + (g[1] - wall.start[1]) * wall.dir[1]
        if (!inRange(uG) || inKeepout(uG)) continue
        // perpendicular offset from the wall LINE (out ⊥ dir ⇒ constant
        // along the wall) — the away-only floor, with 1e-9 float grace so
        // an exactly-on-grid honest spot keeps its own stand-off
        const sG = (g[0] - wall.start[0]) * out[0] + (g[1] - wall.start[1]) * out[1]
        if (sG < rowOff - 1e-9) continue
        const dx = g[0] - unit1Presnap[0]
        const dz = g[1] - unit1Presnap[1]
        const d2 = dx * dx + dz * dz
        if (
          !best ||
          sG < best.s ||
          (sG === best.s && (d2 < best.d2 || (d2 === best.d2 && uG < best.u)))
        ) {
          best = { g, d2, s: sG, u: uG }
        }
      }
    }
    at1 = best ? best.g : unit1Presnap
    unit1OffGrid = !best
    // Re-derive the wall geometry from the FINAL point with the exact
    // verbatim-path expressions (same clamp, same normalize) — the seeded
    // node's recompose reproduces these bits, snapped or honest-off-grid.
    uFinal = Math.max(
      0,
      Math.min(
        wall.length,
        (at1[0] - wall.start[0]) * wall.dir[0] + (at1[1] - wall.start[1]) * wall.dir[1],
      ),
    )
    const footF = wallPointAt(wall, uFinal)
    const ofx = at1[0] - footF[0]
    const ofz = at1[1] - footF[1]
    const offF = Math.hypot(ofx, ofz)
    // offF ≥ the stand-off floor by construction (≫ the 1e-6 degenerate)
    outFinal = [ofx / offF, ofz / offF]
    rowOffFinal = Math.max(offF, minOff)
  }
  const slots: CondenserSlot[] = []
  slots.push({ at: at1, u: uFinal, out: outFinal })
  // Subsequent units: step along the wall at pad + clear pitch, sliding past
  // ROs; grow the other way when a direction runs out of wall.
  const pitch = COND_PAD_SIDE + COND_UNIT_CLEAR
  const d0: 1 | -1 = wall.length - uFinal >= uFinal ? 1 : -1
  let fwdCursor = uFinal
  let bwdCursor = uFinal
  for (let k = 1; k < count; k++) {
    let u = slide(fwdCursor + d0 * pitch, d0)
    if (inRange(u)) fwdCursor = u
    else {
      const alt = slide(bwdCursor - d0 * pitch, (d0 === 1 ? -1 : 1) as 1 | -1)
      if (inRange(alt)) {
        u = alt
        bwdCursor = alt
      } else {
        u = fwdCursor + d0 * pitch
        fwdCursor = u
        warnings.push('condenser row exceeds the exterior wall — verify placement')
      }
    }
    const p = wallPointAt(wall, u)
    slots.push({
      at: [p[0] + outFinal[0] * rowOffFinal, p[1] + outFinal[1] * rowOffFinal] as Pt,
      u,
      out: outFinal,
    })
  }
  return { wall, slots, warnings, unit1Presnap, unit1OffGrid }
}

export function layoutHvac(
  walls: WallSlice[],
  rooms: RoomSlice[],
  spec: FramingSpec = DEFAULT_SPEC,
  overrides?: Pick<ServiceOverrides, 'thermostat' | 'heatPump'>,
  context?: {
    hasLevelAbove?: boolean
    stateCode?: string
    /** Floor coverage for the condenser-spot validation — compute threads
     * its probe slabs (probeSlabsFor); direct callers may omit it and the
     * election validates on zones + wall bands alone. */
    coverage?: readonly CoverageSlice[]
  },
): { members: Member[]; fixtures: Fixture[]; warnings: string[] } {
  const members: Member[] = []
  const fixtures: Fixture[] = []
  const warnings: string[] = []
  // Outdoor zones drop out entirely: a level with ONLY a garden/patio has no
  // AH — and per the condenser-always contract (no AH ⇒ no outdoor unit,
  // nothing silent about it) that is the honest compose.
  // The UNFILTERED zone list survives for the condenser-spot validation:
  // an OUTDOOR zone (courtyard garden) legitimizes a pad spot there, and
  // the election must see it (hvacServedRooms drops it).
  const zonesAll = rooms
  rooms = hvacServedRooms(rooms)
  if (rooms.length === 0) return { members, fixtures, warnings }
  const fab = spec.detail !== '200'

  const conditioned = rooms.filter((r) => r.category !== 'garage')
  const habitable = conditioned.filter((r) => r.category !== 'hallway')
  if (habitable.length === 0) return { members, fixtures, warnings }

  const areaM2 = conditioned.reduce((sum, r) => sum + polygonArea(r.polygon), 0)
  const habitableArea = habitable.reduce((sum, r) => sum + polygonArea(r.polygon), 0)
  // ONE system tonnage (IRC M1401.3): Manual-J-lite load → Manual S
  // selection, or the labeled sqft fallback — air handler, duct cfm, return
  // grille and the condenser row all size from this plan (the old engine
  // ran the AH at 1 ton/500 sqft NEXT TO condensers at 450/550/650).
  const plan = sizeCoolingPlan(walls, rooms, areaM2, context?.stateCode)
  // The system figure is the INSTALLED capacity (count × unitTons — what
  // the cabinets actually add up to; == the selection for single-unit
  // plans). The drawn single indoor coil serves the installed units, so
  // the AH label/cfm/grille must say 6.0 when the cabinets say 2 × 3.0 —
  // an AH reading 5.5 beside 6.0 tons of cabinets was its own honesty gap
  // (skeptic F2); the plan-vs-installed distinction is stated on the AH
  // label when they differ.
  const tons = plan.installedTons
  const totalCfm = tons * CFM_PER_TON
  if (plan.basis === 'manual-j-lite' && !plan.withinManualSBand && plan.load) {
    warnings.push(
      `cooling selection ${plan.totalTons} tons sits outside the Manual S 95–115% band for the ${plan.load.loadTons.toFixed(2)}-ton Manual J-lite load (stock half-ton steps / 1.5-ton floor) — verify equipment selection (M1401.3)`,
    )
  }
  // INSTALLED-SUM band (skeptic F2): the ≤5-ton split rounds each unit to
  // a stock half ton, so the installed sum can leave the band the plan
  // total passed — say so, never silently.
  if (
    plan.basis === 'manual-j-lite' &&
    plan.load &&
    plan.withinManualSBand &&
    !plan.installedWithinBand
  ) {
    // one-decimal percent: a 115.1% overrun rounded to '115%' would read
    // as '115% exceeds the 115% band' — a printed contradiction
    warnings.push(
      `installed ${plan.installedTons} tons = ${((plan.installedTons / plan.load.loadTons) * 100).toFixed(1)}% of the ${plan.load.loadTons.toFixed(2)}-ton Manual J-lite load — exceeds the Manual S 115% band (stock unit steps after the ≤5-ton split); verify selection`,
    )
  }
  // MULTI-SYSTEM HONESTY: the load takes N>1 condensers, but this engine's
  // duct machinery models ONE trunk network from ONE equipment point
  // (supplySpineOf) — drawing N air handlers would invent zoning it cannot
  // route (no zoning dampers, no per-system register split). One indoor
  // coil/exchanger is DRAWN and the assumption is stated here + on the AH
  // label, never silent.
  if (plan.count > 1) {
    warnings.push(
      `cooling load takes ${plan.count} condensers — ONE air handler/duct system drawn (single indoor coil/exchanger assumption; multi-system zoning not modeled, Manual S/D govern) — verify`,
    )
  }
  const ceiling = Math.min(...conditioned.map((r) => r.ceilingHeight))
  // DUCTS NEVER CROSS TOP PLATES (prod report): the trunk plane sits above
  // the TALLEST wall's plate band — R602.6/R602.6.1 cap plate notching/
  // boring (a >50% bored plate needs a 16 ga tie) and a duct never fits, so
  // practice is an attic trunk above the ceiling joists (M1601) with supply
  // boots dropping through the CEILING.
  // INTERIOR STOREYS (a walled storey stacked above — skeptic 2026-08-16:
  // the "attic" trunk rose INTO the storey above): there is no attic, so the
  // trunk caps below this storey's ceiling as a dropped-soffit run and the
  // level says so. Top storeys keep the attic routing.
  const wallTop = walls.reduce((m, w) => Math.max(m, w.height), ceiling)
  const interiorStorey = context?.hasLevelAbove === true
  const trunkY = interiorStorey ? ceiling - SOFFIT_DROP : wallTop + TRUNK_ATTIC_CLEARANCE
  if (interiorStorey) {
    warnings.push('interior-storey ducts run in soffits/floor webs — verify')
  }

  const equipRoom = equipmentRoomOf(rooms)
  const equipAt = centroid(equipRoom.polygon)
  // GARAGE AIR HANDLER (B19a BLOCKER): only reachable when the scene has NO
  // conditioned service space (laundry/utility, closet, hallway) — keep it,
  // but LOUDLY: M1602.2(1) forbids garage return air (the open grille moves
  // to a conditioned room below) and R302.5.2 restricts garage duct
  // penetrations. Never silent.
  if (equipRoom.category === 'garage') {
    warnings.push(
      'air handler in garage — M1602.2(1) forbids garage return air; provide a sealed return + R302.5.2 duct protection — verify',
    )
  }

  fixtures.push({
    system: 'hvac',
    kind: 'equipment',
    position: [equipAt[0], 1.0, equipAt[1]],
    rotationY: 0,
    sourceId: equipRoom.id,
    label:
      `Air handler — ${tons} ton (${plan.sizingNote}; Manual J/S govern)` +
      (plan.count > 1
        ? ` — serves ${plan.count} condensers (${plan.count} × ${plan.unitTons} t installed${
            plan.installedTons !== plan.totalTons
              ? ` vs ${plan.totalTons} t selected`
              : ''
          }), single indoor coil assumption`
        : ''),
    meta: {
      tons,
      // the Manual S SELECTION, when the installed sum diverged from it
      // (split rounding) — single-unit scenes carry no duplicate key
      ...(plan.installedTons !== plan.totalTons ? { selectedTons: plan.totalTons } : {}),
      conditionedSqft: Math.round(areaM2 * 10.7639),
      cfm: totalCfm,
      sizingBasis: plan.basis,
      ...(plan.load
        ? {
            // design load = what Manual S selected from (sensible × latent)
            loadBtuH: Math.round(plan.load.loadTons * 12000),
            sensibleBtuH: Math.round(plan.load.totalBtuH),
            latentFactor: plan.load.latentFactor,
            // fixture meta forbids null — a regime-less zone just omits it
            ...(plan.load.moistureRegime ? { moistureRegime: plan.load.moistureRegime } : {}),
          }
        : {}),
    },
  })

  // The supply spine (axis + register drop points + keep-out footprints) —
  // ONE computation feeds the trunk emission below AND the return path's
  // keep-out checks (round-1 blocker: return tin inside supply tin).
  const spine = supplySpineOf(walls, rooms)
  if (!spine) return { members, fixtures, warnings } // habitable ≠ 0 ⇒ unreachable

  // Central return sized to the tonnage; flag when it can't carry the supply.
  // The GRILLE lives in a central conditioned room (hallway first, NEVER the
  // garage — M1602.2(1)); the return trunk back to the air handler is
  // emitted with the supply network below (B19c).
  const grilleIn2 = returnGrilleIn2(tons)
  const returnCapacityCfm = grilleIn2 * 2 // ≈2 cfm/in² face velocity
  const grilleSpot = placeReturnGrilleSpot(walls, rooms)
  const grilleRoom = grilleSpot?.room ?? equipRoom
  const grilleAt: Pt = grilleSpot?.at ?? [equipAt[0] + 0.5, equipAt[1] + 0.5]
  // A compromised grille spot (relaxed search pass) is never silent —
  // round-1 finding 3: the verbatim fallback interpenetrated boots/branches.
  if (grilleSpot && !grilleSpot.clear) {
    warnings.push(
      `return grille cannot fully clear the supply ducts in ${grilleRoom.name || grilleRoom.id} — verify placement`,
    )
  }
  fixtures.push({
    system: 'hvac',
    kind: 'return',
    position: [grilleAt[0], grilleRoom.ceilingHeight - REGISTER_BELOW_CEILING, grilleAt[1]],
    rotationY: 0,
    sourceId: grilleRoom.id,
    label:
      `Central return — ${grilleIn2} in² grille` +
      (returnCapacityCfm < totalCfm
        ? ` — UNDERSIZED vs ${totalCfm} cfm supply (add a second return)`
        : ''),
    meta: { grilleIn2, capacityCfm: returnCapacityCfm },
  })

  // CEILING registers at habitable room AREA centroids (drop points from
  // the shared supply spine — nudged off wall bands by roomInteriorPoint),
  // cfm from the room's area share — each one is a boot dropping through
  // the ceiling plane; the grille hangs just BELOW the plane (like a
  // recessed light) so it's visible from inside the room.
  const registers: { room: RoomSlice; at: Pt; cfm: number; transferAssumed: boolean }[] =
    spine.registerAts.map(({ room, at }) => {
      const cfm = Math.round(
        (totalCfm * polygonArea(room.polygon)) / Math.max(1e-6, habitableArea),
      )
      // TRANSFER-AIR honesty (M1602.2): a room whose door can close cuts its
      // supply cfm off from the central return — v1 doesn't invent jumper-duct
      // geometry, it LABELS the assumption on the room's register. The grille
      // room itself feeds the return directly.
      const transferAssumed = room.id !== grilleRoom.id && doorTouchesRoom(walls, room)
      fixtures.push({
        system: 'hvac',
        kind: 'register',
        position: [at[0], room.ceilingHeight - REGISTER_BELOW_CEILING, at[1]],
        rotationY: 0,
        sourceId: room.id,
        label:
          `Supply register — ${cfm} cfm (ceiling)` +
          (transferAssumed ? ' — door undercut / jumper duct assumed (M1602.2)' : ''),
        meta: transferAssumed
          ? { cfm, ceiling: true, transferAirAssumed: true }
          : { cfm, ceiling: true },
      })
      return { room, at, cfm, transferAssumed }
    })

  // ---- Manhattan trunk along the hallway axis, stepping down per takeoff ----
  // Axis: the hallway's long bbox axis (corridors are where trunks live);
  // without a hallway, the dominant spread axis of the registers — both
  // computed once in supplySpineOf (shared with the return keep-out model).
  const { alongX, axisCross } = spine
  const u = (p: Pt): number => (alongX ? p[0] : p[1])
  const onAxis = (uu: number): Pt => (alongX ? [uu, axisCross] : [axisCross, uu])

  // SOFFIT legs run inside the storey — a leg crossing a wall through a
  // rough opening hangs in the doorway (round-3 finding; the 2.0–2.2 m
  // supply band grazes a standard 2.17 m head). The supply axis is fixed by
  // the registers, so supply legs FLAG the crossing — never silent; the
  // return path (below) actively routes around ROs first. Attic legs ride
  // above every wall top — immune.
  const doorwayCheck = (
    m: Member | null,
    a: Pt,
    b: Pt,
    kind: 'supply' | 'return',
  ): Member | null => {
    if (
      m &&
      interiorStorey &&
      legCrossesRo(
        walls,
        a,
        b,
        m.position[1] - m.dims[1] / 2,
        m.position[1] + m.dims[1] / 2,
        m.dims[2] / 2,
      )
    ) {
      m.flag = `${kind} duct crosses a doorway — verify routing (soffit/floor-web coordination)`
    }
    return m
  }

  // Feed: the air handler rises into the attic at its own plan point, then a
  // perpendicular leg reaches the trunk axis — every trunk/branch run lives
  // at attic elevation (trunkY), never in the plate band.
  const uEq = u(equipAt)
  // The riser is the supply PLENUM STACK — the receiving body for the feed +
  // trunk (day-9 z-fight): its section swallows the 14×8 runs with BURY of
  // side clearance, and its cap extends BURY past the trunk's center plane
  // (off every boot cap and off the run's own faces — 5 mm inside tin).
  const riser = ductDrop(
    equipAt,
    1.0,
    trunkY + DUCT_JUNCTION_BURY,
    TRUNK_W + 2 * DUCT_JUNCTION_BURY,
    TRUNK_H + 2 * DUCT_JUNCTION_BURY,
    equipRoom.id,
    `Trunk riser ${Math.round(toFeet(TRUNK_W) * 12)}"×${Math.round(toFeet(TRUNK_H) * 12)}" — ${interiorStorey ? 'to soffit (M1601)' : 'to attic (M1601)'}`,
  )
  if (riser) members.push(riser)
  const feed = doorwayCheck(
    duct(
      equipAt,
      onAxis(uEq),
      trunkY,
      TRUNK_W,
      TRUNK_H,
      equipRoom.id,
      `Trunk feed ${Math.round(toFeet(TRUNK_W) * 12)}"×${Math.round(toFeet(TRUNK_H) * 12)}"`,
    ),
    equipAt,
    onAxis(uEq),
    'supply',
  )
  if (feed) members.push(feed)

  // Takeoffs in each direction from the feed point; the cross-section steps
  // down after every takeoff in proportion to the remaining cfm.
  for (const direction of [1, -1] as const) {
    const takeoffs = registers
      .filter((r) => (u(r.at) - uEq) * direction > 0.15)
      .sort((a, b) => (u(a.at) - u(b.at)) * direction)
    // Registers hugging the feed line tee straight off the feed point.
    let remaining = takeoffs.reduce((sum, t) => sum + t.cfm, 0)
    let cursor = uEq
    for (const takeoff of takeoffs) {
      const next = u(takeoff.at)
      const w = Math.max(TRUNK_MIN_W, TRUNK_W * (remaining / Math.max(1, totalCfm)))
      const segment = doorwayCheck(
        duct(
          onAxis(cursor),
          onAxis(next),
          trunkY,
          w,
          TRUNK_H,
          equipRoom.id,
          `Trunk ${Math.round(toFeet(w) * 12)}"×${Math.round(toFeet(TRUNK_H) * 12)}" — ${remaining} cfm`,
        ),
        onAxis(cursor),
        onAxis(next),
        'supply',
      )
      if (segment) members.push(segment)
      cursor = next
      remaining -= takeoff.cfm
    }
  }
  // Branches leave the trunk at right angles to each register (still in the
  // attic), then a drop boot carries the air through the CEILING plane.
  for (const { room, at, cfm, transferAssumed } of registers) {
    const branch = doorwayCheck(
      duct(
        onAxis(u(at)),
        at,
        trunkY,
        BRANCH_SIDE,
        BRANCH_SIDE,
        room.id,
        `6" branch — ${cfm} cfm`,
      ),
      onAxis(u(at)),
      at,
      'supply',
    )
    if (branch) members.push(branch)
    // The boot is the register COLLAR the branch buries into (day-9
    // z-fight): 2×BURY fatter than the 6" branch (its sides clear the
    // branch's by BURY), capped 2×BURY short of the branch's center plane —
    // still deep inside the branch, and never on the plenum riser's cap
    // plane even when the equipment room's own register drops at the same
    // plan point (attic: riser +BURY vs boot −2×BURY; soffit the boot
    // enters from above, so the retreat flips sign).
    const boot = ductDrop(
      at,
      room.ceilingHeight - BOOT_BELOW_CEILING,
      interiorStorey ? trunkY + 2 * DUCT_JUNCTION_BURY : trunkY - 2 * DUCT_JUNCTION_BURY,
      BRANCH_SIDE + 2 * DUCT_JUNCTION_BURY,
      BRANCH_SIDE + 2 * DUCT_JUNCTION_BURY,
      room.id,
      'Supply boot 6" — ceiling drop (M1601)',
    )
    if (boot) {
      // The transfer-path assumption must reach PAPER (examiner round 2:
      // register labels never typeset) — the boot carries it as a member
      // flag, which the takeoff aggregates into ONE Flags row ('N ea') and
      // the schedules flag block prints (P4).
      if (transferAssumed) boot.flag = 'door undercut / jumper duct assumed — M1602.2'
      members.push(boot)
    }
  }

  // ---- RETURN trunk: central grille → return plane → air handler ----
  // Mirrors the supply schematic (B19c — the return-air path used to be
  // MAGIC): full trunk section end to end (the return carries the whole
  // system cfm — same sizing rule the supply trunk starts from; label
  // honesty over invented per-leg cfm). KEEP-OUT discipline (round-1
  // BLOCKER — return tin inside supply tin at the identical trunkY):
  //  - horizontal legs ride their OWN plane, one section height + gap off
  //    the supply plane (up in the attic, down in a soffit), so plan
  //    crossings never share tin;
  //  - the verticals (riser at the grille, drop at the AH) clear the whole
  //    supply footprint in plan — the grille via placeReturnGrilleSpot, the
  //    drop via a candidate ring around the AH that prefers full clearance
  //    and otherwise takes the LEAST-intrusion spot with a ⚠ warning
  //    (round-1 finding 2: the blind dropCands[0] fallback punched through
  //    two closet walls silently);
  //  - in a soffit the legs cross the supply riser's vertical span: the
  //    Manhattan elbow that clears it is chosen (E1's alternate-elbow
  //    pattern), else ⚠. Labels start with 'Return' — the takeoff books
  //    them on their own rows, the MEP sheet prints the return tone.
  {
    const returnY = interiorStorey ? trunkY - RETURN_PLANE_OFFSET : trunkY + RETURN_PLANE_OFFSET
    const gdx = grilleAt[0] - equipAt[0]
    const gdz = grilleAt[1] - equipAt[1]
    const gd = Math.hypot(gdx, gdz)
    const grilleBearing = gd > 1e-6 ? Math.atan2(gdz, gdx) : 0
    // Candidate ring around the AH, ordered by closeness to the grille
    // bearing (the drop wants to face the trunk leg it terminates).
    const dropCands: Pt[] = [0, 1, -1, 2, -2, 3, -3, 4]
      .map((k) => grilleBearing + (k * Math.PI) / 4)
      .map((ang): Pt => [
        equipAt[0] + Math.cos(ang) * RETURN_DROP_OFFSET,
        equipAt[1] + Math.sin(ang) * RETURN_DROP_OFFSET,
      ])
    // Intrusion metric: how deep a vertical at q sinks into wall bands +
    // supply footprints (0 = fully clear).
    const intrusion = (q: Pt): number => {
      let depth = 0
      for (const w of walls) {
        if (w.curved || w.length < 0.1) continue
        const dx = q[0] - w.start[0]
        const dz = q[1] - w.start[1]
        const along = dx * w.dir[0] + dz * w.dir[1]
        if (along < -RETURN_WALL_MARGIN || along > w.length + RETURN_WALL_MARGIN) continue
        const off = Math.abs(-dx * w.dir[1] + dz * w.dir[0])
        depth += Math.max(0, w.thickness / 2 + RETURN_WALL_MARGIN - off)
      }
      for (const s of spine.obstacles) {
        depth += Math.max(0, s.half + RETURN_VERT_HALF + DUCT_CLEAR_GAP - planSegDist(s, q))
      }
      return depth
    }
    const clearDrops = dropCands.filter((q) => intrusion(q) === 0)
    let ahReturnAt: Pt
    if (clearDrops.length > 0) ahReturnAt = clearDrops[0] as Pt
    else {
      ahReturnAt = dropCands.reduce((best, q) => (intrusion(q) < intrusion(best) ? q : best))
      warnings.push(
        `return drop cannot clear walls in ${equipRoom.name || equipRoom.id} — verify routing`,
      )
    }
    const sizeTag = `${Math.round(toFeet(TRUNK_W) * 12)}"×${Math.round(toFeet(TRUNK_H) * 12)}"`
    // Verticals pass W = the NARROW side: a grille-to-attic riser is only
    // ~0.35 m long — with the 14" side in dims[0] it reads as a horizontal
    // run to every dims[1]>dims[0] verticality check (plates harness, plan
    // projection). The section is the same 14×8 either way.
    // Return verticals are the return-side PLENUM class (day-9 z-fight):
    // 2×BURY fatter than the legs entering them, caps BURY past the leg's
    // center plane on the far side from the grille/AH (attic legs sit above
    // the grille, soffit legs below — the extension direction follows).
    const rise = ductDrop(
      grilleAt,
      grilleRoom.ceilingHeight - BOOT_BELOW_CEILING,
      interiorStorey ? returnY - DUCT_JUNCTION_BURY : returnY + DUCT_JUNCTION_BURY,
      TRUNK_H + 2 * DUCT_JUNCTION_BURY,
      TRUNK_W + 2 * DUCT_JUNCTION_BURY,
      'return-trunk',
      `Return riser ${sizeTag} — grille to ${interiorStorey ? 'soffit' : 'attic'} (M1602)`,
    )
    if (rise) members.push(rise)
    // Manhattan legs: in a SOFFIT the return plane sits below the supply
    // plane, inside the supply riser's vertical span, AND inside the storey
    // — so soffit legs must (i) clear the supply riser in plan and (ii)
    // cross walls only at SOLID segments: a 14×8 duct through an open
    // doorway is physically impossible (round-3 finding — the leg crossed
    // dead center of a door, half a meter below its head). The search walks
    // every clear drop candidate × both elbows for a path clearing BOTH;
    // the head-band raise (crossing above the door) is NOT modeled — over a
    // standard 2.17 m head a 2.5 m wall leaves ~0.24 m to the plate band,
    // under the section + margins — so a path that cannot clear keeps the
    // preferred route and FLAGS its crossing legs (never silent). Attic
    // legs ride above every wall top, either elbow is safe there.
    const legLabel = `Return trunk ${sizeTag} — ${totalCfm} cfm (M1602)`
    const legYLo = returnY - TRUNK_H / 2
    const legYHi = returnY + TRUNK_H / 2
    const roClear = (a: Pt, b: Pt): boolean =>
      !legCrossesRo(walls, a, b, legYLo, legYHi, TRUNK_W / 2)
    const legsClearRiser = (via: Pt, drop: Pt): boolean => {
      const need = RETURN_VERT_HALF + TRUNK_W / 2 + DUCT_CLEAR_GAP
      for (const [a, b] of [
        [grilleAt, via],
        [via, drop],
      ] as const) {
        const p = projectOnto(a, b, equipAt)
        if (Math.hypot(p[0] - equipAt[0], p[1] - equipAt[1]) < need) return false
      }
      return true
    }
    let elbow: Pt = [ahReturnAt[0], grilleAt[1]]
    if (interiorStorey) {
      let found: { drop: Pt; via: Pt } | null = null
      for (const drop of clearDrops.length > 0 ? clearDrops : [ahReturnAt]) {
        for (const via of [
          [drop[0], grilleAt[1]],
          [grilleAt[0], drop[1]],
        ] as Pt[]) {
          if (legsClearRiser(via, drop) && roClear(grilleAt, via) && roClear(via, drop)) {
            found = { drop, via }
            break
          }
        }
        if (found) break
      }
      if (found) {
        ahReturnAt = found.drop
        elbow = found.via
      } else {
        // No combination clears everything: keep the preferred drop, take
        // the riser-clear elbow when one exists, and let doorwayCheck flag
        // any leg still crossing an RO.
        if (!legsClearRiser(elbow, ahReturnAt)) {
          const alt: Pt = [grilleAt[0], ahReturnAt[1]]
          if (legsClearRiser(alt, ahReturnAt)) elbow = alt
          else warnings.push('return trunk cannot clear the supply riser — verify routing')
        }
      }
    }
    const legA = doorwayCheck(
      duct(grilleAt, elbow, returnY, TRUNK_W, TRUNK_H, 'return-trunk', legLabel),
      grilleAt,
      elbow,
      'return',
    )
    if (legA) members.push(legA)
    const legB = doorwayCheck(
      duct(elbow, ahReturnAt, returnY, TRUNK_W, TRUNK_H, 'return-trunk', legLabel),
      elbow,
      ahReturnAt,
      'return',
    )
    if (legB) members.push(legB)
    // The drop rises from the AH below the return plane in BOTH modes, so
    // its cap always extends upward past the leg's center plane. Its cap
    // shares the attic riser's plane (both returnY + BURY) but the two
    // stand RETURN_DROP_OFFSET apart in plan — coplanar without overlap is
    // not a z-fight pair.
    const drop = ductDrop(
      ahReturnAt,
      1.0,
      returnY + DUCT_JUNCTION_BURY,
      TRUNK_H + 2 * DUCT_JUNCTION_BURY,
      TRUNK_W + 2 * DUCT_JUNCTION_BURY,
      'return-trunk',
      `Return drop ${sizeTag} — to air handler (M1602)`,
    )
    if (drop) members.push(drop)
  }

  // ---- exhaust: bath fans + laundry dryer vent to exterior terminations ----
  if (fab) {
    for (const room of rooms) {
      if (room.category !== 'bathroom' && room.category !== 'laundry') continue
      const at = centroid(room.polygon)
      const exit = nearestExteriorExit(walls, at)
      if (room.category === 'bathroom') {
        fixtures.push({
          system: 'hvac',
          kind: 'exhaust-fan',
          position: [at[0], room.ceilingHeight - 0.05, at[1]],
          rotationY: 0,
          sourceId: room.id,
          label: 'Bath exhaust fan — 50 cfm (M1505.4)',
          meta: { cfm: 50 },
        })
        if (exit) {
          // High on the wall but BELOW the plate band of every wall the run
          // passes through — the EXIT wall's OWN height governs, not the
          // room ceiling (a shorter exit wall used to put the duct in ITS
          // plate band). The 4" duct exits a stud bay, never a top plate
          // (R602.6).
          const cap = minWallHeightAlong(at, exit.at, exit.wall, room.ceilingHeight, walls)
          manhattanDuct(
            members,
            at,
            exit.at,
            cap - (PLATE_BAND + EXHAUST_SIDE / 2 + 0.03),
            EXHAUST_SIDE,
            EXHAUST_SIDE,
            room.id,
            'Bath exhaust 4" — exterior termination (M1505)',
          )
        }
      } else if (exit) {
        manhattanDuct(
          members,
          at,
          exit.at,
          0.35,
          EXHAUST_SIDE,
          EXHAUST_SIDE,
          room.id,
          'Dryer exhaust 4" — exterior termination (M1502)',
        )
      }
    }
  }

  // ---- outdoor unit on its pad + refrigerant lineset through the wall —
  // at EVERY LOD the air handler ships (condenser-always fix): the old
  // `detail === '400' || hpPlan` gate emitted the AH + the whole duct
  // network at LOD 200/300 with NO outdoor unit and NO warning — the
  // 'sometimes the HVAC does not add the outside heat pump' user report.
  // A heat pump HEATS too, so no climate/size ever justifies zero units
  // (condenserPlan floors at 1 unit / 1.5 tons). Only the condensate drain
  // stays LOD-400 scope. ----
  const hpPlan = overridePlanPoint(walls, overrides?.heatPump)
  // ROTATION OVERRIDE (HP polish item 4 — R-key / rotate-gesture parity):
  // the heat-pump service node's `yawOverride` (written by the host's
  // standard rotate gestures through the bones:service definition) beats
  // the derived wall-square orientation for unit #1's ASSEMBLY — cabinet,
  // pad, and the service pick proxy that reads the fixture's rotationY.
  // Absent/null ⇒ wall-square auto (never a stored copy of the derivation).
  // The disconnect + line-set stay DERIVED: the box mounts flat on the
  // wall face and the whip/line-set attach points recompute from the
  // assembly's plan anchor, whatever its yaw.
  const hpYaw =
    typeof overrides?.heatPump?.yaw === 'number' && Number.isFinite(overrides.heatPump.yaw)
      ? overrides.heatPump.yaw
      : null
  // HEAT-PUMP OVERRIDE HONESTY (condenser-honesty set, hunt 5a/5f): the
  // service node WINS verbatim (checklist A4 — never silently relocated),
  // but a mis-dragged point told no one: a unit in the living room and one
  // 13 m into the yard both composed flag-free while every OTHER service
  // point (panel/meter/tstat/WH) carries an RO-collision warning. Two truth
  // classes, checked on the override only (auto placement stays silent):
  //  (a) the point sits INSIDE an indoor zone polygon — the outdoor unit
  //      belongs outside (name the room). A point ON a wall band is a
  //      legitimate wall-anchored override, not "indoors" — zone polygons
  //      trace wall centerlines, so the band guard kills the boundary
  //      false-positive (wallId/wallT anchors resolve to the centerline);
  //  (b) the point sits beyond the NEC 210.63 service reach (25 ft ≈
  //      7.62 m) from EVERY exterior wall — see HP_OVERRIDE_FAR_M.
  // The override still wins below — the warning just tells the truth.
  if (hpPlan) {
    const hpRoom =
      wallBandAt(hpPlan, walls) === null
        ? rooms.find((r) => pointInPolygon(hpPlan, r.polygon))
        : undefined
    if (hpRoom) {
      warnings.push(
        `heat-pump point is inside ${hpRoom.name || hpRoom.id} — the outdoor unit belongs outside; move it or it will be drawn indoors`,
      )
    } else {
      const hpExit = nearestExteriorExit(walls, hpPlan)
      if (hpExit) {
        const d = Math.hypot(hpExit.at[0] - hpPlan[0], hpExit.at[1] - hpPlan[1])
        if (d > HP_OVERRIDE_FAR_M) {
          warnings.push(
            `heat-pump point is ${d.toFixed(1)} m from the nearest exterior wall — beyond the 25 ft service reach (NEC 210.63); verify the outdoor unit's spot`,
          )
        }
      }
    }
  }
  {
    const exit = nearestExteriorExit(walls, equipAt)?.at
    if (spec.detail === '400' && exit) {
      // Condensate falls 1/8" per foot toward the exterior (M1411.3.1) —
      // rendered with the actual pitch, chaining down across both legs.
      const CONDENSATE_SLOPE = 1 / 96
      const condensate = (from: Pt, to: Pt, yHigh: number): number => {
        const dx = to[0] - from[0]
        const dz = to[1] - from[1]
        const plan = Math.hypot(dx, dz)
        if (plan < 0.05) return yHigh
        const drop = plan * CONDENSATE_SLOPE
        const length = Math.hypot(plan, drop)
        members.push({
          system: 'hvac',
          role: 'pipe-run',
          dims: [length, inches(0.75), inches(0.75)],
          length,
          position: [(from[0] + to[0]) / 2, yHigh - drop / 2, (from[1] + to[1]) / 2],
          // +X points uphill (toward `from`), matching the plumbing slope convention
          rotation: [0, Math.atan2(-(from[1] - to[1]), from[0] - to[0]), Math.atan2(drop, plan)],
          material: 'pvc',
          sourceId: equipRoom.id,
          label: 'Condensate ¾" — slope 1/8"/ft to exterior (M1411.3.1)',
        })
        return yHigh - drop
      }
      const elbow: Pt = [exit[0], equipAt[1]]
      condensate(elbow, exit, condensate(equipAt, elbow, 0.25))
    }
    // Outdoor CONDENSER ROW (night-4 user ask — generalizes the old single
    // heat-pump block): the heat-pump service node still wins unit #1's
    // position verbatim (moving it re-anchors pads, cabinets, line-sets AND
    // the whole row), else unit #1 takes the auto pad spot; units 2..N step
    // along the same exterior wall. Sizing is a labeled ASSUMPTION
    // (1 ton per 450/550/650 sqft by climate-zone band — Manual J/S govern).
    // AUTO election is VALIDATED (Julien-scene root cause 2026-08-22):
    // wall.exterior is input, not truth — the election walks exterior
    // candidates by distance until one's pad spot really is outdoors; an
    // exhausted walk keeps the least-bad spot and says so (flag + warning
    // below). A verbatim override still wins its POSITION outright (A4) —
    // the election runs anyway to recognize the machine's own seed (below).
    const election = electHeatPumpExit(walls, zonesAll, context?.coverage ?? [])
    let anchor = hpPlan ?? election?.spot ?? null
    const electionUnvalidated = hpPlan == null && election !== null && !election.validated
    // MACHINE-SEEDED OVERRIDE COHERENCE (round-2 finding — the fence+RO
    // compound): the seed action writes the engine's own unit-#1 anchor
    // back as a bones:service node, and every activated scene seeds
    // automatically — so the default lifecycle turns the auto anchor into
    // a verbatim override on the very next compose. Re-deriving that row's
    // wall by nearest flipped the disconnect onto a garden fence 0.4 m
    // from the pad (the elected wall stands ≥ 1 m away BY CONSTRUCTION —
    // condenserStandoff — so any exterior segment beyond the shell wins
    // the race). DECISION: an
    // override standing within ε of the election spot or of the engine's
    // own slid unit-#1 spot IS the machine's point — its row keeps the
    // ELECTED wall (post-seed compose == auto compose, byte). Any other
    // point is a real user drag and stays verbatim-nearest (A4: never
    // silently re-anchored); ε is a float round-trip tolerance, not a
    // snap radius — a deliberate drag lands metres away, not nanometres.
    let rowWall = hpPlan ? undefined : election?.wall
    // OFF-GRID HONESTY RIDES MACHINE SEEDS (verify round 2, F1 — the flag
    // died on the DEFAULT lifecycle): the editor auto-seeds the service
    // node at the machine's own unit-#1 spot on first load, so the very
    // next compose runs verbatim — and a verbatim row never snaps, hence
    // never reports exhaustion. The auto compose's off-grid outcome must
    // therefore ride every RECOGNIZED machine seed (the ε-anchor already
    // proves the point is the machine's own), or the flag lives for
    // exactly ONE compose on every activated exhaustion-class scene and
    // post-seed == auto byte-equality breaks on the flag field. A real
    // user drag — any position that is NOT a recognized machine spelling
    // — stays flag-free (A4: the user's own point is the user's truth).
    let machineSeedOffGrid = false
    if (hpPlan && election) {
      const near = (p: Pt, q: Pt): boolean =>
        Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9
      const autoRow = condenserRow(walls, election.spot, false, 1, equipAt, election.wall)
      const autoUnit1 = autoRow.slots[0]?.at
      // Three machine spellings of the same point: the raw election spot,
      // TODAY's slid+grid-snapped unit-#1 spot, and the PRE-snap slid spot
      // (unit1Presnap) — nodes seeded before the grid snap shipped carry
      // that older coordinate and must keep reading as the machine's own
      // point (elected wall, not verbatim-nearest).
      if (
        near(hpPlan, election.spot) ||
        (autoUnit1 && near(hpPlan, autoUnit1)) ||
        (autoRow.unit1Presnap && near(hpPlan, autoRow.unit1Presnap))
      ) {
        rowWall = election.wall
        machineSeedOffGrid = autoRow.unit1OffGrid
      }
    }
    // CONTRACT (never silent): placeHeatPumpSpot fails only when the level
    // has no straight EXTERIOR wall (hosts marking both wall faces
    // 'interior', all-curved shells). Skipping here used to drop the whole
    // outdoor block with zero words while the AH + ducts emitted. Fall back
    // to the least-bad spot — just outside the nearest straight wall (away
    // from the AH), else beside the AH — condenserRow's no-exterior branch
    // warns, and every pad/cabinet carries the ⚠ verify flag below.
    let anchorFallback = false
    if (!anchor) {
      anchorFallback = true
      const near = nearestWallPoint(walls, equipAt, Number.POSITIVE_INFINITY)
      if (near) {
        const p = wallPointAt(near.wall, near.u)
        const dx = p[0] - equipAt[0]
        const dz = p[1] - equipAt[1]
        const d = Math.hypot(dx, dz)
        const off = condenserStandoff(near.wall.thickness)
        anchor =
          d > 1e-6 ? [p[0] + (dx / d) * off, p[1] + (dz / d) * off] : [p[0] + off, p[1]]
      } else {
        anchor = [equipAt[0] + PAD_OFFSET_NO_WALL(), equipAt[1]]
      }
    }
    {
      // The hoisted system plan (ONE tonnage — Manual-J-lite or the labeled
      // fallback) drives the row count and every per-unit label.
      const row = condenserRow(walls, anchor, hpPlan != null, plan.count, equipAt, rowWall)
      warnings.push(...row.warnings)
      if (electionUnvalidated) warnings.push(COND_UNVALIDATED_WARNING)
      // ⚠ flag on every pad + cabinet when the anchor is a guess: the
      // no-exterior-wall fallback keeps its legacy class; an exhausted
      // validation walk carries its own (never silent, never overloaded).
      const rowFlag = anchorFallback
        ? COND_VERIFY_FLAG
        : electionUnvalidated
          ? COND_UNVALIDATED_FLAG
          : null
      const unitTopY = COND_PAD_T + COND_DIMS[1]
      // Line-set rails: the wall graph + the air handler's wall anchor are
      // shared by every unit's run (the coil is one point).
      const linesetGraph = buildWallGraph(walls)
      const ahAnchor = nearestWallPoint(walls, equipAt)
      const sizingNote = plan.sizingNote
      for (let i = 0; i < row.slots.length; i++) {
        const slot = row.slots[i] as CondenserSlot
        const n = i + 1
        const at = slot.at
        // WALL-SQUARE ASSEMBLY (HP polish item 2 — Julien: "it's tilted…
        // let's make sure it's aligned normally"): every unit sits SQUARE
        // to its row wall — yaw = the outward wall normal, back to the
        // house — the real-install truth. Unit #1's old yaw was its bearing
        // from the equipment room (legacy single-unit facing), which on
        // off-axis scenes read as an arbitrary tilt (rotY ≈ 2.99) against a
        // wall-aligned pad. THE RULE: a machine placement squares to the
        // ELECTED wall; a verbatim user drag squares to ITS OWN row wall —
        // the nearest exterior exit (A4 keeps the dragged POSITION; the
        // orientation is derived truth, same as the pad always was). A
        // node-level yawOverride (item 4) beats wall-square for unit #1;
        // only the rowless no-exterior-wall fallback keeps the legacy
        // equipment-room bearing (no wall to square to, already ⚠-flagged).
        const wallSquareYaw = Math.atan2(slot.out[0], slot.out[1])
        const rotY =
          i === 0 && hpYaw !== null
            ? hpYaw
            : i === 0 && !row.wall
              ? Math.atan2(at[0] - equipAt[0], at[1] - equipAt[1])
              : wallSquareYaw
        // The pad's inner edge must clear the wall's exterior assembly —
        // brick veneer reaches ~0.13 m past the face (R703.8). AUTO anchors
        // now stand off far enough by construction (24" face clearance >
        // the 0.13 m allowance + pad reveal), but a VERBATIM user drag can
        // still tuck the pad against the wall (S1). Slide the SLAB outward
        // just enough; the cabinet stays put (A4 — the user's point is
        // never moved). With the true square cabinet (0.95 deep on a 1.0
        // pad) the reveal is only 2.5 cm per side, so a slide beyond it
        // leaves the cabinet OVERHANGING its pad — physically wrong and
        // caused by the too-close anchor itself: flag pad + cabinet, never
        // silent (unwarp round 2026-08-23; the slim 0.35 m cabinet had
        // 0.3 m of slack and could never overhang).
        // Pad reach toward the wall: the pad turns WITH the assembly (one
        // rigid object — HP polish items 2+4), so a yawOverride'd square
        // pad reaches (|sin φ|+|cos φ|)·half along the wall normal (φ =
        // assembly yaw − wall-square yaw; φ = 0 ⇒ the old half-side
        // exactly). The clearance math grows with the obliqueness, so the
        // night-4 F1 punch-through class cannot come back through the
        // rotation override. Cabinet slack scales the same way.
        const padPhi = rotY - wallSquareYaw
        const obliq = Math.abs(Math.sin(padPhi)) + Math.abs(Math.cos(padPhi))
        let padCenter: Pt = at
        let overhangFlag: string | null = null
        if (row.wall) {
          const foot = wallPointAt(row.wall, slot.u)
          const standOff = (at[0] - foot[0]) * slot.out[0] + (at[1] - foot[1]) * slot.out[1]
          const needed =
            row.wall.thickness / 2 + PAD_CLADDING_ALLOW + (COND_PAD_SIDE / 2) * obliq
          const push = Math.max(0, needed - standOff)
          if (push > 0) {
            padCenter = [at[0] + slot.out[0] * push, at[1] + slot.out[1] * push]
            const cabinetReach =
              (COND_DIMS[0] / 2) * Math.abs(Math.sin(padPhi)) +
              (COND_DIMS[2] / 2) * Math.abs(Math.cos(padPhi))
            if (push > (COND_PAD_SIDE / 2) * obliq - cabinetReach + 1e-9) {
              overhangFlag = COND_PAD_OVERHANG_FLAG
            }
          }
        }
        const slotFlag = (base: string | null): string | undefined => {
          let out: string | undefined = base ?? undefined
          if (overhangFlag) out = composeFlag(out, overhangFlag)
          // Off-grid honesty (verify round F3): the world-grid search
          // exhausted — unit #1 stands at the honest un-snapped spot and
          // its pad + cabinet say so (' | ' composition, the B1 flag
          // convention). The class reaches a compose two ways: the AUTO
          // row's own exhaustion, or a RECOGNIZED machine seed replaying
          // it (round-2 F1 — the default auto-seed lifecycle must not
          // launder the flag). Real user drags carry neither (A4).
          if (i === 0 && (row.unit1OffGrid || machineSeedOffGrid)) {
            out = composeFlag(out, COND_OFF_GRID_FLAG)
          }
          return out
        }
        const padCabinetFlag = slotFlag(rowFlag)
        // PAD YAW == ASSEMBLY YAW: cabinet, pad and pick proxy turn as one
        // rigid object. With the cabinet now wall-square (item 2) this is
        // the old wall-parallel pad for every derived orientation; under a
        // yawOverride the pad follows the user's rotation and the oblique
        // reach above keeps the clearance math honest (the night-4 F1
        // punch-through class stays dead — `needed` grows with |φ|).
        const padRotY = rotY
        members.push({
          system: 'hvac',
          role: 'equipment',
          dims: [COND_PAD_SIDE, COND_PAD_T, COND_PAD_SIDE],
          length: COND_PAD_SIDE,
          position: [padCenter[0], COND_PAD_T / 2, padCenter[1]],
          rotation: [0, padRotY, 0],
          material: 'concrete',
          sourceId: equipRoom.id,
          // '≥ 24"': the grid snap only ever raises the auto stand-off
          // (outward ceil — HP polish item 3), so 24" is a floor, not the
          // exact figure; a verbatim drag can still stand closer (S1 slide
          // + overhang honesty above).
          label: 'Condenser pad 4" — concrete (≥ 24" face clearance basis; per mfr clearance + IRC M1403)',
          ...(padCabinetFlag ? { flag: padCabinetFlag } : {}),
        })
        members.push({
          system: 'hvac',
          role: 'equipment',
          dims: COND_DIMS,
          length: COND_DIMS[0],
          position: [at[0], COND_PAD_T + COND_DIMS[1] / 2, at[1]],
          rotation: [0, rotY, 0],
          material: 'steel',
          sourceId: equipRoom.id,
          label: `AC condenser #${n} — ${plan.unitTons} tons outdoor unit`,
          ...(padCabinetFlag ? { flag: padCabinetFlag } : {}),
        })
        fixtures.push({
          system: 'hvac',
          kind: 'equipment',
          position: [at[0], COND_PAD_T + COND_DIMS[1] / 2, at[1]],
          rotationY: rotY,
          sourceId: equipRoom.id,
          label: `AC Condenser #${n} — ${plan.unitTons} tons (${sizingNote})`,
          meta: {
            tons: plan.unitTons,
            equipment: 'condenser',
            unit: n,
            units: plan.count,
            totalTons: plan.totalTons,
            sizingBasis: plan.basis,
            ...(plan.load
              ? {
                  sensibleTons: Math.round(plan.load.sensibleTons * 100) / 100,
                  latentFactor: plan.load.latentFactor,
                  ...(plan.load.moistureRegime
                    ? { moistureRegime: plan.load.moistureRegime }
                    : {}),
                }
              : {}),
          },
        })
        // Refrigerant LINE-SET (suction ¾" insulated + liquid ⅜", M1411):
        // cabinet service-valve side → ONE exterior-wall penetration at the
        // unit's along-wall spot SNAPPED clear of any RO crossing the pipe
        // band (~0.4 m up) → the WALL GRAPH to the air handler's wall anchor
        // on the plumbing engine's routePipe rails (E1 RO detours over the
        // header / under the sill, junction jumpers, flagged air-run
        // fallback) → a coil stub into the equipment room. The two pipes run
        // the SAME plan path as a parallel pair, suction +2 cm / liquid
        // −2 cm — cold line insulated, warm line bare. A run over ~15 m
        // carries the oil-return advisory (mfr line-set charts govern).
        const runMembers: Member[] = []
        const pipes = [
          {
            dia: LINESET_SUCTION_DIA,
            y: LINESET_Y + LINESET_PAIR_OFFSET,
            sourceId: `lineset-suction-${n}`,
            label: 'Line-set suction ¾" — insulated (M1411)',
          },
          {
            dia: LINESET_LIQUID_DIA,
            y: LINESET_Y - LINESET_PAIR_OFFSET,
            sourceId: `lineset-liquid-${n}`,
            label: 'Line-set liquid ⅜" (M1411)',
          },
        ]
        if (row.wall && ahAnchor) {
          const penWall = row.wall
          // Penetration: the unit's anchor slid clear of every RO whose
          // vertical span crosses the pipe band (a verbatim heat-pump node
          // can front a window the ROW never slid for).
          const penU = clearOfOpenings(
            penWall,
            slot.u,
            LINESET_Y - LINESET_PAIR_OFFSET - 0.05,
            LINESET_Y + LINESET_PAIR_OFFSET + 0.05,
          )
          const pen = wallPointAt(row.wall, penU)
          const foot = wallPointAt(row.wall, slot.u)
          const standOff = (at[0] - foot[0]) * slot.out[0] + (at[1] - foot[1]) * slot.out[1]
          // Service-valve elbow: slide OUTSIDE the wall (parallel to it) to
          // face the penetration, then straight in through the wall.
          const elbowOut: Pt = [pen[0] + slot.out[0] * standOff, pen[1] + slot.out[1] * standOff]
          // In-wall route: solved ONCE at the pair's center plane with the
          // band set to the pair ENVELOPE (liquid bottom → suction top), so
          // both pipes inherit the SAME detour decisions. Per-pipe routing
          // collapsed the pair onto one detour plane (the ±2 cm lived only
          // on straight legs) and let an RO sill landing BETWEEN the two
          // bands detour one pipe THROUGH the other (skeptic round).
          const REF_LABEL = '§LINESET§'
          const refSpec: PipeSpec = {
            side: LINESET_SUCTION_DIA,
            material: 'copper',
            role: 'pipe-run',
            sourceId: 'lineset-ref',
            label: REF_LABEL,
          }
          const ref: Member[] = []
          routePipe(
            ref, refSpec, linesetGraph,
            { wall: row.wall, u: penU }, ahAnchor, LINESET_Y, walls,
            LINESET_PAIR_OFFSET + LINESET_SUCTION_DIA / 2,
          )
          // Cross-trade LATERAL for this run: plumbing rides the wall
          // centerline, the pair shifts across the wall. The offset clamps
          // so the OUTERMOST pipe surface (lateral + roll + suction radius
          // + 2 mm skin) stays inside the THINNEST wall on the path — a
          // 0.114 partition can't grant the full 3.5 cm, so the run keeps
          // what fits and says so (flag below), never silently pokes out.
          const pathLegs = wallPath(linesetGraph, { wall: penWall, u: penU }, ahAnchor)
          const minHalfT = (pathLegs ?? []).reduce(
            (min2, l) => Math.min(min2, l.wall.thickness / 2),
            penWall.thickness / 2,
          )
          const maxLateral =
            minHalfT - LINESET_PAIR_OFFSET - LINESET_SUCTION_DIA / 2 - 0.002
          const lateral = Math.min(LINESET_LATERAL, Math.max(0, maxLateral))
          const lateralClamped = lateral < LINESET_LATERAL - 1e-9
          // Outside stubs cross ROs as a PAIR too: either pipe's height
          // clipping an RO volume flags BOTH (one shared decision, one
          // shared honesty — E1, same contract as the service laterals).
          const stubCrosses = (a: Pt, b: Pt): boolean =>
            pipes.some((p) =>
              segmentCrossesRo(walls, [a[0], p.y, a[1]], [b[0], p.y, b[1]]),
            )
          const isVertical = (m: Member): boolean =>
            m.rotation[1] === 0 && m.dims[1] === m.length
          // CORNER CANCEL: ROs hugging BOTH sides of a shared junction make
          // the reference route drop to the run plane AT the corner and
          // immediately re-ascend — pipeWallLeg emits two byte-identical
          // OPPOSITE risers at the junction (attack 3b: the pair collided
          // with the orthogonal crossings crowding the corner, printed as
          // duplicate members, and double-booked riser copper). A real pipe
          // stays UP around the corner: cancel adjacent identical riser
          // pairs so the two crossings connect directly at the detour plane
          // (their endpoints coincide at the junction — continuity holds).
          for (let i = ref.length - 2; i >= 0; i--) {
            const a = ref[i] as Member
            const b = ref[i + 1] as Member
            if (!isVertical(a) || !isVertical(b)) continue
            if (
              a.position[0] === b.position[0] &&
              a.position[1] === b.position[1] &&
              a.position[2] === b.position[2] &&
              a.dims[0] === b.dims[0] &&
              a.dims[1] === b.dims[1] &&
              a.dims[2] === b.dims[2]
            ) {
              ref.splice(i, 2)
            }
          }
          // A riser's ROLL AXIS comes from its OWN triplet in the emission
          // order — pipeWallLeg deterministically emits near-riser /
          // crossing / far-riser, so the crossing at the riser's detour
          // elevation sits right AFTER a near-riser and right BEFORE a far
          // one. GEOMETRIC lookup (a crossing touching the riser's plan
          // point) was ambiguous at corners: attack 3b put BOTH walls'
          // crossings at the same elevation touching the junction point,
          // matched the WRONG wall first, and rolled the riser ALONG its
          // own wall again. Round 2's emission-ORDER cursor was equally
          // wrong the other way (stale axis when the approach leg drops) —
          // the triplet index is the only unambiguous owner.
          const rollYawAt = (i: number): number => {
            const r = ref[i] as Member
            const top = r.position[1] + r.dims[1] / 2
            const bot = r.position[1] - r.dims[1] / 2
            const detourEnd =
              Math.abs(top - LINESET_Y) >= Math.abs(bot - LINESET_Y) ? top : bot
            for (const j of [i + 1, i - 1]) {
              const h = ref[j]
              if (!h || isVertical(h)) continue
              if (Math.abs(h.position[1] - detourEnd) < 1e-6) return h.rotation[1]
            }
            // no adjacent crossing (a fully-canceled degenerate) — fall
            // back to the penetration wall's axis
            return Math.atan2(-penWall.dir[1], penWall.dir[0])
          }
          // ACUTE-CORNER MITER (closing round F2): the per-member lateral
          // opens a junction gap of 2·lat·sin(Δyaw/2) between adjoining
          // legs — a right angle stays inside the continuity tolerance,
          // but a sharper turn (>~118°) BREAKS the chain (150° wedge
          // repro: 6.8 cm gap, a delta regression vs the centerline
          // route). Real pipes get a FITTING at the corner: extend (or
          // trim, on inner corners) each adjoining leg along its own axis
          // to the shifted lines' MITER point — exact closure at every
          // junction, both pipes identically. A near-reversal whose miter
          // would run past the cap gets a short closing BRIDGE instead
          // (the same jumper convention routePipe uses at the centerline).
          const MITER_CAP = 0.15
          const ext = new Map<number, { minus: number; plus: number }>()
          const bridges: { a: Pt; b: Pt }[] = []
          const planAxisOf = (m: Member): Pt => [
            Math.cos(m.rotation[1]),
            -Math.sin(m.rotation[1]),
          ]
          const endsAt = (m: Member): [Pt, Pt] => {
            const ax = planAxisOf(m)
            return [
              [m.position[0] - (ax[0] * m.dims[0]) / 2, m.position[2] - (ax[1] * m.dims[0]) / 2],
              [m.position[0] + (ax[0] * m.dims[0]) / 2, m.position[2] + (ax[1] * m.dims[0]) / 2],
            ]
          }
          for (let i = 0; i + 1 < ref.length; i++) {
            const h1 = ref[i] as Member
            const h2 = ref[i + 1] as Member
            if (isVertical(h1) || isVertical(h2)) continue
            if (Math.abs(h1.position[1] - h2.position[1]) > 1e-6) continue
            const e1 = endsAt(h1)
            const e2 = endsAt(h2)
            // facing endpoints — the closest pair (they met at the shared
            // junction before the lateral; jumpers bridged anything wider)
            let best: [number, number] = [0, 0]
            let bestD = Number.POSITIVE_INFINITY
            for (const a of [0, 1] as const) {
              for (const b of [0, 1] as const) {
                const d = Math.hypot(
                  (e2[b] as Pt)[0] - (e1[a] as Pt)[0],
                  (e2[b] as Pt)[1] - (e1[a] as Pt)[1],
                )
                if (d < bestD) {
                  bestD = d
                  best = [a, b]
                }
              }
            }
            if (bestD > 0.03) continue // not a shared junction
            const fA = e1[best[0]] as Pt
            const fB = e2[best[1]] as Pt
            const axA = planAxisOf(h1)
            const axB = planAxisOf(h2)
            // outward unit at the junction (from the member interior out)
            const u1: Pt = best[0] === 1 ? axA : [-axA[0], -axA[1]]
            const u2: Pt = best[1] === 1 ? axB : [-axB[0], -axB[1]]
            const pA: Pt = [Math.sin(h1.rotation[1]), Math.cos(h1.rotation[1])]
            const pB: Pt = [Math.sin(h2.rotation[1]), Math.cos(h2.rotation[1])]
            const E1: Pt = [fA[0] + lateral * pA[0], fA[1] + lateral * pA[1]]
            const E2: Pt = [fB[0] + lateral * pB[0], fB[1] + lateral * pB[1]]
            const gap = Math.hypot(E2[0] - E1[0], E2[1] - E1[1])
            if (gap < 0.005) continue // colinear legs — already closed
            // E1 + t1·u1 == E2 + t2·u2 (Cramer)
            const det = u2[0] * u1[1] - u1[0] * u2[1]
            const dx = E2[0] - E1[0]
            const dz = E2[1] - E1[1]
            const t1 = det !== 0 ? (u2[0] * dz - u2[1] * dx) / det : Number.NaN
            const t2 = det !== 0 ? (u1[0] * dz - u1[1] * dx) / det : Number.NaN
            // COMBINED trim floor (merge-gate F1): a per-junction trim cap
            // let a short mid-leg mitered at BOTH ends accumulate NEGATIVE
            // length — a −6 mm member SUBTRACTED lf from the takeoff and
            // read as separated on every SAT axis (ra+rb−skin < 0), making
            // the gates vacuously green. The floor is checked against the
            // member's ALREADY-ACCUMULATED extensions (its other junction
            // was processed one step earlier in sequence order): if this
            // miter would leave EITHER member under 2 cm, the junction
            // BRIDGES instead — lengths stay positive, the chain closes.
            const g1cur = ext.get(i) ?? { minus: 0, plus: 0 }
            const g2cur = ext.get(i + 1) ?? { minus: 0, plus: 0 }
            const len1After = h1.dims[0] + g1cur.minus + g1cur.plus + t1
            const len2After = h2.dims[0] + g2cur.minus + g2cur.plus + t2
            if (
              !Number.isFinite(t1) ||
              !Number.isFinite(t2) ||
              Math.abs(t1) > MITER_CAP ||
              Math.abs(t2) > MITER_CAP ||
              len1After < 0.02 ||
              len2After < 0.02
            ) {
              // parallel / near-reversal / over-trimmed — bridge instead
              bridges.push({ a: E1, b: E2 })
              continue
            }
            const g1 = g1cur
            if (best[0] === 1) g1.plus += t1
            else g1.minus += t1
            ext.set(i, g1)
            const g2 = g2cur
            if (best[1] === 1) g2.plus += t2
            else g2.minus += t2
            ext.set(i + 1, g2)
          }
          for (const pipe of pipes) {
            const shift = pipe.y - LINESET_Y
            for (const [a, b] of [
              [at, elbowOut],
              [elbowOut, pen],
            ] as const) {
              const seg = duct(
                a, b, pipe.y, pipe.dia, pipe.dia, pipe.sourceId, pipe.label,
                'copper', 'pipe-run', 0.02,
              )
              if (!seg) continue
              if (stubCrosses(a, b)) {
                seg.flag = 'line-set crosses a door/window RO — verify routing'
              }
              runMembers.push(seg)
            }
            // BOTH pipes derive from the one reference route: a uniform Y
            // shift of ±LINESET_PAIR_OFFSET on EVERY member (horizontal
            // legs and detour crossings — 4 cm vertical separation), the
            // whole run pushed the cross-trade LATERAL off the wall
            // centerline (perpendicular to each member's own wall axis —
            // adjacent legs at a corner mismatch by lateral·√2 ≤ 5 cm,
            // inside the continuity tolerance), Ø components rewritten per
            // pipe, labels/sourceIds per pipe, flags copied to both.
            // RISERS additionally ROLL the pair 90°: a lower pipe's riser
            // must cross the upper pipe's plane on the way up, so coaxial
            // risers would leave the liquid line inside the suction line
            // (the skeptic's coincident-stack class) — each riser steps
            // ±LINESET_PAIR_OFFSET PERPENDICULAR to its own wall's axis
            // (rollYawAt) AROUND the lateral plane, side-by-side across
            // the wall exactly like field-bent soft copper.
            for (let i = 0; i < ref.length; i++) {
              const m = ref[i] as Member
              const vertical = isVertical(m)
              const acrossYaw = vertical ? rollYawAt(i) : m.rotation[1]
              const across = vertical ? lateral + shift : lateral
              // corner miter (F2): the junction extensions are shared plan
              // geometry — identical for both pipes, so the twins hold
              const e = !vertical ? ext.get(i) : undefined
              const len = vertical ? m.dims[1] : m.dims[0] + (e ? e.minus + e.plus : 0)
              const ax = planAxisOf(m)
              const slide = e ? (e.plus - e.minus) / 2 : 0
              const clone: Member = {
                ...m,
                dims: vertical ? [pipe.dia, len, pipe.dia] : [len, pipe.dia, pipe.dia],
                length: vertical ? m.length : len,
                position: [
                  m.position[0] + across * Math.sin(acrossYaw) + ax[0] * slide,
                  m.position[1] + shift,
                  m.position[2] + across * Math.cos(acrossYaw) + ax[1] * slide,
                ],
                sourceId: pipe.sourceId,
                label: (m.label ?? REF_LABEL).replace(REF_LABEL, pipe.label),
              }
              if (lateralClamped) clone.flag = composeFlag(clone.flag, LINESET_THIN_WALL_FLAG)
              runMembers.push(clone)
            }
            // near-reversal corners: a short closing bridge per pipe (the
            // centerline jumper convention, shifted with the run)
            for (const br of bridges) {
              const seg = duct(
                br.a, br.b, pipe.y, pipe.dia, pipe.dia, pipe.sourceId,
                pipe.label, 'copper', 'pipe-run', 0.005,
              )
              if (seg) {
                if (lateralClamped) seg.flag = composeFlag(seg.flag, LINESET_THIN_WALL_FLAG)
                runMembers.push(seg)
              }
            }
            // coil stub: wall anchor → the air handler
            const ap = wallPlan(ahAnchor)
            const stub = duct(
              [ap[0], ap[1]], equipAt, pipe.y, pipe.dia, pipe.dia,
              pipe.sourceId, pipe.label, 'copper', 'pipe-run', 0.02,
            )
            if (stub) runMembers.push(stub)
          }
        } else {
          // No exterior wall / no wall anchor (degenerate scene): flagged
          // Manhattan air legs — never silent (routePipe fallback semantics).
          for (const pipe of pipes) {
            const elbow: Pt = [equipAt[0], at[1]]
            for (const [a, b] of [
              [at, elbow],
              [elbow, equipAt],
            ] as const) {
              const seg = duct(
                a, b, pipe.y, pipe.dia, pipe.dia, pipe.sourceId,
                `${pipe.label} (air run — no wall path, verify)`,
                'copper', 'pipe-run', 0.02,
              )
              if (!seg) continue
              seg.flag = 'AIR RUN: line-set found no wall path — route along a wall'
              runMembers.push(seg)
            }
          }
        }
        // routePipe emits system 'plumbing' — the line-set is HVAC scope
        // (S4 sections, M2 row); the >15 m advisory rides every leg of the
        // long run so it aggregates as ONE flag line.
        const suctionLen = runMembers
          .filter((m) => m.sourceId === `lineset-suction-${n}`)
          .reduce((sum, m) => sum + m.length, 0)
        for (const m of runMembers) {
          m.system = 'hvac'
          if (suctionLen > LINESET_MAX_LEN_ADVISORY) m.flag = composeFlag(m.flag, LINESET_LONG_FLAG)
          members.push(m)
        }
        // DISCONNECT on the wall face above the unit (NEC 440.14 — within
        // sight) + a short liquid-tight whip down to the cabinet. The
        // dedicated branch circuit is deliberately NOT routed here (panel
        // integration is a parallel electrical track).
        if (row.wall) {
          const faceOff = row.wall.thickness / 2 + 0.02
          const discY = unitTopY + DISCONNECT_ABOVE_UNIT
          // The disconnect is DERIVED (only the unit anchor is verbatim):
          // a unit dragged in front of a window must not mount its box on
          // the glass — slide the box along the wall to the nearest clear
          // spot within sight (±1.2m), else keep + ⚠ (dawn visual round:
          // box mid-RO with the AC stub crossing, silently).
          let discU = slot.u
          const discSpans = openingSpans(row.wall, discY - 0.15, discY + 0.15)
          const inSpan = (u: number): boolean =>
            discSpans.some((sp) => u > sp.lo - 0.08 && u < sp.hi + 0.08)
          if (inSpan(discU)) {
            let best: number | null = null
            for (const sp of discSpans) {
              for (const cand of [sp.lo - 0.1, sp.hi + 0.1]) {
                if (cand < 0.1 || cand > row.wall.length - 0.1) continue
                if (inSpan(cand)) continue
                if (Math.abs(cand - slot.u) > 1.2) continue
                if (best === null || Math.abs(cand - slot.u) < Math.abs(best - slot.u)) best = cand
              }
            }
            if (best !== null) discU = best
            else warnings.push(
              `AC disconnect #${n} sits in a door/window rough opening — move the unit clear (NEC 440.14)`,
            )
          }
          const discFoot = wallPointAt(row.wall, discU)
          const face: Pt = [
            discFoot[0] + slot.out[0] * faceOff,
            discFoot[1] + slot.out[1] * faceOff,
          ]
          // Dedicated 2-pole branch circuit (NEC 440): ≤3-ton units run
          // 30A/10 AWG, larger 40A/8 AWG — routeWiring homeruns the panel
          // to this box like any device (compute wires it post-HVAC).
          const acGauge = plan.unitTons <= 3 ? 10 : 8
          const acBreaker = acGauge === 10 ? 30 : 40
          fixtures.push({
            system: 'hvac',
            kind: 'disconnect',
            position: [face[0], discY, face[1]],
            rotationY: Math.atan2(slot.out[0], slot.out[1]),
            sourceId: row.wall.id,
            label: `AC disconnect — NEC 440.14, within sight (AC-${n}, ${acBreaker}A 2-pole)`,
            meta: {
              unit: n,
              circuit: `AC-${n}`,
              gaugeAwg: acGauge,
              breakerA: acBreaker,
              // ~MCA proxy for the schedule's VA column (assumption-labeled
              // on the condenser fixture itself: 1 ton ≈ 1200 VA).
              va: Math.round(plan.unitTons * 1200),
            },
          })
          const whipY = unitTopY - 0.1
          const whipLabel = 'Condenser whip — liquid-tight conduit (NEC 440.14)'
          // The vertical is the whip's connector body at the disconnect
          // (day-9 z-fight family): 2×BURY fatter than the run entering it,
          // so the matched 16 mm sections never share side planes. Caps stay:
          // the top is buried in the disconnect box, the bottom sits on the
          // run's center plane — 8 mm from either run face, never coplanar.
          const drop = ductDrop(
            face, whipY, discY,
            0.016 + 2 * DUCT_JUNCTION_BURY, 0.016 + 2 * DUCT_JUNCTION_BURY,
            `ac-whip-${n}`, whipLabel, 'steel', 'wire-run',
          )
          if (drop) members.push(drop)
          const run = duct(
            face, at, whipY, 0.016, 0.016, `ac-whip-${n}`, whipLabel, 'steel', 'wire-run',
          )
          if (run) members.push(run)
        }
      }
      // Disconnect + whip mount on the row wall's FACE — a rowless install
      // (no exterior wall) has nowhere to hang them. One loud line (NEC
      // 440.14), never a silent omission (condenser-always contract).
      if (!row.wall) {
        warnings.push(
          'AC disconnect + whip not mounted — no exterior wall face for the box (NEC 440.14) — verify',
        )
      }
    }
  }

  // Thermostat: the bones:service node when present (verbatim — checklist
  // A4), else the auto spot on an interior wall near the return, 52" AFF.
  const tstatForced = overrideWallPoint(walls, overrides?.thermostat)
  const tstatSpot = tstatForced
    ? {
        wall: tstatForced.wall,
        u: tstatForced.u,
        heightAff: overrides?.thermostat?.heightAff ?? TSTAT_AFF,
      }
    : placeThermostatSpot(walls, rooms)
  if (tstatSpot) {
    const { wall } = tstatSpot
    const p: Pt = [
      wall.start[0] + wall.dir[0] * tstatSpot.u,
      wall.start[1] + wall.dir[1] * tstatSpot.u,
    ]
    const nx = equipAt[0] - p[0]
    const nz = equipAt[1] - p[1]
    fixtures.push({
      system: 'hvac',
      kind: 'thermostat',
      position: [p[0], tstatSpot.heightAff, p[1]],
      rotationY: Math.atan2(nx, nz),
      sourceId: wall.id,
      label: `Thermostat ${Math.round(toFeet(tstatSpot.heightAff) * 12)}" AFF — near the return`,
    })
  }

  return { members, fixtures, warnings }
}

// ---------------------------------------------------------------------------
// Cross-trade coordination (post-merge seam round)
// ---------------------------------------------------------------------------

/** Sampled step along a line-set member's axis for the crossing test. */
const TRADE_SAMPLE_STEP = 0.02
/** Trade skin — the 2 mm grace every SAT harness in the repo uses. */
const TRADE_SKIN = 0.002

/** A world point in `m`'s local frame (euler XYZ: world = Rx·Ry·Rz·local,
 * the repo's member convention — see plan-set's projection notes). */
function memberLocal(
  m: Member,
  p: readonly [number, number, number],
): [number, number, number] {
  let x = p[0] - m.position[0]
  let y = p[1] - m.position[1]
  let z = p[2] - m.position[2]
  const [rx, ry, rz] = m.rotation
  // local = Rz(−rz) · Ry(−ry) · Rx(−rx) · world
  let c = Math.cos(-rx)
  let s = Math.sin(-rx)
  ;[y, z] = [c * y - s * z, s * y + c * z]
  c = Math.cos(-ry)
  s = Math.sin(-ry)
  ;[x, z] = [c * x + s * z, -s * x + c * z]
  c = Math.cos(-rz)
  s = Math.sin(-rz)
  ;[x, y] = [c * x - s * y, s * x + c * y]
  return [x, y, z]
}

/**
 * Cross-trade honesty for the refrigerant line-set (post-merge seam round:
 * 24 OBB hits on a both-systems-hot compose — the pair bored through the
 * 3" DWV stack and 22 supply risers standing on the wall centerline).
 * The LATERAL offset clears the centerline plane in the common case, but
 * geometry can still be forced to cross: a 3" stack fills the cavity wider
 * than any lateral dodges (±38 mm), and clamped thin-wall runs share the
 * plane outright. compute calls this AFTER both engines land members —
 * every line-set member whose swept volume clips a plumbing pipe or stack
 * gets a coordinate-trades flag. Never a silent bore (E1's spirit across
 * trades; night-5 D2 set the trade-skin convention).
 *
 * Detection: the line-set member's axis sampled every 2 cm against each
 * plumbing member's OBB inflated by the line-set radius + the 2 mm skin
 * (full euler inverse — sloped drain legs included).
 */
export function flagLinesetTradeCrossings(members: Member[]): void {
  const lineset = members.filter(
    (m) => m.system === 'hvac' && m.role === 'pipe-run' && m.sourceId.startsWith('lineset-'),
  )
  if (lineset.length === 0) return
  const plumbing = members.filter(
    (m) => m.system === 'plumbing' && (m.role === 'pipe-run' || m.role === 'vent-stack'),
  )
  if (plumbing.length === 0) return
  // loose world-space bound per plumbing member (pre-cull)
  const bounds = plumbing.map((p) => {
    const r = (p.dims[0] + p.dims[1] + p.dims[2]) / 2 + 0.05
    return { p, r }
  })
  const STACK_FLAG = '⚠ line-set crosses DWV stack — coordinate trades'
  const PIPE_FLAG = '⚠ line-set crosses plumbing — coordinate trades'
  for (const ls of lineset) {
    const vertical = ls.rotation[1] === 0 && ls.dims[1] === ls.length
    const half = ls.length / 2
    const yaw = ls.rotation[1]
    const axis: [number, number, number] = vertical
      ? [0, 1, 0]
      : [Math.cos(yaw), 0, -Math.sin(yaw)]
    const radius = Math.max(ls.dims[vertical ? 0 : 1], ls.dims[2]) / 2
    const steps = Math.max(1, Math.ceil(ls.length / TRADE_SAMPLE_STEP))
    const classes = new Set<string>()
    for (const { p, r } of bounds) {
      const cls =
        p.role === 'vent-stack' || p.sourceId.startsWith('dwv-') ? STACK_FLAG : PIPE_FLAG
      if (classes.has(cls)) continue
      const dc = Math.hypot(
        p.position[0] - ls.position[0],
        p.position[1] - ls.position[1],
        p.position[2] - ls.position[2],
      )
      if (dc > r + half + radius) continue
      for (let i = 0; i <= steps; i++) {
        const t = -half + (ls.length * i) / steps
        const q: [number, number, number] = [
          ls.position[0] + axis[0] * t,
          ls.position[1] + axis[1] * t,
          ls.position[2] + axis[2] * t,
        ]
        const [lx, ly, lz] = memberLocal(p, q)
        if (
          Math.abs(lx) <= p.dims[0] / 2 + radius + TRADE_SKIN &&
          Math.abs(ly) <= p.dims[1] / 2 + radius + TRADE_SKIN &&
          Math.abs(lz) <= p.dims[2] / 2 + radius + TRADE_SKIN
        ) {
          classes.add(cls)
          break
        }
      }
      if (classes.size === 2) break
    }
    // COMPOSE (the B1 ' | ' convention): the crossing classes APPEND to
    // whatever honesty the member already carries. Skipping flagged
    // members MASKED real bores — the >15 m advisory rides EVERY leg of a
    // long run, so a long run through the 3\" stack never said so
    // (closing round F1); a member crossing BOTH supply and stack kept
    // only the first class. Never overwrite, never skip, never duplicate.
    for (const cls of [STACK_FLAG, PIPE_FLAG]) {
      if (!classes.has(cls)) continue
      ls.flag = composeFlag(ls.flag, cls)
    }
  }
}
