// ---------------------------------------------------------------------------
// Plan-first generation flow, shared foundation (GENERATION_REDESIGN.md §2).
//
// LayoutIntent is what the model outputs: room list + semantics, NO
// coordinates. LayoutPlan is what the deterministic partitioner outputs:
// axis-aligned polygons that exactly tile the footprint, plus the door
// connection graph and the entry room. Door/window positions never appear in
// either schema — the scene executor computes them from wall geometry.
//
// Also home to the geometry helpers shared by the partitioner, the plan
// validator and the completion gates (point-in-polygon, collinear edge
// overlap, vertex-compressed grid union). agent.ts has private copies of
// some of these today; batch B migrates it onto these exports.
// ---------------------------------------------------------------------------

export type RoomType =
  | 'bedroom' | 'living' | 'living_kitchen' | 'dining' | 'kitchen' | 'bathroom'
  | 'study' | 'hallway' | 'entry' | 'storage' | 'balcony' | 'other'

export const ROOM_TYPES: readonly RoomType[] = [
  'bedroom', 'living', 'living_kitchen', 'dining', 'kitchen', 'bathroom',
  'study', 'hallway', 'entry', 'storage', 'balcony', 'other',
]

export type LayoutIntentRoom = {
  id: string
  name: string
  type: RoomType
  targetAreaSqm?: number
  requiresExteriorWindow?: boolean
}

export type LayoutIntent = {
  targetTotalAreaSqm: number
  rooms: LayoutIntentRoom[]
  adjacency?: Array<{ a: string; b: string }>
}

export type LayoutPlanRoom = {
  id: string
  name: string
  type: RoomType
  polygon: Array<[number, number]>
  requiresExteriorWindow: boolean
}

// Template id + params for re-rendering a plan-stage failure in the reply
// language (same pattern as GateFailureL10n; ids live in src/lang/i18n.ts
// ISSUE). The zh message stays canonical for correction prompts.
export type IssueL10n = { id: string; params: Record<string, string | number | boolean> }

// Building outline. `width`/`depth` are always the bounding box; `polygon`
// (batch S5, §10.2) describes a non-rectangular outline — axis-aligned,
// counter-clockwise, tiled exactly by the plan's rooms. Absent = rectangle.
export type LayoutFootprint = {
  width: number
  depth: number
  polygon?: Array<[number, number]>
}

export type LayoutPlan = {
  footprint: LayoutFootprint
  entry: { roomId: string }
  rooms: LayoutPlanRoom[]
  connections: Array<{ from: string; to: string; type: 'door' }>
  notes?: string[]
}

// Per-type default target areas (sqm), used when the intent omits
// targetAreaSqm; the partitioner then scales everything to the total.
export const DEFAULT_ROOM_AREAS: Record<RoomType, number> = {
  bedroom: 12,
  living: 22,
  living_kitchen: 26,
  dining: 8,
  kitchen: 6,
  bathroom: 4,
  study: 8,
  hallway: 6,
  entry: 3.5,
  storage: 3,
  balcony: 4,
  other: 8,
}

const WINDOW_DEFAULT_TYPES: ReadonlySet<RoomType> = new Set([
  'bedroom', 'living', 'living_kitchen', 'study',
])

export function defaultRequiresWindow(type: RoomType): boolean {
  return WINDOW_DEFAULT_TYPES.has(type)
}

// --- intent parsing ---------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function coerceRoomType(value: unknown): RoomType | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return (ROOM_TYPES as readonly string[]).includes(normalized)
    ? normalized as RoomType
    : undefined
}

