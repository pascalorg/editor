// ---------------------------------------------------------------------------
// Deterministic rectangular partitioner: LayoutIntent → LayoutPlan
// (GENERATION_REDESIGN.md §2). Zero model calls.
//
// Band guillotine v1. Entry side is z=0 (bottom):
//
//   z=D ┌──────────────────────────────┐
//       │ private band: bedrooms/study │  ← exterior windows
//       ├──────────────────────────────┤
//       │ corridor (1.15m, full width) │  ← only when ≥2 private rooms
//       ├──────────────────────────────┤
//       │ public band: kitchen│dining│HUB (living / living_kitchen)
//   z=0 └──────────────────────────────┘  ← entry door side
//
// Within a band, each room is a full-depth column whose width is proportional
// to its target area. Small service rooms (bathroom / storage / entry, and —
// when a full-depth column would be too narrow — kitchen / dining) are carved
// as corner rectangles out of a host column, which becomes an L/U-shaped
// axis-aligned polygon; the LayoutPlan schema allows that, and the validator's
// grid method handles it. Bathrooms carve into the hub on the corridor side
// so their door opens to circulation, extra bathrooms become bedroom
// en-suites. This is the one refinement over the doc's plain proportional
// split: without it, any plan with a 4㎡ bathroom in a ≥3m-deep band is
// unsolvable (the bathroom column would be ~1.2m wide).
//
// Footprint width W is searched over √A × [0.7, 1.5]; candidates violating
// per-room minimum widths or aspect ratios are rejected, the rest are scored
// (footprint proportions, room aspect, corridor share) and the best wins.
// No feasible W → explicit failure with suggestions, never a forced layout.
// ---------------------------------------------------------------------------

import {
  DEFAULT_ROOM_AREAS,
  defaultRequiresWindow,
  polygonArea,
  sharedBoundaryLength,
  type LayoutIntent,
  type LayoutPlan,
  type LayoutPlanRoom,
  type RoomType,
} from './layout-plan'

export type PartitionResult =
  | { ok: true; plan: LayoutPlan; notes: string[] }
  | { ok: false; reason: string }

export const CORRIDOR_WIDTH_M = 1.15
const MAX_ROOM_ASPECT = 3.0
const MAX_FOOTPRINT_ASPECT = 2.2
const MIN_DOOR_EDGE_M = 0.9
// Column/carve minimum interior widths by room type.
const SMALL_MIN_WIDTH_TYPES: ReadonlySet<RoomType> = new Set([
  'bathroom', 'storage', 'entry', 'balcony',
])
function minWidthFor(type: RoomType): number {
  return SMALL_MIN_WIDTH_TYPES.has(type) ? 1.5 : 1.8
}

const PRIVATE_TYPES: ReadonlySet<RoomType> = new Set([
  'bedroom', 'study', 'balcony', 'other',
])
const CARVE_TYPES: ReadonlySet<RoomType> = new Set(['bathroom', 'storage', 'entry'])
// Public rooms small enough to carve into the hub when their full-depth
// column would come out too narrow.
const CARVEABLE_PUBLIC_MAX_SQM = 9

type NormRoom = {
  id: string
  name: string
  type: RoomType
  area: number
  window: boolean
}

type Rect = { x0: number; z0: number; x1: number; z1: number }
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type Notch = { corner: Corner; w: number; d: number }

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function rectPolygon(rect: Rect): Array<[number, number]> {
  return [
    [rect.x0, rect.z0],
    [rect.x1, rect.z0],
    [rect.x1, rect.z1],
    [rect.x0, rect.z1],
  ]
}

// Host column rectangle with up to four corner notches cut out.
function rectWithNotches(rect: Rect, notches: Notch[]): Array<[number, number]> {
  const byCorner = new Map<Corner, Notch>(notches.map(n => [n.corner, n]))
  const { x0, z0, x1, z1 } = rect
  const points: Array<[number, number]> = []
  const bl = byCorner.get('bottom-left')
  const br = byCorner.get('bottom-right')
  const tr = byCorner.get('top-right')
  const tl = byCorner.get('top-left')
  if (bl) points.push([x0, round2(z0 + bl.d)], [round2(x0 + bl.w), round2(z0 + bl.d)], [round2(x0 + bl.w), z0])
  else points.push([x0, z0])
  if (br) points.push([round2(x1 - br.w), z0], [round2(x1 - br.w), round2(z0 + br.d)], [x1, round2(z0 + br.d)])
  else points.push([x1, z0])
  if (tr) points.push([x1, round2(z1 - tr.d)], [round2(x1 - tr.w), round2(z1 - tr.d)], [round2(x1 - tr.w), z1])
  else points.push([x1, z1])
  if (tl) points.push([round2(x0 + tl.w), z1], [round2(x0 + tl.w), round2(z1 - tl.d)], [x0, round2(z1 - tl.d)])
  else points.push([x0, z1])
  return points
}

