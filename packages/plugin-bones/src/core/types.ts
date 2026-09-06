/**
 * The shared vocabulary of every Bones inference engine.
 *
 * Engines are PURE functions: `(model slice, spec) → Member[] | Fixture[]`.
 * No React, no Three.js, no store access — testable with plain objects.
 * Renderers turn Members into instanced meshes; nothing here is persisted.
 */

import type { LumberSize } from '../lumber'

/** Which subsystem produced a member/fixture — drives visibility + color. */
export type BonesSystem =
  | 'wall-framing'
  | 'floor-framing'
  | 'roof-framing'
  | 'foundation'
  | 'electrical'
  | 'plumbing'
  | 'hvac'

/** Structural role of a framing member — drives takeoff grouping + hover labels. */
export type MemberRole =
  // wall framing
  | 'bottom-plate'
  | 'top-plate'
  | 'cap-plate'
  | 'stud'
  | 'king-stud'
  | 'trimmer'
  | 'header'
  /** A porch / lean-to roof's board on the house wall that the rafters hang from. */
  | 'ledger'
  | 'sill'
  | 'cripple'
  | 'blocking'
  // floor framing
  | 'joist'
  | 'rim-joist'
  | 'girder'
  | 'post'
  | 'subfloor'
  // roof framing
  | 'rafter'
  | 'ridge'
  | 'hip'
  | 'valley'
  | 'ceiling-joist'
  | 'collar-tie'
  /** Pre-engineered truss top/bottom chord (roofSystem 'truss'). */
  | 'truss-chord'
  /** Truss web — representative layout; the real webbing is manufacturer-designed. */
  | 'truss-web'
  // foundation
  | 'mudsill'
  | 'stemwall'
  | 'footing'
  /** Slab-on-grade field strip (R506.1 3-1/2" concrete floor) — LOD-400 B17.
   * Replaces the never-emitted 'slab-edge' role (the stemwall detail made a
   * turned-down edge redundant; the dead role let the takeoff map a pour
   * nothing built). */
  | 'slab'
  /** 6-mil polyethylene membrane under the slab field (R506.2.3). */
  | 'vapor-retarder'
  | 'anchor-bolt'
  | 'hold-down'
  // cmu
  | 'block'
  | 'lintel'
  | 'bond-beam'
  // mep runs
  | 'pipe-run'
  | 'vent-stack'
  | 'duct-run'
  | 'wire-run'
  /** Driven grounding electrode (5/8" × 8 ft copper-clad rod, NEC
   * 250.52(A)(5)) — the grounding electrode system (LOD-400 B12). */
  | 'ground-rod'
  /** Water-heater body (tank cylinder approximated as a box, or tankless cabinet). */
  | 'water-heater'
  /** MEP equipment bodies that aren't pipe/duct (heat-pump outdoor unit + its pad). */
  | 'equipment'
  // fabrication (LOD 350/400)
  | 'rebar'
  | 'hanger'
  /** Flat steel tension strap — the CS-PF portal frame's 1000-lb
   * header-to-jack strap (R602.10.6.4, LOD-400 B9). Surface-mounted:
   * ~1.2 mm thick against the framing face, under the 2 mm SAT skin. */
  | 'strap'
  /** LGS horizontal strap bracing (IRC R603.3.3, Phase 1): 1-1/2" × 33 mil
   * flat strap across the stud flanges — mid-height on ≤ 8 ft walls,
   * third-points on 9/10 ft. Its OWN role so the takeoff books it by
   * LENGTH without perturbing B9's portal-strap census (the role-counted
   * doctrine). Surface steel on the framing faces, under the SAT skin. */
  | 'strap-bracing'
  // high-wind wall uplift path (R802.11 continuation / WFCM — LOD-400 B10).
  // Own roles so the takeoff counts each as a dedicated hardware line (the
  // 'counted by ROLE, never label regex' doctrine) without perturbing B9's
  // portal-strap census. All three follow the S13 surface-hardware
  // convention: ~1.2 mm symbolic steel on the framing face, under the skin.
  /** Stud-to-top-plate uplift connector (H2.5-class, WFCM stud-to-plate). */
  | 'uplift-connector'
  /** Header-to-jack uplift strap at an opening (WFCM coil-strap class). */
  | 'uplift-strap'
  /** Bottom-plate-to-foundation uplift strap (anchorage per schedule). */
  | 'foundation-strap'
  | 'plate-washer'
  | 'jack-rafter'
  | 'outlooker'
  | 'fascia'
  /** Eave/rake deck-edge metal (R905.2.8.5) — booked by the lf, LOD 400. */
  | 'drip-edge'
  | 'fire-blocking'
  | 'backing'
  // wall assembly layers (round 13)
  | 'drywall'
  | 'sheathing'
  | 'wrb'
  | 'cladding'
  | 'insulation'

