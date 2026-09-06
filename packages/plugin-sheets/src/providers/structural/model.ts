/**
 * The bridge between a Pascal scene and the Bones framing engines, for the
 * S-series sheets.
 *
 * Everything the structural provider prints on paper comes from ONE call:
 * `computeLevel(nodes, config)` (packages/plugin-bones/src/framing/compute.ts).
 * The engines return `Member[]` in LEVEL-LOCAL metres — the same coordinate
 * space a sheet's live window draws in — plus the resolved `FramingSpec` and
 * jurisdiction, which is where every code number on these sheets comes from.
 * Nothing here invents a dimension: a value that is not in the spec, in a
 * member's own geometry, or in a member's cited label is printed as
 * "(verify: …)" instead.
 *
 * Bones is imported by RELATIVE PATH. Its package.json `exports` map only
 * publishes the root entry, which pulls the React panel and a `.webp` asset
 * import; the engines are plain pure functions and must be reachable from a
 * headless test. The workspace layout makes the relative path stable, and
 * `packages/plugin-bones` stays read-only either way. (Reported: a
 * `./src/*` subpath export on plugin-bones would make this an ordinary
 * package import.)
 */
import { calculateLevelMiters, getWallPlanFootprint } from '@pascal-app/core'
import adoptionData from '../../../../plugin-bones/data/jurisdictions-adoption.json'
import climateData from '../../../../plugin-bones/data/jurisdictions-climate.json'
import type { FramingSpec } from '../../../../plugin-bones/src/core/spec'
import type { Member, WallSlice } from '../../../../plugin-bones/src/core/types'
import { formatFtIn, formatIn, toFeet, toInches } from '../../../../plugin-bones/src/core/units'
import { computeLevel, foundationOf } from '../../../../plugin-bones/src/framing/compute'
import { resolveJurisdiction } from '../../notes/jurisdiction'
import { FramingNode } from '../../../../plugin-bones/src/framing/schema'
import {
  type JurisdictionProfile,
  profileFor,
} from '../../../../plugin-bones/src/jurisdiction/profiles'
import type { AnyNodeLike, NodeMap } from '../../model'

export type { FramingSpec, JurisdictionProfile, Member, WallSlice }
export { formatFtIn, formatIn, toFeet, toInches }

export type Pt = [number, number]
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** Climate row for the level's jurisdiction — design criteria on SN1. */
export type ClimateRow = {
  name?: string
  frostLineIn?: number
  groundSnowLoadPsf?: number
  ultimateWindMph?: number
  windNote?: string
  seismicSdc?: string
  seismicNote?: string
  frostLineNote?: string
  snowNote?: string
  termiteRisk?: string
  weatheringPotential?: string
  caveat?: string
  flags?: Record<string, boolean>
}

export type StructuralModel = {
  levelId: string
  level: AnyNodeLike | undefined
  levelLabel: string
  /** Ordinal within the building — 0 is the storey that gets the foundation. */
  levelIndex: number
  isGround: boolean
  /** Whether the level above (if any) exists — floor framing belongs to IT. */
  hasLevelAbove: boolean
  members: Member[]
  walls: WallSlice[]
  spec: FramingSpec
  profile: JurisdictionProfile
  climate: ClimateRow | undefined
  /** 'FL', 'CA', 'INTL' … as resolved by Bones. */
  jurisdiction: string
  /** How the jurisdiction was chosen — printed, never assumed silently. */
  jurisdictionSource: string
  /** Mitred wall plan footprints, level-local metres. */
  footprints: { id: string; loop: Pt[]; exterior: boolean; bearing: boolean }[]
  slabs: { id: string; polygon: Pt[]; holes: Pt[][] }[]
  bounds: Bounds
  /** Bones' own warnings for this level, plus ours. */
  warnings: string[]
  /** The ground storey is a framed platform over a crawl space (the building's foundation record). */
  raisedFloor: boolean
  /** The site is in Florida's High-Velocity Hurricane Zone (county inferred or recorded). */
  hvhz: boolean
  /** The design wind speed as the criteria table prints it, with its provenance. */
  windLabel: string
  /** 'truss' when the roof is pre-engineered trusses (interior partitions then bear nothing on a single storey). */
  roofSystem: 'stick' | 'truss'
}

