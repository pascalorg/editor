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
  CIRCULATION_RATIO_HARD,
  CIRCULATION_RATIO_SOFT,
  polygonAspectRatio,
  type RoomKind,
} from './layout-metrics'
import { DEFAULT_NORM_PROFILE, type NormProfile } from './norms/profile'
import {
  analyzePolygonGrid,
  footprintArea as footprintAreaOf,
  isAxisAligned,
  longestExteriorEdge,
  longestSharedEdge,
  polygonArea,
  polygonIntersectionArea,
  polygonSelfIntersects,
  type IssueL10n,
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
  // Aligned with `fatal`: template refs for reply-language re-rendering, null
  // for checks that only fire on the experimental llm-geometry path (their
  // zh text passes through untranslated).
  fatalL10n: Array<IssueL10n | null>
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
  profile: NormProfile = DEFAULT_NORM_PROFILE,
): PlanValidation {
  const fatal: string[] = []
  const fatalL10n: Array<IssueL10n | null> = []
  const warnings: string[] = []
  const pushFatal = (message: string, l10n?: IssueL10n) => {
    fatal.push(message)
    fatalL10n.push(l10n ?? null)
  }
  const label = (room: LayoutPlanRoom) => room.name || room.id

  // --- #1 schema / geometry legality ---
  const ids = new Set<string>()
  for (const room of plan.rooms) {
    if (ids.has(room.id)) pushFatal(`房间 id「${room.id}」重复`)
    ids.add(room.id)
    if (room.polygon.length < 4) {
      pushFatal(`房间「${label(room)}」多边形顶点少于 4 个`)
      continue
    }
    if (!isAxisAligned(room.polygon)) {
      pushFatal(`房间「${label(room)}」多边形不是轴对齐的（或含零长度边）`)
      continue
    }
    if (polygonSelfIntersects(room.polygon)) {
      pushFatal(`房间「${label(room)}」多边形自相交`)
    }
  }
  if (!ids.has(plan.entry.roomId)) {
    pushFatal(`entry.roomId「${plan.entry.roomId}」不存在于 rooms 中`)
  }
  for (const conn of plan.connections) {
    if (!ids.has(conn.from) || !ids.has(conn.to)) {
      pushFatal(`connection ${conn.from}→${conn.to} 引用了不存在的房间`)
    }
    if (conn.from === conn.to) {
      pushFatal(`connection ${conn.from}→${conn.to} 两端相同`)
    }
  }
  if (!(plan.footprint.width > 0) || !(plan.footprint.depth > 0)) {
    pushFatal('footprint 尺寸必须为正数')
  }
  // Geometry below assumes a sane schema; bail out early if not.
  if (fatal.length > 0) return finish(fatal, fatalL10n, warnings)

  // --- #2 rooms inside footprint ---
  for (const room of plan.rooms) {
    const outside = room.polygon.some(([x, z]) =>
      x < -EDGE_EPSILON || z < -EDGE_EPSILON
      || x > plan.footprint.width + EDGE_EPSILON
      || z > plan.footprint.depth + EDGE_EPSILON)
    if (outside) pushFatal(`房间「${label(room)}」超出 footprint 边界`)
  }
  // Non-rectangular outline: the bbox test above can't see a room sitting in
  // the notch (and coverage only fires on UNDER-coverage), so prove every
  // room lies inside the true polygon.
  if (plan.footprint.polygon) {
    for (const room of plan.rooms) {
      const outsideArea = polygonArea(room.polygon)
        - polygonIntersectionArea(room.polygon, plan.footprint.polygon)
      if (outsideArea > OVERLAP_AREA_TOLERANCE_SQM) {
        pushFatal(`房间「${label(room)}」超出 footprint 边界`)
      }
    }
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
    pushFatal(`房间「${roomA ? label(roomA) : a}」与「${roomB ? label(roomB) : b}」重叠约 ${area.toFixed(2)}㎡`)
  }
  // Polygon-aware (S5 L-shape): the coverage/target base is the true outline
  // area, not the bounding box.
  const footprintArea = footprintAreaOf(plan.footprint)
  if (grid.unionArea < footprintArea * COVERAGE_MIN_RATIO) {
    pushFatal(
      `房间未铺满 footprint：覆盖 ${grid.unionArea.toFixed(1)}㎡ / ${footprintArea.toFixed(1)}㎡`
      + `（要求 ≥${Math.round(COVERAGE_MIN_RATIO * 100)}%）`,
    )
  }

  // --- #5 footprint area vs target ---
  if (targets.totalAreaSqm !== undefined && targets.totalAreaSqm > 0) {
    const deviation = Math.abs(footprintArea - targets.totalAreaSqm) / targets.totalAreaSqm
    if (deviation > TOTAL_AREA_TOLERANCE) {
      pushFatal(
        `footprint 面积 ${footprintArea.toFixed(1)}㎡ 偏离目标 ${targets.totalAreaSqm}㎡ 达 `
        + `${Math.round(deviation * 100)}%（上限 ±${Math.round(TOTAL_AREA_TOLERANCE * 100)}%）`,
        {
          id: 'planFootprintAreaDeviation',
          params: {
            actual: footprintArea.toFixed(1),
            target: targets.totalAreaSqm,
            percent: Math.round(deviation * 100),
            limit: Math.round(TOTAL_AREA_TOLERANCE * 100),
          },
        },
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
        pushFatal(
          `房型「${requirement.type}」数量 ${actual} 不等于 brief 要求的 ${requirement.count}`,
          {
            id: 'planRoomCountMismatch',
            params: { type: requirement.type, actual, expected: requirement.count },
          },
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
  const bedroomCount = plan.rooms.filter(room => room.type === 'bedroom').length
  const bounds = profile.roomAreaBounds({ totalAreaSqm: totalRoomArea, bedroomCount })
  for (const entry of areas) {
    const bound = bounds[entry.kind]
    if (!bound) continue
    if (entry.area >= bound.softMin && entry.area <= bound.softMax) continue
    const hard = entry.area < bound.fatalMin || entry.area > bound.fatalMax
    const message = `房间「${label(entry.room)}」面积 ${entry.area.toFixed(1)}㎡ 超出该房型合理区间 ${bound.softMin}–${bound.softMax}㎡`
    if (hard) {
      pushFatal(message, {
        id: 'planRoomAreaOutOfBand',
        params: {
          room: label(entry.room),
          area: entry.area.toFixed(1),
          min: bound.softMin,
          max: bound.softMax,
        },
      })
    } else warnings.push(message)
  }
  for (const entry of areas) {
    if (entry.kind === 'circulation') continue
    const ratio = polygonAspectRatio(entry.room.polygon)
    if (ratio <= ASPECT_RATIO_SOFT) continue
    const message = `房间「${label(entry.room)}」长宽比约 ${ratio.toFixed(1)}:1`
    if (ratio > ASPECT_RATIO_HARD) {
      pushFatal(`${message}，过于狭长`, {
        id: 'planRoomTooSlender',
        params: { room: label(entry.room), ratio: ratio.toFixed(1) },
      })
    } else warnings.push(message)
  }
  const circulationArea = areas
    .filter(entry => entry.kind === 'circulation')
    .reduce((sum, entry) => sum + entry.area, 0)
  const circulationRatio = totalRoomArea > 0 ? circulationArea / totalRoomArea : 0
  if (circulationRatio > CIRCULATION_RATIO_HARD) {
    pushFatal(
      `纯通行空间占比 ${Math.round(circulationRatio * 100)}% 超过上限 ${Math.round(CIRCULATION_RATIO_HARD * 100)}%`,
      {
        id: 'planCirculationShareHigh',
        params: {
          percent: Math.round(circulationRatio * 100),
          limit: Math.round(CIRCULATION_RATIO_HARD * 100),
        },
      },
    )
  } else if (circulationRatio > CIRCULATION_RATIO_SOFT) {
    warnings.push(`纯通行空间占比 ${Math.round(circulationRatio * 100)}% 偏高`)
  }

  // --- #8 exterior-window rooms touch the footprint boundary ---
  for (const room of plan.rooms) {
    if (!room.requiresExteriorWindow) continue
    const contact = longestExteriorEdge(room.polygon, plan.footprint)
    if (contact < MIN_DOOR_EDGE_M) {
      pushFatal(`房间「${label(room)}」需要外窗，但没有 ≥${MIN_DOOR_EDGE_M}m 的外墙边`, {
        id: 'planWindowRoomNoExterior',
        params: { room: label(room), min: MIN_DOOR_EDGE_M },
      })
    }
  }

  // --- #9 every connection has a usable shared edge ---
  const roomById = new Map(plan.rooms.map(room => [room.id, room]))
  for (const conn of plan.connections) {
    const a = roomById.get(conn.from)!
    const b = roomById.get(conn.to)!
    const shared = longestSharedEdge(a.polygon, b.polygon)
    if (shared.length < MIN_DOOR_EDGE_M) {
      pushFatal(
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
        pushFatal(`房间「${label(room)}」从入户房间出发经 connections 不可达`)
      }
    }
    const hasPublic = plan.rooms.some(room => PUBLIC_TYPES.has(room.type))
    for (const bedroom of plan.rooms.filter(room => room.type === 'bedroom')) {
      if (!hasPublic) {
        pushFatal(`卧室「${label(bedroom)}」无法到达公共空间：户型中没有任何公共房型`)
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
        pushFatal(`卧室「${label(bedroom)}」必须不穿过厨房/卫生间/其他卧室即可到达公共空间`)
      }
    }
  }

  // --- #11 entry room has an exterior wall for the entry door ---
  const entryRoom = roomById.get(plan.entry.roomId)!
  if (longestExteriorEdge(entryRoom.polygon, plan.footprint) < MIN_DOOR_EDGE_M) {
    pushFatal(`入户房间「${label(entryRoom)}」没有 ≥${MIN_DOOR_EDGE_M}m 的外墙边可开入户门`)
  }

  return finish(fatal, fatalL10n, warnings)
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

function finish(
  fatal: string[],
  fatalL10n: Array<IssueL10n | null>,
  warnings: string[],
): PlanValidation {
  const score = Math.max(0, Math.min(100, 100 - fatal.length * 20 - warnings.length * 4))
  return { fatal, fatalL10n, warnings, score }
}