function notchRect(host: Rect, notch: Notch): Rect {
  switch (notch.corner) {
    case 'bottom-left':
      return { x0: host.x0, z0: host.z0, x1: round2(host.x0 + notch.w), z1: round2(host.z0 + notch.d) }
    case 'bottom-right':
      return { x0: round2(host.x1 - notch.w), z0: host.z0, x1: host.x1, z1: round2(host.z0 + notch.d) }
    case 'top-left':
      return { x0: host.x0, z0: round2(host.z1 - notch.d), x1: round2(host.x0 + notch.w), z1: host.z1 }
    case 'top-right':
      return { x0: round2(host.x1 - notch.w), z0: round2(host.z1 - notch.d), x1: host.x1, z1: host.z1 }
  }
}

// Corner preference per carved room type. Bathrooms/storage go to the "top"
// (corridor side when the host sits in the public band, so the bathroom door
// opens onto circulation); entry goes to the bottom (exterior entry side).
const CARVE_CORNER_PREFERENCE: Partial<Record<RoomType, Corner[]>> = {
  bathroom: ['top-left', 'top-right', 'bottom-right'],
  storage: ['top-right', 'top-left', 'bottom-right'],
  entry: ['bottom-left', 'bottom-right'],
  kitchen: ['bottom-right', 'bottom-left', 'top-right'],
  dining: ['bottom-left', 'bottom-right', 'top-left'],
}

// --- normalization ----------------------------------------------------------

function normalizeRooms(intent: LayoutIntent): NormRoom[] {
  return intent.rooms.map(room => ({
    id: room.id,
    name: room.name,
    type: room.type,
    area: room.targetAreaSqm !== undefined && room.targetAreaSqm > 0
      ? room.targetAreaSqm
      : DEFAULT_ROOM_AREAS[room.type],
    window: room.requiresExteriorWindow ?? defaultRequiresWindow(room.type),
  }))
}

// --- candidate layout construction ------------------------------------------

type Candidate = { plan: LayoutPlan; penalty: number; notes: string[] }
type Attempt = Candidate | { reject: string }

type CarveSpec = { room: NormRoom; hostId: string }

// Places `carves` into `hostRect`, returning notches + carved room rects, or
// a rejection when they don't fit while keeping ≥0.9m of host wall around.
function placeCarves(
  hostRect: Rect,
  carves: Array<{ room: NormRoom; area: number }>,
): { notches: Notch[]; rects: Map<string, { rect: Rect; corner: Corner }> } | { reject: string } {
  const hostW = hostRect.x1 - hostRect.x0
  const hostD = hostRect.z1 - hostRect.z0
  const used = new Map<Corner, Notch>()
  const rects = new Map<string, { rect: Rect; corner: Corner }>()
  for (const { room, area } of carves) {
    const minW = minWidthFor(room.type)
    // Aim for a slightly-deeper-than-square carve, capped by the host.
    let d = Math.min(Math.max(Math.sqrt(area * 1.2), 1.4), Math.min(2.4, hostD - MIN_DOOR_EDGE_M))
    if (d <= 0) return { reject: `房间「${room.name}」无法嵌入宿主（宿主进深不足）` }
    let w = area / d
    if (w < minW) {
      w = minW
      d = area / w
    }
    if (d < 1.2 || d > hostD - MIN_DOOR_EDGE_M) {
      return { reject: `房间「${room.name}」按面积 ${round2(area)}㎡ 嵌入宿主后进深不合理` }
    }
    if (w > hostW - MIN_DOOR_EDGE_M) {
      return { reject: `房间「${room.name}」嵌入后宿主剩余宽度不足` }
    }
    w = round2(w)
    d = round2(d)
    const preferences = CARVE_CORNER_PREFERENCE[room.type]
      ?? ['top-right', 'top-left', 'bottom-right', 'bottom-left'] satisfies Corner[]
    const allCorners: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
    let placed = false
    for (const corner of [...preferences, ...allCorners]) {
      if (used.has(corner)) continue
      const candidate: Notch = { corner, w, d }
      if (!cornerFits(candidate, used, hostW, hostD)) continue
      used.set(corner, candidate)
      rects.set(room.id, { rect: notchRect(hostRect, candidate), corner })
      placed = true
      break
    }
    if (!placed) return { reject: `房间「${room.name}」在宿主的四个角都放不下` }
  }
  return { notches: [...used.values()], rects }
}

