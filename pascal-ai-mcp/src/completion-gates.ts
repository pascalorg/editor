// ---------------------------------------------------------------------------
// Completion hard gates (GENERATION_REDESIGN.md §5). A generated/modified
// scene may only enter phase `completed` when every gate passes; otherwise it
// ends as `completed_with_issues`. Gates judge the ACTUAL scene state
// (zones/walls/items), not the plan — a scene is complete or not regardless
// of how it was built, which is why the modify path runs through the same
// function (§6).
//
// Gate 3 deliberately asks "is any ROOM cut off from the entry?" rather than
// "does every zone have a door": an open-plan living_kitchen reached through
// a doorless open boundary is legal (审核意见④).
//
// Input types are declared locally and assignment-compatible with agent.ts's
// ZoneSummary / WallWithOpenings / ItemSummary, same pattern as
// layout-metrics.ts, so agent.ts and the eval harness can both call in.
// ---------------------------------------------------------------------------

import { findMissingFurniture } from './furniture-checklist'
import { classifyRoomTypeByName } from './lang/room-vocab'
import {
  analyzePolygonGrid,
  collinearOverlapLength,
  pointInPolygon,
  sharedBoundarySegments,
  type RoomType,
} from './layout-plan'

export type GateZone = { id: string; name: string; polygon: Array<[number, number]> }
export type GateWall = {
  id: string
  start: [number, number]
  end: [number, number]
  // `position`, when present, is the opening's local [x,y,z] measured from
  // wall.start (same shape agent.ts reads off get_walls payloads); openings
  // without it are sampled at the wall midpoint.
  openings: Array<{ type: string; position?: unknown }>
}
export type GateItem = { id: string; name?: string; position: [number, number, number] }

export type GateTargets = {
  totalAreaSqm?: number
  // Minimum per-type counts from the brief ("必需房间齐全").
  requiredRooms?: Array<{ type: RoomType; count: number }>
  // Room types the user explicitly asked exterior windows for (gate 4 only
  // covers explicit requests; default window preferences are plan-level).
  requiredWindowRoomTypes?: RoomType[]
  // Authoritative zoneId→type mapping from the layout plan (plan-first
  // builds). When a zone appears here its type is taken verbatim and the
  // name-based guess is skipped — room names can then be in any language.
  zoneTypes?: Record<string, RoomType>
}

// `l10n` carries the message's template id + params so agent.ts can re-render
// the failure in the user's reply language; `message` stays the canonical
// Chinese used in prompts and persisted sessions.
export type GateFailureL10n = { id: string; params: Record<string, string | number | boolean> }
export type GateFailure = { gate: number; id: string; message: string; l10n?: GateFailureL10n }
export type GateReport = { passed: boolean; failures: GateFailure[] }

const TOTAL_AREA_TOLERANCE = 0.1
// Walls and zone edges in a real scene are only near-coincident; same 5cm
// bar as agent.ts/layout-metrics segment matching.
const SCENE_LINE_EPSILON = 0.06
// An uncovered shared boundary must be at least people-passable to count as
// an open-plan connection.
const MIN_OPEN_PASSAGE_M = 0.6

const PUBLIC_TYPES: ReadonlySet<RoomType> = new Set([
  'living', 'living_kitchen', 'dining', 'hallway', 'entry',
])
const FORBIDDEN_INTERMEDIATE_TYPES: ReadonlySet<RoomType> = new Set([
  'kitchen', 'bathroom', 'bedroom',
])

// Zone-name → room type: delegates to the shared trilingual vocabulary
// (src/lang/room-vocab.ts). Kept as an export because the gates tests and
// external callers address it under this name. Name classification is the
// FALLBACK — freshly generated scenes pass explicit zone types via
// GateTargets.zoneTypes and never guess.
export const classifyZoneType = classifyRoomTypeByName

