// ---------------------------------------------------------------------------
// Deterministic furniture executor (GENERATION_REDESIGN.md §4, batch C).
//
// Single strategy, zero model calls: for each room, diff the per-type
// required checklist against already-placed items, search the catalog with
// the checklist's fixed terms, then grid-scan wall-adjacent positions until
// one satisfies the same constraints the post-build placement check
// (agent.ts checkFurniturePlacement) enforces — rotated footprint inside the
// room polygon, 8cm gap to other furniture, out of every door's clearance
// rectangle. Candidates are tried smallest-footprint-first (compact variants
// win by construction), so "换更小规格重试" is the loop's normal order, not
// a special case. Whatever still doesn't fit lands in `missing` — reported,
// never silently dropped.
// ---------------------------------------------------------------------------

import { findMissingFurniture, type FurnitureRequirement } from './furniture-checklist'
import { pointInPolygon, polygonArea, type RoomType } from './layout-plan'
import { callWithRetry, type McpCaller } from './scene-executor'

export type FurnitureRoom = {
  id: string
  name: string
  type: RoomType
  polygon: Array<[number, number]>
  // create_room's zone node — the place_item target for floor items.
  zoneId: string | null
}

export type PlacedFurniture = {
  room: string
  label: string
  catalogItemId: string
  itemId: string
  position: [number, number, number]
  rotationY: number
}

export type MissingFurniture = {
  room: string
  label: string
  reason: string
}

export type FurnitureExecutionReport = {
  placed: PlacedFurniture[]
  missing: MissingFurniture[]
  executionIssues: string[]
}

// Same conventions as agent.ts checkFurniturePlacement — an executor output
// that violates its own acceptance check would be a bug, so the constants
// must not drift apart.
// `footprintsIntersect(a, b, gap)` SHRINKS `a` by `gap`: it fires only when
// the boxes interpenetrate deeper than `gap` on both axes. The acceptance
// check (agent.ts, FURNITURE_GAP_M = 0.08) therefore tolerates up to 8cm of
// penetration — but flags exactly-8cm cases or not depending on float noise
// and argument order. The scan must not play at that boundary: it demands a
// real physical separation instead, by EXPANDING the other footprint
// (negative gap) by SCAN_CLEARANCE_M. Anything the scan approves then sits
// strictly clear of every acceptance-check firing condition.
const SCAN_CLEARANCE_M = 0.02
const DOOR_CLEARANCE_DEPTH_M = 0.75
const BOUNDS_SLACK_M = 0.05
// Distance between the item's back and the wall it stands against.
const WALL_BACK_GAP_M = 0.03
// Scan step along each wall edge.
const SCAN_STEP_M = 0.15
// Try at most this many catalog candidates per checklist option.
const MAX_CANDIDATES = 4

type Footprint2D = { minX: number; maxX: number; minZ: number; maxZ: number }

type CatalogCandidate = {
  id: string
  name: string
  dimensions: [number, number, number]
  tags: string[]
}

type DoorWall = {
  start: [number, number]
  end: [number, number]
  openings: Array<{ type: string; position?: [number, number, number]; width?: number }>
}

function isNumberPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && typeof value[1] === 'number'
}

function isNumberTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number')
}

function footprintAt(
  x: number,
  z: number,
  w: number,
  d: number,
  rotationY: number,
): Footprint2D {
  const cos = Math.abs(Math.cos(rotationY))
  const sin = Math.abs(Math.sin(rotationY))
  const halfW = (w * cos + d * sin) / 2
  const halfD = (w * sin + d * cos) / 2
  return { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD }
}

function footprintsIntersect(a: Footprint2D, b: Footprint2D, gap: number): boolean {
  return a.maxX - gap > b.minX && a.minX + gap < b.maxX &&
    a.maxZ - gap > b.minZ && a.minZ + gap < b.maxZ
}