function cornerFits(notch: Notch, used: Map<Corner, Notch>, hostW: number, hostD: number): boolean {
  if (notch.w > hostW - MIN_DOOR_EDGE_M || notch.d > hostD - MIN_DOOR_EDGE_M) return false
  const [vert, horiz] = notch.corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  for (const other of used.values()) {
    const [oVert, oHoriz] = other.corner.split('-') as ['top' | 'bottom', 'left' | 'right']
    // Same horizontal edge (both top / both bottom): widths must leave a gap.
    if (vert === oVert && notch.w + other.w > hostW - MIN_DOOR_EDGE_M) return false
    // Same vertical edge (both left / both right): depths must leave a gap.
    if (horiz === oHoriz && notch.d + other.d > hostD - MIN_DOOR_EDGE_M) return false
  }
  return true
}

// Splits a band's total width among columns proportionally to area, with
// coordinates rounded to cm and the last edge pinned to the band width.
function columnRects(
  columns: Array<{ area: number }>,
  bandRect: Rect,
): Rect[] {
  const total = columns.reduce((sum, c) => sum + c.area, 0)
  const width = bandRect.x1 - bandRect.x0
  const rects: Rect[] = []
  let cum = 0
  let prevX = bandRect.x0
  for (let i = 0; i < columns.length; i++) {
    cum += columns[i]!.area
    const x = i === columns.length - 1
      ? bandRect.x1
      : round2(bandRect.x0 + (width * cum) / total)
    rects.push({ x0: prevX, z0: bandRect.z0, x1: x, z1: bandRect.z1 })
    prevX = x
  }
  return rects
}

function aspectOf(rect: Rect): number {
  const w = rect.x1 - rect.x0
  const d = rect.z1 - rect.z0
  if (w <= 0 || d <= 0) return Infinity
  return Math.max(w, d) / Math.min(w, d)
}

// --- main entry point ---------------------------------------------------------

export function partitionLayout(intent: LayoutIntent): PartitionResult {
  if (!(intent.targetTotalAreaSqm > 0)) {
    return { ok: false, reason: 'targetTotalAreaSqm 必须为正数' }
  }
  if (intent.rooms.length === 0) {
    return { ok: false, reason: 'rooms 为空，无法分区' }
  }
  const ids = new Set(intent.rooms.map(r => r.id))
  if (ids.size !== intent.rooms.length) {
    return { ok: false, reason: 'rooms 中存在重复 id' }
  }

  const rooms = normalizeRooms(intent)

  if (rooms.length === 1) return singleRoomPlan(intent, rooms[0]!)

  const hub = pickHub(rooms)
  const attempts: Attempt[] = []
  const base = Math.sqrt(intent.targetTotalAreaSqm)
  const carveOptions = hub
    ? [false, true]
    : [false]
  for (let step = 0; step <= 32; step++) {
    const W = round2(base * (0.7 + (0.8 * step) / 32))
    for (const carveSmallPublic of carveOptions) {
      attempts.push(
        hub
          ? tryBandLayout(intent, rooms, hub, W, carveSmallPublic)
          : tryCorridorHubLayout(intent, rooms, W),
      )
    }
  }

  let best: Candidate | null = null
  const rejectCounts = new Map<string, number>()
  for (const attempt of attempts) {
    if ('reject' in attempt) {
      rejectCounts.set(attempt.reject, (rejectCounts.get(attempt.reject) ?? 0) + 1)
      continue
    }
    if (!best || attempt.penalty < best.penalty) best = attempt
  }
  if (!best) {
    const topReasons = [...rejectCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason]) => reason)
    return {
      ok: false,
      reason: `在 ${intent.targetTotalAreaSqm}㎡ 内找不到满足最小宽度/长宽比约束的布局。主要障碍：${topReasons.join('；')}。`
        + '建议：增大总面积、减少房间数量，或调低个别房间的目标面积。',
    }
  }
  const notes = [...best.notes]
  for (const pair of intent.adjacency ?? []) {
    const a = best.plan.rooms.find(r => r.id === pair.a)
    const b = best.plan.rooms.find(r => r.id === pair.b)
    if (a && b && sharedBoundaryLength(a.polygon, b.polygon) < MIN_DOOR_EDGE_M) {
      notes.push(`邻接意愿 ${pair.a}↔${pair.b} 在 v1 带状布局中未能满足`)
    }
  }
  return { ok: true, plan: { ...best.plan, ...(notes.length > 0 ? { notes } : {}) }, notes }
}

