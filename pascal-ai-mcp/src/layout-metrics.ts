// ---------------------------------------------------------------------------
// Deterministic positive-quality layout metrics.
//
// The diagnostics pipeline (collectDiagnostics in agent.ts) was previously a
// pure negative checklist: no overlaps, no doorless rooms, no isolated
// bedrooms. A layout could pass every one of those and still be a bad floor
// plan — oversized bathroom, corridor eating 20% of the flat, 4:1 sliver
// kitchen (the exact deductions human review kept making on case-03/06).
// This module turns those review criteria into machine-checkable metrics.
//
// Two output channels, deliberately separate:
// - `score` (0–100): every finding deducts, including soft ones. Used for
//   reporting, and later for best-of-N plan selection. Never triggers repair.
// - `issues` (strings): HARD findings only, phrased as repair instructions.
//   These are merged into the repair loop's issue list, so the thresholds are
//   intentionally loose — a borderline room must not burn repair rounds
//   (see the case-02 lesson on unfixable false positives).
//
// Total-area deviation is scored here but NEVER emitted as an issue:
// checkAreaRequirements (agent.ts) already feeds the ±10% total-area check
// into requirementMismatches, and duplicating it would double-count the same
// problem in countAllIssues and the repair prompt.
//
// Self-contained on purpose: structural input types (zones/walls) are
// declared locally and are assignment-compatible with agent.ts's
// ZoneSummary/WallWithOpenings, so both agent.ts and the eval harness can
// call in without import cycles.
// ---------------------------------------------------------------------------

export type MetricsZone = {
  id: string
  name: string
  polygon: Array<[number, number]>
}

export type MetricsWall = {
  id: string
  start: [number, number]
  end: [number, number]
  openings: Array<{ type: string }>
}

export type RoomKind =
  | 'bedroom'
  | 'bathroom'
  | 'kitchen'
  | 'living'
  | 'circulation'
  | 'other'

export type RoomAreaFinding = {
  room: string
  kind: RoomKind
  areaSqm: number
  band: [number, number]
  severity: 'soft' | 'hard'
}

export type AspectFinding = {
  room: string
  ratio: number
  severity: 'soft' | 'hard'
}

export type LayoutQuality = {
  score: number
  totalAreaSqm: number
  circulation: { areaSqm: number; ratio: number }
  // null when the brief has no numeric floor-area target.
  totalAreaDeviation: { targetSqm: number; actualSqm: number; ratio: number } | null
  roomAreaFindings: RoomAreaFinding[]
  aspectFindings: AspectFinding[]
  entryIssues: string[]
  // Hard findings only, phrased as repair instructions. Consumed by
  // countDiagnosticIssues/describeRemainingIssues and the repair prompt.
  issues: string[]
}

// --- thresholds (exported for tests and future plan-validator reuse) -------

export const CIRCULATION_RATIO_SOFT = 0.15
export const CIRCULATION_RATIO_HARD = 0.25
// The structure prompt asks for aspect ratios "不超过约 3:1"; soft matches the
// review bar (2.5), hard sits above the prompt's own bar so the repair loop
// only fires on rooms the prompt already promised not to build.
export const ASPECT_RATIO_SOFT = 2.5
export const ASPECT_RATIO_HARD = 3.2
// Multipliers applied to a room's band before a finding turns hard.
export const BAND_HARD_LOW_FACTOR = 0.6
export const BAND_HARD_HIGH_FACTOR = 1.6
// Mirrors AREA_TOLERANCE_RATIO in agent.ts (generation-side acceptance).
export const TOTAL_AREA_SOFT_RATIO = 0.1

// Reasonable per-room-type area bands (sqm), tiered by total floor area.
// Sources: common CN residential design ranges; deliberately wide — the
// bands exist to catch the grotesque (16㎡ bathroom, 3㎡ bedroom), not to
// enforce taste.
type BandTable = Partial<Record<RoomKind, [number, number]>>

const BANDS_SMALL: BandTable = {
  bedroom: [6, 18],
  bathroom: [2.5, 7],
  kitchen: [3.5, 10],
  living: [10, 32],
}
const BANDS_MEDIUM: BandTable = {
  bedroom: [8, 22],
  bathroom: [3, 9],
  kitchen: [4, 14],
  living: [14, 48],
}
const BANDS_LARGE: BandTable = {
  bedroom: [9, 30],
  bathroom: [3.5, 12],
  kitchen: [5, 20],
  living: [18, 75],
}

export function bandTableForTotalArea(totalAreaSqm: number): BandTable {
  if (totalAreaSqm < 60) return BANDS_SMALL
  if (totalAreaSqm <= 120) return BANDS_MEDIUM
  return BANDS_LARGE
}

// --- room classification ----------------------------------------------------