/* ------------------------------------------------------------- caching */

/**
 * `computeLevel` memoises on the config object's identity, and a sheet set
 * resolves many viewports against the same scene snapshot — so the model is
 * cached per (nodes, level) here too. Pascal's stores hand out immutable
 * snapshots, so the nodes reference is a safe key (the same argument
 * `compute.ts` makes for its own WeakMap).
 */
const cache = new WeakMap<object, Map<string, StructuralModel>>()

/* -------------------------------------------------------------- levels */

function levelNodes(nodes: NodeMap): AnyNodeLike[] {
  return Object.values(nodes)
    .filter((n) => n?.type === 'level')
    .sort((a, b) => ((a.level as number) ?? 0) - ((b.level as number) ?? 0))
}

export function levelName(node: AnyNodeLike | undefined): string {
  if (!node) return 'Level'
  const name = (node.name as string | undefined)?.trim()
  return name || `Level ${(node.level as number) ?? 0}`
}

/** The two-letter state on the site record, when there is one. */
function siteState(nodes: NodeMap): string | null {
  const site = Object.values(nodes).find((n) => n?.type === 'site')
  const address = site?.address as { state?: unknown } | undefined
  const parcel = site?.parcel as { state?: unknown } | undefined
  const raw = (address?.state ?? parcel?.state) as unknown
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

/**
 * The `bones:framing` config the level already carries, or a synthesised one.
 *
 * An X-rayed level's own node is authoritative: it holds the user's
 * jurisdiction, LOD, roof system (stick / truss), framing system and per-wall
 * construction overrides, and the sheets must draw the SAME building the 3D
 * X-ray shows. Without one we synthesise the defaults and take the
 * jurisdiction from the site address, so a scene that has never been X-rayed
 * still produces a structural set — the sheet says which of the two happened.
 */
/** The roof system the building asks for (the generator writes it past its span limit). */
function roofSystemOf(nodes: NodeMap, levelId: string): 'stick' | 'truss' | null {
  const level = nodes[levelId]
  const building = typeof level?.parentId === 'string' ? nodes[level.parentId] : undefined
  const system = (building?.metadata as { structure?: { roofSystem?: unknown } } | undefined)
    ?.structure?.roofSystem
  return system === 'truss' || system === 'stick' ? system : null
}

function configFor(nodes: NodeMap, levelId: string): { config: FramingNode; source: string } {
  const existing = Object.values(nodes).find(
    (n) => n?.type === 'bones:framing' && n.parentId === levelId,
  )
  const roofSystem = roofSystemOf(nodes, levelId)
  if (existing) {
    const parsed = FramingNode.safeParse(existing)
    if (parsed.success) {
      // the node's own choice stands; an unset one takes the building's
      const config =
        parsed.data.roofSystem === undefined && roofSystem
          ? { ...parsed.data, roofSystem }
          : parsed.data
      return {
        config: withAssemblyOverrides(nodes, levelId, config),
        source: `Bones X-ray node on this level (jurisdiction ${parsed.data.jurisdiction})`,
      }
    }
  }
  const state = siteState(nodes)
  return {
    config: withAssemblyOverrides(
      nodes,
      levelId,
      FramingNode.parse({
        id: 'bonesframing_sheets',
        type: 'bones:framing',
        parentId: levelId,
        jurisdiction: state ?? 'AUTO',
        ...(roofSystem ? { roofSystem } : {}),
      }),
    ),
    source: state
      ? `site address state (${state}) — no Bones X-ray node on this level`
      : 'no site state and no Bones X-ray node — generic defaults',
  }
}

/**
 * The wall ASSEMBLY is the source of truth for how a wall is built (WS5,
 * `wall.assembly.framing.kind`): a 2x6 wood exterior in Florida must frame as
 * wood on paper even though Bones' FL profile defaults exteriors to CMU. So
 * every wall on the level that declares an assembly and has no explicit
 * per-wall override in the config gets one derived from it — wood → framed,
 * lgs → lgs, cmu → cmu. ICF has no Bones construction and is left to the
 * jurisdiction default (the engine's own warning covers it). Walls without an
 * assembly keep the jurisdiction default, as before.
 */
function withAssemblyOverrides(nodes: NodeMap, levelId: string, config: FramingNode): FramingNode {
  const overrides: Record<string, 'framed' | 'lgs' | 'cmu'> = {}
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall' || node.parentId !== levelId) continue
    if (config.wallOverrides?.[node.id] !== undefined) continue
    const kind = (node.assembly as { framing?: { kind?: string } } | undefined)?.framing?.kind
    if (kind === 'wood') overrides[node.id] = 'framed'
    else if (kind === 'lgs') overrides[node.id] = 'lgs'
    else if (kind === 'cmu') overrides[node.id] = 'cmu'
  }
  if (Object.keys(overrides).length === 0) return config
  return FramingNode.parse({
    ...config,
    wallOverrides: { ...(config.wallOverrides ?? {}), ...overrides },
  })
}