export function evaluateCompletionGates(
  zones: GateZone[],
  walls: GateWall[],
  items: GateItem[],
  targets: GateTargets = {},
): GateReport {
  const failures: GateFailure[] = []
  const typed = zones.map(zone => ({
    zone,
    type: targets.zoneTypes?.[zone.id] ?? classifyZoneType(zone.name || ''),
  }))
  const label = (zone: GateZone) => zone.name || zone.id

  // --- gate 1: required rooms present (minimum counts) ---
  if (targets.requiredRooms) {
    const countByType = new Map<RoomType, number>()
    for (const entry of typed) {
      countByType.set(entry.type, (countByType.get(entry.type) ?? 0) + 1)
    }
    const lkCount = countByType.get('living_kitchen') ?? 0
    for (const requirement of targets.requiredRooms) {
      let actual = countByType.get(requirement.type) ?? 0
      if (requirement.type === 'living' || requirement.type === 'kitchen') actual += lkCount
      if (actual < requirement.count) {
        failures.push({
          gate: 1,
          id: 'missing-room',
          message: `房型「${requirement.type}」只有 ${actual} 间，brief 要求 ${requirement.count} 间`,
          l10n: { id: 'gateMissingRoom', params: { type: requirement.type, actual, expected: requirement.count } },
        })
      }
    }
  }

  // --- gate 2: total (union) area within ±10% of target ---
  if (targets.totalAreaSqm !== undefined && targets.totalAreaSqm > 0 && zones.length > 0) {
    const { unionArea } = analyzePolygonGrid(
      zones.map(zone => ({ id: zone.id, polygon: zone.polygon })),
    )
    const deviation = Math.abs(unionArea - targets.totalAreaSqm) / targets.totalAreaSqm
    if (deviation > TOTAL_AREA_TOLERANCE) {
      failures.push({
        gate: 2,
        id: 'total-area',
        message: `实测总面积 ${unionArea.toFixed(1)}㎡ 偏离目标 ${targets.totalAreaSqm}㎡ 达 ${Math.round(deviation * 100)}%`,
        l10n: { id: 'gateTotalArea', params: { actual: unionArea.toFixed(1), target: targets.totalAreaSqm, deviation: Math.round(deviation * 100) } },
      })
    }
  }

  // --- connectivity graph shared by gates 3 and 5 ---
  const graph = buildAccessGraph(zones, walls)

  // --- gate 3: no room isolated from the entry door ---
  if (zones.length > 0) {
    if (graph.entryZoneIds.size === 0) {
      failures.push({ gate: 3, id: 'no-entry-door', message: '没有通向室外的入户门', l10n: { id: 'gateNoEntryDoor', params: {} } })
    } else {
      const reachable = bfs([...graph.entryZoneIds], graph.adjacency, () => true)
      for (const zone of zones) {
        if (!reachable.has(zone.id)) {
          failures.push({
            gate: 3,
            id: 'isolated-room',
            message: `房间「${label(zone)}」经门和开放边界都无法从入户门到达`,
            l10n: { id: 'gateIsolatedRoom', params: { room: label(zone) } },
          })
        }
      }
    }
  }

  // --- gate 4: explicitly requested exterior windows exist ---
  for (const type of targets.requiredWindowRoomTypes ?? []) {
    const zoneIdsOfType = new Set(
      typed
        .filter(entry => entry.type === type
          || (type === 'living' || type === 'kitchen') && entry.type === 'living_kitchen')
        .map(entry => entry.zone.id),
    )
    if (zoneIdsOfType.size === 0) continue // gate 1 already reports the missing room
    const satisfied = walls.some(wall =>
      wall.openings.some(opening => {
        if (opening.type !== 'window') return false
        const sides = graph.openingSides(wall, opening)
        // Exterior window: one side is a zone of the required type, the
        // other side is outside every zone.
        return (sides.a !== null && sides.b === null && zoneIdsOfType.has(sides.a))
          || (sides.b !== null && sides.a === null && zoneIdsOfType.has(sides.b))
      }),
    )
    if (!satisfied) {
      failures.push({
        gate: 4,
        id: 'missing-window',
        message: `用户要求的「${type}」外窗不存在于对应房间的外墙上`,
        l10n: { id: 'gateMissingWindow', params: { type } },
      })
    }
  }

  // --- gate 5: bedrooms reach public space without crossing 厨/卫/其他卧室 ---
  const bedrooms = typed.filter(entry => entry.type === 'bedroom')
  const hasPublic = typed.some(entry => PUBLIC_TYPES.has(entry.type))
  if (bedrooms.length > 0 && zones.length > 1) {
    const typeById = new Map(typed.map(entry => [entry.zone.id, entry.type]))
    for (const bedroom of bedrooms) {
      if (!hasPublic) {
        failures.push({
          gate: 5,
          id: 'bedroom-access',
          message: `卧室「${label(bedroom.zone)}」无公共空间可达（户型中没有公共房型）`,
          l10n: { id: 'gateBedroomAccess', params: { room: label(bedroom.zone), noPublic: true } },
        })
        continue
      }
      const reached = bfs([bedroom.zone.id], graph.adjacency, id =>
        id === bedroom.zone.id || !FORBIDDEN_INTERMEDIATE_TYPES.has(typeById.get(id) ?? 'other'))
      const ok = [...reached].some(id => PUBLIC_TYPES.has(typeById.get(id) ?? 'other'))
      if (!ok) {
        failures.push({
          gate: 5,
          id: 'bedroom-access',
          message: `卧室「${label(bedroom.zone)}」无法不穿过厨房/卫生间/其他卧室到达公共空间`,
          l10n: { id: 'gateBedroomAccess', params: { room: label(bedroom.zone), noPublic: false } },
        })
      }
    }
  }

  // --- gates 6 & 7: required equipment/furniture per room ---
  const itemNamesByZone = new Map<string, string[]>()
  for (const item of items) {
    const [x, , z] = item.position
    const home = zones.find(zone => pointInPolygon(x, z, zone.polygon))
    if (!home) continue
    const list = itemNamesByZone.get(home.id) ?? []
    list.push(item.name ?? item.id)
    itemNamesByZone.set(home.id, list)
  }
  for (const entry of typed) {
    const names = itemNamesByZone.get(entry.zone.id) ?? []
    if (entry.type === 'kitchen' || entry.type === 'bathroom' || entry.type === 'living_kitchen') {
      const checkType = entry.type === 'living_kitchen' ? 'kitchen' : entry.type
      for (const missing of findMissingFurniture(checkType, names)) {
        failures.push({
          gate: 6,
          id: 'missing-equipment',
          message: `${entry.type === 'bathroom' ? '卫生间' : '厨房'}「${label(entry.zone)}」缺少必备设备：${missing.label}`,
          l10n: { id: 'gateMissingEquipment', params: { roomKind: entry.type === 'bathroom' ? '卫生间' : '厨房', room: label(entry.zone), label: missing.label } },
        })
      }
    }
    if (entry.type === 'bedroom') {
      // A bedroom with its own dressing room (a storage zone whose name
      // carries the bedroom's name, e.g. 「主卧步入式衣帽间」) satisfies the
      // wardrobe requirement by design — the walk-in closet IS the wardrobe
      // (2026-07-14 case-11 复盘).
      const bedroomName = label(entry.zone)
      const hasDressingRoom = typed.some(other =>
        other.type === 'storage' && bedroomName.length > 0 && (other.zone.name ?? '').includes(bedroomName))
      for (const missing of findMissingFurniture('bedroom', names)) {
        if (hasDressingRoom && /衣柜|wardrobe|closet|クローゼット/i.test(missing.label)) continue
        failures.push({
          gate: 7,
          id: 'missing-bedroom-furniture',
          message: `卧室「${label(entry.zone)}」缺少必备家具：${missing.label}`,
          l10n: { id: 'gateMissingBedroomFurniture', params: { room: label(entry.zone), label: missing.label } },
        })
      }
    }
  }

  return { passed: failures.length === 0, failures }
}

