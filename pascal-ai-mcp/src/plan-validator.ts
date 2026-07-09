// ---------------------------------------------------------------------------
// Deterministic LayoutPlan validator (GENERATION_REDESIGN.md §3).
//
// Runs BEFORE any Pascal scene exists. `fatal` findings are quoted back into
// the intent-correction prompt (≤3 rounds); if they persist, generation fails
// with zero abandoned scenes. The partitioner constructs plans that satisfy
// checks 2/3/4/8/9/11 by construction — this validator re-checks all of them
// anyway, both as the partitioner's regression net and for the experimental
// LLM-direct-geometry path, which goes through the same function.
// ---------------------------------------------------------------------------

import {
  ASPECT_RATIO_HARD,
  ASPECT_RATIO_SOFT,
  BAND_HARD_HIGH_FACTOR,
  BAND_HARD_LOW_FACTOR,
  CIRCULATION_RATIO_HARD,
  CIRCULATION_RATIO_SOFT,
  bandTableForTotalArea,
  polygonAspectRatio,
  type RoomKind,
} from './layout-metrics'
import {
  analyzePolygonGrid,
  isAxisAligned,
  longestExteriorEdge,
  longestSharedEdge,
  polygonArea,
  polygonSelfIntersects,
  type LayoutPlan,
  type LayoutPlanRoom,
  type RoomType,
} from './layout-plan'

export type PlanTargets = {
  totalAreaSqm?: number
  // Exact per-type room counts from the brief ("按 type 枚举精确比对").
  // Only listed types are compared; a living_kitchen satisfies both a
  // `living` and a `kitchen` requirement.
  requiredRooms?: Array<{ type: RoomType; count: number }>
}

export type PlanValidation = {
  fatal: string[]
  warnings: string[]
  score: number
}

const MIN_DOOR_EDGE_M = 0.9
const COVERAGE_MIN_RATIO = 0.98
const TOTAL_AREA_TOLERANCE = 0.1
const OVERLAP_AREA_TOLERANCE_SQM = 0.02
const EDGE_EPSILON = 0.02

// Maps LayoutPlan room types onto layout-metrics band kinds. `dining` maps
// to `other` (no band) on purpose: an 8㎡ dining room is normal but sits
// below the `living` band's minimum, and dual-counting it as a living room
// would spam warnings.
const TYPE_TO_KIND: Record<RoomType, RoomKind> = {
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  kitchen: 'kitchen',
  living: 'living',
  living_kitchen: 'living',
  dining: 'other',
  hallway: 'circulation',
  entry: 'circulation',
  study: 'other',
  storage: 'other',
  balcony: 'other',
  other: 'other',
}

const PUBLIC_TYPES: ReadonlySet<RoomType> = new Set([
  'living', 'living_kitchen', 'dining', 'hallway', 'entry',
])
// Rooms a bedroom's path to public space must never pass THROUGH.
const FORBIDDEN_INTERMEDIATE_TYPES: ReadonlySet<RoomType> = new Set([
  'kitchen', 'bathroom', 'bedroom',
])

