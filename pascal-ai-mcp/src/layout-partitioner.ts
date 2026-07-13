// ---------------------------------------------------------------------------
// Deterministic rectangular partitioner: LayoutIntent → LayoutPlan
// (GENERATION_REDESIGN.md §2). Zero model calls.
//
// Band guillotine v1. Entry side is z=0 (bottom):
//
//   z=D ┌──────────────────────────────┐
//       │ private band: bedrooms/study │  ← exterior windows
//       ├──────────────────────────────┤
//       │ corridor (profile width)     │  ← only when ≥2 private rooms
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
  defaultRequiresWindow,
  longestExteriorEdge,
  polygonArea,
  sharedBoundaryLength,
  type IssueL10n,
  type LayoutIntent,
  type LayoutPlan,
  type LayoutPlanRoom,
  type RoomType,
} from './layout-plan'
import {
  DEFAULT_NORM_PROFILE,
  quantizeAreaSqm,
  type NormProfile,
  type PartitionParams,
  type ScoringParams,
} from './norms/profile'

export type PartitionResult =
  | { ok: true; plan: LayoutPlan; notes: string[] }
  // `reason` is the canonical zh text; `l10n` re-renders it per language and
  // `details` carries the top rejection obstacles as separate lines.
  | {
      ok: false
      reason: string
      l10n?: IssueL10n
      details?: Array<{ message: string; l10n?: IssueL10n }>
    }

// Column/carve minimum interior widths by room type.
const SMALL_MIN_WIDTH_TYPES: ReadonlySet<RoomType> = new Set([
  'bathroom', 'storage', 'entry', 'balcony',
])
function minWidthFor(type: RoomType, p: PartitionParams): number {
  return SMALL_MIN_WIDTH_TYPES.has(type) ? p.minRoomWidthSmallM : p.minRoomWidthDefaultM
}

const PRIVATE_TYPES: ReadonlySet<RoomType> = new Set([
  'bedroom', 'study', 'balcony', 'other',
])
const CARVE_TYPES: ReadonlySet<RoomType> = new Set(['bathroom', 'storage', 'entry'])

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
  // Study needs an exterior window — bottom corners sit on the entry-side
  // exterior wall in every hub position this carve is used from.
  study: ['bottom-right', 'bottom-left'],
}

// --- normalization ----------------------------------------------------------

function normalizeRooms(intent: LayoutIntent, profile: NormProfile): NormRoom[] {
  return intent.rooms.map(room => ({
    id: room.id,
    name: room.name,
    type: room.type,
    // J7: target areas snap to the profile's 帖 grid (no-op when off).
    area: quantizeAreaSqm(
      room.targetAreaSqm !== undefined && room.targetAreaSqm > 0
        ? room.targetAreaSqm
        : profile.defaultRoomAreas[room.type],
      profile.areaQuantization,
    ),
    window: room.requiresExteriorWindow ?? defaultRequiresWindow(room.type),
  }))
}

// --- candidate layout construction ------------------------------------------

type Candidate = { plan: LayoutPlan; penalty: number; notes: string[] }
type Reject = { reject: string; l10n?: IssueL10n }
type Attempt = Candidate | Reject

type CarveSpec = { room: NormRoom; hostId: string }

// Places `carves` into `hostRect`, returning notches + carved room rects, or
// a rejection when they don't fit while keeping ≥0.9m of host wall around.
function placeCarves(
  hostRect: Rect,
  carves: Array<{ room: NormRoom; area: number }>,
  p: PartitionParams,
): { notches: Notch[]; rects: Map<string, { rect: Rect; corner: Corner }> } | Reject {
  const hostW = hostRect.x1 - hostRect.x0
  const hostD = hostRect.z1 - hostRect.z0
  const used = new Map<Corner, Notch>()
  const rects = new Map<string, { rect: Rect; corner: Corner }>()
  for (const { room, area } of carves) {
    const minW = minWidthFor(room.type, p)
    // Aim for a slightly-deeper-than-square carve, capped by the host.
    let d = Math.min(Math.max(Math.sqrt(area * 1.2), 1.4), Math.min(2.4, hostD - p.minDoorEdgeM))
    if (d <= 0) {
      return {
        reject: `房间「${room.name}」无法嵌入宿主（宿主进深不足）`,
        l10n: { id: 'planCarveHostTooShallow', params: { room: room.name } },
      }
    }
    let w = area / d
    if (w < minW) {
      w = minW
      d = area / w
    }
    if (d < 1.2 || d > hostD - p.minDoorEdgeM) {
      return {
        reject: `房间「${room.name}」按面积 ${round2(area)}㎡ 嵌入宿主后进深不合理`,
        l10n: { id: 'planCarveDepthUnreasonable', params: { room: room.name, area: round2(area) } },
      }
    }
    if (w > hostW - p.minDoorEdgeM) {
      return {
        reject: `房间「${room.name}」嵌入后宿主剩余宽度不足`,
        l10n: { id: 'planCarveHostWidthInsufficient', params: { room: room.name } },
      }
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
      if (!cornerFits(candidate, used, hostW, hostD, p.minDoorEdgeM)) continue
      used.set(corner, candidate)
      rects.set(room.id, { rect: notchRect(hostRect, candidate), corner })
      placed = true
      break
    }
    if (!placed) {
      return {
        reject: `房间「${room.name}」在宿主的四个角都放不下`,
        l10n: { id: 'planCarveNoCorner', params: { room: room.name } },
      }
    }
  }
  return { notches: [...used.values()], rects }
}

