/**
 * Scene → engine model extraction. The ONLY place Bones reads Pascal node
 * shapes; engines stay pure. Wall child openings follow the host convention
 * verified against the door floor-plan renderer: `position[0]` is the opening
 * CENTER measured along the wall from `start`; doors sit on the floor,
 * windows carry their center height in `position[1]`.
 */

import type {
  OpeningSlice,
  RoomSlice,
  ServiceOverrides,
  ServicePointOverride,
  SlabKind,
  SlabSlice,
  WallSlice,
  PorchPostSlice,
} from './types'
import { inches } from './units'

// Minimal structural views of the host nodes we read — kept local so the
// extractor compiles against any @pascal-app/core >=0.9 without depending on
// exact exported TS types.
type AnyRecord = Record<string, unknown>
type NodesRecord = Record<string, AnyRecord>

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const pair = (v: unknown): readonly [number, number] | null =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
    ? [v[0], v[1]]
    : null

/** Default wall height used across Pascal when a wall doesn't set one. */
const DEFAULT_WALL_HEIGHT = 2.5
const DEFAULT_WALL_THICKNESS = 0.1

/**
 * Host wall `assembly.framing` — the structural core the ARCHITECT declared
 * (editor WS5: `packages/core/src/schema/nodes/wall.ts` → `WallAssembly`,
 * resolved by `packages/core/src/systems/wall/wall-assembly.ts`). Bones
 * reads it so the stud recipe follows the drawn assembly instead of guessing
 * from total wall thickness: an exterior 2x4 stack (3/4" siding + 7/16"
 * sheathing + 3-1/2" stud + 1/2" gypsum = 5-3/16" = 0.132 m) sits ABOVE the
 * 0.13 m `thickWallThreshold` and used to frame as 2x6 — wrong studs AND a
 * spurious cavity-compression flag on every member of the wall.
 *
 * Returns undefined for anything the host did not declare; never invents a
 * depth.
 */
function extractAssemblyFraming(
  node: AnyRecord,
): { depth: number; kind: WallSlice['framingKind'] } | undefined {
  const assembly = node.assembly
  if (typeof assembly !== 'object' || assembly === null) return undefined
  const framing = (assembly as AnyRecord).framing
  if (typeof framing !== 'object' || framing === null) return undefined
  const depth = (framing as AnyRecord).depth
  if (typeof depth !== 'number' || !Number.isFinite(depth) || depth <= 0) return undefined
  const rawKind = (framing as AnyRecord).kind
  const kind =
    rawKind === 'wood' || rawKind === 'lgs' || rawKind === 'cmu' || rawKind === 'icf'
      ? rawKind
      : undefined
  return { depth, kind }
}

function extractOpening(node: AnyRecord): OpeningSlice | null {
  const type = node.type
  if (type !== 'door' && type !== 'window') return null
  const pos = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
  const width = num(node.width, type === 'door' ? 0.9 : 1.5)
  const height = num(node.height, type === 'door' ? 2.1 : 1.5)
  const centerY = num(pos[1], type === 'door' ? height / 2 : 1.5)
  const sillHeight = type === 'door' ? 0 : Math.max(0, centerY - height / 2)
  const roughWidth = num(node.roughOpeningWidth, width + inches(1.5))
  const roughHeight = num(node.roughOpeningHeight, height + inches(1.5))
  return {
    id: String(node.id ?? ''),
    kind: type,
    u: num(pos[0], 0),
    width,
    height,
    sillHeight,
    roughWidth,
    roughHeight,
  }
}

/** Extract every straight wall on `levelId` with its openings. */
/**
 * Geometric exterior fallback (quality round-1 A1): hosts routinely leave
 * BOTH faces 'interior', which killed sheathing/WRB/cladding, stemwall
 * hardware, and put devices on the wrong side. When no wall in the level
 * declares an exterior face, infer: probe one wall-thickness past each
 * face at the midpoint — a face with NO other wall's segment and no slab
 * coverage within the footprint faces outdoors.
 */