// --- access graph: doors + open (wall-less) boundaries -----------------------

type OpeningSides = { a: string | null; b: string | null }

type AccessGraph = {
  adjacency: Map<string, Set<string>>
  entryZoneIds: Set<string>
  openingSides: (wall: GateWall, opening: { position?: unknown }) => OpeningSides
}

// How far to either side of a wall we sample when deciding which zones an
// opening connects. Must exceed half a typical wall thickness.
const SIDE_SAMPLE_OFFSET_M = 0.2

function buildAccessGraph(zones: GateZone[], walls: GateWall[]): AccessGraph {
  const adjacency = new Map<string, Set<string>>()
  for (const zone of zones) adjacency.set(zone.id, new Set())
  const link = (a: string, b: string) => {
    adjacency.get(a)?.add(b)
    adjacency.get(b)?.add(a)
  }

  const zoneAt = (x: number, z: number): string | null =>
    zones.find(zone => pointInPolygon(x, z, zone.polygon))?.id ?? null

  // Which zone lies on each side of an opening. A wall spanning the whole
  // footprint edge can border several zones, so "count host zones" is not a
  // usable exterior test — instead sample perpendicular to the wall at the
  // opening itself (its stored local offset when present, wall midpoint
  // otherwise). One side inside a zone + one side outside = exterior opening.
  const openingSides = (wall: GateWall, opening: { position?: unknown }): OpeningSides => {
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) return { a: null, b: null }
    const ux = dx / length
    const uz = dz / length
    let along = length / 2
    const local = opening.position
    if (Array.isArray(local) && local.length === 3 && typeof local[0] === 'number') {
      along = Math.min(Math.max(local[0], 0), length)
    }
    const px = wall.start[0] + ux * along
    const pz = wall.start[1] + uz * along
    return {
      a: zoneAt(px - uz * SIDE_SAMPLE_OFFSET_M, pz + ux * SIDE_SAMPLE_OFFSET_M),
      b: zoneAt(px + uz * SIDE_SAMPLE_OFFSET_M, pz - ux * SIDE_SAMPLE_OFFSET_M),
    }
  }

  // Door edges + entry zones.
  const entryZoneIds = new Set<string>()
  for (const wall of walls) {
    for (const opening of wall.openings) {
      if (opening.type !== 'door') continue
      const sides = openingSides(wall, opening)
      if (sides.a && sides.b && sides.a !== sides.b) link(sides.a, sides.b)
      else if (sides.a && !sides.b) entryZoneIds.add(sides.a)
      else if (sides.b && !sides.a) entryZoneIds.add(sides.b)
    }
  }

  // Open boundaries: a stretch of shared zone boundary with no wall on it is
  // a walkable open-plan connection. Coverage is measured against each
  // concrete shared segment, so perimeter walls that merely touch both zones
  // elsewhere don't count.
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!
      const b = zones[j]!
      let open = 0
      for (const segment of sharedBoundarySegments(a.polygon, b.polygon, SCENE_LINE_EPSILON)) {
        const segmentLength = Math.hypot(
          segment.end[0] - segment.start[0],
          segment.end[1] - segment.start[1],
        )
        let covered = 0
        for (const wall of walls) {
          covered += collinearOverlapLength(
            segment,
            { start: wall.start, end: wall.end },
            SCENE_LINE_EPSILON,
          )
        }
        open += Math.max(0, segmentLength - covered)
      }
      if (open >= MIN_OPEN_PASSAGE_M) link(a.id, b.id)
    }
  }

  return { adjacency, entryZoneIds, openingSides }
}

function bfs(
  starts: string[],
  adjacency: Map<string, Set<string>>,
  allowed: (id: string) => boolean,
): Set<string> {
  const visited = new Set<string>(starts)
  const queue = [...starts]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor) || !allowed(neighbor)) continue
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }
  return visited
}