function pickHub(rooms: NormRoom[]): NormRoom | null {
  return rooms.find(r => r.type === 'living_kitchen')
    ?? rooms.find(r => r.type === 'living')
    ?? rooms.find(r => r.type === 'hallway')
    ?? null
}

function singleRoomPlan(intent: LayoutIntent, room: NormRoom): PartitionResult {
  const area = intent.targetTotalAreaSqm
  const width = round2(Math.sqrt(area * (4 / 3)))
  const depth = round2(area / width)
  const plan: LayoutPlan = {
    footprint: { width, depth },
    entry: { roomId: room.id },
    rooms: [{
      id: room.id,
      name: room.name,
      type: room.type,
      polygon: rectPolygon({ x0: 0, z0: 0, x1: width, z1: depth }),
      requiresExteriorWindow: room.window,
    }],
    connections: [],
  }
  return { ok: true, plan, notes: [] }
}

// --- standard band layout (has a public hub) ---------------------------------

function tryBandLayout(
  intent: LayoutIntent,
  rooms: NormRoom[],
  hub: NormRoom,
  W: number,
  carveSmallPublic: boolean,
): Attempt {
  const notes: string[] = []
  const others = rooms.filter(r => r.id !== hub.id)
  const privates = others.filter(r => PRIVATE_TYPES.has(r.type))
  const corridorRoom = others.find(r => r.type === 'hallway') ?? null
  const corridorNeeded = privates.length >= 2

  // --- carve assignment ---
  const carveSpecs: CarveSpec[] = []
  const bedroomsByArea = [...privates.filter(r => r.type === 'bedroom')].sort((a, b) => b.area - a.area)
  const ensuiteHosts = new Set<string>()
  let bathIndex = 0
  for (const room of others) {
    if (room.type === 'bathroom') {
      // First bathroom is the shared one (hub host, door onto circulation);
      // extra bathrooms become en-suites of the biggest bedrooms.
      if (bathIndex === 0) {
        carveSpecs.push({ room, hostId: hub.id })
      } else {
        const host = bedroomsByArea.find(b => !ensuiteHosts.has(b.id))
        if (host) {
          ensuiteHosts.add(host.id)
          carveSpecs.push({ room, hostId: host.id })
          notes.push(`卫生间「${room.name}」作为「${host.name}」的套内卫生间`)
        } else {
          carveSpecs.push({ room, hostId: hub.id })
        }
      }
      bathIndex++
    } else if (room.type === 'storage' || room.type === 'entry') {
      carveSpecs.push({ room, hostId: hub.id })
    } else if (
      carveSmallPublic
      && (room.type === 'kitchen' || room.type === 'dining')
      && room.area <= CARVEABLE_PUBLIC_MAX_SQM
    ) {
      carveSpecs.push({ room, hostId: hub.id })
      notes.push(`「${room.name}」以开放/嵌入形式并入「${hub.name}」一侧`)
    }
  }
  const carvedIds = new Set(carveSpecs.map(c => c.room.id))

  const publicColumns = others.filter(r =>
    !carvedIds.has(r.id) && !PRIVATE_TYPES.has(r.type) && r.id !== corridorRoom?.id,
  )
  const privateColumns = privates.filter(r => !carvedIds.has(r.id))

  // --- area scaling to hit the total ---
  const corridorArea = corridorNeeded ? CORRIDOR_WIDTH_M * W : 0
  const roomAreaSum = rooms.reduce((sum, r) => sum + r.area, 0)
    - (corridorNeeded && corridorRoom ? corridorRoom.area : 0)
  const scale = (intent.targetTotalAreaSqm - corridorArea) / roomAreaSum
  if (scale < 0.7 || scale > 1.6) {
    return { reject: `总面积与房间面积之和不匹配（需整体缩放到 ${Math.round(scale * 100)}%）` }
  }
  if (Math.abs(scale - 1) > 0.25) {
    notes.push(`房间面积整体缩放 ${Math.round(scale * 100)}% 以匹配总面积 ${intent.targetTotalAreaSqm}㎡`)
  }
  const scaled = (room: NormRoom) => room.area * scale

  const carvesByHost = new Map<string, Array<{ room: NormRoom; area: number }>>()
  for (const spec of carveSpecs) {
    const list = carvesByHost.get(spec.hostId) ?? []
    list.push({ room: spec.room, area: scaled(spec.room) })
    carvesByHost.set(spec.hostId, list)
  }
  const columnArea = (room: NormRoom) =>
    scaled(room) + (carvesByHost.get(room.id) ?? []).reduce((sum, c) => sum + c.area, 0)

  // --- band geometry ---
  // Public band column order: kitchen (wet corner) far left, then dining and
  // any extra public rooms, hub on the right. With no corridor the single
  // band is [privates..., HUB, dining..., kitchen] so every column either
  // touches the hub or chains toward it through public rooms only.
  const publicSorted = [
    ...publicColumns.filter(r => r.type === 'kitchen'),
    ...publicColumns.filter(r => r.type !== 'kitchen'),
  ]
  let bandColumns: NormRoom[][]
  if (corridorNeeded) {
    bandColumns = [[...publicSorted, hub], privateColumns]
  } else {
    const publicsAfterHub = [
      ...publicColumns.filter(r => r.type !== 'kitchen'),
      ...publicColumns.filter(r => r.type === 'kitchen'),
    ]
    bandColumns = [[...privateColumns, hub, ...publicsAfterHub], []]
  }
  const [lowerBand, upperBand] = bandColumns as [NormRoom[], NormRoom[]]

  const lowerArea = lowerBand.reduce((sum, r) => sum + columnArea(r), 0)
  const upperArea = upperBand.reduce((sum, r) => sum + columnArea(r), 0)
  const dLower = round2(lowerArea / W)
  const dUpper = upperArea > 0 ? round2(upperArea / W) : 0
  const corridorD = corridorNeeded ? CORRIDOR_WIDTH_M : 0
  const zLowerTop = dLower
  const zUpperBottom = round2(dLower + corridorD)
  const D = round2(zUpperBottom + dUpper)
  if (Math.max(W, D) / Math.min(W, D) > MAX_FOOTPRINT_ASPECT) {
    return { reject: '外轮廓过于狭长' }
  }

  const rectById = new Map<string, Rect>()
  const lowerRects = columnRects(lowerBand.map(r => ({ area: columnArea(r) })), { x0: 0, z0: 0, x1: W, z1: zLowerTop })
  lowerBand.forEach((room, i) => rectById.set(room.id, lowerRects[i]!))
  if (upperBand.length > 0) {
    const upperRects = columnRects(upperBand.map(r => ({ area: columnArea(r) })), { x0: 0, z0: zUpperBottom, x1: W, z1: D })
    upperBand.forEach((room, i) => rectById.set(room.id, upperRects[i]!))
  }

  // --- per-column constraint checks ---
  for (const room of [...lowerBand, ...upperBand]) {
    const rect = rectById.get(room.id)!
    const width = rect.x1 - rect.x0
    if (width < minWidthFor(room.type)) {
      return { reject: `房间「${room.name}」按比例分宽后过窄` }
    }
    if (aspectOf(rect) > MAX_ROOM_ASPECT) {
      return { reject: `房间「${room.name}」长宽比超限` }
    }
  }

  // --- carve placement & polygon assembly ---
  const planRooms: LayoutPlanRoom[] = []
  const connections: Array<{ from: string; to: string }> = []
  const carveCorners = new Map<string, Corner>()

  for (const room of [...lowerBand, ...upperBand]) {
    const rect = rectById.get(room.id)!
    const carves = carvesByHost.get(room.id) ?? []
    if (carves.length === 0) {
      planRooms.push(planRoom(room, rectPolygon(rect)))
      continue
    }
    const placed = placeCarves(rect, carves)
    if ('reject' in placed) return placed
    planRooms.push(planRoom(room, rectWithNotches(rect, placed.notches)))
    for (const { room: carve } of carves) {
      const info = placed.rects.get(carve.id)!
      planRooms.push(planRoom(carve, rectPolygon(info.rect)))
      carveCorners.set(carve.id, info.corner)
    }
  }

  // --- corridor room ---
  const corridorId = corridorRoom?.id ?? 'corridor-auto'
  if (corridorNeeded) {
    planRooms.push({
      id: corridorId,
      name: corridorRoom?.name ?? '走廊',
      type: 'hallway',
      polygon: rectPolygon({ x0: 0, z0: zLowerTop, x1: W, z1: zUpperBottom }),
      requiresExteriorWindow: false,
    })
    if (!corridorRoom) notes.push('自动添加贯通走廊作为私密区动线（基础设施）')
    else notes.push(`「${corridorRoom.name}」作为贯通走廊，面积由布局决定`)
  } else if (corridorRoom) {
    // Explicit hallway but no corridor needed — it stayed a normal column.
    if (!rectById.has(corridorRoom.id)) {
      return { reject: '户型无需走廊，但 Intent 中的走廊房间未能布置' }
    }
  }

  // --- connections ---
  const hubRect = rectById.get(hub.id)!
  if (corridorNeeded) {
    connections.push({ from: hub.id, to: corridorId })
    for (const room of privateColumns) connections.push({ from: room.id, to: corridorId })
    for (const room of publicSorted) {
      const rect = rectById.get(room.id)!
      const touchesHub = Math.abs(rect.x1 - hubRect.x0) < 0.01 || Math.abs(rect.x0 - hubRect.x1) < 0.01
      connections.push({ from: room.id, to: touchesHub ? hub.id : corridorId })
    }
    for (const spec of carveSpecs) {
      const corner = carveCorners.get(spec.room.id)
      // A carve on the hub's corridor-side edge opens onto the corridor;
      // everything else (en-suites, entry, embedded kitchen) opens into its
      // host.
      const opensToCorridor = spec.hostId === hub.id && corner?.startsWith('top')
      connections.push({ from: spec.room.id, to: opensToCorridor ? corridorId : spec.hostId })
    }
  } else {
    // Single band: chain each column toward the hub.
    const order = lowerBand
    const hubIndex = order.findIndex(r => r.id === hub.id)
    for (let i = 0; i < order.length; i++) {
      if (i === hubIndex) continue
      const next = i < hubIndex ? order[i + 1]! : order[i - 1]!
      connections.push({ from: order[i]!.id, to: next.id })
    }
    for (const spec of carveSpecs) connections.push({ from: spec.room.id, to: spec.hostId })
  }

  // --- entry room ---
  const entryRoom = others.find(r => r.type === 'entry') ?? hub

  const plan: LayoutPlan = {
    footprint: { width: W, depth: D },
    entry: { roomId: entryRoom.id },
    rooms: planRooms,
    connections: dedupeConnections(connections),
  }

  // --- score ---
  const footprintAspect = Math.max(W, D) / Math.min(W, D)
  let penalty = Math.abs(footprintAspect - 1.35) * 6
  for (const room of [...lowerBand, ...upperBand]) {
    penalty += Math.max(0, aspectOf(rectById.get(room.id)!) - 2.2) * 8
  }
  if (corridorNeeded) {
    const corridorRatio = (corridorD * W) / (W * D)
    penalty += Math.max(0, corridorRatio - 0.15) * 120
  }
  return { plan, penalty, notes }
}