function applyExteriorFallback(
  walls: WallSlice[],
  slabs: { polygon: readonly (readonly [number, number])[] }[],
  hasRooms: boolean,
  hasLowerStorey: boolean,
): void {
  if (walls.some((w) => w.exterior)) return
  if (slabs.length === 0 && !hasRooms) {
    // NOTHING to probe against and nothing interior to enclose. With a
    // storey BELOW in the same building this is an attic / gable storey —
    // its walls face outdoors. (Prod starter house 2026-08-16: roof-level
    // gable-end walls framed as INTERIOR — no sheathing/WRB/cladding —
    // because the slab probe below found both sides equally 'uncovered'.)
    // WITHOUT a storey below it is an in-progress GROUND storey: leave the
    // walls interior — blanket-exterior there turned partitions into
    // exterior/CMU and the takeoff booked sheathing area the layer engine
    // never renders (checklist S4, verify round 2026-08-16). compute widens
    // `slabs` with the storey-below footprint first; this is the last
    // resort when the whole building has no flooring at all.
    if (!hasLowerStorey) return
    for (const wall of walls) {
      if (!wall.curved) (wall as { exterior: boolean }).exterior = true
    }
    return
  }
  const inPoly = (
    p: readonly [number, number],
    poly: readonly (readonly [number, number])[],
  ): boolean => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i] as readonly [number, number]
      const [xj, zj] = poly[j] as readonly [number, number]
      if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)
        inside = !inside
    }
    return inside
  }
  const covered = (p: readonly [number, number]): boolean =>
    slabs.some((sl) => inPoly(p, sl.polygon))
  for (const wall of walls) {
    if (wall.curved) continue
    const mid: [number, number] = [
      wall.start[0] + (wall.dir[0] * wall.length) / 2,
      wall.start[1] + (wall.dir[1] * wall.length) / 2,
    ]
    const probeDist = wall.thickness / 2 + 0.2
    let exposedSides = 0
    for (const side of [1, -1] as const) {
      const n: [number, number] = [-wall.dir[1] * side, wall.dir[0] * side]
      const p: [number, number] = [mid[0] + n[0] * probeDist, mid[1] + n[1] * probeDist]
      if (!covered(p)) exposedSides++
    }
    // exactly one exposed side = a perimeter wall
    if (exposedSides === 1) (wall as { exterior: boolean }).exterior = true
  }
}