export type MemberMaterial =
  | 'lumber'
  | 'pt-lumber'
  | 'engineered'
  | 'concrete'
  | 'steel'
  | 'pvc'
  | 'copper'
  | 'duct'

/**
 * One physical piece the engines generated, in LEVEL-LOCAL coordinates.
 * Geometry is a box of size `dims` (member-local XYZ, meters) centered at
 * `position`, rotated by `rotation` (XYZ euler, radians). `length` is the
 * lumber cut length for takeoffs (usually the largest dim). `sourceId` ties
 * the member back to the wall/slab/roof/opening that produced it (hover →
 * highlight, takeoff by source, incremental recompute).
 */
export type Member = {
  system: BonesSystem
  role: MemberRole
  /** Nominal lumber size when applicable — keyed for takeoff. */
  size?: LumberSize
  /** Box size in the member's local frame, meters. */
  dims: readonly [number, number, number]
  /** Cut length for takeoff, meters. */
  length: number
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  material: MemberMaterial
  sourceId: string
  /** Optional human label ("Header 4x8 over D101"). */
  label?: string
  /** Set when the prescriptive tables run out (engineered beam required). */
  flag?: string
  /** Level whose transform this member follows when it belongs to ANOTHER
   * storey than its X-ray node (cross-level roofs). Position is LOCAL to
   * that level; the renderer mounts these into the level's own Object3D so
   * the host's stacked/exploded/solo moves apply natively. Unset = the
   * node's own level. */
  levelId?: string
  /** Render-only mount override: the renderer mounts this member into this
   * level's Object3D WITHOUT the plan-set's cross-level baseY lift (used
   * for own-level roof strata — the sheets already draw these owner-local).
   * Mutually exclusive with levelId. */
  mountLevelId?: string
  /** Set (with `levelId`) when the member's SOURCE level sits strictly
   * ABOVE the owner X-ray's storey (the main roof adopted by a lower
   * owner). Only these foreign groups take the exploded-view roof stratum
   * drop — a ground-storey porch roof (levelId BELOW the owner) must never
   * offset into the storey under it (verify round 2026-08-16, F1). */
  strataAbove?: true
  /**
   * Informational note that is NOT a problem (e.g. "sized schematically —
   * verify with span/load design"). Kept apart from `flag` so advisory
   * text never masks real validation errors (round-10: girders born with a
   * schematic-sizing flag made the end-bearing check dead code).
   */
  advisory?: string
  /**
   * Masonry unit whose cell is grouted solid (vertical rebar, R606.12).
   * Dedicated field so the grout takeoff never keys off label strings.
   */
  grouted?: boolean
  /**
   * Outward plan normal of the wall FACE a finish layer belongs to —
   * drives the dollhouse cut (camera-facing layers hide). Only assembly
   * layers carry it.
   */
  face?: readonly [number, number]
  /**
   * AISI member designator when the piece is a cold-formed steel profile
   * from data/lgs-profiles.json ('350S162-68', vendor designators
   * included) — the takeoff's grouping key for steel rows (the dedicated-
   * field doctrine: never parsed back out of labels). Only LGS members
   * carry it (LGS Phase 1).
   */
  profile?: string
  /**
   * Factory service punchouts (AISI S240 A5.9) on an LGS member's web —
   * METADATA ONLY in Phase 1 (the box geometry carries no holes; the
   * Phase-2 MEP engines snap runs to this rhythm instead of drilling).
   * Centers run along the member axis: first ≥ `endDistanceIn` from each
   * end, then `spacingIn` on-center; `count` is what fits the cut length.
   */
  punchouts?: {
    /** Key into data/lgs-profiles.json punchPatterns. */
    pattern: string
    widthIn: number
    lengthIn: number
    spacingIn: number
    endDistanceIn: number
    count: number
  }
}