/* ------------------------------------------------------------ geometry */

function boundsOf(points: readonly Pt[]): Bounds | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b
  if (!b) return a
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/**
 * Level-local mitred plan footprints for the level's walls — the same math
 * `levelFootprintLoops` runs in
 * `packages/editor/src/lib/floorplan/site-plan/build-site-plan-drawing.ts`,
 * minus the building placement transform (a structural plan is drawn in the
 * level's own frame, like every Bones member).
 */
function wallFootprints(
  nodes: NodeMap,
  levelId: string,
  walls: WallSlice[],
  bearingRule: { interiorBearing: boolean; lapWallIds: Set<string> },
): { id: string; loop: Pt[]; exterior: boolean; bearing: boolean }[] {
  const wallNodes = Object.values(nodes).filter(
    (n) => n?.type === 'wall' && n.parentId === levelId && n.visible !== false,
  )
  if (wallNodes.length === 0) return []
  const miters = calculateLevelMiters(wallNodes as never)
  const sliceById = new Map(walls.map((w) => [w.id, w]))
  const out: { id: string; loop: Pt[]; exterior: boolean; bearing: boolean }[] = []
  for (const node of wallNodes) {
    const poly = getWallPlanFootprint(node as never, miters)
    if (poly.length < 3) continue
    const slice = sliceById.get(node.id)
    out.push({
      id: node.id,
      loop: poly.map((p) => [p.x, p.y] as Pt),
      exterior: slice?.exterior ?? false,
      // Which interior walls bear: with site-cut framing, the partitions the
      // ceiling joists lap over (the roof engine names them) and — Bones'
      // foundation assumption, INTERIOR_BEARING_MIN_LENGTH — any interior
      // wall over 2.4 m, which gets a thickened footing; under a trussed
      // single storey none of them (the trusses clear-span). The same rule
      // the foundation engine used, so the plans and the footings agree.
      bearing:
        (slice?.exterior ?? false) ||
        (bearingRule.interiorBearing &&
          (bearingRule.lapWallIds.has(node.id) || (slice?.length ?? 0) > 2.4)),
    })
  }
  return out
}

function slabOutlines(
  nodes: NodeMap,
  levelId: string,
): { id: string; polygon: Pt[]; holes: Pt[][] }[] {
  const out: { id: string; polygon: Pt[]; holes: Pt[][] }[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'slab' || node.parentId !== levelId || node.visible === false) continue
    const polygon = asPointList(node.polygon)
    if (polygon.length < 3) continue
    const holes = Array.isArray(node.holes)
      ? (node.holes as unknown[]).map(asPointList).filter((h) => h.length >= 3)
      : []
    out.push({ id: node.id, polygon, holes })
  }
  return out
}

function asPointList(value: unknown): Pt[] {
  if (!Array.isArray(value)) return []
  const out: Pt[] = []
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
      out.push([entry[0], entry[1]])
    } else if (entry && typeof entry === 'object') {
      const p = entry as { x?: unknown; y?: unknown }
      if (typeof p.x === 'number' && typeof p.y === 'number') out.push([p.x, p.y])
    }
  }
  return out
}

/* --------------------------------------------------------- the model */

/**
 * Run the Bones engines for one level and collect everything the S-sheets
 * draw from. Returns null when the scene has no level at all.
 */