export function extractWalls(
  nodes: NodesRecord,
  levelId: string,
  slabs: { polygon: readonly (readonly [number, number])[] }[] = [],
  /** A storey exists BELOW this level in the same building — gates the
   * attic blanket-exterior rule (an in-progress ground storey with no
   * slabs/rooms anywhere must NOT frame its partitions as exterior). */
  hasLowerStorey = false,
  /**
   * The level's vertical datum (W11b) — how the HOST resolves a wall's
   * extent (core `resolveWallTop` / `getWallPlaneTop`): a wall with no
   * explicit height reaches the level's wall plane (the floor-to-floor
   * line, or the underside of a covering slab above), and a wall whose
   * `supportSlabId` names a slab at another height stands on that slab
   * with its top unchanged. Absent = the historical 2.5 m default and the
   * plate line (standalone callers, tests).
   */
  datum?: WallDatum,
): WallSlice[] {
  const walls: WallSlice[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const start = pair(node.start)
    const end = pair(node.end)
    if (!start || !end) continue
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.05) continue
    const curved = Math.abs(num(node.curveOffset, 0)) > 1e-6

    const openings: OpeningSlice[] = []
    const childIds = Array.isArray(node.children) ? (node.children as string[]) : []
    for (const childId of childIds) {
      const child = nodes[childId]
      if (!child) continue
      const opening = extractOpening(child)
      if (opening) openings.push(opening)
    }
    openings.sort((a, b) => a.u - b.u)

    const assemblyFraming = extractAssemblyFraming(node)

    const front = node.frontSide
    const back = node.backSide
    const exterior = front === 'exterior' || back === 'exterior'

    // Vertical extent the host's way (W11b): the top is the explicit height
    // or the level's wall plane; a support slab at another height moves the
    // BASE there (a positive base lifts an explicit-height wall whole, a
    // negative one grows the body down to the slab — core resolveWallTop).
    const explicitHeight = node.height != null ? num(node.height, DEFAULT_WALL_HEIGHT) : null
    const supportId =
      typeof node.supportSlabId === 'string' && node.supportSlabId !== 'ground'
        ? node.supportSlabId
        : null
    const base = supportId && datum ? (datum.supportBaseFor(supportId) ?? 0) : 0
    const top =
      explicitHeight !== null
        ? base > 0
          ? base + explicitHeight
          : explicitHeight
        : datum
          ? datum.planeTopFor(start, end)
          : DEFAULT_WALL_HEIGHT
    const onSupport = supportId !== null && Math.abs(base) > 1e-6

    walls.push({
      id: String(node.id ?? ''),
      start,
      end,
      length,
      dir: [dx / length, dz / length],
      thickness: num(node.thickness, DEFAULT_WALL_THICKNESS),
      height: top - base,
      ...(onSupport ? { baseY: base, supportSlabId: supportId } : {}),
      // Assembly-declared core (WS5). Folded ONLY when the host declares it,
      // so an assembly-less wall's slice stays byte-identical to before.
      ...(assemblyFraming
        ? {
            framingDepth: assemblyFraming.depth,
            ...(assemblyFraming.kind ? { framingKind: assemblyFraming.kind } : {}),
          }
        : {}),
      exterior,
      openings,
      curved,
    })
  }
  // Rooms gate the attic fallback above: a level with drawn zones is a lived
  // storey — ambiguous walls there stay interior, never blanket-exterior.
  // Polygon validity mirrors extractRooms exactly (pair-filtered points,
  // >= 3 VALID vertices) so a malformed zone can't count as a room here
  // while extractRooms drops it.
  const hasRooms = Object.values(nodes).some(
    (n) =>
      n.type === 'zone' &&
      n.parentId === levelId &&
      Array.isArray(n.polygon) &&
      (n.polygon as unknown[]).map(pair).filter((p) => p !== null).length >= 3,
  )
  applyExteriorFallback(walls, slabs, hasRooms, hasLowerStorey)
  return walls
}

/** Extract slabs on `levelId` for floor framing / foundation outlines. */
/** The level's vertical datum for wall extraction — see `extractWalls`. */
export type WallDatum = {
  /** Level-local y of the wall plane over this wall's run (floor-to-floor, or a covering slab's underside). */
  planeTopFor: (start: readonly [number, number], end: readonly [number, number]) => number
  /** Level-local y of a support slab's walking surface in the framing datum, or null when the id names no slab on the level. */
  supportBaseFor: (slabId: string) => number | null
}

export function extractSlabs(nodes: NodesRecord, levelId: string): SlabSlice[] {
  const slabs: SlabSlice[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'slab' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const polygon = Array.isArray(node.polygon)
      ? (node.polygon as unknown[]).map(pair).filter((p): p is [number, number] => p !== null)
      : []
    if (polygon.length < 3) continue
    const holes = Array.isArray(node.holes)
      ? (node.holes as unknown[][]).map((h) =>
          (h as unknown[]).map(pair).filter((p): p is [number, number] => p !== null),
        )
      : []
    slabs.push({
      id: String(node.id ?? ''),
      polygon,
      holes,
      elevation: num(node.elevation, 0.05),
      thickness: num(node.thickness, 0.05),
      kind: slabKindOf(node.metadata),
      outdoor: slabIsOutdoor(node.metadata),
      decking: slabDeckingOf(node.metadata),
    })
  }
  return slabs
}