/** Electrical / plumbing / HVAC device the engines placed. */
export type FixtureKind =
  | 'receptacle'
  | 'receptacle-gfci'
  /** Outdoor weather-resistant GFCI receptacle with an in-use cover —
   * NEC 210.52(E) front+back, 210.8(A)(3), 406.9(A)/(B). Its own kind so
   * the takeoff and paper distinguish WR devices from interior GFCI. */
  | 'receptacle-wr-gfci'
  | 'switch'
  | 'light'
  | 'smoke-alarm'
  /** CO alarm — IRC R315.3 (attached garage / fuel-fired appliance). */
  | 'co-alarm'
  | 'panel'
  | 'stub-out'
  | 'vent-stack'
  | 'register'
  | 'return'
  | 'equipment'
  | 'water-heater'
  | 'water-meter'
  | 'cleanout'
  | 'thermostat'
  | 'exhaust-fan'
  | 'electric-meter'
  /** AC-condenser service disconnect (NEC 440.14 — within sight of the unit). */
  | 'disconnect'

export type Fixture = {
  system: BonesSystem
  kind: FixtureKind
  /** Level-local position of the fixture center. */
  position: readonly [number, number, number]
  /** Y rotation so the device faces out of its wall. */
  rotationY: number
  sourceId: string
  label?: string
  meta?: Record<string, string | number | boolean>
}

/**
 * Authoritative location of one service point (from a `bones:service` node).
 * When present, engines use it VERBATIM instead of auto-placement — routing
 * follows (checklist A4). Precedence: a non-default `position` (a manual
 * inspector/MCP write — editor drags of wall types commit `wallT` and reset
 * position to the default, see service/frame.ts) OUTRANKS `wallId`+`wallT`
 * (wall consumers snap it to the nearest wall point); the schema default
 * [0,0,0] means "wall anchor is authoritative". An unresolvable wall with a
 * default position is NOT an override (engines auto-place).
 */
export type ServicePointOverride = {
  wallId?: string
  /** 0..1 along the wall from `start`. */
  wallT?: number
  /** Mount height (device center, m AFF). */
  heightAff?: number
  position?: readonly [number, number, number]
  /** Assembly yaw override (radians, world +Y — the node's `yawOverride`
   * field, written by the host rotate gestures). Heat-pump only today: it
   * beats the derived wall-square orientation for unit #1's cabinet + pad;
   * absent ⇒ the engine derives (never a stored copy of the derivation). */
  yaw?: number
}

/**
 * Authoritative location of one wall-mounted electrical DEVICE (receptacle /
 * switch), keyed by the engine's deterministic `deviceId` — from a
 * `bones:device` node the user MOVED (unmoved nodes track the derivation and
 * are never overrides; see device/overrides.ts). Same precedence as
 * `ServicePointOverride`: a non-default `position` outranks `wallId`+`wallT`
 * (mapped to the nearest wall point). Unlike service points, a device
 * override is NOT honored verbatim — the engine applies code-aware snapping
 * (RO snap-out, stud rule, height clamps; electrical.ts
 * `applyDeviceOverrides`) so the mount stays physical.
 */
export type DeviceOverride = {
  wallId?: string
  /** 0..1 along the wall from `start`. */
  wallT?: number
  /** Mount height (device center, m AFF). */
  heightAff?: number
  position?: readonly [number, number, number]
}

/** Per-level device overrides, keyed by deterministic deviceId. */
export type DeviceOverrides = ReadonlyMap<string, DeviceOverride>

/** Per-level service overrides keyed by what each engine consumes. */
export type ServiceOverrides = {
  panel?: ServicePointOverride
  waterHeater?: ServicePointOverride
  waterEntry?: ServicePointOverride
  sewerExit?: ServicePointOverride
  powerEntry?: ServicePointOverride
  thermostat?: ServicePointOverride
  heatPump?: ServicePointOverride
  electricMeter?: ServicePointOverride
}

/** A door/window opening extracted from a wall's children, wall-local. */
export type OpeningSlice = {
  id: string
  kind: 'door' | 'window'
  /** Center distance along the wall from `start`, meters. */
  u: number
  width: number
  height: number
  /** Bottom of the opening above the floor (0 for doors). */
  sillHeight: number
  /** Rough opening — width the framing must clear. */
  roughWidth: number
  roughHeight: number
}

/**
 * Everything the engines need to know about one wall, extracted once from the
 * scene (see `wall-model.ts`) so engines never touch the store.
 */