function footprintInsidePolygon(fp: Footprint2D, polygon: Array<[number, number]>): boolean {
  const corners: Array<[number, number]> = [
    [fp.minX + BOUNDS_SLACK_M, fp.minZ + BOUNDS_SLACK_M],
    [fp.maxX - BOUNDS_SLACK_M, fp.minZ + BOUNDS_SLACK_M],
    [fp.maxX - BOUNDS_SLACK_M, fp.maxZ - BOUNDS_SLACK_M],
    [fp.minX + BOUNDS_SLACK_M, fp.maxZ - BOUNDS_SLACK_M],
  ]
  const centerX = (fp.minX + fp.maxX) / 2
  const centerZ = (fp.minZ + fp.maxZ) / 2
  return pointInPolygon(centerX, centerZ, polygon) &&
    corners.every(([x, z]) => pointInPolygon(x, z, polygon))
}

// Door keep-clear rectangles, same construction as checkFurniturePlacement:
// door width (+slack) along the wall × DOOR_CLEARANCE_DEPTH_M on both sides.
export function doorClearances(walls: DoorWall[]): Footprint2D[] {
  const clearances: Footprint2D[] = []
  for (const wall of walls) {
    const [sx, sz] = wall.start
    const [ex, ez] = wall.end
    const axisX = Math.abs(sz - ez) <= 0.05
    const axisZ = Math.abs(sx - ex) <= 0.05
    if (!axisX && !axisZ) continue // diagonal wall — best-effort skip
    for (const opening of wall.openings) {
      if (opening.type !== 'door') continue
      const localX = opening.position?.[0]
      if (typeof localX !== 'number') continue
      const width = opening.width ?? 0.9
      const startCoord = axisX ? sx : sz
      const endCoord = axisX ? ex : ez
      const along = startCoord <= endCoord ? startCoord + localX : startCoord - localX
      const alongLo = along - width / 2 - BOUNDS_SLACK_M
      const alongHi = along + width / 2 + BOUNDS_SLACK_M
      const constant = axisX ? (sz + ez) / 2 : (sx + ex) / 2
      clearances.push(axisX
        ? { minX: alongLo, maxX: alongHi, minZ: constant - DOOR_CLEARANCE_DEPTH_M, maxZ: constant + DOOR_CLEARANCE_DEPTH_M }
        : { minX: constant - DOOR_CLEARANCE_DEPTH_M, maxX: constant + DOOR_CLEARANCE_DEPTH_M, minZ: alongLo, maxZ: alongHi })
    }
  }
  return clearances
}

// Wall-adjacent placement scan. Walks every polygon edge, standing the item
// with its back to the edge and its front facing the room interior, sliding
// along the edge in SCAN_STEP_M increments until every constraint passes.
// Deterministic: edge order and scan direction are fixed by the polygon.
export function findWallPlacement(options: {
  polygon: Array<[number, number]>
  itemDims: [number, number, number]
  occupied: Footprint2D[]
  keepClear: Footprint2D[]
}): { position: [number, number, number]; rotationY: number } | null {
  const { polygon, itemDims, occupied, keepClear } = options
  const [w, , d] = itemDims
  for (let i = 0; i < polygon.length; i++) {
    const [sx, sz] = polygon[i]!
    const [ex, ez] = polygon[(i + 1) % polygon.length]!
    const dx = ex - sx
    const dz = ez - sz
    const length = Math.hypot(dx, dz)
    if (length < w + 2 * BOUNDS_SLACK_M) continue
    const ux = dx / length
    const uz = dz / length
    // Interior side: probe both normals from the edge midpoint.
    const probeDist = d / 2 + WALL_BACK_GAP_M + BOUNDS_SLACK_M
    const midX = sx + (dx / 2)
    const midZ = sz + (dz / 2)
    let nx = -uz
    let nz = ux
    if (!pointInPolygon(midX + nx * probeDist, midZ + nz * probeDist, polygon)) {
      nx = uz
      nz = -ux
      if (!pointInPolygon(midX + nx * probeDist, midZ + nz * probeDist, polygon)) continue
    }
    // Item front faces the interior normal (unrotated front assumed +z):
    // rotationY turns +z onto (nx, nz).
    const rotationY = Math.atan2(nx, nz)
    const centerOffset = d / 2 + WALL_BACK_GAP_M
    for (let t = w / 2 + BOUNDS_SLACK_M; t <= length - w / 2 - BOUNDS_SLACK_M; t += SCAN_STEP_M) {
      const cx = sx + ux * t + nx * centerOffset
      const cz = sz + uz * t + nz * centerOffset
      const fp = footprintAt(cx, cz, w, d, rotationY)
      if (!footprintInsidePolygon(fp, polygon)) continue
      if (occupied.some(other => footprintsIntersect(fp, other, -SCAN_CLEARANCE_M))) continue
      if (keepClear.some(zone => footprintsIntersect(fp, zone, -SCAN_CLEARANCE_M))) continue
      return { position: [cx, 0, cz], rotationY }
    }
  }
  return null
}

