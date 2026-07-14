// Config-driven, data-based scene assertions for the eval harness.
//
// Everything here is a PURE function operating on the *actual* scene data read
// back from MCP (get_zones / get_walls / get_scene) — never on the model's own
// self-reported diagnostics. Room *type* is the one thing the scene graph does
// not carry structurally (zones only have a model-chosen `name`), so type
// classification is name-based; every other fact (area, bounds, openings,
// adjacency, node identity) comes from structural fields.
//
// Each assertion returns pass / fail / unsupported with expected + actual +
// reason. `unsupported` means "this can't be reliably decided from the data we
// have" and must NOT be counted as a pass by the caller.

import { findVocabularyOption } from '../src/furniture-checklist'
import { ROOM_NAME_PATTERNS } from '../src/lang/room-vocab'
import { countZonesOfType, ROOM_TYPE_PATTERNS, zoneNameMatchesType } from './evaluate-run'

export type ZoneInfo = {
  id: string
  name: string
  polygon: Array<[number, number]>
  areaSqMeters: number
  bounds?: { width: number; depth: number }
}

export type Opening = { type: string }
export type WallInfo = {
  id: string
  start: [number, number]
  end: [number, number]
  openings: Opening[]
}

export type SceneInputs = { zones: ZoneInfo[]; walls: WallInfo[] }

export type AssertionStatus = 'pass' | 'fail' | 'unsupported'
export type AssertionResult = {
  name: string
  status: AssertionStatus
  expected?: unknown
  actual?: unknown
  reason?: string
}

// ---------------------------------------------------------------------------
// Geometry helpers (ported from the agent's deterministic checks; axis-aligned
// rooms per the structure-phase prompt). Coordinates are [x, z] in plan.
// ---------------------------------------------------------------------------

const EPS = 0.05 // wall-coincidence tolerance (m)

const round2 = (value: number): number => Math.round(value * 100) / 100
const MIN_OVERLAP = 0.03 // below this two collinear segments merely touch

type Seg = { start: [number, number]; end: [number, number] }
type Orientation = { axis: 'x' | 'z'; constant: number; lo: number; hi: number }

function segmentOrientation(seg: Seg): Orientation | null {
  const [sx, sz] = seg.start
  const [ex, ez] = seg.end
  if (Math.abs(sx - ex) <= EPS) return { axis: 'z', constant: (sx + ex) / 2, lo: Math.min(sz, ez), hi: Math.max(sz, ez) }
  if (Math.abs(sz - ez) <= EPS) return { axis: 'x', constant: (sz + ez) / 2, lo: Math.min(sx, ex), hi: Math.max(sx, ex) }
  return null
}

function pointsClose(p: [number, number], q: [number, number]): boolean {
  return Math.hypot(p[0] - q[0], p[1] - q[1]) <= EPS
}

function wallsCoincide(a: Seg, b: Seg): boolean {
  return (
    (pointsClose(a.start, b.start) && pointsClose(a.end, b.end)) ||
    (pointsClose(a.start, b.end) && pointsClose(a.end, b.start))
  )
}

function collinearOverlap(a: Seg, b: Seg): Orientation | null {
  const oa = segmentOrientation(a)
  const ob = segmentOrientation(b)
  if (!oa || !ob || oa.axis !== ob.axis) return null
  if (Math.abs(oa.constant - ob.constant) > EPS) return null
  const lo = Math.max(oa.lo, ob.lo)
  const hi = Math.min(oa.hi, ob.hi)
  if (hi - lo <= MIN_OVERLAP) return null
  return { axis: oa.axis, constant: (oa.constant + ob.constant) / 2, lo, hi }
}

function segmentsCoverSameLine(a: Seg, b: Seg): boolean {
  return wallsCoincide(a, b) || collinearOverlap(a, b) !== null
}

function zoneEdges(zone: ZoneInfo): Seg[] {
  const edges: Seg[] = []
  for (let i = 0; i < zone.polygon.length; i++) {
    edges.push({ start: zone.polygon[i]!, end: zone.polygon[(i + 1) % zone.polygon.length]! })
  }
  return edges
}

export function overallBounds(zones: ZoneInfo[]): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (zones.length === 0) return null
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (const zone of zones) {
    for (const [x, z] of zone.polygon) {
      if (x < b.minX) b.minX = x
      if (x > b.maxX) b.maxX = x
      if (z < b.minZ) b.minZ = z
      if (z > b.maxZ) b.maxZ = z
    }
  }
  return b
}

function wallIsOnExteriorBoundary(wall: WallInfo, bounds: NonNullable<ReturnType<typeof overallBounds>>): boolean {
  const midX = (wall.start[0] + wall.end[0]) / 2
  const midZ = (wall.start[1] + wall.end[1]) / 2
  const e = 0.15
  return (
    Math.abs(midX - bounds.minX) <= e ||
    Math.abs(midX - bounds.maxX) <= e ||
    Math.abs(midZ - bounds.minZ) <= e ||
    Math.abs(midZ - bounds.maxZ) <= e
  )
}

