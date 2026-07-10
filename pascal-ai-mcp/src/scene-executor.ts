// ---------------------------------------------------------------------------
// Deterministic structure + openings executor (GENERATION_REDESIGN.md §4).
//
// Input: a validated LayoutPlan whose coordinates ARE the scene coordinates
// (create_room receives plan polygons verbatim). Output: rooms, shared-wall
// dedupe, connection doors at shared-wall midpoints, the entry door on the
// entry room's longest exterior edge, and one window per
// requiresExteriorWindow room — all through direct MCP calls, zero model
// calls. Each MCP call is retried once; a second failure is recorded in
// `executionIssues` and execution continues, so one bad opening never aborts
// the whole build. Structural completeness is judged afterwards by the
// completion gates, not here.
// ---------------------------------------------------------------------------

import {
  longestSharedEdge,
  polygonArea,
  polygonBounds,
  type LayoutPlan,
  type LayoutPlanRoom,
  type Segment,
  sharedBoundarySegments,
} from './layout-plan'

// Unwraps an MCP tool result into its structured payload. Lives here (not in
// agent.ts) so the executor has no import back into the agent; agent.ts
// re-uses this export.
export function toolPayload(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const value = result as Record<string, unknown>
  if (value.structuredContent && typeof value.structuredContent === 'object') {
    return value.structuredContent as Record<string, unknown>
  }
  if (Array.isArray(value.content)) {
    const text = value.content.find(block =>
      Boolean(block) && typeof block === 'object' && (block as { type?: string }).type === 'text',
    ) as { text?: unknown } | undefined
    if (typeof text?.text === 'string') {
      try { return JSON.parse(text.text) as Record<string, unknown> } catch { return {} }
    }
  }
  return {}
}

export type McpCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>

export type ExecutedRoom = {
  planRoomId: string
  name: string
  zoneId: string | null
  plannedAreaSqm: number
  builtAreaSqm: number | null
}

export type ExecutedOpening = {
  kind: 'door' | 'entry_door' | 'window'
  roomIds: string[]
  wallId: string | null
  nodeId: string | null
}

export type SceneExecutionReport = {
  rooms: ExecutedRoom[]
  openings: ExecutedOpening[]
  executionIssues: string[]
}

const DOOR_WIDTH_M = 0.9
const WINDOW_MAX_WIDTH_M = 1.5
const WINDOW_MIN_WIDTH_M = 0.6
// Wall-matching tolerance: how far a target point may sit off a wall's line
// and still count as hosted by that wall. Matches the agent's wall
// coincidence epsilon.
const WALL_MATCH_EPSILON_M = 0.06
// A door "occupies" this radius of wall around its midpoint when deciding
// whether a window edge conflicts with it.
const DOOR_CONFLICT_RADIUS_M = DOOR_WIDTH_M / 2 + 0.1
// Built zone area may differ from the plan by wall thickness effects; beyond
// this ratio it's reported as an execution issue.
const AREA_MISMATCH_RATIO = 0.1

export type WallSegment = {
  id: string
  start: [number, number]
  end: [number, number]
}

function isNumberPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && typeof value[1] === 'number'
}

function isWallSegment(value: unknown): value is WallSegment {
  return Boolean(value) && typeof value === 'object' &&
    typeof (value as WallSegment).id === 'string' &&
    isNumberPair((value as WallSegment).start) && isNumberPair((value as WallSegment).end)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// One retry per call (§4). Returns the unwrapped payload, or null after the
// second failure (recorded in `issues`). An `{error}` payload from a tool
// counts as a failure too — MCP tool errors often come back as content, not
// as thrown exceptions. `beforeCall` runs OUTSIDE the try so a cancellation
// it throws aborts the whole execution instead of being retried and recorded
// as a tool failure.
export async function callWithRetry(
  callMcp: McpCaller,
  name: string,
  args: Record<string, unknown>,
  issues: string[],
  label: string,
  beforeCall?: () => void,
): Promise<Record<string, unknown> | null> {
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    beforeCall?.()
    try {
      const payload = toolPayload(await callMcp(name, args))
      if (typeof payload.error === 'string' && payload.error) {
        lastError = payload.error
        continue
      }
      return payload
    } catch (error) {
      lastError = errorText(error)
    }
  }
  issues.push(`${label}失败（${name}）：${lastError || '未知错误'}`)
  return null
}