export function validateLayoutPlan(
  plan: LayoutPlan,
  targets: PlanTargets = {},
): PlanValidation {
  const fatal: string[] = []
  const warnings: string[] = []
  const label = (room: LayoutPlanRoom) => room.name || room.id

  // --- #1 schema / geometry legality ---
  const ids = new Set<string>()
  for (const room of plan.rooms) {
    if (ids.has(room.id)) fatal.push(`房间 id「${room.id}」重复`)
    ids.add(room.id)
    if (room.polygon.length < 4) {
      fatal.push(`房间「${label(room)}」多边形顶点少于 4 个`)
      continue
    }
    if (!isAxisAligned(room.polygon)) {
      fatal.push(`房间「${label(room)}」多边形不是轴对齐的（或含零长度边）`)
      continue
    }
    if (polygonSelfIntersects(room.polygon)) {
      fatal.push(`房间「${label(room)}」多边形自相交`)
    }
  }
  if (!ids.has(plan.entry.roomId)) {
    fatal.push(`entry.roomId「${plan.entry.roomId}」不存在于 rooms 中`)
  }
  for (const conn of plan.connections) {
    if (!ids.has(conn.from) || !ids.has(conn.to)) {
      fatal.push(`connection ${conn.from}→${conn.to} 引用了不存在的房间`)
    }
    if (conn.from === conn.to) {
      fatal.push(`connection ${conn.from}→${conn.to} 两端相同`)
    }
  }
  if (!(plan.footprint.width > 0) || !(plan.footprint.depth > 0)) {
    fatal.push('footprint 尺寸必须为正数')
  }
  // Geometry below assumes a sane schema; bail out early if not.
  if (fatal.length > 0) return finish(fatal, warnings)

  // --- #2 rooms inside footprint ---
  for (const room of plan.rooms) {
    const outside = room.polygon.some(([x, z]) =>
      x < -EDGE_EPSILON || z < -EDGE_EPSILON
      || x > plan.footprint.width + EDGE_EPSILON
      || z > plan.footprint.depth + EDGE_EPSILON)
    if (outside) fatal.push(`房间「${label(room)}」超出 footprint 边界`)
  }

  // --- #3 no overlaps / #4 coverage (one grid pass) ---
  const grid = analyzePolygonGrid(
    plan.rooms.map(room => ({ id: room.id, polygon: room.polygon })),
    plan.footprint,
  )
  for (const [key, area] of grid.overlapPairs) {
    if (area < OVERLAP_AREA_TOLERANCE_SQM) continue
    const [a, b] = key.split('|')
    const roomA = plan.rooms.find(r => r.id === a)
    const roomB = plan.rooms.find(r => r.id === b)
    fatal.push(`房间「${roomA ? label(roomA) : a}」与「${roomB ? label(roomB) : b}」重叠约 ${area.toFixed(2)}㎡`)
  }
  const footprintArea = plan.footprint.width * plan.footprint.depth
  if (grid.unionArea < footprintArea * COVERAGE_MIN_RATIO) {
    fatal.push(
      `房间未铺满 footprint：覆盖 ${grid.unionArea.toFixed(1)}㎡ / ${footprintArea.toFixed(1)}㎡`
      + `（要求 ≥${Math.round(COVERAGE_MIN_RATIO * 100)}%）`,
    )
  }

  // --- #5 footprint area vs target ---
  if (targets.totalAreaSqm !== undefined && targets.totalAreaSqm > 0) {
    const deviation = Math.abs(footprintArea - targets.totalAreaSqm) / targets.totalAreaSqm
    if (deviation > TOTAL_AREA_TOLERANCE) {
      fatal.push(
        `footprint 面积 ${footprintArea.toFixed(1)}㎡ 偏离目标 ${targets.totalAreaSqm}㎡ 达 `
        + `${Math.round(deviation * 100)}%（上限 ±${Math.round(TOTAL_AREA_TOLERANCE * 100)}%）`,
      )
    }
  }

  // --- #6 room counts/types vs brief ---
  if (targets.requiredRooms) {
    const countByType = new Map<RoomType, number>()
    for (const room of plan.rooms) {
      countByType.set(room.type, (countByType.get(room.type) ?? 0) + 1)
    }
    const lkCount = countByType.get('living_kitchen') ?? 0
    for (const requirement of targets.requiredRooms) {
      let actual = countByType.get(requirement.type) ?? 0
      if (requirement.type === 'living' || requirement.type === 'kitchen') actual += lkCount
      if (actual !== requirement.count) {
        fatal.push(
          `房型「${requirement.type}」数量 ${actual} 不等于 brief 要求的 ${requirement.count}`,
        )
      }
    }
  }

  // --- #7 area bands / aspect ratio / circulation share ---
  const areas = plan.rooms.map(room => ({
    room,
    kind: TYPE_TO_KIND[room.type],
    area: polygonArea(room.polygon),
  }))
  const totalRoomArea = areas.reduce((sum, entry) => sum + entry.area, 0)
  const bands = bandTableForTotalArea(totalRoomArea)
  for (const entry of areas) {
    const band = bands[entry.kind]
    if (!band) continue
    const [min, max] = band
    if (entry.area >= min && entry.area <= max) continue
    const hard = entry.area < min * BAND_HARD_LOW_FACTOR || entry.area > max * BAND_HARD_HIGH_FACTOR
    const message = `房间「${label(entry.room)}」面积 ${entry.area.toFixed(1)}㎡ 超出该房型合理区间 ${min}–${max}㎡`
    if (hard) fatal.push(message)
    else warnings.push(message)
  }
  for (const entry of areas) {
    if (entry.kind === 'circulation') continue
    const ratio = polygonAspectRatio(entry.room.polygon)
    if (ratio <= ASPECT_RATIO_SOFT) continue
    const message = `房间「${label(entry.room)}」长宽比约 ${ratio.toFixed(1)}:1`
    if (ratio > ASPECT_RATIO_HARD) fatal.push(`${message}，过于狭长`)
    else warnings.push(message)
  }
  const circulationArea = areas
    .filter(entry => entry.kind === 'circulation')
    .reduce((sum, entry) => sum + entry.area, 0)
  const circulationRatio = totalRoomArea > 0 ? circulationArea / totalRoomArea : 0
  if (circulationRatio > CIRCULATION_RATIO_HARD) {
    fatal.push(`纯通行空间占比 ${Math.round(circulationRatio * 100)}% 超过上限 ${Math.round(CIRCULATION_RATIO_HARD * 100)}%`)
  } else if (circulationRatio > CIRCULATION_RATIO_SOFT) {
    warnings.push(`纯通行空间占比 ${Math.round(circulationRatio * 100)}% 偏高`)
  }

  // --- #8 exterior-window rooms touch the footprint boundary ---
  for (const room of plan.rooms) {
    if (!room.requiresExteriorWindow) continue
    const contact = longestExteriorEdge(room.polygon, plan.footprint)
    if (contact < MIN_DOOR_EDGE_M) {
      fatal.push(`房间「${label(room)}」需要外窗，但没有 ≥${MIN_DOOR_EDGE_M}m 的外墙边`)
    }
  }

  // --- #9 every connection has a usable shared edge ---
  const roomById = new Map(plan.rooms.map(room => [room.id, room]))
  for (const conn of plan.connections) {
    const a = roomById.get(conn.from)!
    const b = roomById.get(conn.to)!
    const shared = longestSharedEdge(a.polygon, b.polygon)
    if (shared.length < MIN_DOOR_EDGE_M) {
      fatal.push(
        `connection ${label(a)}→${label(b)} 的共享墙段仅 ${shared.length.toFixed(2)}m（需 ≥${MIN_DOOR_EDGE_M}m）`,
      )
    }
  }

  // --- #10 circulation: reachability + bedroom access rule ---
  const adjacency = new Map<string, Set<string>>()
  for (const room of plan.rooms) adjacency.set(room.id, new Set())
  for (const conn of plan.connections) {
    adjacency.get(conn.from)?.add(conn.to)
    adjacency.get(conn.to)?.add(conn.from)
  }
  if (plan.rooms.length > 1) {
    const reachable = bfs(plan.entry.roomId, adjacency, () => true)
    for (const room of plan.rooms) {
      if (!reachable.has(room.id)) {
        fatal.push(`房间「${label(room)}」从入户房间出发经 connections 不可达`)
      }
    }
    const hasPublic = plan.rooms.some(room => PUBLIC_TYPES.has(room.type))
    for (const bedroom of plan.rooms.filter(room => room.type === 'bedroom')) {
      if (!hasPublic) {
        fatal.push(`卧室「${label(bedroom)}」无法到达公共空间：户型中没有任何公共房型`)
        continue
      }
      const allowed = (id: string) => {
        const room = roomById.get(id)
        if (!room) return false
        if (room.id === bedroom.id) return true
        // Public targets are also valid intermediates; forbidden types
        // (kitchen/bathroom/OTHER bedrooms) block the path.
        return !FORBIDDEN_INTERMEDIATE_TYPES.has(room.type)
      }
      const reached = bfs(bedroom.id, adjacency, allowed)
      const reachedPublic = [...reached].some(id => PUBLIC_TYPES.has(roomById.get(id)!.type))
      if (!reachedPublic) {
        fatal.push(`卧室「${label(bedroom)}」必须不穿过厨房/卫生间/其他卧室即可到达公共空间`)
      }
    }
  }

  // --- #11 entry room has an exterior wall for the entry door ---
  const entryRoom = roomById.get(plan.entry.roomId)!
  if (longestExteriorEdge(entryRoom.polygon, plan.footprint) < MIN_DOOR_EDGE_M) {
    fatal.push(`入户房间「${label(entryRoom)}」没有 ≥${MIN_DOOR_EDGE_M}m 的外墙边可开入户门`)
  }

  return finish(fatal, warnings)
}

function bfs(
  start: string,
  adjacency: Map<string, Set<string>>,
  allowed: (id: string) => boolean,
): Set<string> {
  const visited = new Set<string>([start])
  const queue = [start]
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

function finish(fatal: string[], warnings: string[]): PlanValidation {
  const score = Math.max(0, Math.min(100, 100 - fatal.length * 20 - warnings.length * 4))
  return { fatal, warnings, score }
}