export function structuralModel(nodes: NodeMap, levelId?: string): StructuralModel | null {
  const all = levelNodes(nodes)
  const level = levelId ? nodes[levelId] : all[0]
  const id = level?.id ?? levelId
  if (!id) return null

  const byNodes = cache.get(nodes as object) ?? new Map<string, StructuralModel>()
  cache.set(nodes as object, byNodes)
  const hit = byNodes.get(id)
  if (hit) return hit

  const { config, source } = configFor(nodes, id)
  const result = computeLevel(nodes as never, config)
  const profile = profileFor(result.jurisdiction)
  const index = all.findIndex((l) => l.id === id)
  const hasAbove = index >= 0 && index < all.length - 1
  const trussed = result.spec.roofSystem === 'truss'
  // the partitions the ceiling joists lap over, named by the roof engine
  const lapWallIds = new Set<string>()
  for (const m of result.members) {
    if (m.role !== 'ceiling-joist') continue
    const text = `${m.label ?? ''} ${(m as { flag?: string }).flag ?? ''}`
    for (const hit of text.matchAll(/partition (wall_[A-Za-z0-9]+)/g)) lapWallIds.add(hit[1] as string)
  }
  const footprints = wallFootprints(nodes, id, result.walls, {
    interiorBearing: !(trussed && !hasAbove),
    lapWallIds,
  })
  const slabs = slabOutlines(nodes, id)

  let bounds: Bounds | null = null
  for (const fp of footprints) bounds = unionBounds(bounds, boundsOf(fp.loop))
  for (const slab of slabs) bounds = unionBounds(bounds, boundsOf(slab.polygon))
  for (const member of result.members) {
    const seg = memberPlanSegment(member)
    bounds = unionBounds(bounds, boundsOf([seg.a, seg.b]))
  }

  const warnings = [...result.warnings]
  const site = resolveJurisdiction(nodes)
  const parentId = level?.parentId
  const building = typeof parentId === 'string' ? nodes[parentId] : undefined
  const raisedFloor = foundationOf(building as Record<string, unknown> | undefined).type === 'raised'
  const climate = climateRow(result.jurisdiction)
  const windLabel = site.windRange
    ? `${site.windRange} (HVHZ — ${site.county} County; ASCE 7 map — verify)`
    : climate?.ultimateWindMph
      ? `${climate.ultimateWindMph} mph (state typical — verify against the ASCE 7 map)`
      : 'not in the data'
  // R602.10's prescriptive bracing is written for ultimate wind speeds to
  // 140 mph; above that (and in the HVHZ) the lateral system is designed
  // (R301.2.1.1: AWC WFCM, ICC 600, ASCE 7). The S4.0 braced-wall plan then
  // shows the lines to design against, not a prescriptive answer.
  if (site.hvhz || (climate?.ultimateWindMph ?? 0) > 140) {
    warnings.push(
      `Ultimate design wind speed ${site.windRange ?? `${climate?.ultimateWindMph} mph`} exceeds the 140 mph limit of R602.10 prescriptive wall bracing — lateral design per R301.2.1.1 (AWC WFCM / ICC 600 / ASCE 7) by the engineer of record; braced wall lines shown for that design.`,
    )
  }
  if (!Object.values(nodes).some((n) => n?.type === 'bones:framing' && n.parentId === id)) {
    warnings.unshift(
      `Framing derived with default Bones settings — ${source}. X-ray this level in Bones to drive these sheets from its own config.`,
    )
  }

  const model: StructuralModel = {
    levelId: id,
    level,
    levelLabel: levelName(level),
    levelIndex: index < 0 ? 0 : index,
    isGround: index <= 0,
    hasLevelAbove: index >= 0 && index < all.length - 1,
    members: result.members,
    walls: result.walls,
    spec: result.spec,
    profile,
    climate: climateRow(result.jurisdiction),
    jurisdiction: result.jurisdiction,
    jurisdictionSource: source,
    footprints,
    slabs,
    bounds: bounds ?? { minX: -6, minY: -6, maxX: 6, maxY: 6 },
    warnings,
    raisedFloor,
    hvhz: site.hvhz,
    windLabel,
    roofSystem: trussed ? 'truss' : 'stick',
  }
  byNodes.set(id, model)
  return model
}

/* --------------------------------------------------- climate look-up */

const CLIMATE = climateData as { states?: Record<string, ClimateRow>; disclaimer?: string }
const ADOPTION = adoptionData as {
  states?: Record<string, { residentialCode?: string; ircBase?: number | null; note?: string }>
  disclaimer?: string
}