/**
 * The porch posts on a level: `column` nodes carrying the generator's
 * `metadata.porch` (the entrance they belong to). A post standing on a slab
 * (`supportSlabId`) has its base at that slab's elevation; a deck's post
 * carries its own base (the grade under it) in its position.
 */
export function extractPorchPosts(
  nodes: NodesRecord,
  levelId: string,
  /** The sculpted ground under a level-local plan point (null / absent on a flat site): a post hosted on the ground (`supportSlabId: 'ground'`) stands on it, its authored y on top. */
  ground?: ((x: number, z: number) => number) | null,
): PorchPostSlice[] {
  const out: PorchPostSlice[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'column' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const meta = node.metadata as { porch?: { entrance?: unknown } } | undefined
    const porch = meta?.porch
    if (!porch || typeof porch !== 'object') continue
    const pos = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
    const support = typeof node.supportSlabId === 'string' ? nodes[node.supportSlabId] : undefined
    const slabY =
      support?.type === 'slab' && typeof support.elevation === 'number' ? support.elevation : 0
    // the viewer lifts a ground-hosted node by the ground under it (terrain-support.ts)
    const groundY =
      node.supportSlabId === 'ground' && ground ? ground(num(pos[0], 0), num(pos[2], 0)) : 0
    const width = num(node.width, 0.14)
    out.push({
      id: String(node.id ?? ''),
      plan: [num(pos[0], 0), num(pos[2], 0)],
      baseY: num(pos[1], 0) + slabY + groundY,
      height: num(node.height, 2.5),
      size: Math.max(width, num(node.depth, width)),
      entrance: typeof porch.entrance === 'string' ? porch.entrance : undefined,
    })
  }
  return out
}

/** The decking thickness a deck slab declares (`metadata.decking`), when its slab is decking + rim band. */
export function slabDeckingOf(metadata: unknown): number | undefined {
  const decking = (metadata as { decking?: unknown } | null | undefined)?.decking
  return typeof decking === 'number' && decking > 0 ? decking : undefined
}

/** A deck or a porch pad: an outdoor floor, never probe coverage. */
export function slabIsOutdoor(metadata: unknown): boolean {
  const floor = (metadata as { floor?: unknown } | null | undefined)?.floor
  return floor === 'deck' || floor === 'porch-slab'
}

/** The generator's `metadata.floor` tag → what the slab is (see SlabKind). */
export function slabKindOf(metadata: unknown): SlabKind {
  const floor = (metadata as { floor?: unknown } | null | undefined)?.floor
  if (floor === 'deck') return 'deck'
  if (floor === 'slab-on-grade' || floor === 'garage-slab-at-grade' || floor === 'porch-slab')
    return 'slab'
  // a beam the generator shows as a slab (a shed cover's beam): trim, never framed or poured
  if (floor === 'porch-beam') return 'trim'
  return 'floor'
}

// ---------------------------------------------------------------------------
// Placed sanitary fixtures — the items the USER dropped (toilet, shower…)
// are the plumbing demand points; room-category guessing is the fallback.
// ---------------------------------------------------------------------------

export type PlacedFixtureSlice = {
  id: string
  kind: 'toilet' | 'lavatory' | 'shower' | 'bathtub' | 'clothes-washer' | 'kitchen-sink'
  /** Level-local plan position of the item center. */
  plan: readonly [number, number]
  yaw: number
  /** Needs a hot-water supply (toilets are cold-only). */
  hot: boolean
  /** Drainage fixture units (IRC P3004.1). */
  dfu: number
  /** Trap/drain size, inches (IRC P3201.7). */
  drainIn: number
}