// Order matters: mixed-function names ("客厅/开放式厨房") must resolve to the
// passable/living reading first — same rationale as
// classifyCirculationRoomKind in agent.ts (case-02 false positive).
export function classifyRoomKind(name: string): RoomKind {
  if (/走廊|过道|corridor|hallway|hall\b|玄关|门厅|entry|foyer/i.test(name)) return 'circulation'
  if (/客厅|起居|living|餐厅|饭厅|dining/i.test(name)) return 'living'
  if (/卧室|bedroom/i.test(name)) return 'bedroom'
  if (/厨房|kitchen/i.test(name)) return 'kitchen'
  if (/卫生间|浴室|洗手间|bathroom/i.test(name)) return 'bathroom'
  return 'other'
}

// --- geometry helpers -------------------------------------------------------

export function polygonArea(polygon: Array<[number, number]>): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

// Bounding-box aspect ratio. Exact for the axis-aligned rectangular rooms the
// structure phase produces; an L-shaped room's bbox can overstate the ratio,
// which is one more reason hard findings use a loose threshold.
export function polygonAspectRatio(polygon: Array<[number, number]>): number {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of polygon) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const width = maxX - minX
  const depth = maxZ - minZ
  if (width <= 0 || depth <= 0) return Infinity
  return Math.max(width, depth) / Math.min(width, depth)
}

const COINCIDENCE_EPSILON_M = 0.05
const MIN_MEANINGFUL_OVERLAP_M = 0.03

type Segment = { start: [number, number]; end: [number, number] }

// Collinear-overlap test between a wall segment and a zone polygon edge.
// Same semantics as agent.ts's segmentsCoverSameLine: parallel, within 5cm of
// the same line, sharing at least 3cm of length.
export function segmentsCoverSameLine(a: Segment, b: Segment): boolean {
  const dax = a.end[0] - a.start[0]
  const daz = a.end[1] - a.start[1]
  const lenA = Math.hypot(dax, daz)
  if (lenA <= MIN_MEANINGFUL_OVERLAP_M) return false
  const ux = dax / lenA
  const uz = daz / lenA
  // Perpendicular distance of both b endpoints from a's line.
  const perp = (px: number, pz: number) =>
    Math.abs((px - a.start[0]) * uz - (pz - a.start[1]) * ux)
  if (perp(...b.start) > COINCIDENCE_EPSILON_M) return false
  if (perp(...b.end) > COINCIDENCE_EPSILON_M) return false
  // 1D overlap of b's projection onto a.
  const proj = (px: number, pz: number) => (px - a.start[0]) * ux + (pz - a.start[1]) * uz
  const t1 = proj(...b.start)
  const t2 = proj(...b.end)
  const lo = Math.max(0, Math.min(t1, t2))
  const hi = Math.min(lenA, Math.max(t1, t2))
  return hi - lo > MIN_MEANINGFUL_OVERLAP_M
}

function wallHostZoneIds(wall: Segment, zones: MetricsZone[]): string[] {
  const hostIds: string[] = []
  for (const zone of zones) {
    for (let i = 0; i < zone.polygon.length; i++) {
      const edge: Segment = {
        start: zone.polygon[i]!,
        end: zone.polygon[(i + 1) % zone.polygon.length]!,
      }
      if (segmentsCoverSameLine(wall, edge)) {
        hostIds.push(zone.id)
        break
      }
    }
  }
  return hostIds
}

// --- entry / reachability ---------------------------------------------------

// A door on a wall bordering exactly one zone leads outside (or to untracked
// space): that's the flat's entry. From those entry zones, every room must be
// reachable through door adjacencies. Zones without any door at all are
// excluded — findDoorlessRooms (agent.ts) already flags them, and reporting
// the same room twice would double-count it in the repair loop.
function findEntryIssues(zones: MetricsZone[], walls: MetricsWall[]): string[] {
  if (zones.length === 0) return []
  const adjacency = new Map<string, Set<string>>()
  const hasDoor = new Set<string>()
  const entryZones = new Set<string>()
  for (const zone of zones) adjacency.set(zone.id, new Set())
  for (const wall of walls) {
    if (!wall.openings.some(o => o.type === 'door')) continue
    const hostIds = wallHostZoneIds(wall, zones)
    for (const id of hostIds) hasDoor.add(id)
    if (hostIds.length === 1) entryZones.add(hostIds[0]!)
    for (let i = 0; i < hostIds.length; i++) {
      for (let j = i + 1; j < hostIds.length; j++) {
        adjacency.get(hostIds[i]!)?.add(hostIds[j]!)
        adjacency.get(hostIds[j]!)?.add(hostIds[i]!)
      }
    }
  }
  if (entryZones.size === 0) {
    return ['整套户型没有任何通向室外的入户门。请在贴近建筑外边界的公共空间（玄关/客厅/走廊）的外墙上加一扇入户门']
  }
  const visited = new Set<string>(entryZones)
  const queue = [...entryZones]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }
  const issues: string[] = []
  for (const zone of zones) {
    if (visited.has(zone.id) || !hasDoor.has(zone.id)) continue
    issues.push(
      `房间「${zone.name || zone.id}」虽然有门，但从入户门出发经由各房间的门无法到达它。请检查它的门是否开在了正确的隔墙上，保证它与公共动线连通`,
    )
  }
  return issues
}