export function climateRow(code: string): ClimateRow | undefined {
  return CLIMATE.states?.[code]
}

export const CLIMATE_DISCLAIMER = CLIMATE.disclaimer ?? ''
export const ADOPTION_DISCLAIMER = ADOPTION.disclaimer ?? ''

export function adoptionRow(
  code: string,
): { residentialCode?: string; ircBase?: number | null; note?: string } | undefined {
  return ADOPTION.states?.[code]
}

/* -------------------------------------------------- member projection */

/**
 * A member's plan segment: the world endpoints of its LONGEST axis, projected
 * onto the plan (x, z).
 *
 * The rotation is a three.js XYZ euler (`R = Rx·Ry·Rz`), which is how the
 * Bones renderer mounts every member and how `plan-set.ts` projects them —
 * the same math is reproduced here rather than imported because
 * `memberAxis` is module-private there. A rafter therefore foreshortens by
 * cos(pitch) exactly as a roof framing plan requires, and a rolled outlooker
 * keeps its true plan angle.
 */
export function memberPlanSegment(m: Member): {
  a: Pt
  b: Pt
  axis: 0 | 1 | 2
  planLength: number
} {
  const dims = m.dims
  const axis: 0 | 1 | 2 = dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : dims[1] >= dims[2] ? 1 : 2
  const half = dims[axis] / 2
  const [vx, , vz] = rotateLocalAxis(m.rotation, axis)
  const cx = m.position[0]
  const cz = m.position[2]
  const a: Pt = [cx - vx * half, cz - vz * half]
  const b: Pt = [cx + vx * half, cz + vz * half]
  return { a, b, axis, planLength: Math.hypot(b[0] - a[0], b[1] - a[1]) }
}

/** The member's plan rectangle: length axis × the widest of its other two. */
export function memberPlanRect(m: Member): Pt[] {
  const dims = m.dims
  const axis: 0 | 1 | 2 = dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : dims[1] >= dims[2] ? 1 : 2
  // The cross axis drawn in plan is whichever of the other two is more
  // horizontal — for a footing (len, height, width) that is the width.
  const others: (0 | 1 | 2)[] = ([0, 1, 2] as const).filter((i) => i !== axis)
  let best: 0 | 1 | 2 = others[0] ?? 2
  let bestFrac = -1
  for (const i of others) {
    const [ax, , az] = rotateLocalAxis(m.rotation, i)
    const frac = Math.hypot(ax, az)
    if (frac > bestFrac) {
      bestFrac = frac
      best = i
    }
  }
  const [lx, , lz] = rotateLocalAxis(m.rotation, axis)
  const [wx, , wz] = rotateLocalAxis(m.rotation, best)
  const hl = dims[axis] / 2
  const hw = dims[best] / 2
  const cx = m.position[0]
  const cz = m.position[2]
  return [
    [cx - lx * hl - wx * hw, cz - lz * hl - wz * hw],
    [cx + lx * hl - wx * hw, cz + lz * hl - wz * hw],
    [cx + lx * hl + wx * hw, cz + lz * hl + wz * hw],
    [cx - lx * hl + wx * hw, cz - lz * hl + wz * hw],
  ]
}

/** Plan centre of a member. */
export function memberPlanCentre(m: Member): Pt {
  return [m.position[0], m.position[2]]
}

/** `R = Rx·Ry·Rz` applied to the unit vector on `axis` (three.js XYZ order). */
function rotateLocalAxis(
  rotation: readonly [number, number, number],
  axis: 0 | 1 | 2,
): [number, number, number] {
  const [rx, ry, rz] = rotation
  const e = [0, 0, 0]
  e[axis] = 1
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  let vx = (e[0] ?? 0) * cz - (e[1] ?? 0) * sz
  let vy = (e[0] ?? 0) * sz + (e[1] ?? 0) * cz
  let vz = e[2] ?? 0
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const tx = vx * cy + vz * sy
  vz = -vx * sy + vz * cy
  vx = tx
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const ty = vy * cx - vz * sx
  vz = vy * sx + vz * cx
  vy = ty
  return [vx, vy, vz]
}

/* ---------------------------------------------------------- selection */