/** asset.id → sanitary profile. Kitchen counter blocks carry the sink. */
const SANITARY_ASSETS: Record<string, Omit<PlacedFixtureSlice, 'id' | 'plan' | 'yaw'>> = {
  toilet: { kind: 'toilet', hot: false, dfu: 3, drainIn: 3 },
  'bathroom-sink': { kind: 'lavatory', hot: true, dfu: 1, drainIn: 1.25 },
  'shower-square': { kind: 'shower', hot: true, dfu: 2, drainIn: 2 },
  'shower-angle': { kind: 'shower', hot: true, dfu: 2, drainIn: 2 },
  bathtub: { kind: 'bathtub', hot: true, dfu: 2, drainIn: 1.5 },
  'washing-machine': { kind: 'clothes-washer', hot: true, dfu: 2, drainIn: 2 },
  kitchen: { kind: 'kitchen-sink', hot: true, dfu: 2, drainIn: 1.5 },
  'kitchen-counter': { kind: 'kitchen-sink', hot: true, dfu: 2, drainIn: 1.5 },
}

export function extractPlacedFixtures(nodes: NodesRecord, levelId: string): PlacedFixtureSlice[] {
  const out: PlacedFixtureSlice[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'item' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const asset = node.asset as { id?: string } | undefined
    const profile = asset?.id ? SANITARY_ASSETS[asset.id] : undefined
    if (!profile) continue
    const pos = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
    const rot = Array.isArray(node.rotation) ? (node.rotation as number[]) : [0, 0, 0]
    out.push({
      id: String(node.id ?? ''),
      plan: [num(pos[0], 0), num(pos[2], 0)],
      yaw: num(rot[1], 0),
      ...profile,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Service points — bones:service nodes are AUTHORITATIVE engine overrides
// (checklist A4): where one exists, the engine routes to it, verbatim.
// ---------------------------------------------------------------------------

/** serviceType → the engines' override slot. */
const SERVICE_OVERRIDE_KEY: Record<string, keyof ServiceOverrides> = {
  panel: 'panel',
  'water-heater': 'waterHeater',
  'water-entry': 'waterEntry',
  'sewer-exit': 'sewerExit',
  'power-entry': 'powerEntry',
}

export type ServiceOverrideExtraction = {
  overrides: ServiceOverrides
  /** serviceTypes that had more than one node on the level (extras ignored). */
  duplicates: string[]
}

/**
 * Collect the service overrides on `levelId`. Duplicate nodes of one type:
 * the LOWEST id wins — deterministic across hosts (object insertion order is
 * not a contract) — and the type lands in `duplicates` so computeLevel can
 * warn that the extra node is ignored.
 */
export function extractServiceOverrides(
  nodes: NodesRecord,
  levelId: string,
): ServiceOverrideExtraction {
  const winners = new Map<keyof ServiceOverrides, { id: string; node: AnyRecord }>()
  const duplicates = new Set<string>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'bones:service' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const serviceType = String(node.serviceType)
    const key = SERVICE_OVERRIDE_KEY[serviceType]
    if (!key) continue
    const id = String(node.id ?? '')
    const current = winners.get(key)
    if (!current) {
      winners.set(key, { id, node })
      continue
    }
    duplicates.add(serviceType)
    if (id < current.id) winners.set(key, { id, node })
  }
  const overrides: ServiceOverrides = {}
  for (const [key, { node }] of winners) {
    const override: ServicePointOverride = {}
    if (typeof node.wallId === 'string' && node.wallId.length > 0) override.wallId = node.wallId
    if (typeof node.wallT === 'number' && Number.isFinite(node.wallT)) override.wallT = node.wallT
    if (typeof node.heightAff === 'number' && Number.isFinite(node.heightAff)) {
      override.heightAff = node.heightAff
    }
    const pos = Array.isArray(node.position) ? (node.position as number[]) : null
    if (pos && pos.length >= 3) {
      override.position = [num(pos[0], 0), num(pos[1], 0), num(pos[2], 0)]
    }
    overrides[key] = override
  }
  return { overrides, duplicates: [...duplicates].sort() }
}

/** Ordered level ids (bottom → top) with their storey heights. */
export type LevelSlice = {
  id: string
  level: number
  height: number
  /** Level-floor world Y — mirrors the host's storey stacking exactly
   * (core getLevelElevations): per building, ordinal order, each floor
   * sits on the one below plus its own explicit baseElevation offset. */
  baseY: number
  /** Owning building — level arithmetic (ground detection, storey-below
   * height, roof search/ownership) never crosses buildings. */
  buildingId: string | null
}

export function extractLevels(nodes: NodesRecord): LevelSlice[] {
  type Entry = LevelSlice & { baseElevation: number; buildingId: string | null }
  const buildings = Object.values(nodes).filter((n) => n.type === 'building')
  const entries: Entry[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'level') continue
    const id = String(node.id ?? '')
    const parentId = typeof node.parentId === 'string' ? node.parentId : null
    let buildingId = parentId && nodes[parentId]?.type === 'building' ? parentId : null
    if (!buildingId) {
      // Legacy scenes list levels only in the building's children array.
      const owner = buildings.find(
        (b) => Array.isArray(b.children) && (b.children as string[]).includes(id),
      )
      buildingId = owner ? String(owner.id ?? '') : null
    }
    entries.push({
      id,
      level: num(node.level, 0),
      // host core DEFAULT_LEVEL_HEIGHT — a 2.7 fallback desyncs baseY on
      // legacy height-less levels (verify round: 0.2 m float per storey)
      height: num(node.height, 2.5),
      baseElevation: num(node.baseElevation, 0),
      buildingId,
      baseY: 0,
    })
  }
  const cumulative = new Map<string | null, number>()
  const sorted = entries.sort((a, b) => a.level - b.level)
  for (const e of sorted) {
    e.baseY = (cumulative.get(e.buildingId) ?? 0) + e.baseElevation
    cumulative.set(e.buildingId, e.baseY + e.height)
  }
  return sorted.map(({ id, level, height, baseY, buildingId }) => ({
    id,
    level,
    height,
    baseY,
    buildingId,
  }))
}

/** Sleeping-area name words — the bedroom row below, and exported so the
 * compose can WARN when a name carrying a sleeping word classifies
 * outdoors ('Outdoor bedroom' via the leading qualifier, 'Master terrace'
 * via the head noun → open air → NO smoke alarm placed; R314 must never
 * drop silently — round-2 + day-9 advisories). */
export const SLEEPING_NAME_RE = /bed|chambre|master|primary/i

const ROOM_PATTERNS: [RegExp, RoomSlice['category']][] = [
  [/kitchen|cuisine/i, 'kitchen'],
  [/bath|wc|toilet|powder|salle de bain/i, 'bathroom'],
  [SLEEPING_NAME_RE, 'bedroom'],
  [/garage/i, 'garage'],
  [/laundry|utility|buanderie/i, 'laundry'],
  [/hall|corridor|couloir/i, 'hallway'],
]

/** Outdoor names (open air — never conditioned/habitable; starter-template
 * 'Back garden' zone, 2026-08-22). The terrace forms are spelled OUT
 * (terrace|terrasse|terraza|terrazza) so material adjectives never match: a
 * 'Terrazzo bathroom' is a bathroom (plumbing stubs, exhaust fan, wet
 * GFCI), a 'Terracotta kitchen' a kitchen (skeptic round-1 harm class).
 * garden/yard are WORD-ANCHORED (day-9 skeptic misfire list): a
 * 'Kindergarden' is a child's room and a 'Vineyard cellar' a cellar —
 * substrings never classify — while the legitimate one-word compounds
 * keep their own anchored forms (courtyard/backyard/frontyard, plurals).
 * 'balcon' covers balcony/balcon/balcón; 'lanai' is the FL porch. */
const OUTDOOR_RE =
  /\bgardens?\b|\b(?:court|back|front)?yards?\b|patio|terrace|terrasse|terraza|terrazza|deck|porch|balcon|lanai|pergola|jardin|outdoor|outside|exterior/i

/** A LEADING outdoor qualifier flips a compound name outdoors: an 'Outdoor
 * kitchen' or 'Roof terrace' is open air even where the trailing word alone
 * would classify indoor. */
const OUTDOOR_QUALIFIER_RE = /^\s*(outdoor|outside|exterior|roof)\b/i

/** Start index of the LAST match of `re` in `name`, −1 when none. The
 * head-noun tie-break reads compound names right-to-left: room names put
 * the head noun LAST ('Master terrace' is a terrace, 'Garden bedroom' a
 * bedroom), so the later match is the thing the room IS. */
function lastMatchIndex(re: RegExp, name: string): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let idx = -1
  for (let m = g.exec(name); m !== null; m = g.exec(name)) {
    idx = m.index
    if (g.lastIndex === m.index) g.lastIndex++ // zero-width safety
  }
  return idx
}

/**
 * Classify a zone name into the room categories the MEP engines key on.
 *
 * Compound-name precedence (skeptic round-1, head-noun refinement day-9):
 * when a name carries BOTH an indoor category word and an outdoor keyword,
 * the HEAD NOUN — the LAST matching word — wins: a 'Garden bedroom' is a
 * bedroom (it keeps its R314 smoke alarm), a 'Patio kitchen' a kitchen,
 * while a 'Master terrace' / 'Bedroom terrace' is a terrace (open air; the
 * compose still speaks for the dropped alarm via SLEEPING_NAME_RE). A tie
 * cannot arise from distinct words; equal indices keep the INDOOR reading
 * (conservative — life-safety machinery stays). A LEADING outdoor
 * qualifier (OUTDOOR_QUALIFIER_RE) still flips outdoors regardless: an
 * 'Outdoor kitchen' is open air even though 'kitchen' is the head noun.
 * A name with an outdoor keyword and NO indoor category word stays
 * outdoor: 'Back garden', 'Roof terrace' — and deliberately also
 * 'Winter garden' / 'Garden room' ('room' is not a category word; a
 * conservatory is unconditioned glass space until the user renames or
 * re-zones it — the defensible reading). The indoor CATEGORY itself keeps
 * ROOM_PATTERNS order ('Master bath' is a bathroom, not a bedroom).
 */
export function classifyRoom(name: string): RoomSlice['category'] {
  let indoor: RoomSlice['category'] | null = null
  let indoorLast = -1
  for (const [pattern, category] of ROOM_PATTERNS) {
    const at = lastMatchIndex(pattern, name)
    if (at < 0) continue
    if (indoor === null) indoor = category
    if (at > indoorLast) indoorLast = at
  }
  const outdoorLast = lastMatchIndex(OUTDOOR_RE, name)
  if (
    outdoorLast >= 0 &&
    (indoor === null || OUTDOOR_QUALIFIER_RE.test(name) || outdoorLast > indoorLast)
  ) {
    return 'outdoor'
  }
  return indoor ?? 'other'
}

/** Zone-twin tolerance (m): two zones whose polygons match vertex-for-vertex
 * within this distance are the SAME drawn space duplicated (host zone
 * duplication / re-detection drift), not two rooms. 1 cm — float drift and
 * re-snap jitter live well under it; genuinely distinct zones (even twins
 * shifted a wall thickness apart) sit far above it. */
const ZONE_TWIN_TOL = 0.01

/** Vertex-for-vertex polygon identity within ZONE_TWIN_TOL, under any
 * cyclic offset in either winding order (the host re-detects zones with
 * arbitrary start vertex / orientation). */
function sameZonePolygon(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
): boolean {
  const n = a.length
  if (n !== b.length) return false
  const close = (p: readonly [number, number], q: readonly [number, number]): boolean =>
    Math.hypot(p[0] - q[0], p[1] - q[1]) <= ZONE_TWIN_TOL
  for (const dir of [1, -1]) {
    for (let off = 0; off < n; off++) {
      let ok = true
      for (let i = 0; i < n; i++) {
        const j = (((off + dir * i) % n) + n) % n
        const bj = b[j]
        const ai = a[i]
        if (!ai || !bj || !close(ai, bj)) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
  }
  return false
}

/** Zone-twin tiebreak — which twin is the room (S8 class, stated):
 * (1) a CATEGORIZED name beats 'other' — the MEP engines key on category,
 *     so a 'Kitchen' twin outranks its 'Living' twin (the counter walk,
 *     GFCI zones, register land once, on the honest name);
 * (2) then the LONGER trimmed name (more descriptive: 'Living / Kitchen'
 *     beats 'Kitchen');
 * (3) then the lexicographically smaller id (deterministic across hosts —
 *     object insertion order is not a contract). */
function betterZoneTwin(a: RoomSlice, b: RoomSlice): RoomSlice {
  const rank = (r: RoomSlice): number => (r.category === 'other' ? 0 : 1)
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b
  const an = a.name.trim().length
  const bn = b.name.trim().length
  if (an !== bn) return an > bn ? a : b
  return a.id <= b.id ? a : b
}

/**
 * Extract named rooms (zones) on `levelId`, DEDUPED: zone twins — same
 * polygon within ZONE_TWIN_TOL on the same level — collapse to ONE room
 * (kept per betterZoneTwin; the dropped twin's boundaryWallIds union onto
 * the kept room, mirroring S8's opening merge). Duplicate zones made the
 * honesty warnings contradict the sheets: the demo's 'Living / Kitchen'
 * twin fired 'countertop receptacles not modeled' for the sink-less twin
 * while the OTHER twin's counter run was drawn — and welded B13's false
 * cross-circuit traveler. Every extractRooms consumer (compute, seeding,
 * panel) sees the same deduped census (A4 parity). `twinLog`, when passed,
 * collects the merges so computeLevel can say so.
 */
export function extractRooms(
  nodes: NodesRecord,
  levelId: string,
  twinLog?: { kept: string; dropped: string }[],
): RoomSlice[] {
  const rooms: RoomSlice[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' || node.parentId !== levelId) continue
    const polygon = Array.isArray(node.polygon)
      ? (node.polygon as unknown[]).map(pair).filter((p): p is [number, number] => p !== null)
      : []
    if (polygon.length < 3) continue
    const name = typeof node.name === 'string' ? node.name : ''
    rooms.push({
      id: String(node.id ?? ''),
      name,
      category: classifyRoom(name),
      polygon,
      boundaryWallIds: Array.isArray(node.boundaryWallIds)
        ? (node.boundaryWallIds as string[])
        : [],
      ceilingHeight: num(node.ceilingHeight, 2.7),
    })
  }
  // Room ORDER is a downstream contract (circuit numbering walks rooms in
  // scene order — byte-equality): dedupe in place, never re-sort. The
  // WINNER is still insertion-order-independent — betterZoneTwin is a
  // strict total order (category rank, name length, then id).
  const kept: RoomSlice[] = []
  for (const room of rooms) {
    const twinAt = kept.findIndex((k) => sameZonePolygon(k.polygon, room.polygon))
    if (twinAt < 0) {
      kept.push(room)
      continue
    }
    const incumbent = kept[twinAt] as RoomSlice
    const winner = betterZoneTwin(incumbent, room)
    const loser = winner === incumbent ? room : incumbent
    const mergedWallIds = [
      ...winner.boundaryWallIds,
      ...loser.boundaryWallIds.filter((id) => !winner.boundaryWallIds.includes(id)),
    ]
    kept[twinAt] =
      mergedWallIds.length === winner.boundaryWallIds.length
        ? winner
        : { ...winner, boundaryWallIds: mergedWallIds }
    twinLog?.push({ kept: winner.name || winner.id, dropped: loser.name || loser.id })
  }
  return kept
}