function footprintPolygon(
  footprint: { width: number; depth: number; polygon?: Array<[number, number]> },
): Array<[number, number]> {
  // S5: non-rectangular outlines carry their true polygon — exterior-wall
  // detection (windows/entry door) must follow it, not the bounding box.
  if (footprint.polygon) return footprint.polygon
  return [[0, 0], [footprint.width, 0], [footprint.width, footprint.depth], [0, footprint.depth]]
}

function boundsCenter(polygon: Array<[number, number]>): [number, number] {
  const { minX, maxX, minZ, maxZ } = polygonBounds(polygon)
  return [(minX + maxX) / 2, (minZ + maxZ) / 2]
}

function segmentLength(seg: Segment): number {
  return Math.hypot(seg.end[0] - seg.start[0], seg.end[1] - seg.start[1])
}

function segmentMidpoint(seg: Segment): [number, number] {
  return [(seg.start[0] + seg.end[0]) / 2, (seg.start[1] + seg.end[1]) / 2]
}

// Distance from a point to a wall's segment line plus its projection
// parameter — used both to find the hosting wall for an opening point and to
// convert that point into the wall's 0..1 `position`.
function projectOntoWall(wall: WallSegment, point: [number, number]): {
  distance: number
  t: number
  length: number
} {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return { distance: Infinity, t: 0, length: 0 }
  const px = point[0] - wall.start[0]
  const pz = point[1] - wall.start[1]
  const t = (px * dx + pz * dz) / (length * length)
  const projX = wall.start[0] + dx * t
  const projZ = wall.start[1] + dz * t
  return { distance: Math.hypot(point[0] - projX, point[1] - projZ), t, length }
}

// The wall that hosts `point`: nearest wall whose segment actually contains
// the point's projection (within tolerance). Null when no wall is close
// enough — e.g. dedupe failed or the room was never built.
export function findHostWall(walls: WallSegment[], point: [number, number]): WallSegment | null {
  let best: WallSegment | null = null
  let bestDistance = WALL_MATCH_EPSILON_M
  for (const wall of walls) {
    const { distance, t, length } = projectOntoWall(wall, point)
    const overhang = WALL_MATCH_EPSILON_M / Math.max(length, 1e-9)
    if (distance <= bestDistance && t >= -overhang && t <= 1 + overhang) {
      best = wall
      bestDistance = distance
    }
  }
  return best
}

// 0..1 position on `wall` for an opening of `width` centered as close to
// `point` as the wall allows.
function openingPosition(wall: WallSegment, point: [number, number], width: number): number {
  const { t, length } = projectOntoWall(wall, point)
  if (length <= width) return 0.5
  const halfWidthT = width / 2 / length
  return Math.min(1 - halfWidthT, Math.max(halfWidthT, t))
}

// Which way a connection door should swing: toward the larger room (§4).
// `inward`/`outward` are defined in the wall's local frame; which world side
// that is depends on the wall's own start→end direction, so we decide by the
// side of the wall line the larger room's center falls on. The left-side ⇒
// inward convention is an assumption — if visual review shows it inverted,
// flip it HERE only. A wrong swing is a decorative issue (§5), never a gate.
export function swingToward(wall: WallSegment, roomCenter: [number, number]): 'inward' | 'outward' {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const cross = dx * (roomCenter[1] - wall.start[1]) - dz * (roomCenter[0] - wall.start[0])
  return cross > 0 ? 'inward' : 'outward'
}

// Exterior straight runs of a room (contiguous overlaps between its polygon
// and the footprint boundary), longest first — window / entry-door hosts.
export function exteriorSegments(
  room: LayoutPlanRoom,
  footprint: { width: number; depth: number },
): Segment[] {
  return sharedBoundarySegments(room.polygon, footprintPolygon(footprint))
    .sort((a, b) => segmentLength(b) - segmentLength(a))
}

function pointNearSegment(point: [number, number], seg: Segment, radius: number): boolean {
  const asWall: WallSegment = { id: '', start: seg.start, end: seg.end }
  const { distance, t, length } = projectOntoWall(asWall, point)
  if (length < 1e-9) return false
  const slackT = radius / length
  return distance <= WALL_MATCH_EPSILON_M && t >= -slackT && t <= 1 + slackT
}