export function membersOf(
  model: StructuralModel,
  system: Member['system'],
  ...roles: Member['role'][]
): Member[] {
  const wanted = new Set(roles)
  return model.members.filter(
    (m) => m.system === system && (wanted.size === 0 || wanted.has(m.role)),
  )
}

/** The Bones systems an S-sheet speaks for. */
export const STRUCTURAL_SYSTEMS_SET = new Set<Member['system']>([
  'wall-framing',
  'floor-framing',
  'roof-framing',
  'foundation',
])

/**
 * Distinct member flags for a set — printed on the sheet, never swallowed.
 *
 * STRUCTURAL flags only: one `computeLevel` also flags plumbing trap arms and
 * HVAC line-set clashes, and those belong on the P and M sheets. The first
 * SN1 render carried nine of them under "ENGINE FLAG", which buried the one
 * flag that mattered (a ceiling joist over its prescriptive span).
 */
export function flagsOf(members: readonly Member[]): string[] {
  const seen = new Set<string>()
  for (const m of members) {
    if (m.flag && STRUCTURAL_SYSTEMS_SET.has(m.system)) seen.add(m.flag)
  }
  return [...seen]
}

/**
 * Bones' level warnings, trimmed to the ones a STRUCTURAL reader needs — the
 * same filter the provider applies to the warnings strip.
 */
export function structuralWarnings(model: StructuralModel): string[] {
  return model.warnings.filter(
    (w) => !/water-pipe bond|HVAC|smoke alarm|zones on this level|NEC|plumbing/i.test(w),
  )
}

/**
 * The o.c. spacing implied by a family of parallel members, in metres — the
 * median gap between neighbours measured perpendicular to their run. Returns
 * null with fewer than two members (nothing to measure; the caller prints the
 * spec value with a "(spec)" qualifier instead of inventing one).
 */
export function measuredSpacing(members: readonly Member[]): number | null {
  if (members.length < 2) return null
  const first = members[0]
  if (!first) return null
  const seg = memberPlanSegment(first)
  const dx = seg.b[0] - seg.a[0]
  const dy = seg.b[1] - seg.a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const nx = -dy / len
  const ny = dx / len
  const offsets = members
    .map((m) => {
      const c = memberPlanCentre(m)
      return c[0] * nx + c[1] * ny
    })
    .sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < offsets.length; i++) {
    const gap = (offsets[i] ?? 0) - (offsets[i - 1] ?? 0)
    if (gap > 0.05) gaps.push(gap)
  }
  if (gaps.length === 0) return null
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] ?? null
}

/**
 * Metres → an inch string with a vulgar fraction ('5/8"', '3-1/2"'), the way
 * a bolt diameter or a slab thickness is written on paper. `formatIn` rounds
 * to hundredths, which turns Bones' exact `inches(5/8)` into `0.63"`.
 */
export function formatInchFraction(m: number, denominator = 16): string {
  const total = toInches(m)
  const sign = total < 0 ? '-' : ''
  const abs = Math.abs(total)
  const whole = Math.floor(abs + 1e-9)
  let num = Math.round((abs - whole) * denominator)
  let den = denominator
  let carry = 0
  if (num >= den) {
    carry = 1
    num = 0
  }
  while (num > 0 && num % 2 === 0 && den % 2 === 0) {
    num /= 2
    den /= 2
  }
  const w = whole + carry
  if (num === 0) return `${sign}${w}"`
  if (w === 0) return `${sign}${num}/${den}"`
  return `${sign}${w}-${num}/${den}"`
}

/**
 * Round a measured metre spacing to the nearest tabulated o.c. column.
 *
 * Returns NULL when the measurement is not a framing spacing at all — two
 * mid-span purlins 16 ft apart are not "@ 192 in o.c.", and printing that
 * would be an invented callout. The caller then captions the family without
 * a spacing.
 */
export function nearestOcInches(spacingM: number | null): number | null {
  if (spacingM === null) return null
  const raw = toInches(spacingM)
  if (raw > 50) return null
  const columns = [12, 16, 19.2, 24, 32, 48]
  let best: number | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const c of columns) {
    const delta = Math.abs(c - raw)
    if (delta < bestDelta) {
      bestDelta = delta
      best = c
    }
  }
  return bestDelta <= 2.5 ? best : null
}