function parseCandidates(payload: Record<string, unknown> | null): CatalogCandidate[] {
  if (!payload || !Array.isArray(payload.results)) return []
  const out: CatalogCandidate[] = []
  for (const entry of payload.results) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    if (typeof value.id !== 'string' || !isNumberTriple(value.dimensions)) continue
    // Only floor-standing items can be wall-scanned onto the slab.
    if (value.attachTo === 'wall' || value.attachTo === 'ceiling') continue
    out.push({
      id: value.id,
      name: typeof value.name === 'string' ? value.name : value.id,
      dimensions: value.dimensions,
      tags: Array.isArray(value.tags) ? value.tags.filter((t): t is string => typeof t === 'string') : [],
    })
  }
  return out
}

// Candidate order: smallest footprint first, compact-tagged breaking ties —
// maximizes placement success, and a failed larger pick automatically falls
// through to a smaller one on the next iteration.
export function rankCandidates(candidates: CatalogCandidate[]): CatalogCandidate[] {
  return [...candidates].sort((a, b) => {
    const areaA = a.dimensions[0] * a.dimensions[2]
    const areaB = b.dimensions[0] * b.dimensions[2]
    if (Math.abs(areaA - areaB) > 1e-6) return areaA - areaB
    const compactA = a.tags.includes('compact') ? 0 : 1
    const compactB = b.tags.includes('compact') ? 0 : 1
    return compactA - compactB
  })
}

async function searchCandidates(
  callMcp: McpCaller,
  requirement: FurnitureRequirement,
  issues: string[],
  beforeCall?: () => void,
): Promise<Array<{ optionLabel: string; candidate: CatalogCandidate }>> {
  const ranked: Array<{ optionLabel: string; candidate: CatalogCandidate }> = []
  const seenIds = new Set<string>()
  for (const option of requirement.options) {
    for (const term of option.searchTerms) {
      const payload = await callWithRetry(
        callMcp,
        'search_assets',
        { query: term },
        issues,
        `检索「${term}」`,
        beforeCall,
      )
      // Keep only results that the checklist's own matcher recognizes as this
      // furniture kind — "床" must not return 床头柜.
      const matches = parseCandidates(payload).filter(candidate => option.match.test(candidate.name))
      for (const candidate of rankCandidates(matches)) {
        if (seenIds.has(candidate.id)) continue
        seenIds.add(candidate.id)
        ranked.push({ optionLabel: option.label, candidate })
      }
      if (matches.length > 0) break // fixed-term list: first productive term wins per option
    }
  }
  return ranked
}