function cornerFits(notch: Notch, used: Map<Corner, Notch>, hostW: number, hostD: number, minDoorEdgeM: number): boolean {
  if (notch.w > hostW - minDoorEdgeM || notch.d > hostD - minDoorEdgeM) return false
  const [vert, horiz] = notch.corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  for (const other of used.values()) {
    const [oVert, oHoriz] = other.corner.split('-') as ['top' | 'bottom', 'left' | 'right']
    // Same horizontal edge (both top / both bottom): widths must leave a gap.
    if (vert === oVert && notch.w + other.w > hostW - minDoorEdgeM) return false
    // Same vertical edge (both left / both right): depths must leave a gap.
    if (horiz === oHoriz && notch.d + other.d > hostD - minDoorEdgeM) return false
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

// Candidate scoring (LAYOUT_STRATEGY_DESIGN.md §3.6) — the one ruler every
// topology's candidates are compared with. Lower is better.
export function scoreCandidate(
  candidate: { footprintW: number; footprintD: number; roomAspects: number[]; corridorRatio: number },
  s: ScoringParams,
): number {
  const { footprintW: w, footprintD: d } = candidate
  const footprintAspect = Math.max(w, d) / Math.min(w, d)
  let penalty = Math.abs(footprintAspect - s.idealFootprintAspect) * s.footprintAspectWeight
  for (const ratio of candidate.roomAspects) {
    penalty += Math.max(0, ratio - s.roomAspectSoft) * s.roomAspectExcessWeight
  }
  penalty += Math.max(0, candidate.corridorRatio - s.corridorShareSoft) * s.corridorShareExcessWeight
  return penalty
}

// --- main entry point ---------------------------------------------------------

// The strategy fields the partitioner consumes (LAYOUT_STRATEGY_DESIGN.md §2
// step ③). StrategyDecision satisfies this structurally; a plain object works
// for tests.
export type PartitionStrategyHint = {
  typology?: 'studio' | 'standard_band' | 'narrow_lot' | 'tanoji' | 'l_shape'
  footprintHint?: { widthM: number; depthM: number }
}

// Modify-path stability (MODIFY_REDESIGN.md §4): lock the footprint width to
// the previous plan's and penalize room-center displacement, so a re-partition
// after an intent edit moves as little as possible.
export type PartitionStability = {
  previousPlan: LayoutPlan
}

// Sum of room-center displacement (m) for rooms present in both plans,
// matched by id. Rooms added/removed by the edit contribute nothing — their
// movement is the point of the edit.
export function planDeviation(plan: LayoutPlan, previous: LayoutPlan): number {
  const centerOf = (polygon: Array<[number, number]>): [number, number] => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const [x, z] of polygon) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    return [(minX + maxX) / 2, (minZ + maxZ) / 2]
  }
  const previousCenters = new Map(previous.rooms.map(room => [room.id, centerOf(room.polygon)]))
  let total = 0
  for (const room of plan.rooms) {
    const prev = previousCenters.get(room.id)
    if (!prev) continue
    const [cx, cz] = centerOf(room.polygon)
    total += Math.hypot(cx - prev[0], cz - prev[1])
  }
  return total
}