// Which zones a wall's segment lies along the boundary of.
function wallHostZoneIds(wall: WallInfo, zones: ZoneInfo[]): string[] {
  const ids: string[] = []
  for (const zone of zones) {
    if (zoneEdges(zone).some(edge => segmentsCoverSameLine(wall, edge))) ids.push(zone.id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Room-type classification (name-based — the only signal zones carry).
// ---------------------------------------------------------------------------

export const KNOWN_ROOM_TYPES = ['卧室', '客厅', '厨房', '卫生间', '书房', '餐厅', '玄关'] as const
export type KnownRoomType = (typeof KNOWN_ROOM_TYPES)[number]

function roomTypePattern(type: string): RegExp | undefined {
  return ROOM_TYPE_PATTERNS[type]
}

function zoneIsType(zone: ZoneInfo, type: string): boolean {
  // Canonical classification + merged-space semantics — shared with the
  // corpus-level checks so roomCount/adjacency/forbidden all agree.
  return zoneNameMatchesType(type, zone.name)
}

function countRoomsOfType(zones: ZoneInfo[], type: string): number {
  // Merged-space stand-in rule lives in countZonesOfType (evaluate-run).
  return countZonesOfType(type, zones.map(zone => zone.name))
}

// "Public circulation" room types a bedroom is allowed to reach through.
// Name recognition comes from the shared trilingual vocabulary (中/日/英).
const PUBLIC_TYPES = ['客厅', '书房', '餐厅']
const PUBLIC_NAME_PATTERN = new RegExp(
  [
    ROOM_NAME_PATTERNS.living.source,
    ROOM_NAME_PATTERNS.hallway.source,
    ROOM_NAME_PATTERNS.entry.source,
  ].join('|'),
  'i',
)

function zoneIsPublic(zone: ZoneInfo): boolean {
  if (PUBLIC_TYPES.some(t => zoneIsType(zone, t))) return true
  return PUBLIC_NAME_PATTERN.test(zone.name)
}

// ---------------------------------------------------------------------------
// Adjacency graph from doors + open passages (open kitchen has no door but is
// still reachable: a shared boundary with NO wall covering it is an opening).
// ---------------------------------------------------------------------------

type Adjacency = Map<string, Set<string>>

export function buildZoneAdjacency(zones: ZoneInfo[], walls: WallInfo[]): Adjacency {
  const adjacency: Adjacency = new Map()
  for (const zone of zones) adjacency.set(zone.id, new Set())

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!
      const b = zones[j]!
      // Two zones can share SEVERAL disjoint boundary segments — e.g. a
      // kitchen carved out of an L-shaped living hub touches it on two
      // sides — and the door may sit on any of them. Checking only the
      // first shared segment found used to mark such rooms unreachable
      // (case-03 regression: 厨房 had a door on its second shared edge).
      // Connected if ANY shared segment has a door, or ANY is open (no
      // covering wall).
      let connected = false
      for (const ea of zoneEdges(a)) {
        if (connected) break
        for (const eb of zoneEdges(b)) {
          if (!segmentsCoverSameLine(ea, eb)) continue
          const coveringWalls = walls.filter(w => segmentsCoverSameLine(w, ea))
          const hasDoor = coveringWalls.some(w => w.openings.some(o => o.type === 'door'))
          if (hasDoor || coveringWalls.length === 0) {
            connected = true
            break
          }
        }
      }
      if (connected) {
        adjacency.get(a.id)!.add(b.id)
        adjacency.get(b.id)!.add(a.id)
      }
    }
  }
  return adjacency
}

// Zones that have an exterior door (a door on a wall that lies on the outer
// boundary and borders exactly one zone → leads outside = an entry).
function entryZoneIds(zones: ZoneInfo[], walls: WallInfo[]): string[] {
  const bounds = overallBounds(zones)
  if (!bounds) return []
  const entries = new Set<string>()
  for (const wall of walls) {
    if (!wall.openings.some(o => o.type === 'door')) continue
    if (!wallIsOnExteriorBoundary(wall, bounds)) continue
    const hosts = wallHostZoneIds(wall, zones)
    if (hosts.length === 1) entries.add(hosts[0]!)
  }
  return [...entries]
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export function assertRoomCounts(zones: ZoneInfo[], expected: Record<string, number>): AssertionResult[] {
  const results: AssertionResult[] = []
  for (const [type, want] of Object.entries(expected)) {
    if (!roomTypePattern(type)) {
      results.push({
        name: `roomCount:${type}`,
        status: 'unsupported',
        reason: `未知房间类型 "${type}"（不在已知类型 ${KNOWN_ROOM_TYPES.join('/')} 中），无法用名称模式判定`,
      })
      continue
    }
    const actual = countRoomsOfType(zones, type)
    results.push({
      name: `roomCount:${type}`,
      status: actual === want ? 'pass' : 'fail',
      expected: want,
      actual,
      reason: actual === want ? undefined : `${type} 数量不符：期望 ${want}，实际 ${actual}`,
    })
  }
  return results
}

export function assertTotalArea(
  zones: ZoneInfo[],
  config: { target: number; tolerance: number },
): AssertionResult {
  if (zones.length === 0) {
    return { name: 'totalArea', status: 'unsupported', expected: config.target, reason: '没有 zones，无法计算面积' }
  }
  const actual = Math.round(zones.reduce((sum, z) => sum + z.areaSqMeters, 0) * 100) / 100
  const lo = config.target * (1 - config.tolerance)
  const hi = config.target * (1 + config.tolerance)
  const ok = actual >= lo && actual <= hi
  return {
    name: 'totalArea',
    status: ok ? 'pass' : 'fail',
    expected: `${config.target}±${Math.round(config.tolerance * 100)}% ([${lo.toFixed(1)}, ${hi.toFixed(1)}])`,
    actual,
    reason: ok ? undefined : `总面积 ${actual}㎡ 不在 [${lo.toFixed(1)}, ${hi.toFixed(1)}] 内`,
  }
}

// Each room of the given type(s) must have at least one window on an exterior
// wall bordering that room.
export function assertWindowsRequiredFor(
  zones: ZoneInfo[],
  walls: WallInfo[],
  types: string[],
): AssertionResult[] {
  const bounds = overallBounds(zones)
  const results: AssertionResult[] = []
  for (const type of types) {
    if (!roomTypePattern(type)) {
      results.push({ name: `windowsRequiredFor:${type}`, status: 'unsupported', reason: `未知房间类型 "${type}"` })
      continue
    }
    const rooms = zones.filter(z => zoneIsType(z, type))
    if (rooms.length === 0) {
      results.push({ name: `windowsRequiredFor:${type}`, status: 'fail', expected: '≥1 间', actual: 0, reason: `没有 ${type}` })
      continue
    }
    if (!bounds) {
      results.push({ name: `windowsRequiredFor:${type}`, status: 'unsupported', reason: '无法确定外边界' })
      continue
    }
    const without: string[] = []
    for (const room of rooms) {
      const hasExteriorWindow = zoneEdges(room).some(edge =>
        walls.some(
          w =>
            segmentsCoverSameLine(w, edge) &&
            w.openings.some(o => o.type === 'window') &&
            wallIsOnExteriorBoundary(w, bounds),
        ),
      )
      if (!hasExteriorWindow) without.push(room.name || room.id)
    }
    results.push({
      name: `windowsRequiredFor:${type}`,
      status: without.length === 0 ? 'pass' : 'fail',
      expected: `每间 ${type} 都有有效外窗`,
      actual: `${rooms.length - without.length}/${rooms.length} 有外窗`,
      reason: without.length === 0 ? undefined : `以下 ${type} 没有有效外窗：${without.join('、')}`,
    })
  }
  return results
}

export function assertAllRoomsReachable(zones: ZoneInfo[], walls: WallInfo[]): AssertionResult {
  if (zones.length === 0) {
    return { name: 'allRoomsReachable', status: 'unsupported', reason: '没有 zones' }
  }
  const adjacency = buildZoneAdjacency(zones, walls)
  let roots = entryZoneIds(zones, walls)
  if (roots.length === 0) roots = zones.filter(zoneIsPublic).map(z => z.id)
  if (roots.length === 0) {
    return {
      name: 'allRoomsReachable',
      status: 'unsupported',
      reason: '找不到入口（外门）也找不到公共空间（客厅/走廊/玄关），无法确定可达性起点',
    }
  }
  const visited = new Set<string>(roots)
  const queue = [...roots]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push(next)
      }
    }
  }
  const unreachable = zones.filter(z => !visited.has(z.id)).map(z => z.name || z.id)
  return {
    name: 'allRoomsReachable',
    status: unreachable.length === 0 ? 'pass' : 'fail',
    expected: '所有房间可从入口/公共空间到达',
    actual: `${visited.size}/${zones.length} 可达`,
    reason: unreachable.length === 0 ? undefined : `不可达房间：${unreachable.join('、')}`,
  }
}