export async function executeLayoutPlan(options: {
  plan: LayoutPlan
  levelId: string
  callMcp: McpCaller
  // Injected from the agent: the collinear-overlap wall dedupe that must run
  // between room creation and opening placement.
  dedupeSharedWalls: () => Promise<void>
  // Cancellation check, run before every MCP attempt; whatever it throws
  // propagates out of executeLayoutPlan unswallowed.
  beforeCall?: () => void
}): Promise<SceneExecutionReport> {
  const { plan, levelId, callMcp, beforeCall } = options
  const issues: string[] = []
  const call = (name: string, args: Record<string, unknown>, label: string) =>
    callWithRetry(callMcp, name, args, issues, label, beforeCall)
  const openings: ExecutedOpening[] = []
  const roomById = new Map(plan.rooms.map(room => [room.id, room]))

  // --- rooms -----------------------------------------------------------------
  const rooms: ExecutedRoom[] = []
  const zoneIdByRoom = new Map<string, string>()
  for (const room of plan.rooms) {
    const payload = await call('create_room', { levelId, name: room.name, polygon: room.polygon }, `创建房间「${room.name}」`)
    const zoneId = typeof payload?.zoneId === 'string' ? payload.zoneId : null
    if (zoneId) zoneIdByRoom.set(room.id, zoneId)
    rooms.push({
      planRoomId: room.id,
      name: room.name,
      zoneId,
      plannedAreaSqm: polygonArea(room.polygon),
      builtAreaSqm: typeof payload?.areaSqMeters === 'number' ? payload.areaSqMeters : null,
    })
  }

  await options.dedupeSharedWalls()

  // --- walls snapshot (single read; all openings are computed from it) --------
  const wallsPayload = await call('get_walls', { levelId }, '读取墙体清单')
  const walls: WallSegment[] = Array.isArray(wallsPayload?.walls)
    ? wallsPayload.walls.filter(isWallSegment)
    : []
  if (walls.length === 0) {
    issues.push('建墙后未读取到任何墙体，门窗阶段跳过')
    return { rooms, openings, executionIssues: issues }
  }

  // Points already hosting a door, so window edges can yield to them (§2:
  // "与门冲突让位次长边").
  const doorPoints: Array<[number, number]> = []

  // --- connection doors --------------------------------------------------------
  for (const connection of plan.connections) {
    const from = roomById.get(connection.from)
    const to = roomById.get(connection.to)
    if (!from || !to) {
      issues.push(`连接 ${connection.from}→${connection.to} 引用了不存在的房间，跳过`)
      continue
    }
    const shared = longestSharedEdge(from.polygon, to.polygon)
    if (shared.length < DOOR_WIDTH_M) {
      issues.push(`「${from.name}」和「${to.name}」的共享墙段只有 ${shared.length.toFixed(2)}m，放不下 ${DOOR_WIDTH_M}m 的门`)
      continue
    }
    const wall = findHostWall(walls, shared.midpoint)
    if (!wall) {
      issues.push(`找不到承载「${from.name}」↔「${to.name}」连接门的墙（中点 ${shared.midpoint[0].toFixed(2)},${shared.midpoint[1].toFixed(2)}）`)
      continue
    }
    const larger = polygonArea(from.polygon) >= polygonArea(to.polygon) ? from : to
    const payload = await call('add_door', {
        wallId: wall.id,
        position: openingPosition(wall, shared.midpoint, DOOR_WIDTH_M),
        width: DOOR_WIDTH_M,
        swingDirection: swingToward(wall, boundsCenter(larger.polygon)),
      }, `在「${from.name}」和「${to.name}」之间开门`)
    const doorId = typeof payload?.doorId === 'string' ? payload.doorId : null
    if (doorId) doorPoints.push(shared.midpoint)
    openings.push({ kind: 'door', roomIds: [from.id, to.id], wallId: wall.id, nodeId: doorId })
  }

  // --- entry door ---------------------------------------------------------------
  const entryRoom = roomById.get(plan.entry.roomId)
  if (!entryRoom) {
    issues.push(`入户房间 ${plan.entry.roomId} 不在房间清单里，未开入户门`)
  } else {
    const exterior = exteriorSegments(entryRoom, plan.footprint)
    const host = exterior.find(seg => segmentLength(seg) >= DOOR_WIDTH_M)
    if (!host) {
      issues.push(`入户房间「${entryRoom.name}」没有 ≥${DOOR_WIDTH_M}m 的外墙边，未开入户门`)
    } else {
      const midpoint = segmentMidpoint(host)
      const wall = findHostWall(walls, midpoint)
      if (!wall) {
        issues.push(`找不到承载入户门的外墙（中点 ${midpoint[0].toFixed(2)},${midpoint[1].toFixed(2)}）`)
      } else {
        const payload = await call('add_door', {
            wallId: wall.id,
            position: openingPosition(wall, midpoint, DOOR_WIDTH_M),
            width: DOOR_WIDTH_M,
            swingDirection: swingToward(wall, boundsCenter(entryRoom.polygon)),
          }, `为「${entryRoom.name}」开入户门`)
        const doorId = typeof payload?.doorId === 'string' ? payload.doorId : null
        if (doorId) doorPoints.push(midpoint)
        openings.push({ kind: 'entry_door', roomIds: [entryRoom.id], wallId: wall.id, nodeId: doorId })
      }
    }
  }

  // --- windows -------------------------------------------------------------------
  for (const room of plan.rooms) {
    if (!room.requiresExteriorWindow) continue
    const candidates = exteriorSegments(room, plan.footprint)
      .filter(seg => segmentLength(seg) >= WINDOW_MIN_WIDTH_M + 0.2)
    // Longest exterior edge wins; an edge already hosting a door yields to the
    // next longest. If every candidate hosts a door, fall back to the longest
    // anyway (offset placement is a later refinement; a lit room beats none).
    const conflictFree = candidates.filter(
      seg => !doorPoints.some(p => pointNearSegment(p, seg, DOOR_CONFLICT_RADIUS_M)),
    )
    const host = conflictFree[0] ?? candidates[0]
    if (!host) {
      issues.push(`房间「${room.name}」需要外窗，但没有足够长的外墙边`)
      continue
    }
    const midpoint = segmentMidpoint(host)
    const wall = findHostWall(walls, midpoint)
    if (!wall) {
      issues.push(`找不到承载「${room.name}」外窗的墙（中点 ${midpoint[0].toFixed(2)},${midpoint[1].toFixed(2)}）`)
      continue
    }
    const width = Math.max(
      WINDOW_MIN_WIDTH_M,
      Math.min(WINDOW_MAX_WIDTH_M, segmentLength(host) - 0.2),
    )
    const payload = await call('add_window', { wallId: wall.id, position: openingPosition(wall, midpoint, width), width }, `为「${room.name}」开外窗`)
    openings.push({
      kind: 'window',
      roomIds: [room.id],
      wallId: wall.id,
      nodeId: typeof payload?.windowId === 'string' ? payload.windowId : null,
    })
  }

  // --- as-built verification (§4: get_zones 实测比对) -----------------------------
  const zonesPayload = await call('get_zones', {}, '读取分区清单')
  const zones = Array.isArray(zonesPayload?.zones) ? zonesPayload.zones : []
  const zoneAreaById = new Map<string, number>()
  for (const zone of zones) {
    if (zone && typeof zone === 'object' && typeof (zone as { id?: unknown }).id === 'string') {
      const polygon = (zone as { polygon?: unknown }).polygon
      if (Array.isArray(polygon) && polygon.every(isNumberPair)) {
        zoneAreaById.set((zone as { id: string }).id, polygonArea(polygon as Array<[number, number]>))
      }
    }
  }
  for (const room of rooms) {
    if (!room.zoneId) {
      issues.push(`房间「${room.name}」没有建成（缺少 zone）`)
      continue
    }
    const builtArea = zoneAreaById.get(room.zoneId)
    if (builtArea === undefined) {
      issues.push(`房间「${room.name}」的 zone ${room.zoneId} 在实测中不存在`)
      continue
    }
    room.builtAreaSqm = builtArea
    const ratio = Math.abs(builtArea - room.plannedAreaSqm) / Math.max(room.plannedAreaSqm, 1e-9)
    if (ratio > AREA_MISMATCH_RATIO) {
      issues.push(
        `房间「${room.name}」实测面积 ${builtArea.toFixed(1)}㎡ 与计划 ${room.plannedAreaSqm.toFixed(1)}㎡ 偏差超过 ${Math.round(AREA_MISMATCH_RATIO * 100)}%`,
      )
    }
  }

  return { rooms, openings, executionIssues: issues }
}