// --- corridor-hub layout (no living/hallway hub in the intent) ---------------
// "多间房且无公共房型时自动补一条走廊作为枢纽" — the corridor itself becomes
// the hub, with rooms split across the two bands either side of it.

function tryCorridorHubLayout(
  intent: LayoutIntent,
  rooms: NormRoom[],
  W: number,
): Attempt {
  const notes: string[] = ['户型无公共房型，自动添加走廊作为动线枢纽（基础设施）']
  const corridorArea = CORRIDOR_WIDTH_M * W
  const roomAreaSum = rooms.reduce((sum, r) => sum + r.area, 0)
  const scale = (intent.targetTotalAreaSqm - corridorArea) / roomAreaSum
  if (scale < 0.7 || scale > 1.6) {
    return { reject: `总面积与房间面积之和不匹配（需整体缩放到 ${Math.round(scale * 100)}%）` }
  }

  // Greedy balanced split into the two bands (largest first, lighter band).
  const sorted = [...rooms].sort((a, b) => b.area - a.area)
  const bands: [NormRoom[], NormRoom[]] = [[], []]
  const bandAreas = [0, 0]
  for (const room of sorted) {
    const target = bandAreas[0]! <= bandAreas[1]! ? 0 : 1
    bands[target]!.push(room)
    bandAreas[target] += room.area * scale
  }

  const dLower = round2(bandAreas[0]! / W)
  const dUpper = round2(bandAreas[1]! / W)
  const zUpperBottom = round2(dLower + CORRIDOR_WIDTH_M)
  const D = round2(zUpperBottom + dUpper)
  if (Math.max(W, D) / Math.min(W, D) > MAX_FOOTPRINT_ASPECT) {
    return { reject: '外轮廓过于狭长' }
  }

  const planRooms: LayoutPlanRoom[] = []
  const connections: Array<{ from: string; to: string }> = []
  const bandRects: Rect[] = [
    { x0: 0, z0: 0, x1: W, z1: dLower },
    { x0: 0, z0: zUpperBottom, x1: W, z1: D },
  ]
  for (const [bandIndex, bandRooms] of bands.entries()) {
    if (bandRooms.length === 0) continue
    const rects = columnRects(bandRooms.map(r => ({ area: r.area * scale })), bandRects[bandIndex]!)
    for (const [i, room] of bandRooms.entries()) {
      const rect = rects[i]!
      if (rect.x1 - rect.x0 < minWidthFor(room.type)) {
        return { reject: `房间「${room.name}」按比例分宽后过窄` }
      }
      if (aspectOf(rect) > MAX_ROOM_ASPECT) {
        return { reject: `房间「${room.name}」长宽比超限` }
      }
      planRooms.push(planRoom(room, rectPolygon(rect)))
      connections.push({ from: room.id, to: 'corridor-auto' })
    }
  }
  planRooms.push({
    id: 'corridor-auto',
    name: '走廊',
    type: 'hallway',
    polygon: rectPolygon({ x0: 0, z0: dLower, x1: W, z1: zUpperBottom }),
    requiresExteriorWindow: false,
  })

  const plan: LayoutPlan = {
    footprint: { width: W, depth: D },
    entry: { roomId: 'corridor-auto' },
    rooms: planRooms,
    connections: dedupeConnections(connections),
  }
  const corridorRatio = corridorArea / (W * D)
  const footprintAspect = Math.max(W, D) / Math.min(W, D)
  const penalty = Math.abs(footprintAspect - 1.35) * 6 + Math.max(0, corridorRatio - 0.15) * 120
  return { plan, penalty, notes }
}

// --- shared helpers -----------------------------------------------------------

function planRoom(room: NormRoom, polygon: Array<[number, number]>): LayoutPlanRoom {
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    polygon,
    requiresExteriorWindow: room.window,
  }
}

function dedupeConnections(
  connections: Array<{ from: string; to: string }>,
): Array<{ from: string; to: string; type: 'door' }> {
  const seen = new Set<string>()
  const result: Array<{ from: string; to: string; type: 'door' }> = []
  for (const { from, to } of connections) {
    if (from === to) continue
    const key = from < to ? `${from}|${to}` : `${to}|${from}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ from, to, type: 'door' })
  }
  return result
}

// Actual polygon area of every room (post-rounding), for reporting.
export function planRoomAreas(plan: LayoutPlan): Map<string, number> {
  return new Map(plan.rooms.map(room => [room.id, polygonArea(room.polygon)]))
}
