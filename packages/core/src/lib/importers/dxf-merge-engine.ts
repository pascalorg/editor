// Pure TypeScript — no UI, no React, no Node.js-only APIs.

import type { ClosedRegion, CoordsJSON, OpeningRecord, WallRecord } from './dxf-geometry-parser'
import type { MergedFurniture } from './madori-furniture-converter'

export type { MergedFurniture }

// ─── Channel B input types (SemanticJSON) ─────────────────────────────────────

export type SemanticRoom = {
  name: string
  center: [number, number] // image-relative 0–1, y-down
  approxAreaM2: number
  confidence: number
}

export type SemanticOpening = {
  type: 'door' | 'window' | 'sliding_door' | 'opening'
  location: [number, number] // image-relative 0–1, y-down
  facing?: 'north' | 'south' | 'east' | 'west'
  confidence: number
}

export type SemanticWallType = {
  location: [number, number] // image-relative 0–1, y-down
  type: 'exterior' | 'interior' | 'load_bearing'
  confidence: number
}

export type SemanticJSON = {
  valid: boolean
  reason?: string
  confidence: number
  rooms: SemanticRoom[]
  openings: SemanticOpening[]
  wallTypes: SemanticWallType[]
  warnings: string[]
}

// ─── Merge output types ───────────────────────────────────────────────────────

export type WallKind = 'exterior' | 'interior' | 'load_bearing'

export type MergedWall = {
  kind: 'wall'
  id: string
  start: [number, number]
  end: [number, number]
  thickness: number
  height: number
  wallType: WallKind | null
  layerName?: string
  needsReview: boolean
  importWarning?: string
}

export type MergedOpening = {
  kind: 'door' | 'window' | 'unresolved'
  id: string
  wallId: string
  positionAlongWall: number // 0–1
  width: number
  height: number
  confidence: number
  source: 'channel_a' | 'channel_b' | 'madori'
}

export type MergedZone = {
  kind: 'zone'
  id: string
  polygon: Array<[number, number]>
  name?: string
  approxAreaM2?: number
}

export type MergeResult = {
  walls: MergedWall[]
  openings: MergedOpening[]
  zones: MergedZone[]
  furniture: MergedFurniture[]
  warnings: string[]
}

// ─── Geometry helpers (local — avoids coupling to geometry-parser internals) ──

const R3 = (v: number) => Math.round(v * 1000) / 1000

function ptDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
}

function projectOnSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { t: number; x: number; y: number; dist: number } {
  const dx = bx - ax,
    dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return { t: 0, x: ax, y: ay, dist: ptDist(px, py, ax, ay) }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const cx = ax + t * dx,
    cy = ay + t * dy
  return { t, x: cx, y: cy, dist: ptDist(px, py, cx, cy) }
}

function perpDistToLine(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-9) return ptDist(px, py, ax, ay)
  return Math.abs((px - ax) * dy - (py - ay) * dx) / len
}