export type AdjacencySpec = { a: string; b: string; relation: 'ensuite' | 'connected' | 'adjacent' }

export function assertAdjacency(
  zones: ZoneInfo[],
  walls: WallInfo[],
  spec: AdjacencySpec,
): AssertionResult {
  const name = `adjacency:${spec.a}-${spec.b}:${spec.relation}`
  if (!roomTypePattern(spec.a) || !roomTypePattern(spec.b)) {
    return { name, status: 'unsupported', reason: `未知房间类型（${spec.a} 或 ${spec.b}）` }
  }
  const aZones = zones.filter(z => zoneIsType(z, spec.a))
  const bZones = zones.filter(z => zoneIsType(z, spec.b))
  if (aZones.length === 0 || bZones.length === 0) {
    return { name, status: 'fail', reason: `缺少 ${spec.a} 或 ${spec.b}`, expected: spec.relation }
  }

  // A single zone matching both types is a merged open space（如「客厅厨房一体」
  // / living_kitchen，策略层 §3.3 开放式合并）— the strongest form of
  // connection/adjacency. Not applicable to ensuite, which is about a
  // door-graph relationship between two distinct rooms.
  if (spec.relation !== 'ensuite') {
    const merged = aZones.find(a => bZones.some(b => b.id === a.id))
    if (merged) {
      return {
        name,
        status: 'pass',
        expected: spec.relation === 'adjacent' ? `${spec.a} 与 ${spec.b} 相邻` : `${spec.a} 与 ${spec.b} 有门/开口直连`,
        actual: `「${merged.name || merged.id}」为合并开放空间`,
      }
    }
  }

  if (spec.relation === 'adjacent') {
    // Share a boundary (wall or open), regardless of a door.
    const ok = aZones.some(a =>
      bZones.some(b => zoneEdges(a).some(ea => zoneEdges(b).some(eb => segmentsCoverSameLine(ea, eb)))),
    )
    return { name, status: ok ? 'pass' : 'fail', expected: `${spec.a} 与 ${spec.b} 相邻`, reason: ok ? undefined : '未找到共享边界' }
  }

  const adjacency = buildZoneAdjacency(zones, walls)
  if (spec.relation === 'connected') {
    const ok = aZones.some(a => bZones.some(b => adjacency.get(a.id)?.has(b.id)))
    return { name, status: ok ? 'pass' : 'fail', expected: `${spec.a} 与 ${spec.b} 有门/开口直连`, reason: ok ? undefined : '未找到直连' }
  }

  // ensuite: a bathroom whose ONLY door-adjacency is a single bedroom.
  // Reliability guard: if a candidate bathroom shares a boundary with a
  // bedroom but no door can be confirmed on it (only an open/blocked wall),
  // the ensuite relationship can't be decided from the door graph → unsupported.
  let sawAmbiguous = false
  for (const bath of bZones) {
    const neighbors = adjacency.get(bath.id) ?? new Set<string>()
    const neighborBedrooms = [...neighbors].filter(id => aZones.some(a => a.id === id))
    if (neighbors.size === 1 && neighborBedrooms.length === 1) {
      return { name, status: 'pass', expected: `至少一组 ${spec.a} 套 ${spec.b}`, actual: `${bath.name || bath.id} 仅与卧室相连` }
    }
    // Shares a boundary with a bedroom but connection is via an open/unclear
    // passage rather than a confirmable door — can't reliably call it 套卫.
    const sharesWithBedroomNoDoor = aZones.some(
      a =>
        !neighbors.has(a.id) &&
        zoneEdges(a).some(ea => zoneEdges(bath).some(eb => segmentsCoverSameLine(ea, eb))),
    )
    if (sharesWithBedroomNoDoor) sawAmbiguous = true
  }
  if (sawAmbiguous) {
    return {
      name,
      status: 'unsupported',
      reason: '卫生间与卧室相邻但无法从门结构可靠确认套卫关系（缺少可确认的连接门）',
    }
  }
  return { name, status: 'fail', expected: `至少一组 ${spec.a} 套 ${spec.b}`, reason: '没有仅与单个卧室相连的卫生间' }
}