// --- main entry point ---------------------------------------------------------

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function computeLayoutQuality(
  zones: MetricsZone[],
  walls: MetricsWall[],
  options: { targetTotalAreaSqm?: number } = {},
): LayoutQuality {
  const areas = zones.map(zone => ({
    zone,
    kind: classifyRoomKind(zone.name || ''),
    area: polygonArea(zone.polygon),
  }))
  const totalArea = areas.reduce((sum, entry) => sum + entry.area, 0)

  // Circulation share of the floor plate.
  const circulationArea = areas
    .filter(entry => entry.kind === 'circulation')
    .reduce((sum, entry) => sum + entry.area, 0)
  const circulationRatio = totalArea > 0 ? circulationArea / totalArea : 0

  // Per-room area bands, tiered by total area.
  const bands = bandTableForTotalArea(totalArea)
  const roomAreaFindings: RoomAreaFinding[] = []
  for (const entry of areas) {
    const band = bands[entry.kind]
    if (!band) continue
    const [min, max] = band
    if (entry.area >= min && entry.area <= max) continue
    const hard = entry.area < min * BAND_HARD_LOW_FACTOR || entry.area > max * BAND_HARD_HIGH_FACTOR
    roomAreaFindings.push({
      room: entry.zone.name || entry.zone.id,
      kind: entry.kind,
      areaSqm: round1(entry.area),
      band,
      severity: hard ? 'hard' : 'soft',
    })
  }

  // Elongated rooms. Circulation spaces are exempt — corridors are supposed
  // to be long and thin; their cost is captured by the circulation ratio.
  const aspectFindings: AspectFinding[] = []
  for (const entry of areas) {
    if (entry.kind === 'circulation') continue
    const ratio = polygonAspectRatio(entry.zone.polygon)
    if (ratio <= ASPECT_RATIO_SOFT) continue
    aspectFindings.push({
      room: entry.zone.name || entry.zone.id,
      ratio: round1(ratio),
      severity: ratio > ASPECT_RATIO_HARD ? 'hard' : 'soft',
    })
  }

  // Total-area deviation (score only — see module comment).
  const target = options.targetTotalAreaSqm
  const totalAreaDeviation = target !== undefined && target > 0 && totalArea > 0
    ? {
        targetSqm: target,
        actualSqm: round1(totalArea),
        ratio: Math.abs(totalArea - target) / target,
      }
    : null

  const entryIssues = findEntryIssues(zones, walls)

  // --- hard issues, phrased as repair instructions -------------------------
  const issues: string[] = []
  if (circulationRatio > CIRCULATION_RATIO_HARD) {
    issues.push(
      `走廊/玄关等纯通行空间共约 ${round1(circulationArea)}㎡，占总面积 ${Math.round(circulationRatio * 100)}%（上限 ${Math.round(CIRCULATION_RATIO_HARD * 100)}%）。请缩短或取消贯穿式走廊，把通行面积并入客厅等使用空间`,
    )
  }
  for (const finding of roomAreaFindings) {
    if (finding.severity !== 'hard') continue
    const [min, max] = finding.band
    const direction = finding.areaSqm < min ? '过小' : '过大'
    issues.push(
      `房间「${finding.room}」面积 ${finding.areaSqm}㎡，按本户型总面积档位该类型合理区间约为 ${min}–${max}㎡，明显${direction}。请调整该房间边界，${direction === '过大' ? '把多余面积让给相邻空间' : '从相邻空间补足面积'}`,
    )
  }
  for (const finding of aspectFindings) {
    if (finding.severity !== 'hard') continue
    issues.push(
      `房间「${finding.room}」长宽比约 ${finding.ratio}:1，过于狭长。请调整该房间和相邻房间的分界，使其不超过约 3:1`,
    )
  }
  issues.push(...entryIssues)

  // --- score ----------------------------------------------------------------
  let score = 100
  if (circulationRatio > CIRCULATION_RATIO_SOFT) {
    score -= Math.min(30, Math.round((circulationRatio - CIRCULATION_RATIO_SOFT) * 200))
  }
  score -= Math.min(
    25,
    roomAreaFindings.reduce((sum, f) => sum + (f.severity === 'hard' ? 8 : 4), 0),
  )
  score -= Math.min(
    20,
    aspectFindings.reduce((sum, f) => sum + (f.severity === 'hard' ? 8 : 4), 0),
  )
  if (totalAreaDeviation && totalAreaDeviation.ratio > TOTAL_AREA_SOFT_RATIO) {
    score -= Math.min(25, Math.round((totalAreaDeviation.ratio - TOTAL_AREA_SOFT_RATIO) * 150))
  }
  score -= Math.min(30, entryIssues.length * 10)

  return {
    score: Math.max(0, Math.min(100, score)),
    totalAreaSqm: round1(totalArea),
    circulation: { areaSqm: round1(circulationArea), ratio: Math.round(circulationRatio * 1000) / 1000 },
    totalAreaDeviation,
    roomAreaFindings,
    aspectFindings,
    entryIssues,
    issues,
  }
}