function segLen(start: [number, number], end: [number, number]): number {
  return ptDist(start[0], start[1], end[0], end[1])
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(px: number, py: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

// ─── Coordinate conversion: Channel B (image-relative) → world metres ─────────

/**
 * Channel B uses top-left=(0,0) / bottom-right=(1,1), y-down.
 * World uses y-up, so Y is flipped.
 */
export function toWorldCoords(
  rel: [number, number],
  bbox: CoordsJSON['bbox'],
): [number, number] {
  const x = R3(rel[0] * (bbox.maxX - bbox.minX) + bbox.minX)
  const y = R3((1 - rel[1]) * (bbox.maxY - bbox.minY) + bbox.minY)
  return [x, y]
}

// ─── Channel-A-only passthrough ───────────────────────────────────────────────

function aWallsToMerged(walls: WallRecord[]): MergedWall[] {
  return walls.map(w => ({
    kind: 'wall' as const,
    id: w.id,
    start: w.start,
    end: w.end,
    thickness: w.thickness,
    height: w.height,
    wallType: null,
    layerName: w.layerName,
    needsReview: false,
  }))
}

function aOpeningsToMerged(openings: OpeningRecord[]): MergedOpening[] {
  return openings.map(o => ({
    kind: o.type,
    id: o.id,
    wallId: o.wallId,
    positionAlongWall: o.positionAlongWall,
    width: o.width,
    height: o.height,
    confidence: o.confidence,
    source: 'channel_a' as const,
  }))
}

function regionsToZones(regions: ClosedRegion[]): MergedZone[] {
  return regions.map((r, i) => ({
    kind: 'zone' as const,
    id: `z_${String(i + 1).padStart(3, '0')}`,
    polygon: r.polygon,
  }))
}

function buildChannelAOnly(coords: CoordsJSON, warnings: string[]): MergeResult {
  return {
    walls:     aWallsToMerged(coords.walls),
    openings:  aOpeningsToMerged(coords.openings),
    zones:     regionsToZones(coords.closedRegions),
    furniture: [],
    warnings,
  }
}

// ─── RULE 1: B confirms A wall — attach wallType to nearest A wall ─────────────

function applyRule1(
  walls: MergedWall[],
  bWallTypes: SemanticWallType[],
  convert: (rel: [number, number]) => [number, number],
): void {
  for (const bwt of bWallTypes) {
    const [rx, ry] = convert(bwt.location)
    let best: MergedWall | null = null
    let bestDist = 1.0 // 1 m threshold

    for (const w of walls) {
      const d = projectOnSeg(rx, ry, w.start[0], w.start[1], w.end[0], w.end[1]).dist
      if (d < bestDist) {
        bestDist = d
        best = w
      }
    }

    // Attach only if the wall doesn't already have a type (first B annotation wins)
    if (best && !best.wallType) {
      best.wallType = bwt.type
    }
  }
}

// ─── RULE 2: B resolves A ambiguity — drop the weaker of two overlapping walls ─

function wallsAreAmbiguous(
  a: MergedWall,
  b: MergedWall,
): boolean {
  // Nearly parallel (< 15°)
  const angA = Math.atan2(a.end[1] - a.start[1], a.end[0] - a.start[0])
  const angB = Math.atan2(b.end[1] - b.start[1], b.end[0] - b.start[0])
  let diff = Math.abs(angA - angB)
  if (diff > Math.PI) diff = 2 * Math.PI - diff
  if (diff > Math.PI / 2) diff = Math.PI - diff
  if (diff > Math.PI / 12) return false // ≥ 15° → clearly different walls

  // Centrelines within 2× max wall thickness (0.8 m)
  const mx = (b.start[0] + b.end[0]) / 2,
    my = (b.start[1] + b.end[1]) / 2
  if (perpDistToLine(mx, my, a.start[0], a.start[1], a.end[0], a.end[1]) > 0.8) return false

  // Projection overlap > 60% of shorter wall
  const cos = Math.cos(angA),
    sin = Math.sin(angA)
  const proj = (x: number, y: number) => x * cos + y * sin
  const pA = [proj(a.start[0], a.start[1]), proj(a.end[0], a.end[1])].sort((x, y) => x - y)
  const pB = [proj(b.start[0], b.start[1]), proj(b.end[0], b.end[1])].sort((x, y) => x - y)
  const overlap = Math.max(0, Math.min(pA[1]!, pB[1]!) - Math.max(pA[0]!, pB[0]!))
  const shorter = Math.min(Math.abs(pA[1]! - pA[0]!), Math.abs(pB[1]! - pB[0]!))
  return shorter > 0 && overlap / shorter > 0.6
}

function applyRule2(
  walls: MergedWall[],
  bWallTypes: SemanticWallType[],
  convert: (rel: [number, number]) => [number, number],
): MergedWall[] {
  if (bWallTypes.length === 0) return walls

  const toRemove = new Set<number>()

  for (let i = 0; i < walls.length; i++) {
    if (toRemove.has(i)) continue
    for (let j = i + 1; j < walls.length; j++) {
      if (toRemove.has(j)) continue
      if (!wallsAreAmbiguous(walls[i]!, walls[j]!)) continue

      // Find B evidence (confidence > 0.75) for each candidate
      let bestDistI = Infinity,
        bestDistJ = Infinity
      for (const bwt of bWallTypes) {
        if (bwt.confidence <= 0.75) continue
        const [rx, ry] = convert(bwt.location)
        const di = projectOnSeg(rx, ry, walls[i]!.start[0], walls[i]!.start[1], walls[i]!.end[0], walls[i]!.end[1]).dist
        const dj = projectOnSeg(rx, ry, walls[j]!.start[0], walls[j]!.start[1], walls[j]!.end[0], walls[j]!.end[1]).dist
        if (di < bestDistI) bestDistI = di
        if (dj < bestDistJ) bestDistJ = dj
      }

      // If B clearly prefers one, drop the other
      if (bestDistI !== Infinity || bestDistJ !== Infinity) {
        if (bestDistI < bestDistJ) {
          toRemove.add(j)
        } else if (bestDistJ < bestDistI) {
          toRemove.add(i)
          break // i is gone; move to next i
        }
      }
    }
  }

  return walls.filter((_, idx) => !toRemove.has(idx))
}

// ─── RULE 3: B finds opening A missed — add new opening ──────────────────────

function wallPointAt(w: MergedWall, t: number): [number, number] {
  return [
    R3(w.start[0] + (w.end[0] - w.start[0]) * t),
    R3(w.start[1] + (w.end[1] - w.start[1]) * t),
  ]
}

function nearestWallTo(
  px: number,
  py: number,
  walls: MergedWall[],
  maxDist: number,
): { wallId: string; t: number } | null {
  let best: { wallId: string; t: number; dist: number } | null = null
  for (const w of walls) {
    const r = projectOnSeg(px, py, w.start[0], w.start[1], w.end[0], w.end[1])
    if (!best || r.dist < best.dist) best = { wallId: w.id, t: r.t, dist: r.dist }
  }
  if (!best) return null
  const b = best as { wallId: string; t: number; dist: number }
  return b.dist <= maxDist ? { wallId: b.wallId, t: b.t } : null
}

function applyRule3(
  aOpenings: OpeningRecord[],
  bOpenings: SemanticOpening[],
  walls: MergedWall[],
  convert: (rel: [number, number]) => [number, number],
): MergedOpening[] {
  const result: MergedOpening[] = aOpeningsToMerged(aOpenings)
  let extraId = 0

  for (const bo of bOpenings) {
    if (bo.confidence < 0.6) continue
    const [rx, ry] = convert(bo.location)

    // Skip if A already has an opening within 0.3 m
    const alreadyCovered = result.some(ao => {
      const w = walls.find(w => w.id === ao.wallId)
      if (!w) return false
      const [wx, wy] = wallPointAt(w, ao.positionAlongWall)
      return ptDist(rx, ry, wx, wy) < 0.3
    })
    if (alreadyCovered) continue

    const hit = nearestWallTo(rx, ry, walls, 0.3)
    if (!hit) continue

    const kind: MergedOpening['kind'] =
      bo.type === 'door' || bo.type === 'sliding_door'
        ? 'door'
        : bo.type === 'window'
          ? 'window'
          : 'unresolved'

    extraId++
    result.push({
      kind,
      id: `o_b${String(extraId).padStart(3, '0')}`,
      wallId: hit.wallId,
      positionAlongWall: R3(hit.t),
      width: kind === 'door' ? 0.9 : 1.2,
      height: kind === 'door' ? 2.1 : 1.2,
      confidence: bo.confidence,
      source: 'channel_b',
    })
  }

  return result
}

// ─── RULE 4: Room name attachment — zone ← Channel B room centre ──────────────

function applyRule4(
  regions: ClosedRegion[],
  bRooms: SemanticRoom[],
  convert: (rel: [number, number]) => [number, number],
): MergedZone[] {
  const zones = regionsToZones(regions)

  for (const room of bRooms) {
    if (room.confidence < 0.5) continue
    const [rx, ry] = convert(room.center)
    const zone = zones.find(z => pointInPolygon(rx, ry, z.polygon))
    if (zone) {
      zone.name = room.name
      if (room.approxAreaM2 > 0) zone.approxAreaM2 = room.approxAreaM2
    }
  }

  return zones
}

// ─── RULE 5: Conflict detection — flag position mismatches ───────────────────

/**
 * A wall is flagged when Channel B reports a wall-type location that is
 * within 1 m of the wall (meaning B is covering it) but the perpendicular
 * offset exceeds 10% of the wall's own length (B and A disagree on position).
 */
function applyRule5(
  walls: MergedWall[],
  bWallTypes: SemanticWallType[],
  convert: (rel: [number, number]) => [number, number],
): void {
  if (bWallTypes.length === 0) return

  for (const w of walls) {
    const len = segLen(w.start, w.end)
    if (len < 0.05) continue

    let nearestDist = Infinity
    for (const bwt of bWallTypes) {
      const [rx, ry] = convert(bwt.location)
      const d = projectOnSeg(rx, ry, w.start[0], w.start[1], w.end[0], w.end[1]).dist
      if (d < nearestDist) nearestDist = d
    }

    // B is "covering" this wall if within 1 m, but disagrees if dist > 10% of length
    if (nearestDist < 1.0 && nearestDist > len * 0.1) {
      w.needsReview = true
      w.importWarning = 'position_mismatch'
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function mergeDxf(coords: CoordsJSON, semantic: SemanticJSON | null): MergeResult {
  const warnings: string[] = [...coords.warnings]

  if (!semantic) {
    warnings.push('Channel B 不可用，仅使用几何识别结果')
    return buildChannelAOnly(coords, warnings)
  }

  if (!semantic.valid) {
    warnings.push(`Channel B 返回无效结果: ${semantic.reason ?? '未知原因'}`)
    return buildChannelAOnly(coords, warnings)
  }

  warnings.push(...semantic.warnings)

  const convert = (rel: [number, number]) => toWorldCoords(rel, coords.bbox)

  // Build initial MergedWall list from Channel A
  let walls = aWallsToMerged(coords.walls)

  // RULE 1: Attach wall types from Channel B
  applyRule1(walls, semantic.wallTypes, convert)

  // RULE 2: Drop ambiguous duplicates using Channel B evidence
  walls = applyRule2(walls, semantic.wallTypes, convert)

  // RULE 5: Flag walls where B's position disagrees with A by > 10% of length
  applyRule5(walls, semantic.wallTypes, convert)

  // RULE 3: Add openings that Channel B found but Channel A missed
  const openings = applyRule3(coords.openings, semantic.openings, walls, convert)

  // RULE 4: Attach room names to zones from Channel B room centres
  const zones = applyRule4(coords.closedRegions, semantic.rooms, convert)

  return { walls, openings, zones, furniture: [], warnings }
}