export function assertBounds(
  zones: ZoneInfo[],
  config: { width: number; depth: number; tolerance: number },
): AssertionResult {
  const bounds = overallBounds(zones)
  if (!bounds) return { name: 'bounds', status: 'unsupported', reason: '没有 zones' }
  const w = Math.round((bounds.maxX - bounds.minX) * 100) / 100
  const d = Math.round((bounds.maxZ - bounds.minZ) * 100) / 100
  const within = (actual: number, target: number) =>
    actual >= target * (1 - config.tolerance) && actual <= target * (1 + config.tolerance)
  // Accept either orientation (the model may lay the lot out along x or z).
  const direct = within(w, config.width) && within(d, config.depth)
  const swapped = within(w, config.depth) && within(d, config.width)
  const ok = direct || swapped
  return {
    name: 'bounds',
    status: ok ? 'pass' : 'fail',
    expected: `约 ${config.width}×${config.depth}m（±${Math.round(config.tolerance * 100)}%，允许长宽互换）`,
    actual: `${w}×${d}m`,
    reason: ok ? undefined : `整体轮廓 ${w}×${d}m 与目标 ${config.width}×${config.depth}m 不符`,
  }
}

// ---------------------------------------------------------------------------
// Snapshot diff (Case 13). Compares the full node maps before/after a modify.
// ---------------------------------------------------------------------------

export type SceneSnapshot = Record<string, { type?: string; [k: string]: unknown }>

export type SceneDiff = {
  added: string[]
  deleted: string[]
  modified: string[]
  addedByType: Record<string, number>
  deletedByType: Record<string, number>
}

function nodeType(node: unknown): string | undefined {
  return node && typeof node === 'object' && typeof (node as { type?: unknown }).type === 'string'
    ? (node as { type: string }).type
    : undefined
}

export function diffSnapshots(before: SceneSnapshot, after: SceneSnapshot): SceneDiff {
  const added: string[] = []
  const deleted: string[] = []
  const modified: string[] = []
  const addedByType: Record<string, number> = {}
  const deletedByType: Record<string, number> = {}
  for (const id of Object.keys(after)) {
    if (!(id in before)) {
      added.push(id)
      const t = nodeType(after[id]) ?? 'unknown'
      addedByType[t] = (addedByType[t] ?? 0) + 1
    } else if (JSON.stringify(before[id]) !== JSON.stringify(after[id])) {
      modified.push(id)
    }
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) {
      deleted.push(id)
      const t = nodeType(before[id]) ?? 'unknown'
      deletedByType[t] = (deletedByType[t] ?? 0) + 1
    }
  }
  return { added, deleted, modified, addedByType, deletedByType }
}

// ---------------------------------------------------------------------------
// Node-level change classification for the modification checks.
//
// The raw JSON diff above counts ANY property change as "modified" — but a
// wall's `children` array changes whenever a door/window is hosted on it, and
// hosting a new door on an existing wall does not damage the wall itself. A
// case like "只加一扇必要的房门" would false-positive on maxModifiedOriginalWalls.
// So the GATING wall check compares geometry fields only (start/end/thickness/
// height); children/metadata-only changes are reported informationally. To
// keep that from hiding real damage, original door/window nodes get their own
// geometry/host check (`openingChanged`) and deletions stay gated separately.
// ---------------------------------------------------------------------------

// Positions come back from the same serialized graph, so genuine edits differ
// by far more than float noise; 1mm keeps us safe against re-serialization.
const GEOM_FIELD_EPS = 0.001

function numbersDiffer(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > GEOM_FIELD_EPS
  return a !== b
}

function pairDiffers(a: unknown, b: unknown): boolean {
  const isPair = (v: unknown): v is [number, number] =>
    Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number')
  if (isPair(a) && isPair(b)) return numbersDiffer(a[0], b[0]) || numbersDiffer(a[1], b[1])
  return JSON.stringify(a) !== JSON.stringify(b)
}

/** True when a wall's structural geometry (not children/metadata) changed. */
export function wallGeometryChanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return (
    pairDiffers(before.start, after.start) ||
    pairDiffers(before.end, after.end) ||
    numbersDiffer(before.thickness, after.thickness) ||
    numbersDiffer(before.height, after.height)
  )
}

/** True when a door/window moved, was resized, or was re-hosted on another wall. */
export function openingChanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const positionDiffers = (() => {
    const isTriple = (v: unknown): v is number[] =>
      Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number')
    if (isTriple(before.position) && isTriple(after.position)) {
      return before.position.some((value, index) => numbersDiffer(value, (after.position as number[])[index]))
    }
    return JSON.stringify(before.position) !== JSON.stringify(after.position)
  })()
  return (
    positionDiffers ||
    numbersDiffer(before.width, after.width) ||
    numbersDiffer(before.height, after.height) ||
    before.parentId !== after.parentId ||
    before.wallId !== after.wallId
  )
}

export type ModificationChecks = {
  addedRoomType?: string
  adjacentTo?: string
  preserveRoomCounts?: boolean
  preserveFurniture?: boolean
  /** Fail if more than this many original walls were deleted. */
  maxDeletedOriginalWalls?: number
  /** Fail if more than this many original walls were modified. */
  maxModifiedOriginalWalls?: number
  /** Fail if any original door/window was deleted. */
  preserveOriginalOpenings?: boolean
  /** Require the newly added room to fall within this area range in m². */
  addedRoomArea?: { type: string; min: number; max: number }
  /** Require the overall zone footprint bounds to remain unchanged. */
  preserveExteriorBounds?: boolean
  /** Width-only exterior check for plan-first structural modifies (§4 locks W, depth floats). */
  preserveExteriorWidth?: boolean
  /** Require a matching existing room to meet an area range after modification. */
  targetRoomArea?: { type: string; min: number; max?: number; nameIncludes?: string[] }
  /**
   * Furniture-modify cases (M1): item-node diff assertions. Keywords match
   * case-insensitively against the serialized node (name, asset name, tags —
   * so an English catalog term matches regardless of the reply language).
   * `structureUntouched` requires zero structural nodes added or deleted
   * (modified is allowed: place_item re-parents touch zone children).
   */
  itemChanges?: {
    addedMatching?: string[]
    deletedMatching?: string[]
    structureUntouched?: boolean
  }
  /**
   * Local-removal cases (§6 吸收语义): every before-zone whose name is not in
   * `except` must reappear after with an identical polygon (±2cm) — proves
   * the modify moved nothing it wasn't asked to touch. Matching is geometric
   * (name-independent), so renames don't read as movement.
   *
   * `allowAbsorber`: the absorber is picked by shared-edge length at runtime
   * (topology-dependent — 2026-07-14 复盘: pinning it in `except` broke when
   * the baseline layout changed). With it set, `except` lists only the
   * removed room(s) and AT MOST ONE other room may change shape (the
   * absorber, reported in `actual`).
   */
  preserveRoomPolygons?: { except: string[]; allowAbsorber?: boolean }
  /** Rename cases: these zone names must exist after the modification. */
  requireZoneNames?: string[]
}