export type WallSlice = {
  id: string
  start: readonly [number, number]
  end: readonly [number, number]
  length: number
  /** Unit direction start→end. */
  dir: readonly [number, number]
  thickness: number
  height: number
  /**
   * Structural-core depth (m) declared by the host wall's `assembly.framing`
   * (editor `packages/core/src/schema/nodes/wall.ts` → `WallAssembly`,
   * resolved by `packages/core/src/systems/wall/wall-assembly.ts`). When the
   * host says the core is 3-1/2" or 5-1/2" that is the AUTHORITATIVE stud
   * depth — IRC Table R602.3(5) sizes studs by nominal 2x4/2x6, and the
   * assembly names which one. ABSENT (walls drawn before WS5, or an
   * assembly-less wall) falls back to the historical thickness heuristic
   * (`studSizeFor`). See src/core/wall-model.ts.
   */
  framingDepth?: number
  /** `assembly.framing.kind` — 'wood' | 'lgs' | 'cmu' | 'icf'. Absent when
   * the host wall carries no assembly. Only 'wood'/'lgs' feed `studSizeFor`;
   * CMU/ICF cores are framed by their own engines. */
  framingKind?: 'wood' | 'lgs' | 'cmu' | 'icf'
  /** True when either face is marked exterior (or unknown-but-boundary). */
  exterior: boolean
  openings: OpeningSlice[]
  /** Curved walls are framed segment-wise later; v1 flags them. */
  curved: boolean
  /**
   * Level-local y the wall STANDS ON when the host's `supportSlabId`
   * names a slab at a different height than the plate line — the garage
   * walls on their pad at grade beside a raised platform (W11b). The
   * wall's `height` is already the body from this base up to the top
   * (Pascal `resolveWallTop`: the top stays where it was, the body grows
   * down to the support). Absent = the plate line (0), every scene drawn
   * before this byte-identical.
   */
  baseY?: number
  /** The slab node the wall stands on (set with `baseY`). */
  supportSlabId?: string
}

/**
 * What a slab node IS, read from the generator's `metadata.floor` tag
 * (packages/plugin-generate build.ts / porch.ts):
 *   - 'floor' — the storey's floor (no tag, 'platform', anything unknown):
 *     a framed platform on a raised house, the slab-on-grade otherwise;
 *   - 'slab'  — concrete at its own elevation whatever the house stands on
 *     ('slab-on-grade', 'garage-slab-at-grade', 'porch-slab'): the
 *     foundation pours it, nothing frames it;
 *   - 'deck'  — a wood deck: the deck engine frames it, nothing pours it.
 */
export type SlabKind = 'floor' | 'slab' | 'deck'

/** A slab outline for floor framing / foundation, level-local. */
export type SlabSlice = {
  id: string
  polygon: readonly (readonly [number, number])[]
  holes: readonly (readonly (readonly [number, number])[])[]
  elevation: number
  thickness: number
  /** Absent = 'floor' (every slab drawn before the tag existed). */
  kind?: SlabKind
  /**
   * An OUTDOOR floor (a deck, a porch pad): exactly the outdoors the
   * exterior-side probes hunt for — never coverage. Without this a porch
   * slab against the front wall read as 'covered' and the wall under the
   * porch lost its sheathing, WRB and siding (W10b).
   */
  outdoor?: boolean
}

/** A named room (Pascal zone) — drives GFCI, wet walls, registers. */
export type RoomSlice = {
  id: string
  name: string
  /** Classified from the name: kitchen/bathroom/bedroom/garage/laundry/
   * hallway/outdoor/other. 'outdoor' (garden/patio/yard…) is open air —
   * never conditioned, never a register target, never floor coverage for
   * the exterior-wall election (starter-template report 2026-08-22: the
   * back-garden zone read as a habitable room, so HVAC ducted a supply
   * register into the yard and the election saw rooms on both wall sides). */
  category:
    | 'kitchen'
    | 'bathroom'
    | 'bedroom'
    | 'garage'
    | 'laundry'
    | 'hallway'
    | 'outdoor'
    | 'other'
  polygon: readonly (readonly [number, number])[]
  boundaryWallIds: readonly string[]
  ceilingHeight: number
}

/** Bounding info for a roof segment plane set (v1 roof model). */
export type RoofSlice = {
  id: string
  type: 'hip' | 'gable' | 'shed' | 'gambrel' | 'dutch' | 'mansard' | 'flat'
  position: readonly [number, number, number]
  rotationY: number
  width: number
  depth: number
  pitch: number
  overhang: Record<string, number>
}