export async function executeFurniturePlan(options: {
  rooms: FurnitureRoom[]
  levelId: string
  callMcp: McpCaller
  beforeCall?: () => void
}): Promise<FurnitureExecutionReport> {
  const { rooms, levelId, callMcp, beforeCall } = options
  const issues: string[] = []
  const placed: PlacedFurniture[] = []
  const missing: MissingFurniture[] = []

  // One walls read for every room's door clearances.
  const wallsPayload = await callWithRetry(callMcp, 'get_walls', { levelId }, issues, '读取墙体清单', beforeCall)
  const walls: DoorWall[] = Array.isArray(wallsPayload?.walls)
    ? wallsPayload.walls.filter((wall: unknown): wall is DoorWall => {
        const value = wall as DoorWall
        return Boolean(value) && isNumberPair(value.start) && isNumberPair(value.end) && Array.isArray(value.openings)
      })
    : []
  const keepClear = doorClearances(walls)

  // Existing items (modify path / idempotent re-runs): they both satisfy
  // checklist requirements and occupy floor space.
  const summaryPayload = await callWithRetry(callMcp, 'get_level_summary', {}, issues, '读取已放置家具', beforeCall)
  const existingItems = Array.isArray(summaryPayload?.items) ? summaryPayload.items : []
  const occupied: Footprint2D[] = []
  const existingByRoom = new Map<string, string[]>()
  for (const entry of existingItems) {
    const item = entry as {
      name?: unknown
      position?: unknown
      rotation?: unknown
      asset?: { dimensions?: unknown; attachTo?: unknown }
    }
    if (!isNumberTriple(item.position)) continue
    if (item.asset?.attachTo === 'wall' || item.asset?.attachTo === 'ceiling') continue
    const position = item.position
    const dims = isNumberTriple(item.asset?.dimensions) ? item.asset.dimensions : [1, 1, 1] as [number, number, number]
    const rotationY = isNumberTriple(item.rotation) ? item.rotation[1] : 0
    occupied.push(footprintAt(position[0], position[2], dims[0], dims[2], rotationY))
    const home = rooms.find(room => pointInPolygon(position[0], position[2], room.polygon))
    if (home && typeof item.name === 'string') {
      existingByRoom.set(home.id, [...(existingByRoom.get(home.id) ?? []), item.name])
    }
  }

  // Larger rooms first: they host the bulky items (beds, sofas), and filling
  // them before bathrooms/corridors never hurts the small rooms' fit.
  const roomsBySize = [...rooms].sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))
  // search_assets results are stable within a run — cache per requirement key.
  const candidateCache = new Map<string, Array<{ optionLabel: string; candidate: CatalogCandidate }>>()

  for (const room of roomsBySize) {
    const requirements = findMissingFurniture(room.type, existingByRoom.get(room.id) ?? [])
    for (const requirement of requirements) {
      let candidates = candidateCache.get(requirement.key)
      if (!candidates) {
        candidates = await searchCandidates(callMcp, requirement, issues, beforeCall)
        candidateCache.set(requirement.key, candidates)
      }
      if (candidates.length === 0) {
        missing.push({ room: room.name, label: requirement.label, reason: '目录中检索不到匹配资产' })
        continue
      }
      let done = false
      for (const { candidate } of candidates.slice(0, MAX_CANDIDATES)) {
        const spot = findWallPlacement({
          polygon: room.polygon,
          itemDims: candidate.dimensions,
          occupied,
          keepClear,
        })
        if (!spot) continue
        const payload = await callWithRetry(
          callMcp,
          'place_item',
          {
            catalogItemId: candidate.id,
            targetNodeId: room.zoneId ?? levelId,
            position: spot.position,
            rotation: spot.rotationY,
          },
          issues,
          `在「${room.name}」放置「${candidate.name}」`,
          beforeCall,
        )
        const itemId = typeof payload?.itemId === 'string' ? payload.itemId : null
        if (!itemId || payload?.status === 'catalog_unavailable') continue
        occupied.push(footprintAt(
          spot.position[0],
          spot.position[2],
          candidate.dimensions[0],
          candidate.dimensions[2],
          spot.rotationY,
        ))
        placed.push({
          room: room.name,
          label: requirement.label,
          catalogItemId: candidate.id,
          itemId,
          position: spot.position,
          rotationY: spot.rotationY,
        })
        done = true
        break
      }
      if (!done) {
        missing.push({
          room: room.name,
          label: requirement.label,
          reason: '所有候选规格都放不进剩余空间（贴墙扫描无合法位置）',
        })
      }
    }
  }

  return { placed, missing, executionIssues: issues }
}