// Tolerant parse of a model reply that should contain one LayoutIntent JSON
// object: strips code fences / surrounding prose, coerces stringified
// numbers, drops unknown fields, and reports every recoverable defect in
// `errors` so the intent-correction prompt can quote them back.
export function parseLayoutIntent(raw: string | unknown): {
  intent: LayoutIntent | null
  errors: string[]
} {
  const errors: string[] = []
  let data: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.replace(/```(?:json)?/gi, '').trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) {
      return { intent: null, errors: ['回复中找不到 JSON 对象'] }
    }
    try {
      data = JSON.parse(text.slice(start, end + 1))
    } catch (parseError) {
      return {
        intent: null,
        errors: [`JSON 解析失败：${parseError instanceof Error ? parseError.message : String(parseError)}`],
      }
    }
  }
  if (!isRecord(data)) return { intent: null, errors: ['LayoutIntent 必须是 JSON 对象'] }

  const total = coerceNumber(data.targetTotalAreaSqm)
  if (total === undefined || total <= 0) {
    errors.push('targetTotalAreaSqm 缺失或不是正数')
  }

  const roomsRaw = Array.isArray(data.rooms) ? data.rooms : null
  if (!roomsRaw || roomsRaw.length === 0) {
    errors.push('rooms 缺失或为空数组')
    return { intent: null, errors }
  }

  const rooms: LayoutIntentRoom[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < roomsRaw.length; i++) {
    const entry = roomsRaw[i]
    if (!isRecord(entry)) {
      errors.push(`rooms[${i}] 不是对象`)
      continue
    }
    const type = coerceRoomType(entry.type)
    if (!type) {
      errors.push(`rooms[${i}].type「${String(entry.type)}」不在允许的房型枚举内`)
      continue
    }
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `${type}-${i + 1}`
    if (seenIds.has(id)) {
      errors.push(`rooms[${i}].id「${id}」重复，已自动改名`)
      let n = 2
      while (seenIds.has(`${id}-${n}`)) n++
      id = `${id}-${n}`
    }
    seenIds.add(id)
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id
    const targetAreaSqm = coerceNumber(entry.targetAreaSqm)
    if (targetAreaSqm !== undefined && targetAreaSqm <= 0) {
      errors.push(`rooms[${i}].targetAreaSqm 必须为正数，已忽略`)
    }
    rooms.push({
      id,
      name,
      type,
      ...(targetAreaSqm !== undefined && targetAreaSqm > 0 ? { targetAreaSqm } : {}),
      ...(typeof entry.requiresExteriorWindow === 'boolean'
        ? { requiresExteriorWindow: entry.requiresExteriorWindow }
        : {}),
    })
  }
  if (rooms.length === 0) return { intent: null, errors }

  const adjacency: Array<{ a: string; b: string }> = []
  if (Array.isArray(data.adjacency)) {
    for (const pair of data.adjacency) {
      if (isRecord(pair) && typeof pair.a === 'string' && typeof pair.b === 'string'
        && seenIds.has(pair.a) && seenIds.has(pair.b) && pair.a !== pair.b) {
        adjacency.push({ a: pair.a, b: pair.b })
      } else {
        errors.push(`adjacency 中存在无效或引用不存在房间的条目：${JSON.stringify(pair)}`)
      }
    }
  }

  if (total === undefined || total <= 0) return { intent: null, errors }
  return {
    intent: {
      targetTotalAreaSqm: total,
      rooms,
      ...(adjacency.length > 0 ? { adjacency } : {}),
    },
    errors,
  }
}

// --- geometry ---------------------------------------------------------------

export type Segment = { start: [number, number]; end: [number, number] }

export function polygonArea(polygon: Array<[number, number]>): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

export function polygonBounds(polygon: Array<[number, number]>): {
  minX: number; maxX: number; minZ: number; maxZ: number
} {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of polygon) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

// 嵌入式壁橱判定（docs/TEMPLATES.md #9）：这么小/浅的 storage 是壁橱，开平
// 开门既摆不开也不真实——开口用无扇门洞表达，柜门属视觉层。判定与开口下限
// 由 scene-executor（施工）和 plan-validator（#9 门边下限放宽）共享，两侧
// 必须用同一套阈值，否则 validator 会把 executor 能施工的 0.5m 壁橱开口
// 判成 fatal，放宽在正常生成链路中不可达。
export const MINI_CLOSET_MAX_AREA_SQM = 1.5
export const MINI_CLOSET_MAX_DEPTH_M = 0.8
export const MINI_CLOSET_MIN_OPENING_M = 0.5

export function isMiniCloset(room: Pick<LayoutPlanRoom, 'type' | 'polygon'>): boolean {
  if (room.type !== 'storage') return false
  const { minX, maxX, minZ, maxZ } = polygonBounds(room.polygon)
  const minSide = Math.min(maxX - minX, maxZ - minZ)
  return polygonArea(room.polygon) < MINI_CLOSET_MAX_AREA_SQM || minSide < MINI_CLOSET_MAX_DEPTH_M
}

export function pointInPolygon(x: number, z: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

const AXIS_EPSILON = 1e-6
const LINE_EPSILON = 0.02

export function isAxisAligned(polygon: Array<[number, number]>): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    const dx = Math.abs(x1 - x2)
    const dz = Math.abs(z1 - z2)
    if (dx > AXIS_EPSILON && dz > AXIS_EPSILON) return false
    if (dx <= AXIS_EPSILON && dz <= AXIS_EPSILON) return false // zero-length edge
  }
  return true
}

// Length of the collinear overlap between two segments; 0 when they are not
// (nearly) on the same line. Default 2cm tolerance absorbs cm-rounded plan
// coordinates; scene-space callers (walls vs zone edges) pass a looser one.
export function collinearOverlapLength(a: Segment, b: Segment, epsilon = LINE_EPSILON): number {
  const dax = a.end[0] - a.start[0]
  const daz = a.end[1] - a.start[1]
  const lenA = Math.hypot(dax, daz)
  if (lenA < AXIS_EPSILON) return 0
  const ux = dax / lenA
  const uz = daz / lenA
  const perp = (px: number, pz: number) =>
    Math.abs((px - a.start[0]) * uz - (pz - a.start[1]) * ux)
  if (perp(...b.start) > epsilon || perp(...b.end) > epsilon) return 0
  const proj = (px: number, pz: number) => (px - a.start[0]) * ux + (pz - a.start[1]) * uz
  const t1 = proj(...b.start)
  const t2 = proj(...b.end)
  const lo = Math.max(0, Math.min(t1, t2))
  const hi = Math.min(lenA, Math.max(t1, t2))
  return Math.max(0, hi - lo)
}

function polygonEdges(polygon: Array<[number, number]>): Segment[] {
  return polygon.map((point, i) => ({
    start: point,
    end: polygon[(i + 1) % polygon.length]!,
  }))
}

// Total shared boundary length between two polygons (sum of collinear edge
// overlaps). This is the "共享边" the plan validator's ≥0.9m checks measure.
export function sharedBoundaryLength(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): number {
  let total = 0
  for (const edgeA of polygonEdges(a)) {
    for (const edgeB of polygonEdges(b)) {
      total += collinearOverlapLength(edgeA, edgeB)
    }
  }
  // cm 取整：坐标本身是厘米网格，减法的浮点残差（3.6−2.7=0.8999…）会让
  // 0.9m 门边在严格比较里冤枉地差 1e-16（TEMPLATES.md 体检 #1）。
  return roundCm(total)
}

export const roundCm = (value: number): number => Math.round(value * 100) / 100

// Longest single shared straight run between two polygons — where a door can
// actually go, as opposed to the sum of disjoint slivers.
export function longestSharedEdge(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): { length: number; midpoint: [number, number] } {
  let best = 0
  let midpoint: [number, number] = [0, 0]
  for (const edgeA of polygonEdges(a)) {
    for (const edgeB of polygonEdges(b)) {
      const overlap = collinearOverlapSegment(edgeA, edgeB)
      if (overlap && overlap.length > best) {
        best = overlap.length
        midpoint = overlap.midpoint
      }
    }
  }
  return { length: roundCm(best), midpoint }
}

function collinearOverlapSegment(a: Segment, b: Segment, epsilon = LINE_EPSILON): {
  length: number
  midpoint: [number, number]
  segment: Segment
} | null {
  const dax = a.end[0] - a.start[0]
  const daz = a.end[1] - a.start[1]
  const lenA = Math.hypot(dax, daz)
  if (lenA < AXIS_EPSILON) return null
  const ux = dax / lenA
  const uz = daz / lenA
  const perp = (px: number, pz: number) =>
    Math.abs((px - a.start[0]) * uz - (pz - a.start[1]) * ux)
  if (perp(...b.start) > epsilon || perp(...b.end) > epsilon) return null
  const proj = (px: number, pz: number) => (px - a.start[0]) * ux + (pz - a.start[1]) * uz
  const t1 = proj(...b.start)
  const t2 = proj(...b.end)
  const lo = Math.max(0, Math.min(t1, t2))
  const hi = Math.min(lenA, Math.max(t1, t2))
  if (hi - lo <= 0) return null
  const mid = (lo + hi) / 2
  return {
    length: hi - lo,
    midpoint: [a.start[0] + ux * mid, a.start[1] + uz * mid],
    segment: {
      start: [a.start[0] + ux * lo, a.start[1] + uz * lo],
      end: [a.start[0] + ux * hi, a.start[1] + uz * hi],
    },
  }
}

// The actual shared boundary between two polygons, as concrete segments —
// what the completion gates need to decide whether an uncovered (wall-less)
// stretch is wide enough to walk through.
export function sharedBoundarySegments(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
  epsilon = LINE_EPSILON,
): Segment[] {
  const segments: Segment[] = []
  for (const edgeA of polygonEdges(a)) {
    for (const edgeB of polygonEdges(b)) {
      const overlap = collinearOverlapSegment(edgeA, edgeB, epsilon)
      if (overlap && overlap.length > epsilon) segments.push(overlap.segment)
    }
  }
  return segments
}

export function footprintBoundary(footprint: LayoutFootprint): Segment[] {
  if (footprint.polygon) return polygonEdges(footprint.polygon)
  const { width: w, depth: d } = footprint
  return [
    { start: [0, 0], end: [w, 0] },
    { start: [w, 0], end: [w, d] },
    { start: [w, d], end: [0, d] },
    { start: [0, d], end: [0, 0] },
  ]
}

// Ground area of the outline (polygon-aware).
export function footprintArea(footprint: LayoutFootprint): number {
  return footprint.polygon ? polygonArea(footprint.polygon) : footprint.width * footprint.depth
}

// Longest contiguous run of a polygon edge lying on the footprint boundary —
// the wall segment available for a window (validator check #8) or the entry
// door (check #11).
export function longestExteriorEdge(
  polygon: Array<[number, number]>,
  footprint: LayoutFootprint,
): number {
  let best = 0
  for (const edge of polygonEdges(polygon)) {
    for (const boundary of footprintBoundary(footprint)) {
      best = Math.max(best, collinearOverlapLength(boundary, edge))
    }
  }
  return roundCm(best)
}

// Self-intersection test for a simple polygon: any two non-adjacent edges
// crossing, or any two edges overlapping collinearly, invalidates it.
// 1K 豁免（docs/TEMPLATES.md 体检 #2）：日本 1K/1DK 的廊下型キッチン就是
// 全屋唯一动线（玄関→キッチン→居室）——「卧室不得穿过厨房」对这一市场
// 标准形态是错判。仅在「唯一居室 + 无走廊」时把厨房视为可通行空间；家庭
// 户型（≥2 居室或有走廊）规则原样保留。plan-validator #10、completion-gates
// gate-5、agent findIsolatedBedrooms 三份动线检查共用本判定。
// livingLike = living / living_kitchen / dining 数量：这些社交空间存在时，
// 卧室就应该经它们进出——穿厨房仍是坏设计，豁免只给「厨房是唯一动线」的
// 纯 1K（无客厅无 LDK 无餐厅、单居室、无走廊）。1DK/1LDK 不需要豁免：DK/LDK
// 本身就是公共空间，卧室直连即可。
export function kitchenIsCirculation(counts: {
  bedrooms: number
  hallways: number
  livingLike: number
}): boolean {
  return counts.bedrooms === 1 && counts.hallways === 0 && counts.livingLike === 0
}

export function polygonSelfIntersects(polygon: Array<[number, number]>): boolean {
  const edges = polygonEdges(polygon)
  const n = edges.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1)
      const a = edges[i]!
      const b = edges[j]!
      if (!adjacent && segmentsProperlyIntersect(a, b)) return true
      if (collinearOverlapLength(a, b) > LINE_EPSILON * 2 && !adjacent) return true
    }
  }
  return false
}

function orient(p: [number, number], q: [number, number], r: [number, number]): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
}

function segmentsProperlyIntersect(a: Segment, b: Segment): boolean {
  const o1 = orient(a.start, a.end, b.start)
  const o2 = orient(a.start, a.end, b.end)
  const o3 = orient(b.start, b.end, a.start)
  const o4 = orient(b.start, b.end, a.end)
  return o1 * o2 < -AXIS_EPSILON && o3 * o4 < -AXIS_EPSILON
}

// --- vertex-compressed grid analysis ----------------------------------------
//
// Standard trick for axis-aligned layouts: collect every distinct x and z
// coordinate, test each resulting cell's center against every polygon. Exact
// for axis-aligned polygons (no cell straddles an edge), and works for any
// footprint shape — which is why the validator can keep using it when the
// footprint later becomes an L-shaped polygon (batch B).

// Intersection area of two axis-aligned polygons, via the same
// vertex-compressed grid (exact for axis-aligned shapes). Lets the validator
// prove every room lies INSIDE a non-rectangular footprint — the coverage
// check alone can't see a room sitting in the L-notch (union only grows).
export function polygonIntersectionArea(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): number {
  const xs = new Set<number>()
  const zs = new Set<number>()
  for (const polygon of [a, b]) {
    for (const [x, z] of polygon) {
      xs.add(x)
      zs.add(z)
    }
  }
  const xList = [...xs].sort((p, q) => p - q)
  const zList = [...zs].sort((p, q) => p - q)
  let area = 0
  for (let i = 0; i + 1 < xList.length; i++) {
    const cx = (xList[i]! + xList[i + 1]!) / 2
    const cellW = xList[i + 1]! - xList[i]!
    if (cellW < AXIS_EPSILON) continue
    for (let j = 0; j + 1 < zList.length; j++) {
      const cz = (zList[j]! + zList[j + 1]!) / 2
      const cellD = zList[j + 1]! - zList[j]!
      if (cellD < AXIS_EPSILON) continue
      if (pointInPolygon(cx, cz, a) && pointInPolygon(cx, cz, b)) {
        area += cellW * cellD
      }
    }
  }
  return area
}

export type GridAnalysis = {
  unionArea: number
  overlapArea: number
  // Pairwise overlap areas above 1e-4 sqm, keyed "idA|idB" in input order.
  overlapPairs: Map<string, number>
}

export function analyzePolygonGrid(
  polygons: Array<{ id: string; polygon: Array<[number, number]> }>,
  footprint?: { width: number; depth: number },
): GridAnalysis {
  const xs = new Set<number>()
  const zs = new Set<number>()
  for (const { polygon } of polygons) {
    for (const [x, z] of polygon) {
      xs.add(x)
      zs.add(z)
    }
  }
  if (footprint) {
    xs.add(0); xs.add(footprint.width)
    zs.add(0); zs.add(footprint.depth)
  }
  const xList = [...xs].sort((a, b) => a - b)
  const zList = [...zs].sort((a, b) => a - b)

  let unionArea = 0
  let overlapArea = 0
  const overlapPairs = new Map<string, number>()
  for (let i = 0; i + 1 < xList.length; i++) {
    const cx = (xList[i]! + xList[i + 1]!) / 2
    const cellW = xList[i + 1]! - xList[i]!
    if (cellW < AXIS_EPSILON) continue
    for (let j = 0; j + 1 < zList.length; j++) {
      const cz = (zList[j]! + zList[j + 1]!) / 2
      const cellD = zList[j + 1]! - zList[j]!
      if (cellD < AXIS_EPSILON) continue
      const cellArea = cellW * cellD
      const owners: string[] = []
      for (const { id, polygon } of polygons) {
        if (pointInPolygon(cx, cz, polygon)) owners.push(id)
      }
      if (owners.length >= 1) unionArea += cellArea
      if (owners.length >= 2) {
        overlapArea += cellArea
        for (let a = 0; a < owners.length; a++) {
          for (let b = a + 1; b < owners.length; b++) {
            const key = `${owners[a]}|${owners[b]}`
            overlapPairs.set(key, (overlapPairs.get(key) ?? 0) + cellArea)
          }
        }
      }
    }
  }
  for (const [key, area] of overlapPairs) {
    if (area < 1e-4) overlapPairs.delete(key)
  }
  return { unionArea, overlapArea, overlapPairs }
}

// ---------------------------------------------------------------------------
// Union of two adjacent axis-aligned polygons (MODIFY_REDESIGN.md §6 局部删除
// 吸收). Edge-cancellation: split every edge at the combined coordinate
// breakpoints, cancel opposite-direction segment pairs (the shared boundary),
// stitch the remainder into one loop. Returns null whenever the result would
// not be ONE simple polygon — overlapping inputs, point-contact, disjoint,
// or branching boundaries all bail; the caller falls back to re-partition.
// ---------------------------------------------------------------------------

export function unionAdjacentPolygons(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): Array<[number, number]> | null {
  // Key precision must be far tighter than any real wall offset: at 1e-3 a
  // 0.4mm gap/overlap between the two polygons collapses into a "shared"
  // edge and the area check (±0.01㎡) waves the bogus union through. 1e-6
  // only merges genuine float noise.
  const key = (x: number, z: number) => `${x.toFixed(6)},${z.toFixed(6)}`
  const signedArea = (poly: Array<[number, number]>): number => {
    let sum = 0
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i]!
      const [x2, z2] = poly[(i + 1) % poly.length]!
      sum += x1 * z2 - x2 * z1
    }
    return sum / 2
  }
  const ccw = (poly: Array<[number, number]>) => (signedArea(poly) >= 0 ? poly : [...poly].reverse())

  // Collect breakpoints on both axes so shared partial edges split into
  // exactly matching atomic segments.
  const xs = new Set<number>()
  const zs = new Set<number>()
  for (const poly of [a, b]) {
    for (const [x, z] of poly) {
      xs.add(x)
      zs.add(z)
    }
  }
  const xCuts = [...xs].sort((p, q) => p - q)
  const zCuts = [...zs].sort((p, q) => p - q)

  type Segment = { x1: number; z1: number; x2: number; z2: number }
  const segments = new Map<string, Segment>()
  const segKey = (s: Segment) => `${key(s.x1, s.z1)}>${key(s.x2, s.z2)}`

  const addPolygon = (input: Array<[number, number]>): boolean => {
    const poly = ccw(input)
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i]!
      const [x2, z2] = poly[(i + 1) % poly.length]!
      if (Math.abs(x1 - x2) > 1e-6 && Math.abs(z1 - z2) > 1e-6) return false // diagonal edge
      const cuts = Math.abs(x1 - x2) > 1e-6 ? xCuts : zCuts
      const fixed = Math.abs(x1 - x2) > 1e-6 ? null : x1
      const from = fixed === null ? x1 : z1
      const to = fixed === null ? x2 : z2
      const inner = cuts.filter(c => (from < to ? c > from + 1e-9 && c < to - 1e-9 : c < from - 1e-9 && c > to + 1e-9))
      if (from > to) inner.reverse()
      const points = [from, ...inner, to]
      for (let j = 0; j < points.length - 1; j++) {
        const s: Segment = fixed === null
          ? { x1: points[j]!, z1, x2: points[j + 1]!, z2: z1 }
          : { x1: fixed, z1: points[j]!, x2: fixed, z2: points[j + 1]! }
        const reverse = `${key(s.x2, s.z2)}>${key(s.x1, s.z1)}`
        if (segments.has(reverse)) segments.delete(reverse) // shared boundary cancels
        else if (segments.has(segKey(s))) return false // duplicate direction ⇒ overlap
        else segments.set(segKey(s), s)
      }
    }
    return true
  }
  if (!addPolygon(a) || !addPolygon(b)) return null
  if (segments.size === 0) return null

  // Every remaining segment start must be unique for a single simple loop.
  const byStart = new Map<string, Segment>()
  for (const s of segments.values()) {
    const startKey = key(s.x1, s.z1)
    if (byStart.has(startKey)) return null // branching boundary (point contact / hole)
    byStart.set(startKey, s)
  }
  const first = [...segments.values()][0]!
  const loop: Array<[number, number]> = []
  let cursor = first
  for (let i = 0; i <= segments.size; i++) {
    loop.push([cursor.x1, cursor.z1])
    const next = byStart.get(key(cursor.x2, cursor.z2))
    if (!next) return null
    if (next === first) break
    cursor = next
    if (i === segments.size) return null // did not close ⇒ multiple loops
  }
  if (loop.length !== segments.size) return null // leftover segments ⇒ disjoint parts

  // Merge collinear runs.
  const simplified: Array<[number, number]> = []
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length]!
    const curr = loop[i]!
    const next = loop[(i + 1) % loop.length]!
    const collinear = (Math.abs(prev[0] - curr[0]) < 1e-9 && Math.abs(curr[0] - next[0]) < 1e-9)
      || (Math.abs(prev[1] - curr[1]) < 1e-9 && Math.abs(curr[1] - next[1]) < 1e-9)
    if (!collinear) simplified.push(curr)
  }
  if (simplified.length < 4) return null

  // Disjoint polygons cancel nothing — catch by area conservation.
  const total = polygonArea(a) + polygonArea(b)
  if (Math.abs(polygonArea(simplified) - total) > Math.max(0.01, total * 0.001)) return null
  return simplified
}