function snapshotZones(snapshot: SceneSnapshot): ZoneInfo[] {
  return Object.entries(snapshot).flatMap(([id, node]) => {
    if (nodeType(node) !== 'zone' || !Array.isArray(node.polygon)) return []
    const polygon = node.polygon.filter(
      (point): point is [number, number] =>
        Array.isArray(point) && point.length === 2 && point.every(value => typeof value === 'number'),
    )
    if (polygon.length < 3) return []
    return [{
      id,
      name: typeof node.name === 'string' ? node.name : '',
      polygon,
      areaSqMeters: 0,
    }]
  })
}

/**
 * Case-13-style modification verification: compares before/after snapshots and
 * the after-scene zones/walls. Checks that the intended room was added and is
 * reachable/adjacent, and — the hard part — that existing content was NOT
 * removed or broadly rewritten. Returns one result per sub-check plus the
 * add/delete/modify node counts as a separate informational result.
 */
export function assertModification(
  before: SceneSnapshot,
  after: SceneSnapshot,
  afterScene: SceneInputs,
  config: ModificationChecks,
): AssertionResult[] {
  const diff = diffSnapshots(before, after)
  const results: AssertionResult[] = []

  results.push({
    name: 'modification:diffCounts',
    status: 'pass',
    actual: {
      addedCount: diff.added.length,
      deletedCount: diff.deleted.length,
      modifiedCount: diff.modified.length,
      addedByType: diff.addedByType,
      deletedByType: diff.deletedByType,
      addedIds: diff.added,
      deletedIds: diff.deleted,
      modifiedIds: diff.modified,
    },
    reason: '新增/删除/修改节点数量与 ID（信息项，不计入 rollup）',
  })

  // 1. The new room type must exist after, and be one more than before.
  if (config.addedRoomType) {
    const type = config.addedRoomType
    const beforeZones = Object.values(before).filter(n => nodeType(n) === 'zone')
    const afterCount = afterScene.zones.filter(z => zoneIsType(z, type)).length
    const beforeCount = beforeZones.filter(n => {
      const name = (n as { name?: unknown }).name
      const pattern = roomTypePattern(type)
      return pattern && typeof name === 'string' && pattern.test(name)
    }).length
    const ok = roomTypePattern(type) ? afterCount === beforeCount + 1 : false
    results.push({
      name: `modification:added:${type}`,
      status: roomTypePattern(type) ? (ok ? 'pass' : 'fail') : 'unsupported',
      expected: `新增 1 个 ${type}（${beforeCount} → ${beforeCount + 1}）`,
      actual: afterCount,
      reason: ok ? undefined : `${type} 数量未按预期新增（前 ${beforeCount}，后 ${afterCount}）`,
    })
  }

  // 2. The new room must be adjacent to / reachable from the target room.
  if (config.addedRoomType && config.adjacentTo) {
    const conn = assertAdjacency(afterScene.zones, afterScene.walls, {
      a: config.addedRoomType,
      b: config.adjacentTo,
      relation: 'connected',
    })
    results.push({ ...conn, name: `modification:${config.addedRoomType}-connected-${config.adjacentTo}` })
  }

  // 3. No existing room TYPE may have fewer rooms than before (nothing removed).
  if (config.preserveRoomCounts) {
    const beforeZoneNames = Object.values(before)
      .filter(n => nodeType(n) === 'zone')
      .map(n => (n as { name?: unknown }).name)
      .filter((n): n is string => typeof n === 'string')
    const decreased: string[] = []
    for (const type of KNOWN_ROOM_TYPES) {
      if (type === config.addedRoomType) continue
      const pattern = roomTypePattern(type)!
      const beforeN = beforeZoneNames.filter(n => pattern.test(n)).length
      const afterN = afterScene.zones.filter(z => pattern.test(z.name)).length
      if (afterN < beforeN) decreased.push(`${type}(${beforeN}→${afterN})`)
    }
    results.push({
      name: 'modification:preserveRoomCounts',
      status: decreased.length === 0 ? 'pass' : 'fail',
      expected: '原有各类型房间数量不减少',
      actual: decreased.length === 0 ? '未减少' : decreased.join('、'),
      reason: decreased.length === 0 ? undefined : `以下房间类型数量减少：${decreased.join('、')}`,
    })
  }

  // 4. Original furniture (item nodes) must not be deleted.
  if (config.preserveFurniture) {
    const deletedItems = diff.deleted.filter(id => nodeType(before[id]) === 'item')
    results.push({
      name: 'modification:preserveFurniture',
      status: deletedItems.length === 0 ? 'pass' : 'fail',
      expected: '原有家具未被删除',
      actual: `删除了 ${deletedItems.length} 件家具`,
      reason: deletedItems.length === 0 ? undefined : `原有家具被删除：${deletedItems.join(', ')}`,
    })
  }

  // 5. Structure protection — GATING checks (participate in the rollup).
  // Adding a room legitimately touches a wall or two next to it, so these are
  // threshold-based rather than zero-tolerance; over the threshold = fail.
  if (config.maxDeletedOriginalWalls !== undefined) {
    const deletedWalls = diff.deleted.filter(id => nodeType(before[id]) === 'wall')
    const ok = deletedWalls.length <= config.maxDeletedOriginalWalls
    results.push({
      name: 'modification:deletedOriginalWalls',
      status: ok ? 'pass' : 'fail',
      expected: `删除原墙 ≤ ${config.maxDeletedOriginalWalls}`,
      actual: deletedWalls.length,
      reason: ok ? undefined : `删除了 ${deletedWalls.length} 面原墙，超过阈值 ${config.maxDeletedOriginalWalls}：${deletedWalls.join(', ')}`,
    })
  }
  if (config.maxModifiedOriginalWalls !== undefined) {
    // Geometry-field comparison only: a wall that merely gained a door in its
    // `children` array is NOT a modified wall (see wallGeometryChanged doc).
    const touchedWalls = diff.modified.filter(id => nodeType(before[id]) === 'wall')
    const geometryModified = touchedWalls.filter(id =>
      wallGeometryChanged(before[id] as Record<string, unknown>, after[id] as Record<string, unknown>),
    )
    const childrenOnly = touchedWalls.filter(id => !geometryModified.includes(id))
    const ok = geometryModified.length <= config.maxModifiedOriginalWalls
    results.push({
      name: 'modification:modifiedOriginalWalls',
      status: ok ? 'pass' : 'fail',
      expected: `修改原墙几何（start/end/thickness/height）≤ ${config.maxModifiedOriginalWalls}`,
      actual: `几何修改 ${geometryModified.length}；仅 children/metadata 变化 ${childrenOnly.length}（不计入）`,
      reason: ok
        ? undefined
        : `修改了 ${geometryModified.length} 面原墙的几何，超过阈值 ${config.maxModifiedOriginalWalls}：${geometryModified.join(', ')}`,
    })
  }
  if (config.preserveOriginalOpenings) {
    const deletedOpenings = diff.deleted.filter(id => {
      const t = nodeType(before[id])
      return t === 'door' || t === 'window'
    })
    const ok = deletedOpenings.length === 0
    results.push({
      name: 'modification:preserveOpenings',
      status: ok ? 'pass' : 'fail',
      expected: '原有门窗未被删除',
      actual: `删除了 ${deletedOpenings.length} 个原门窗`,
      reason: ok ? undefined : `原门窗被删除：${deletedOpenings.join(', ')}`,
    })
    // Complement to the geometry-only wall check above: ignoring wall
    // children changes must not hide a door/window that was itself moved,
    // resized, or re-hosted — surviving original openings get their own
    // geometry/host comparison.
    const changedOpenings = diff.modified.filter(id => {
      const t = nodeType(before[id])
      if (t !== 'door' && t !== 'window') return false
      return openingChanged(before[id] as Record<string, unknown>, after[id] as Record<string, unknown>)
    })
    const openingsOk = changedOpenings.length === 0
    results.push({
      name: 'modification:modifiedOriginalOpenings',
      status: openingsOk ? 'pass' : 'fail',
      expected: '原有门窗的位置/尺寸/所在墙未被修改',
      actual: `${changedOpenings.length} 个原门窗发生几何或宿主变化`,
      reason: openingsOk ? undefined : `原门窗被修改：${changedOpenings.join(', ')}`,
    })
  }

  if (config.addedRoomArea) {
    const { type, min, max } = config.addedRoomArea
    const pattern = roomTypePattern(type)
    const addedRooms = pattern
      ? afterScene.zones.filter(zone => diff.added.includes(zone.id) && pattern.test(zone.name))
      : []
    if (!pattern) {
      results.push({
        name: `modification:addedRoomArea:${type}`,
        status: 'unsupported',
        reason: `未知房间类型 "${type}"`,
      })
    } else if (addedRooms.length !== 1) {
      results.push({
        name: `modification:addedRoomArea:${type}`,
        status: 'fail',
        expected: `恰好 1 个新增 ${type}，面积 ${min}–${max}㎡`,
        actual: `${addedRooms.length} 个可识别的新增 ${type}`,
        reason: `无法唯一识别新增 ${type}，不能可靠检查面积`,
      })
    } else {
      const actual = Math.round(addedRooms[0]!.areaSqMeters * 100) / 100
      const ok = actual >= min && actual <= max
      results.push({
        name: `modification:addedRoomArea:${type}`,
        status: ok ? 'pass' : 'fail',
        expected: `${min}–${max}㎡`,
        actual: `${actual}㎡`,
        reason: ok ? undefined : `新增 ${type} 面积 ${actual}㎡，不在 ${min}–${max}㎡ 内`,
      })
    }
  }

  if (config.preserveExteriorBounds) {
    const beforeBounds = overallBounds(snapshotZones(before))
    const afterBounds = overallBounds(afterScene.zones)
    if (!beforeBounds || !afterBounds) {
      results.push({
        name: 'modification:preserveExteriorBounds',
        status: 'unsupported',
        reason: '修改前或修改后缺少有效 zone polygon，无法比较外轮廓',
      })
    } else {
      const unchanged =
        Math.abs(beforeBounds.minX - afterBounds.minX) <= EPS &&
        Math.abs(beforeBounds.maxX - afterBounds.maxX) <= EPS &&
        Math.abs(beforeBounds.minZ - afterBounds.minZ) <= EPS &&
        Math.abs(beforeBounds.maxZ - afterBounds.maxZ) <= EPS
      results.push({
        name: 'modification:preserveExteriorBounds',
        status: unchanged ? 'pass' : 'fail',
        expected: beforeBounds,
        actual: afterBounds,
        reason: unchanged ? undefined : '修改后的整体 zone 外轮廓与基准场景不一致',
      })
    }
  }

  if (config.preserveExteriorWidth) {
    // Plan-first structural modify (MODIFY_REDESIGN.md §4) locks the
    // footprint WIDTH but lets depth float with the total-area change — the
    // honest exterior assertion for add/resize cases is width-only.
    const beforeBounds = overallBounds(snapshotZones(before))
    const afterBounds = overallBounds(afterScene.zones)
    if (!beforeBounds || !afterBounds) {
      results.push({
        name: 'modification:preserveExteriorWidth',
        status: 'unsupported',
        reason: '修改前或修改后缺少有效 zone polygon，无法比较外轮廓宽度',
      })
    } else {
      const beforeWidth = beforeBounds.maxX - beforeBounds.minX
      const afterWidth = afterBounds.maxX - afterBounds.minX
      const unchanged = Math.abs(beforeWidth - afterWidth) <= EPS
      results.push({
        name: 'modification:preserveExteriorWidth',
        status: unchanged ? 'pass' : 'fail',
        expected: `宽度 ${round2(beforeWidth)}m`,
        actual: `宽度 ${round2(afterWidth)}m`,
        reason: unchanged ? undefined : '修改后的整体轮廓宽度与基准场景不一致（footprint 锁宽被破坏）',
      })
    }
  }

  if (config.targetRoomArea) {
    const { type, min, max, nameIncludes } = config.targetRoomArea
    const pattern = roomTypePattern(type)
    const names = nameIncludes?.map(value => value.toLowerCase()) ?? []
    const candidates = pattern
      ? afterScene.zones.filter(zone =>
          pattern.test(zone.name) &&
          (names.length === 0 || names.some(value => zone.name.toLowerCase().includes(value))),
        )
      : []
    if (!pattern) {
      results.push({ name: `modification:targetRoomArea:${type}`, status: 'unsupported', reason: `未知房间类型 "${type}"` })
    } else if (candidates.length === 0) {
      results.push({
        name: `modification:targetRoomArea:${type}`,
        status: 'fail',
        expected: { type, min, ...(max !== undefined ? { max } : {}), ...(nameIncludes ? { nameIncludes } : {}) },
        actual: '没有匹配房间',
        reason: `修改后找不到符合名称条件的 ${type}`,
      })
    } else {
      const matched = candidates.find(zone => zone.areaSqMeters >= min && (max === undefined || zone.areaSqMeters <= max))
      results.push({
        name: `modification:targetRoomArea:${type}`,
        status: matched ? 'pass' : 'fail',
        expected: max === undefined ? `≥${min}㎡` : `${min}–${max}㎡`,
        actual: candidates.map(zone => `${zone.name || zone.id}:${zone.areaSqMeters}㎡`),
        reason: matched ? undefined : `匹配的 ${type} 面积未达到要求`,
      })
    }
  }

  if (config.preserveRoomPolygons) {
    // except entries match by substring both ways（「玄关」covers「玄关换鞋区」）
    // — display names drift; identity does not need to be exact here because
    // the MAIN check below is geometric and name-independent.
    const isExcept = (name: string) =>
      config.preserveRoomPolygons!.except.some(entry => name.includes(entry) || entry.includes(name))
    const beforeZones = snapshotZones(before).filter(zone => zone.name && !isExcept(zone.name))
    const samePolygon = (a: Array<[number, number]>, b: Array<[number, number]>): boolean => {
      if (a.length !== b.length) return false
      // Allow rotation of the vertex ring; orientation must match (executor
      // rebuilds from the identical plan polygon).
      for (let offset = 0; offset < b.length; offset++) {
        if (a.every(([x, z], i) => {
          const [bx, bz] = b[(i + offset) % b.length]!
          return Math.abs(x - bx) <= 0.02 && Math.abs(z - bz) <= 0.02
        })) return true
      }
      return false
    }
    // Geometry-based: a before-zone survives if ANY after-zone has the same
    // polygon, regardless of name — renames keep their footprint and must
    // not read as movement (eval case-24).
    const moved = beforeZones.filter(zone =>
      !afterScene.zones.some(z => samePolygon(zone.polygon, z.polygon)),
    ).map(zone => zone.name)
    const allowAbsorber = config.preserveRoomPolygons.allowAbsorber === true
    const pass = allowAbsorber ? moved.length <= 1 : moved.length === 0
    results.push({
      name: 'modification:preserveRoomPolygons',
      status: pass ? 'pass' : 'fail',
      expected: allowAbsorber
        ? `除 ${config.preserveRoomPolygons.except.join('、')} 外至多一间房间改形（吸收方）`
        : `除 ${config.preserveRoomPolygons.except.join('、')} 外全部房间多边形保持原样`,
      actual: moved.length === 0 ? '未移动' : (pass ? `吸收方：${moved.join('、')}` : moved),
      reason: pass ? undefined : `以下房间被移动/改形：${moved.join('、')}`,
    })
  }

  if (config.requireZoneNames) {
    for (const name of config.requireZoneNames) {
      const present = afterScene.zones.some(zone => zone.name === name)
      results.push({
        name: `modification:requireZoneName:${name}`,
        status: present ? 'pass' : 'fail',
        expected: `修改后存在名为「${name}」的房间`,
        actual: present ? '存在' : afterScene.zones.map(zone => zone.name),
        reason: present ? undefined : `修改后的场景中找不到「${name}」`,
      })
    }
  }

  if (config.itemChanges) {
    // Match on the item's name/asset identity ONLY — never the serialized
    // node: asset tags like "bedroom" contain "bed", which let a deleted
    // wardrobe satisfy deletedMatching:["bed"] (case-18 false pass). Terms
    // in the furniture-checklist vocabulary use its word-boundary matcher
    // ("bed" must not match "Bedside Table"); others fall back to a name
    // substring.
    const itemMatches = (snapshot: SceneSnapshot, id: string, term: string): boolean => {
      const node = snapshot[id] as { name?: unknown; asset?: { id?: unknown; name?: unknown } } | undefined
      const fields = [node?.name, node?.asset?.name, node?.asset?.id]
        .filter((value): value is string => typeof value === 'string')
      const option = findVocabularyOption(term)
      if (option) return fields.some(field => option.match.test(field))
      const needle = term.toLowerCase()
      return fields.some(field => field.toLowerCase().includes(needle))
    }
    const addedItems = diff.added.filter(id => nodeType(after[id] ?? {}) === 'item')
    const deletedItems = diff.deleted.filter(id => nodeType(before[id] ?? {}) === 'item')
    for (const term of config.itemChanges.addedMatching ?? []) {
      const ok = addedItems.some(id => itemMatches(after, id, term))
      results.push({
        name: `modification:addedItem:${term}`,
        status: ok ? 'pass' : 'fail',
        expected: `新增至少一件匹配「${term}」的家具`,
        actual: `新增 item ${addedItems.length} 件`,
        reason: ok ? undefined : `新增的 item 中没有匹配「${term}」的`,
      })
    }
    for (const term of config.itemChanges.deletedMatching ?? []) {
      const ok = deletedItems.some(id => itemMatches(before, id, term))
      results.push({
        name: `modification:deletedItem:${term}`,
        status: ok ? 'pass' : 'fail',
        expected: `删除至少一件匹配「${term}」的家具`,
        actual: `删除 item ${deletedItems.length} 件`,
        reason: ok ? undefined : `删除的 item 中没有匹配「${term}」的`,
      })
    }
    if (config.itemChanges.structureUntouched) {
      const structural = new Set(['wall', 'zone', 'slab', 'ceiling', 'door', 'window'])
      const touched = [
        ...diff.added.filter(id => structural.has(nodeType(after[id] ?? {}) ?? '')),
        ...diff.deleted.filter(id => structural.has(nodeType(before[id] ?? {}) ?? '')),
      ]
      results.push({
        name: 'modification:structureUntouched',
        status: touched.length === 0 ? 'pass' : 'fail',
        expected: '纯家具修改：不新增/删除任何结构节点（墙/房间/楼板/天花/门窗）',
        actual: touched.length === 0 ? '结构未动' : touched,
        reason: touched.length === 0 ? undefined : `结构节点被增删：${touched.join('、')}`,
      })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type AssertionConfig = {
  expectedRoomCounts?: Record<string, number>
  totalArea?: { target: number; tolerance: number }
  windowsRequiredFor?: string[]
  requireAllRoomsReachable?: boolean
  requiredAdjacency?: AdjacencySpec[]
  expectedBounds?: { width: number; depth: number; tolerance: number }
}

export function runSceneAssertions(config: AssertionConfig, scene: SceneInputs): AssertionResult[] {
  const results: AssertionResult[] = []
  if (config.expectedRoomCounts) results.push(...assertRoomCounts(scene.zones, config.expectedRoomCounts))
  if (config.totalArea) results.push(assertTotalArea(scene.zones, config.totalArea))
  if (config.windowsRequiredFor) results.push(...assertWindowsRequiredFor(scene.zones, scene.walls, config.windowsRequiredFor))
  if (config.requireAllRoomsReachable) results.push(assertAllRoomsReachable(scene.zones, scene.walls))
  if (config.requiredAdjacency) {
    for (const spec of config.requiredAdjacency) results.push(assertAdjacency(scene.zones, scene.walls, spec))
  }
  if (config.expectedBounds) results.push(assertBounds(scene.zones, config.expectedBounds))
  return results
}

export type AssertionRollup = {
  total: number
  passed: number
  failed: number
  unsupported: number
  // "unsupported" is NOT a pass: allPassed requires every assertion to be pass.
  allPassed: boolean
}

export function rollupAssertions(results: AssertionResult[]): AssertionRollup {
  // Only the informational diff-count row is non-gating; every other
  // assertion (including the wall/opening protection checks) counts.
  const gating = results.filter(r => !r.name.endsWith(':diffCounts'))
  const passed = gating.filter(r => r.status === 'pass').length
  const failed = gating.filter(r => r.status === 'fail').length
  const unsupported = gating.filter(r => r.status === 'unsupported').length
  return {
    total: gating.length,
    passed,
    failed,
    unsupported,
    allPassed: gating.length > 0 && failed === 0 && unsupported === 0,
  }
}

// ---------------------------------------------------------------------------
// Plan-first result assertions (批次 D, 意见⑦: new assertions judge fail like
// every other one). These read the agent's own SceneResult instead of the
// scene graph: hard gates all passed, model-call budget respected, required
// furniture placement rate. `unsupported` (field absent — a pre-批次D
// session) still blocks allPassed, so an old build can't quietly skip them.
// ---------------------------------------------------------------------------

export type PlanFirstSceneResult = {
  gateFailures?: string[]
  modelCallsUsed?: number
  furniture?: { placed: number; required: number }
}

export const FURNITURE_PLACEMENT_RATE_MIN = 0.9

export function assertPlanFirstResult(
  sceneResult: PlanFirstSceneResult | undefined,
  options: { maxModelCalls?: number; allowedGateFailures?: string[] } = {},
): AssertionResult[] {
  const results: AssertionResult[] = []

  if (!sceneResult?.gateFailures) {
    results.push({ name: 'gatesPassed', status: 'unsupported', reason: 'sceneResult.gateFailures 缺失（旧版本会话？）' })
  } else {
    // A modify case may deliberately violate a gate (e.g. 用户要求删掉床 →
    // "卧室缺少必备家具：床" is the CORRECT outcome, not a defect). Gate
    // failures matching an allowed pattern are waived for THIS case only;
    // anything else still fails.
    const allowed = options.allowedGateFailures ?? []
    const blocking = sceneResult.gateFailures.filter(
      failure => !allowed.some(pattern => failure.includes(pattern)),
    )
    const waived = sceneResult.gateFailures.length - blocking.length
    results.push({
      name: 'gatesPassed',
      status: blocking.length === 0 ? 'pass' : 'fail',
      expected: waived > 0 ? `完成门槛通过（豁免 ${waived} 项与请求直接对应的失败）` : '全部完成门槛通过',
      actual: blocking.length === 0
        ? waived > 0 ? `通过（豁免 ${waived} 项）` : '通过'
        : `${blocking.length} 项未过`,
      reason: blocking.length > 0 ? blocking.join('；') : undefined,
    })
  }

  if (options.maxModelCalls !== undefined) {
    if (typeof sceneResult?.modelCallsUsed !== 'number') {
      results.push({ name: 'modelCallBudget', status: 'unsupported', reason: 'sceneResult.modelCallsUsed 缺失' })
    } else {
      results.push({
        name: 'modelCallBudget',
        status: sceneResult.modelCallsUsed <= options.maxModelCalls ? 'pass' : 'fail',
        expected: `≤${options.maxModelCalls} 次模型调用`,
        actual: sceneResult.modelCallsUsed,
      })
    }
  }

  if (!sceneResult?.furniture) {
    results.push({ name: 'furniturePlacementRate', status: 'unsupported', reason: 'sceneResult.furniture 缺失' })
  } else if (sceneResult.furniture.required === 0) {
    results.push({ name: 'furniturePlacementRate', status: 'pass', expected: '无必备家具要求', actual: '0/0' })
  } else {
    const rate = sceneResult.furniture.placed / sceneResult.furniture.required
    results.push({
      name: 'furniturePlacementRate',
      status: rate >= FURNITURE_PLACEMENT_RATE_MIN ? 'pass' : 'fail',
      expected: `≥${Math.round(FURNITURE_PLACEMENT_RATE_MIN * 100)}%`,
      actual: `${sceneResult.furniture.placed}/${sceneResult.furniture.required}（${Math.round(rate * 100)}%）`,
    })
  }

  return results
}