export function partitionLayout(
  intent: LayoutIntent,
  profile: NormProfile = DEFAULT_NORM_PROFILE,
  strategy?: PartitionStrategyHint,
  stability?: PartitionStability,
): PartitionResult {
  if (!(intent.targetTotalAreaSqm > 0)) {
    return {
      ok: false,
      reason: 'targetTotalAreaSqm 必须为正数',
      l10n: { id: 'planTotalAreaInvalid', params: {} },
    }
  }
  if (intent.rooms.length === 0) {
    return { ok: false, reason: 'rooms 为空，无法分区', l10n: { id: 'planRoomsEmpty', params: {} } }
  }
  const ids = new Set(intent.rooms.map(r => r.id))
  if (ids.size !== intent.rooms.length) {
    return { ok: false, reason: 'rooms 中存在重复 id', l10n: { id: 'planDuplicateRoomIds', params: {} } }
  }

  const rooms = normalizeRooms(intent, profile)

  if (rooms.length === 1) return singleRoomPlan(intent, rooms[0]!)

  const p = profile.partition
  const s = profile.scoring
  const hub = pickHub(rooms)
  const attempts: Attempt[] = []
  const carveOptions = hub
    ? [false, true]
    : [false]
  // Stability (§4 MODIFY_REDESIGN): the previous footprint width replaces the
  // whole width search — depth alone absorbs the area change.
  const prevW = stability ? stability.previousPlan.footprint.width : null
  const widthCandidates = (lo: number, hi: number, steps: number): number[] => {
    if (prevW !== null) return [prevW]
    const base = Math.sqrt(intent.targetTotalAreaSqm)
    const out: number[] = []
    for (let step = 0; step <= steps; step++) out.push(round2(base * (lo + ((hi - lo) * step) / steps)))
    return out
  }
  if (strategy?.typology === 'narrow_lot' && hub) {
    // Linear topology (§3.2). With a lot hint the footprint is fixed; without
    // one, slender aspect ratios are searched up to the narrow-lot cap.
    // Hub-less narrow lots fall through to the standard path below —
    // corridor-hub is already linear.
    const geometries: Array<{ W: number; D: number }> = []
    const hint = strategy.footprintHint
    if (hint) {
      geometries.push({
        W: round2(Math.min(hint.widthM, hint.depthM)),
        D: round2(Math.max(hint.widthM, hint.depthM)),
      })
    } else if (prevW !== null) {
      geometries.push({ W: prevW, D: round2(intent.targetTotalAreaSqm / prevW) })
    } else {
      const area = intent.targetTotalAreaSqm
      for (let step = 0; step <= 6; step++) {
        const aspect = 2.4 + ((p.maxFootprintAspectNarrowLot - 2.4) * step) / 6
        const depth = Math.sqrt(area * aspect)
        geometries.push({ W: round2(area / depth), D: round2(depth) })
      }
    }
    for (const geo of geometries) {
      for (const carveSmallPublic of carveOptions) {
        attempts.push(tryNarrowLotLayout(intent, rooms, hub, geo.W, geo.D, carveSmallPublic, p, s))
      }
    }
  } else if (strategy?.typology === 'l_shape') {
    // L-shape is a site constraint (§3.2): only L candidates — silently
    // falling back to a rectangle would violate the stated lot. No hub means
    // no L layout; fail explicitly so the correction loop can add one.
    if (!hub) {
      return {
        ok: false,
        reason: 'L 形拓扑需要一间公共枢纽（客厅或一体客餐厨）',
        l10n: { id: 'planLShapeNeedsHub', params: {} },
      }
    }
    // The main wing wants to be wider than a square footprint, so the width
    // search starts higher; wing proportions are searched alongside.
    for (const W of widthCandidates(0.9, 1.5, 8)) {
      for (const wingFrac of [0.35, 0.45, 0.55]) {
        for (const carveSmallPublic of carveOptions) {
          attempts.push(tryLShapeLayout(intent, rooms, hub, W, wingFrac, carveSmallPublic, p, s))
        }
      }
    }
  } else {
    // 田の字 is the preferred topology for its band (§3.2): use it whenever
    // ANY candidate survives, fall back to the band search only when none
    // does — pure score competition would let the band's larger feasible
    // range crowd the preference out every time.
    if (strategy?.typology === 'tanoji' && hub) {
      for (const W of widthCandidates(0.7, 1.5, 32)) {
        attempts.push(tryTanojiLayout(intent, rooms, hub, W, p, s))
      }
    }
    if (!attempts.some(attempt => !('reject' in attempt))) {
      for (const W of widthCandidates(0.7, 1.5, 32)) {
        for (const carveSmallPublic of carveOptions) {
          attempts.push(
            hub
              ? tryBandLayout(intent, rooms, hub, W, carveSmallPublic, p, s)
              : tryCorridorHubLayout(intent, rooms, W, p, s),
          )
        }
      }
    }
  }

  let best: Candidate | null = null
  let bestPenalty = Infinity
  const rejectCounts = new Map<string, { count: number; l10n?: IssueL10n }>()
  for (const attempt of attempts) {
    if ('reject' in attempt) {
      const entry = rejectCounts.get(attempt.reject)
      if (entry) entry.count++
      else rejectCounts.set(attempt.reject, { count: 1, l10n: attempt.l10n })
      continue
    }
    // §4 mechanism 2: the candidate that moves existing rooms least wins.
    const penalty = attempt.penalty
      + (stability ? planDeviation(attempt.plan, stability.previousPlan) * s.deviationWeight : 0)
    if (penalty < bestPenalty) {
      best = attempt
      bestPenalty = penalty
    }
  }
  if (!best && stability) {
    // 做不到时不硬凑（§4）：the locked footprint has no feasible layout for
    // the edited intent — rerun unconstrained and say so, instead of failing
    // a change that a fresh footprint could absorb.
    const relaxed = partitionLayout(intent, profile, strategy)
    if (relaxed.ok) {
      const note = '稳定性约束下无可行布局，已放开外轮廓重新排布（房间位置会有明显变化）'
      return {
        ok: true,
        plan: { ...relaxed.plan, notes: [...(relaxed.plan.notes ?? []), note] },
        notes: [...relaxed.notes, note],
      }
    }
    return relaxed
  }
  if (!best) {
    const topReasons = [...rejectCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
    return {
      ok: false,
      reason: `在 ${intent.targetTotalAreaSqm}㎡ 内找不到满足最小宽度/长宽比约束的布局，主要障碍如下。`
        + '建议：增大总面积、减少房间数量，或调低个别房间的目标面积。',
      l10n: { id: 'planPartitionInfeasible', params: { totalArea: intent.targetTotalAreaSqm } },
      details: topReasons.map(([message, entry]) => ({
        message,
        ...(entry.l10n ? { l10n: entry.l10n } : {}),
      })),
    }
  }
  const notes = [...best.notes]
  for (const pair of intent.adjacency ?? []) {
    const a = best.plan.rooms.find(r => r.id === pair.a)
    const b = best.plan.rooms.find(r => r.id === pair.b)
    if (a && b && sharedBoundaryLength(a.polygon, b.polygon) < p.minDoorEdgeM) {
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

// Carve assignment shared by the band and narrow-lot topologies: first
// bathroom into the hub (door onto circulation), extra bathrooms as en-suites
// of the biggest bedrooms, storage/entry into the hub, and — when enabled —
// small kitchen/dining embedded into the hub.
function assignCarves(
  others: NormRoom[],
  hub: NormRoom,
  carveSmallPublic: boolean,
  p: PartitionParams,
): { carveSpecs: CarveSpec[]; notes: string[] } {
  const notes: string[] = []
  const carveSpecs: CarveSpec[] = []
  const bedroomsByArea = [...others.filter(r => r.type === 'bedroom')].sort((a, b) => b.area - a.area)
  const ensuiteHosts = new Set<string>()
  let bathIndex = 0
  for (const room of others) {
    if (room.type === 'bathroom') {
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
      // Small study included (M2): "在客厅里划一间书房" (eval case-13) is a
      // hub carve by definition — as a full-depth private column a ~7㎡ study
      // is always too narrow, which would force a footprint change on every
      // such modify.
      && (room.type === 'kitchen' || room.type === 'dining' || room.type === 'study')
      && room.area <= p.carveablePublicMaxSqm
    ) {
      carveSpecs.push({ room, hostId: hub.id })
      notes.push(`「${room.name}」以开放/嵌入形式并入「${hub.name}」一侧`)
    }
  }
  return { carveSpecs, notes }
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
  p: PartitionParams,
  s: ScoringParams,
): Attempt {
  const others = rooms.filter(r => r.id !== hub.id)
  const privates = others.filter(r => PRIVATE_TYPES.has(r.type))
  const corridorRoom = others.find(r => r.type === 'hallway') ?? null
  const corridorNeeded = privates.length >= 2

  const { carveSpecs, notes } = assignCarves(others, hub, carveSmallPublic, p)
  const carvedIds = new Set(carveSpecs.map(c => c.room.id))

  const publicColumns = others.filter(r =>
    !carvedIds.has(r.id) && !PRIVATE_TYPES.has(r.type) && r.id !== corridorRoom?.id,
  )
  const privateColumns = privates.filter(r => !carvedIds.has(r.id))

  // --- area scaling to hit the total ---
  const corridorArea = corridorNeeded ? p.corridorWidthM * W : 0
  const roomAreaSum = rooms.reduce((sum, r) => sum + r.area, 0)
    - (corridorNeeded && corridorRoom ? corridorRoom.area : 0)
  const scale = (intent.targetTotalAreaSqm - corridorArea) / roomAreaSum
  if (scale < 0.7 || scale > 1.6) {
    return {
      reject: `总面积与房间面积之和不匹配（需整体缩放到 ${Math.round(scale * 100)}%）`,
      l10n: { id: 'planAreaScaleMismatch', params: { scalePercent: Math.round(scale * 100) } },
    }
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
  const corridorD = corridorNeeded ? p.corridorWidthM : 0
  const zLowerTop = dLower
  const zUpperBottom = round2(dLower + corridorD)
  const D = round2(zUpperBottom + dUpper)
  if (Math.max(W, D) / Math.min(W, D) > p.maxFootprintAspect) {
    return { reject: '外轮廓过于狭长', l10n: { id: 'planFootprintTooSlender', params: {} } }
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
    if (width < minWidthFor(room.type, p)) {
      return {
        reject: `房间「${room.name}」按比例分宽后过窄`,
        l10n: { id: 'planRoomTooNarrow', params: { room: room.name } },
      }
    }
    if (aspectOf(rect) > p.maxRoomAspect) {
      return {
        reject: `房间「${room.name}」长宽比超限`,
        l10n: { id: 'planRoomAspectExceeded', params: { room: room.name } },
      }
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
    const placed = placeCarves(rect, carves, p)
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
      return {
        reject: '户型无需走廊，但 Intent 中的走廊房间未能布置',
        l10n: { id: 'planCorridorUnplaceable', params: {} },
      }
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
  // 入户优先级：玄关 > 走廊 > 公共枢纽（客厅）。入户门应该开在动线空间，
  // 而不是把客厅的外墙当大门；只有户型里没有动线空间、或候选房间够不着
  // ≥0.9m 的外墙边时才逐级回退到客厅。
  const footprintSize = { width: W, depth: D }
  const canHostEntryDoor = (roomId: string): boolean => {
    const polygon = planRooms.find(room => room.id === roomId)?.polygon
    return polygon !== undefined && longestExteriorEdge(polygon, footprintSize) >= p.minDoorEdgeM
  }
  const entryCandidates = [
    others.find(r => r.type === 'entry')?.id,
    corridorNeeded ? corridorId : corridorRoom?.id,
    hub.id,
  ].filter((id): id is string => Boolean(id))
  const entryRoomId = entryCandidates.find(canHostEntryDoor) ?? hub.id

  const plan: LayoutPlan = {
    footprint: { width: W, depth: D },
    entry: { roomId: entryRoomId },
    rooms: planRooms,
    connections: dedupeConnections(connections),
  }

  // --- score ---
  const penalty = scoreCandidate({
    footprintW: W,
    footprintD: D,
    roomAspects: [...lowerBand, ...upperBand].map(room => aspectOf(rectById.get(room.id)!)),
    corridorRatio: corridorNeeded ? (corridorD * W) / (W * D) : 0,
  }, s)
  return { plan, penalty, notes }
}

// --- narrow-lot linear layout (S3, LAYOUT_STRATEGY_DESIGN.md §3.2) -----------
// Lot short side W across x, long side D along z. The hub (LDK/living) sits
// full-width at the entry end (z=0) with service rooms carved in; the other
// rooms stack along the depth — publics first so the kitchen keeps the wet
// zone near the hub, privates toward the quiet far end — served by a
// longitudinal corridor strip on the right side. With ≤1 stacked room the
// corridor is skipped and the room connects to the hub directly.

function tryNarrowLotLayout(
  intent: LayoutIntent,
  rooms: NormRoom[],
  hub: NormRoom,
  W: number,
  D: number,
  carveSmallPublic: boolean,
  p: PartitionParams,
  s: ScoringParams,
): Attempt {
  if (Math.max(W, D) / Math.min(W, D) > p.maxFootprintAspectNarrowLot) {
    return { reject: '外轮廓过于狭长', l10n: { id: 'planFootprintTooSlender', params: {} } }
  }
  const others = rooms.filter(r => r.id !== hub.id)
  const { carveSpecs, notes } = assignCarves(others, hub, carveSmallPublic, p)
  notes.unshift('狭长地块：线性拓扑，房间沿长边排布')
  const carvedIds = new Set(carveSpecs.map(c => c.room.id))
  const corridorRoom = others.find(r => r.type === 'hallway') ?? null

  const stackable = others.filter(r => !carvedIds.has(r.id) && r.id !== corridorRoom?.id)
  const stacked = [
    ...stackable.filter(r => !PRIVATE_TYPES.has(r.type) && r.type === 'kitchen'),
    ...stackable.filter(r => !PRIVATE_TYPES.has(r.type) && r.type !== 'kitchen'),
    ...stackable.filter(r => PRIVATE_TYPES.has(r.type)),
  ]
  const corridorNeeded = stacked.length >= 2
  const stackW = corridorNeeded ? round2(W - p.corridorWidthM) : W
  if (corridorNeeded && stackW < p.minRoomWidthDefaultM) {
    return {
      reject: '狭长地块扣除走廊后房间宽度不足',
      l10n: { id: 'planNarrowLotWidthInsufficient', params: {} },
    }
  }

  // Column areas (room + its carves), then the uniform scale that makes rooms
  // plus corridor fill W×D exactly. The corridor runs from the hub's top edge
  // to the far end, so its area depends on the (scaled) hub depth:
  //   scale·(hubCol + stackedCols) + corrW·(D − scale·hubCol/W) = W·D
  const carvesByHost = new Map<string, NormRoom[]>()
  for (const spec of carveSpecs) {
    const list = carvesByHost.get(spec.hostId) ?? []
    list.push(spec.room)
    carvesByHost.set(spec.hostId, list)
  }
  const colArea = (room: NormRoom) =>
    room.area + (carvesByHost.get(room.id) ?? []).reduce((sum, r) => sum + r.area, 0)
  const hubCol = colArea(hub)
  const stackedCols = stacked.reduce((sum, r) => sum + colArea(r), 0)
  const scale = corridorNeeded
    ? (W * D - p.corridorWidthM * D) / (hubCol + stackedCols - (p.corridorWidthM * hubCol) / W)
    : (W * D) / (hubCol + stackedCols)
  if (scale < 0.7 || scale > 1.6) {
    return {
      reject: `总面积与房间面积之和不匹配（需整体缩放到 ${Math.round(scale * 100)}%）`,
      l10n: { id: 'planAreaScaleMismatch', params: { scalePercent: Math.round(scale * 100) } },
    }
  }
  if (Math.abs(scale - 1) > 0.25) {
    notes.push(`房间面积整体缩放 ${Math.round(scale * 100)}% 以匹配地块 ${round2(W * D)}㎡`)
  }

  // --- geometry ---
  const hubD = round2((scale * hubCol) / W)
  const rectById = new Map<string, Rect>()
  rectById.set(hub.id, { x0: 0, z0: 0, x1: W, z1: hubD })
  let z = hubD
  for (let i = 0; i < stacked.length; i++) {
    const room = stacked[i]!
    const z1 = i === stacked.length - 1 ? D : round2(z + (scale * colArea(room)) / stackW)
    rectById.set(room.id, { x0: 0, z0: z, x1: stackW, z1 })
    z = z1
  }

  // Stacked segments fail by being too shallow, not too narrow — check the
  // short dimension, not just the column width.
  for (const room of [hub, ...stacked]) {
    const rect = rectById.get(room.id)!
    const minSide = Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0)
    if (minSide < minWidthFor(room.type, p)) {
      return {
        reject: `房间「${room.name}」按比例分宽后过窄`,
        l10n: { id: 'planRoomTooNarrow', params: { room: room.name } },
      }
    }
    if (aspectOf(rect) > p.maxRoomAspect) {
      return {
        reject: `房间「${room.name}」长宽比超限`,
        l10n: { id: 'planRoomAspectExceeded', params: { room: room.name } },
      }
    }
  }

  // --- carve placement & polygon assembly ---
  const planRooms: LayoutPlanRoom[] = []
  const connections: Array<{ from: string; to: string }> = []
  for (const room of [hub, ...stacked]) {
    const rect = rectById.get(room.id)!
    const carves = (carvesByHost.get(room.id) ?? []).map(r => ({ room: r, area: scale * r.area }))
    if (carves.length === 0) {
      planRooms.push(planRoom(room, rectPolygon(rect)))
      continue
    }
    const placed = placeCarves(rect, carves, p)
    if ('reject' in placed) return placed
    planRooms.push(planRoom(room, rectWithNotches(rect, placed.notches)))
    for (const { room: carve } of carves) {
      planRooms.push(planRoom(carve, rectPolygon(placed.rects.get(carve.id)!.rect)))
      // Every carve opens into its host: the corridor strip only borders part
      // of the hub's top edge, so corner-based "opens to corridor" from the
      // band layout doesn't transfer.
      connections.push({ from: carve.id, to: room.id })
    }
  }

  // --- corridor & connections ---
  const corridorId = corridorRoom?.id ?? 'corridor-auto'
  if (corridorNeeded) {
    planRooms.push({
      id: corridorId,
      name: corridorRoom?.name ?? '走廊',
      type: 'hallway',
      polygon: rectPolygon({ x0: stackW, z0: hubD, x1: W, z1: D }),
      requiresExteriorWindow: false,
    })
    notes.push(corridorRoom
      ? `「${corridorRoom.name}」作为纵向走廊，面积由布局决定`
      : '自动添加纵向走廊作为动线（基础设施）')
    connections.push({ from: hub.id, to: corridorId })
    for (const room of stacked) connections.push({ from: room.id, to: corridorId })
  } else {
    if (corridorRoom) {
      return {
        reject: '户型无需走廊，但 Intent 中的走廊房间未能布置',
        l10n: { id: 'planCorridorUnplaceable', params: {} },
      }
    }
    for (const room of stacked) connections.push({ from: room.id, to: hub.id })
  }

  // --- entry room (same priority as band: 玄关 > 走廊 > 枢纽) ---
  const footprintSize = { width: W, depth: D }
  const canHostEntryDoor = (roomId: string): boolean => {
    const polygon = planRooms.find(room => room.id === roomId)?.polygon
    return polygon !== undefined && longestExteriorEdge(polygon, footprintSize) >= p.minDoorEdgeM
  }
  const entryCandidates = [
    others.find(r => r.type === 'entry')?.id,
    corridorNeeded ? corridorId : undefined,
    hub.id,
  ].filter((id): id is string => Boolean(id))
  const entryRoomId = entryCandidates.find(canHostEntryDoor) ?? hub.id

  const plan: LayoutPlan = {
    footprint: { width: W, depth: D },
    entry: { roomId: entryRoomId },
    rooms: planRooms,
    connections: dedupeConnections(connections),
  }
  const corridorArea = corridorNeeded ? p.corridorWidthM * (D - hubD) : 0
  const penalty = scoreCandidate({
    footprintW: W,
    footprintD: D,
    roomAspects: [hub, ...stacked].map(room => aspectOf(rectById.get(room.id)!)),
    corridorRatio: corridorArea / (W * D),
  }, s)
  return { plan, penalty, notes }
}

// --- 田の字 layout (S4) -------------------------------------------------------
// The dominant Japanese apartment plan: 玄関 into a central vertical corridor,
// wing rooms on both sides, LDK full-width at the far end (windows on three
// sides). A PREFERENCE topology — its candidates compete with the band ones
// on the shared scorer.
//
//   z=D ┌─────────────────────────┐
//       │        LDK (hub)        │
//       ├────────┬─────┬──────────┤
//       │ wing L │ 廊  │ wing R   │  cells stacked per side, service low
//       │ wing L2│ 下  │ wing R2  │
//       ├────────┤     ├──────────┤
//   z=0 └────────┴玄関─┴──────────┘  entry door at the corridor's street end
function tryTanojiLayout(
  intent: LayoutIntent,
  rooms: NormRoom[],
  hub: NormRoom,
  W: number,
  p: PartitionParams,
  s: ScoringParams,
): Attempt {
  const others = rooms.filter(r => r.id !== hub.id)
  const corridorRoom = others.find(r => r.type === 'hallway') ?? null
  const entryRoom = others.find(r => r.type === 'entry') ?? null
  const sideRooms = others.filter(r => r.id !== corridorRoom?.id && r.id !== entryRoom?.id)
  if (sideRooms.length < 2) {
    return { reject: '田の字拓扑需要至少两间侧翼房间', l10n: { id: 'planTanojiTooFewRooms', params: {} } }
  }
  const corrW = p.corridorWidthM
  const usable = round2(W - corrW)
  if (usable < 2 * p.minRoomWidthDefaultM) {
    return { reject: '外轮廓过于狭长', l10n: { id: 'planFootprintTooSlender', params: {} } }
  }

  // Greedy area balance into the two wings (largest first, lighter wing).
  const sorted = [...sideRooms].sort((a, b) => b.area - a.area)
  const wings: [NormRoom[], NormRoom[]] = [[], []]
  const wingAreas = [0, 0]
  for (const room of sorted) {
    const target = wingAreas[0]! <= wingAreas[1]! ? 0 : 1
    wings[target]!.push(room)
    wingAreas[target]! += room.area
  }
  const sidesSum = wingAreas[0]! + wingAreas[1]!

  // Total = scale·hub (full-width top) + full-width wing band below it, whose
  // depth is set by the scaled wing areas over the usable (non-corridor)
  // width. The entry cell lives inside the corridor column.
  const scale = intent.targetTotalAreaSqm / (hub.area + (sidesSum * W) / usable)
  if (scale < 0.7 || scale > 1.6) {
    return {
      reject: `总面积与房间面积之和不匹配（需整体缩放到 ${Math.round(scale * 100)}%）`,
      l10n: { id: 'planAreaScaleMismatch', params: { scalePercent: Math.round(scale * 100) } },
    }
  }
  const sideD = round2((scale * sidesSum) / usable)
  const hubD = round2((scale * hub.area) / W)
  const D = round2(sideD + hubD)
  if (Math.max(W, D) / Math.min(W, D) > p.maxFootprintAspect) {
    return { reject: '外轮廓过于狭长', l10n: { id: 'planFootprintTooSlender', params: {} } }
  }
  const entryD = entryRoom ? round2((scale * entryRoom.area) / corrW) : 0
  if (entryRoom && entryD < 0.9) {
    return { reject: '玄关占用后中央走廊长度不足', l10n: { id: 'planTanojiCorridorTooShort', params: {} } }
  }
  if (sideD - entryD < 1.2) {
    return { reject: '玄关占用后中央走廊长度不足', l10n: { id: 'planTanojiCorridorTooShort', params: {} } }
  }

  const leftW = round2((usable * wingAreas[0]!) / sidesSum)
  const xCorr0 = leftW
  const xCorr1 = round2(leftW + corrW)
  const rectById = new Map<string, Rect>()
  rectById.set(hub.id, { x0: 0, z0: sideD, x1: W, z1: D })
  // Per wing: service rooms at the bottom (near the entry), private on top
  // (near the hub); depths proportional, last cell pinned to sideD.
  const wingBounds: Array<[number, number]> = [[0, xCorr0], [xCorr1, W]]
  for (const [wingIndex, wingRooms] of wings.entries()) {
    const [x0, x1] = wingBounds[wingIndex]!
    const ordered = [
      ...wingRooms.filter(r => !PRIVATE_TYPES.has(r.type)),
      ...wingRooms.filter(r => PRIVATE_TYPES.has(r.type)),
    ]
    const colW = x1 - x0
    let z = 0
    for (let i = 0; i < ordered.length; i++) {
      const room = ordered[i]!
      const z1 = i === ordered.length - 1 ? sideD : round2(z + (scale * room.area) / colW)
      rectById.set(room.id, { x0, z0: z, x1, z1 })
      z = z1
    }
  }
  if (entryRoom) rectById.set(entryRoom.id, { x0: xCorr0, z0: 0, x1: xCorr1, z1: entryD })

  // Wing cells fail by being too shallow as often as too narrow — check the
  // short side, like the narrow-lot stack. The 玄関 cell only skips the
  // min-WIDTH check (its width IS the corridor width; a 0.9–1.2m 玄関 is
  // standard) — its aspect ratio is still enforced below.
  if (entryRoom && entryD / corrW > p.maxRoomAspect) {
    return {
      reject: `房间「${entryRoom.name}」长宽比超限`,
      l10n: { id: 'planRoomAspectExceeded', params: { room: entryRoom.name } },
    }
  }
  for (const room of [hub, ...sideRooms]) {
    const rect = rectById.get(room.id)!
    const minSide = Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0)
    if (minSide < minWidthFor(room.type, p)) {
      return {
        reject: `房间「${room.name}」按比例分宽后过窄`,
        l10n: { id: 'planRoomTooNarrow', params: { room: room.name } },
      }
    }
    if (aspectOf(rect) > p.maxRoomAspect) {
      return {
        reject: `房间「${room.name}」长宽比超限`,
        l10n: { id: 'planRoomAspectExceeded', params: { room: room.name } },
      }
    }
  }

  const notes: string[] = ['田の字拓扑：中央縦走廊、尽头 LDK']
  const planRooms: LayoutPlanRoom[] = []
  const connections: Array<{ from: string; to: string }> = []
  for (const room of [hub, ...sideRooms, ...(entryRoom ? [entryRoom] : [])]) {
    planRooms.push(planRoom(room, rectPolygon(rectById.get(room.id)!)))
  }
  const corridorId = corridorRoom?.id ?? 'corridor-auto'
  planRooms.push({
    id: corridorId,
    name: corridorRoom?.name ?? '走廊',
    type: 'hallway',
    polygon: rectPolygon({ x0: xCorr0, z0: entryD, x1: xCorr1, z1: sideD }),
    requiresExteriorWindow: false,
  })
  notes.push(corridorRoom
    ? `「${corridorRoom.name}」作为中央走廊，面积由布局决定`
    : '自动添加中央走廊作为动线（基础设施）')
  connections.push({ from: hub.id, to: corridorId })
  // The corridor column only spans z∈[entryD, sideD]; a SERVICE cell sitting
  // beside the 玄関 (below entryD) opens into the 玄関 instead — walking
  // through the genkan to a bathroom is normal in tight plans, but private
  // rooms (bedroom/study) must reach the corridor proper.
  for (const room of sideRooms) {
    const rect = rectById.get(room.id)!
    const corridorOverlap = Math.min(rect.z1, sideD) - Math.max(rect.z0, entryD)
    if (corridorOverlap >= p.minDoorEdgeM) {
      connections.push({ from: room.id, to: corridorId })
    } else if (
      entryRoom
      && !PRIVATE_TYPES.has(room.type)
      && Math.min(rect.z1, entryD) - rect.z0 >= p.minDoorEdgeM
    ) {
      connections.push({ from: room.id, to: entryRoom.id })
    } else {
      return {
        reject: `房间「${room.name}」够不着中央走廊或玄关，无法开门`,
        l10n: { id: 'planTanojiCellUnreachable', params: { room: room.name } },
      }
    }
  }
  if (entryRoom) connections.push({ from: entryRoom.id, to: corridorId })

  const footprintSize = { width: W, depth: D }
  const canHostEntryDoor = (roomId: string): boolean => {
    const polygon = planRooms.find(room => room.id === roomId)?.polygon
    return polygon !== undefined && longestExteriorEdge(polygon, footprintSize) >= p.minDoorEdgeM
  }
  const entryCandidates = [entryRoom?.id, corridorId, hub.id]
    .filter((id): id is string => Boolean(id))
  const entryRoomId = entryCandidates.find(canHostEntryDoor) ?? hub.id

  const plan: LayoutPlan = {
    footprint: { width: W, depth: D },
    entry: { roomId: entryRoomId },
    rooms: planRooms,
    connections: dedupeConnections(connections),
  }
  const penalty = scoreCandidate({
    footprintW: W,
    footprintD: D,
    roomAspects: [hub, ...sideRooms].map(room => aspectOf(rectById.get(room.id)!)),
    corridorRatio: (corrW * (sideD - entryD)) / (W * D),
  }, s)
  return { plan, penalty, notes }
}

// --- L-shape layout (S5) ------------------------------------------------------
// Two rectangular wings: the main wing (bottom, full width W×Da) holds the hub
// at its LEFT end plus the public columns, with bathroom/storage/entry carved
// into the hub; the side wing (top-left, Wb×Db) stacks the private rooms, with
// its own corridor strip on the inner edge when it holds ≥2 rooms. The
// footprint carries the true L polygon (LayoutFootprint.polygon).
//
//   z=D ┌────────┬─┐
//       │ bed B2 │廊│            wing B (x∈[0,Wb])
//       │ bed B1 │下│
//    Da ├────────┴─┴───────────┐
//       │ HUB(LDK) │ k │ dining│  main wing (z∈[0,Da])
//   z=0 └──────────┴───┴───────┘
function tryLShapeLayout(
  intent: LayoutIntent,
  rooms: NormRoom[],
  hub: NormRoom,
  W: number,
  wingFrac: number,
  carveSmallPublic: boolean,
  p: PartitionParams,
  s: ScoringParams,
): Attempt {
  const others = rooms.filter(r => r.id !== hub.id)
  const corridorRoom = others.find(r => r.type === 'hallway') ?? null
  const { carveSpecs, notes } = assignCarves(others, hub, carveSmallPublic, p)
  notes.unshift('L 形拓扑：主翼公区 + 侧翼私区')
  const carvedIds = new Set(carveSpecs.map(c => c.room.id))
  const wingRooms = others.filter(r =>
    !carvedIds.has(r.id) && r.id !== corridorRoom?.id && PRIVATE_TYPES.has(r.type))
  if (wingRooms.length === 0) {
    return { reject: 'L 形拓扑需要至少一间侧翼房间', l10n: { id: 'planLShapeTooFewRooms', params: {} } }
  }
  const mainColumns = others.filter(r =>
    !carvedIds.has(r.id) && r.id !== corridorRoom?.id && !PRIVATE_TYPES.has(r.type))

  const corridorNeeded = wingRooms.length >= 2
  const corrW = corridorNeeded ? p.corridorWidthM : 0
  const Wb = round2(W * wingFrac)
  const stackWb = round2(Wb - corrW)
  if (stackWb < p.minRoomWidthDefaultM) {
    return { reject: 'L 形侧翼的宽度或深度不合理', l10n: { id: 'planLShapeWingInfeasible', params: {} } }
  }

  const carvesByHost = new Map<string, NormRoom[]>()
  for (const spec of carveSpecs) {
    const list = carvesByHost.get(spec.hostId) ?? []
    list.push(spec.room)
    carvesByHost.set(spec.hostId, list)
  }
  const colArea = (room: NormRoom) =>
    room.area + (carvesByHost.get(room.id) ?? []).reduce((sum, r) => sum + r.area, 0)
  const mainSum = colArea(hub) + mainColumns.reduce((sum, r) => sum + colArea(r), 0)
  const wingSum = wingRooms.reduce((sum, r) => sum + colArea(r), 0)

  // target = scale·(main + wing) + corridor strip (corrW × Db, Db from the
  // scaled wing areas over the stack width).
  const scale = intent.targetTotalAreaSqm
    / (mainSum + wingSum * (1 + (corridorNeeded ? corrW / stackWb : 0)))
  if (scale < 0.7 || scale > 1.6) {
    return {
      reject: `总面积与房间面积之和不匹配（需整体缩放到 ${Math.round(scale * 100)}%）`,
      l10n: { id: 'planAreaScaleMismatch', params: { scalePercent: Math.round(scale * 100) } },
    }
  }
  const Da = round2((scale * mainSum) / W)
  const Db = round2((scale * wingSum) / stackWb)
  const D = round2(Da + Db)
  if (Da < 1.8 || Db < 1.5) {
    return { reject: 'L 形侧翼的宽度或深度不合理', l10n: { id: 'planLShapeWingInfeasible', params: {} } }
  }
  if (Math.max(W, D) / Math.min(W, D) > p.maxFootprintAspect) {
    return { reject: '外轮廓过于狭长', l10n: { id: 'planFootprintTooSlender', params: {} } }
  }

  // Main wing: hub leftmost (the side wing sits above it), publics rightward.
  const rectById = new Map<string, Rect>()
  const mainRects = columnRects(
    [hub, ...mainColumns].map(room => ({ area: colArea(room) })),
    { x0: 0, z0: 0, x1: W, z1: Da },
  )
  ;[hub, ...mainColumns].forEach((room, i) => rectById.set(room.id, mainRects[i]!))
  const hubRect = rectById.get(hub.id)!
  // The wing (incl. its corridor strip) must sit fully above the hub so the
  // corridor's bottom edge opens into it.
  if (hubRect.x1 - hubRect.x0 < Wb) {
    return { reject: 'L 形侧翼的宽度或深度不合理', l10n: { id: 'planLShapeWingInfeasible', params: {} } }
  }
  // Wing stack: private rooms bottom-up, last pinned to D.
  let z = Da
  for (let i = 0; i < wingRooms.length; i++) {
    const room = wingRooms[i]!
    const z1 = i === wingRooms.length - 1 ? D : round2(z + (scale * colArea(room)) / stackWb)
    rectById.set(room.id, { x0: 0, z0: z, x1: stackWb, z1 })
    z = z1
  }

  for (const room of [hub, ...mainColumns, ...wingRooms]) {
    const rect = rectById.get(room.id)!
    const minSide = Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0)
    if (minSide < minWidthFor(room.type, p)) {
      return {
        reject: `房间「${room.name}」按比例分宽后过窄`,
        l10n: { id: 'planRoomTooNarrow', params: { room: room.name } },
      }
    }
    if (aspectOf(rect) > p.maxRoomAspect) {
      return {
        reject: `房间「${room.name}」长宽比超限`,
        l10n: { id: 'planRoomAspectExceeded', params: { room: room.name } },
      }
    }
  }

  // --- carve placement & polygon assembly ---
  const planRooms: LayoutPlanRoom[] = []
  const connections: Array<{ from: string; to: string }> = []
  for (const room of [hub, ...mainColumns, ...wingRooms]) {
    const rect = rectById.get(room.id)!
    const carves = (carvesByHost.get(room.id) ?? []).map(r => ({ room: r, area: scale * r.area }))
    if (carves.length === 0) {
      planRooms.push(planRoom(room, rectPolygon(rect)))
      continue
    }
    const placed = placeCarves(rect, carves, p)
    if ('reject' in placed) return placed
    planRooms.push(planRoom(room, rectWithNotches(rect, placed.notches)))
    for (const { room: carve } of carves) {
      planRooms.push(planRoom(carve, rectPolygon(placed.rects.get(carve.id)!.rect)))
      connections.push({ from: carve.id, to: room.id })
    }
  }

  // Main-wing publics chain toward the hub (leftward neighbor).
  const mainOrder = [hub, ...mainColumns]
  for (let i = 1; i < mainOrder.length; i++) {
    connections.push({ from: mainOrder[i]!.id, to: mainOrder[i - 1]!.id })
  }

  const corridorId = corridorRoom?.id ?? 'corridor-auto'
  if (corridorNeeded) {
    planRooms.push({
      id: corridorId,
      name: corridorRoom?.name ?? '走廊',
      type: 'hallway',
      polygon: rectPolygon({ x0: stackWb, z0: Da, x1: Wb, z1: D }),
      requiresExteriorWindow: false,
    })
    notes.push(corridorRoom
      ? `「${corridorRoom.name}」作为侧翼走廊，面积由布局决定`
      : '自动添加侧翼走廊作为动线（基础设施）')
    connections.push({ from: hub.id, to: corridorId })
    for (const room of wingRooms) connections.push({ from: room.id, to: corridorId })
  } else {
    if (corridorRoom) {
      return {
        reject: '户型无需走廊，但 Intent 中的走廊房间未能布置',
        l10n: { id: 'planCorridorUnplaceable', params: {} },
      }
    }
    // Single wing room opens straight into the hub across the junction edge.
    connections.push({ from: wingRooms[0]!.id, to: hub.id })
  }

  const footprint = {
    width: W,
    depth: D,
    polygon: [[0, 0], [W, 0], [W, Da], [Wb, Da], [Wb, D], [0, D]] as Array<[number, number]>,
  }
  const canHostEntryDoor = (roomId: string): boolean => {
    const polygon = planRooms.find(room => room.id === roomId)?.polygon
    return polygon !== undefined && longestExteriorEdge(polygon, footprint) >= p.minDoorEdgeM
  }
  const entryCandidates = [
    others.find(r => r.type === 'entry')?.id,
    corridorNeeded ? corridorId : undefined,
    hub.id,
  ].filter((id): id is string => Boolean(id))
  const entryRoomId = entryCandidates.find(canHostEntryDoor) ?? hub.id

  const plan: LayoutPlan = {
    footprint,
    entry: { roomId: entryRoomId },
    rooms: planRooms,
    connections: dedupeConnections(connections),
  }
  const lArea = W * Da + Wb * Db
  const penalty = scoreCandidate({
    footprintW: W,
    footprintD: D,
    roomAspects: [hub, ...mainColumns, ...wingRooms].map(room => aspectOf(rectById.get(room.id)!)),
    corridorRatio: corridorNeeded ? (corrW * Db) / lArea : 0,
  }, s)
  return { plan, penalty, notes }
}

// --- corridor-hub layout (no living/hallway hub in the intent) ---------------
// "多间房且无公共房型时自动补一条走廊作为枢纽" — the corridor itself becomes
// the hub, with rooms split across the two bands either side of it.

function tryCorridorHubLayout(
  intent: LayoutIntent,
  rooms: NormRoom[],
  W: number,
  p: PartitionParams,
  s: ScoringParams,
): Attempt {
  const notes: string[] = ['户型无公共房型，自动添加走廊作为动线枢纽（基础设施）']
  const corridorArea = p.corridorWidthM * W
  const roomAreaSum = rooms.reduce((sum, r) => sum + r.area, 0)
  const scale = (intent.targetTotalAreaSqm - corridorArea) / roomAreaSum
  if (scale < 0.7 || scale > 1.6) {
    return {
      reject: `总面积与房间面积之和不匹配（需整体缩放到 ${Math.round(scale * 100)}%）`,
      l10n: { id: 'planAreaScaleMismatch', params: { scalePercent: Math.round(scale * 100) } },
    }
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
  const zUpperBottom = round2(dLower + p.corridorWidthM)
  const D = round2(zUpperBottom + dUpper)
  if (Math.max(W, D) / Math.min(W, D) > p.maxFootprintAspect) {
    return { reject: '外轮廓过于狭长', l10n: { id: 'planFootprintTooSlender', params: {} } }
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
      if (rect.x1 - rect.x0 < minWidthFor(room.type, p)) {
        return {
          reject: `房间「${room.name}」按比例分宽后过窄`,
          l10n: { id: 'planRoomTooNarrow', params: { room: room.name } },
        }
      }
      if (aspectOf(rect) > p.maxRoomAspect) {
        return {
          reject: `房间「${room.name}」长宽比超限`,
          l10n: { id: 'planRoomAspectExceeded', params: { room: room.name } },
        }
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
  const penalty = scoreCandidate({
    footprintW: W,
    footprintD: D,
    roomAspects: [],
    corridorRatio: corridorArea / (W * D),
  }, s)
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
