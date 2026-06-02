// Pure TypeScript -- no DOM APIs, no Node.js-only imports.
// Runs in browser Web Workers and Next.js server routes.

import type { ClosedRegion, CoordsJSON } from './dxf-geometry-parser'
import type { MergeResult, MergedFurniture, MergedOpening, MergedWall, MergedZone } from './dxf-merge-engine'
import { DEFAULT_FURNITURE_REGISTRY, type RawFurniture3D } from './madori-furniture-converter'

// ===========================================================================
// Lightweight XML helpers (no DOMParser dependency)
// ===========================================================================

function parseAttrs(fragment: string): Record<string, string> {
  const result: Record<string, string> = {}
  const re = /(\w+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fragment)) !== null) result[m[1]!] = m[2]!
  return result
}

/** Find all occurrences of a tag (self-closing or opening), return attribute maps. */
function findElements(xml: string, tag: string): Record<string, string>[] {
  const result: Record<string, string>[] = []
  const re = new RegExp(`<${tag}(\\s[^>]*?)?(?:/>|>)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) result.push(parseAttrs(m[1] ?? ''))
  return result
}

/** Get one attribute value from the first occurrence of a tag. */
function firstAttr(xml: string, tag: string, attr: string, fallback = ''): string {
  const re = new RegExp(`<${tag}(\\s[^>]*?)(?:/>|>)`, 's')
  const m = re.exec(xml)
  return m ? (parseAttrs(m[1] ?? '')[attr] ?? fallback) : fallback
}

/** Extract text content between opening and closing tags. */
function innerText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)
  const m = re.exec(xml)
  return m ? m[1]!.trim() : ''
}

function fa(attrs: Record<string, string>, key: string, fallback = 0): number {
  const v = attrs[key]
  return v !== undefined ? parseFloat(v) : fallback
}

// ===========================================================================
// Coordinate conversion
// 3dMadori XML stores all coordinates in cm. Pascal uses metres.
// ===========================================================================

const CM = 0.01
const R3 = (v: number) => Math.round(v * 1000) / 1000

// ===========================================================================
// Intermediate (raw) types
// ===========================================================================

type Vec2 = [number, number]

type RawWall = {
  startX: number; startY: number   // metres
  endX:   number; endY:   number   // metres
  width:  number                   // wall thickness, metres
  height: number                   // wall height, metres
  wallType: 'interior' | 'exterior' | null
}

type RawOpening = {
  kind:   'door' | 'window'
  posX:   number; posY: number     // world position, metres
  length: number                   // opening width, metres
  height: number                   // opening height, metres
  rotate: number                   // direction, radians
}

type RawText = {
  posX: number; posY: number       // metres
  text: string
}

// ===========================================================================
// XML parsing
// ===========================================================================

function parseXml(xml: string): {
  sceneHigh: number
  walls:     RawWall[]
  openings:  RawOpening[]
  texts:     RawText[]
  furniture: RawFurniture3D[]
} {
  const sceneHigh      = parseFloat(firstAttr(xml, 'SceneHigh', 'value', '300')) * CM
  const defaultThickCm = parseFloat(firstAttr(xml, 'WallThick',  'value', '20'))

  // DXF uses Y-up (north = +Y). Pascal's 3D renderer maps start[1] to THREE.js Z,
  // where +Z = screen-down in the top-down floor-plan view. Negate Y here so that
  // DXF north (up in DXF viewers) becomes screen-up in Pascal, matching user
  // expectations without touching any existing user-created scene data.
  const walls: RawWall[] = findElements(xml, 'WallData').map(a => ({
    startX:   R3( fa(a, 'StartX') * CM),
    startY:   R3(-fa(a, 'StartY') * CM),  // Y negated: DXF north -> Pascal north
    endX:     R3( fa(a, 'EndX')   * CM),
    endY:     R3(-fa(a, 'EndY')   * CM),  // Y negated
    width:    R3(fa(a, 'Width', defaultThickCm) * CM),
    height:   sceneHigh,
    wallType: fa(a, 'Type') === 1 ? 'interior'
            : fa(a, 'Type') === 2 ? 'exterior'
            : null,
  }))

  const openings: RawOpening[] = []

  for (const a of findElements(xml, 'DoorData')) {
    openings.push({
      kind:   'door',
      posX:   R3( fa(a, 'PosX')   * CM),
      posY:   R3(-fa(a, 'PosY')   * CM),  // Y negated
      length: R3(fa(a, 'Length') * CM),
      // The Height field in source XML has a known unit bug (~23 cm after /10).
      // Use the architectural standard for a hinged interior door.
      height: 2.1,
      rotate: -fa(a, 'Rotate'),            // negate rotation angle to match flipped Y
    })
  }

  for (const a of findElements(xml, 'WinData')) {
    openings.push({
      kind:   'window',
      posX:   R3( fa(a, 'PosX')   * CM),
      posY:   R3(-fa(a, 'PosY')   * CM),  // Y negated
      length: R3(fa(a, 'Length') * CM),
      // Same unit bug as doors; use standard residential window height.
      height: 1.2,
      rotate: -fa(a, 'Rotate'),            // negate rotation angle to match flipped Y
    })
  }

  const texts: RawText[] = []
  const textBlock = innerText(xml, 'Text')
  if (textBlock) {
    for (const a of findElements(textBlock, 'TextData')) {
      const t = (a['Text'] ?? '').trim()
      if (t) texts.push({ posX: R3(fa(a, 'PosX') * CM), posY: R3(-fa(a, 'PosY') * CM), text: t })
    }
  }

  const furniture: RawFurniture3D[] = findElements(xml, 'Furniture3D')
    .filter(a => (a['source'] ?? '').length > 0)
    .map(a => ({
      posX:      R3( fa(a, 'PosX')   * CM),
      posY:      R3(-fa(a, 'PosY')   * CM),  // Y negated — same convention as walls
      rotate:    -fa(a, 'Rotate'),            // negate to match Y-flip
      length:    R3(fa(a, 'Length') * CM),
      width:     R3(fa(a, 'Width')  * CM),
      height:    R3(fa(a, 'Height') * CM),
      source:    a['source'] ?? '',
      groupName: a['groupName'] ?? '',
    }))

  return { sceneHigh, walls, openings, texts, furniture }
}

// ===========================================================================
// Geometry helpers
// ===========================================================================

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

function pointInPolygon(px: number, py: number, poly: Vec2[]): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i]!
    const [xj, yj] = poly[j]!
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

// ===========================================================================
// Endpoint snapping
// ===========================================================================

/**
 * Merge wall endpoints within `tol` metres of each other to their cluster
 * centroid. Fixes sub-mm DXF rounding noise so closed-region DFS succeeds.
 */
function snapEndpoints(walls: RawWall[], tol: number): RawWall[] {
  // Collect all endpoints: index 2i = wall i start, 2i+1 = wall i end
  const pts: Vec2[] = walls.flatMap(w => [[w.startX, w.startY], [w.endX, w.endY]] as Vec2[])
  const parent = pts.map((_, i) => i)

  function find(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]! }
    return i
  }

  const tol2 = tol * tol
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i]![0] - pts[j]![0]
      const dy = pts[i]![1] - pts[j]![1]
      if (dx * dx + dy * dy <= tol2) {
        const ri = find(i), rj = find(j)
        if (ri !== rj) parent[ri] = rj
      }
    }
  }

  // Centroid per cluster
  const sum = new Map<number, { sx: number; sy: number; cnt: number }>()
  for (let i = 0; i < pts.length; i++) {
    const r = find(i)
    const c = sum.get(r) ?? { sx: 0, sy: 0, cnt: 0 }
    c.sx += pts[i]![0]; c.sy += pts[i]![1]; c.cnt++
    sum.set(r, c)
  }
  const rep = new Map<number, Vec2>()
  sum.forEach((c, r) => rep.set(r, [R3(c.sx / c.cnt), R3(c.sy / c.cnt)]))

  return walls.map((w, i) => {
    const [sx, sy] = rep.get(find(2 * i))!
    const [ex, ey] = rep.get(find(2 * i + 1))!
    return { ...w, startX: sx, startY: sy, endX: ex, endY: ey }
  })
}

// ===========================================================================
// Opening -> wall mapping
// ===========================================================================

// 3dMadori places opening centres at the wall face, so the perpendicular
// distance from the centre to the wall centreline ~= wall_thickness / 2.
const PARALLEL_DOT_MIN = Math.cos((5 * Math.PI) / 180) // cos 5 deg
const PERP_TOLERANCE   = 0.2  // extra metres beyond half-thickness

/**
 * Find the wall that an opening belongs to.
 * Opening centre must project within the wall segment (t in [-0.1, 1.1]).
 *
 * Note: 3dMadori only exports room-boundary wall segments. Corridor-facing
 * openings that sit on wall extensions not present in the XML will not be
 * matched and are reported as warnings for manual placement.
 */
function findWallForOpening(
  posX: number, posY: number,
  rotate: number,
  walls: RawWall[],
): { wallIdx: number; t: number; localX: number } | null {
  const cosR = Math.cos(rotate)
  const sinR = Math.sin(rotate)
  let best: { wallIdx: number; t: number; localX: number; perpDist: number } | null = null

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!
    const wdx = w.endX - w.startX
    const wdy = w.endY - w.startY
    const wLen = Math.hypot(wdx, wdy)
    if (wLen < 0.1) continue

    if (Math.abs(cosR * (wdx / wLen) + sinR * (wdy / wLen)) < PARALLEL_DOT_MIN) continue

    // Parametric projection onto wall centreline; allow 10 % overshoot at each end
    const t = ((posX - w.startX) * wdx + (posY - w.startY) * wdy) / (wLen * wLen)
    if (t < -0.1 || t > 1.1) continue

    const projX = w.startX + t * wdx
    const projY = w.startY + t * wdy
    const perpDist = dist(posX, posY, projX, projY)
    if (perpDist > w.width / 2 + PERP_TOLERANCE) continue

    if (!best || perpDist < best.perpDist) {
      const tc = Math.max(0, Math.min(1, t))
      best = { wallIdx: i, t: tc, localX: R3(tc * wLen), perpDist }
    }
  }

  return best ?? null
}

// ===========================================================================
// Closed region detection
// ===========================================================================

/**
 * Build a node adjacency graph from wall endpoints and find simple cycles
 * (closed rooms). Walls shorter than `minLen` are excluded from topology so
 * thin door-gap fragments do not prevent room closure.
 *
 * `snapTol` is intentionally larger than the endpoint-snapping step above so
 * it can bridge gaps left by 3dMadori's door-cutting pass (typically 0.6-1.2m).
 * We use a moderate value (0.6m) to close room polygons at door positions
 * without merging endpoints from genuinely separate walls.
 */
function findClosedRegions(
  walls: RawWall[],
  minLen = 0.3,
  snapTol = 0.6,
): ClosedRegion[] {
  const nodes: Vec2[] = []
  const adj = new Map<number, Set<number>>()

  function nodeFor(x: number, y: number): number {
    for (let i = 0; i < nodes.length; i++) {
      if (dist(nodes[i]![0], nodes[i]![1], x, y) <= snapTol) return i
    }
    nodes.push([x, y])
    return nodes.length - 1
  }

  function link(a: number, b: number) {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }

  for (const w of walls) {
    if (dist(w.startX, w.startY, w.endX, w.endY) < minLen) continue
    link(nodeFor(w.startX, w.startY), nodeFor(w.endX, w.endY))
  }

  const regions: ClosedRegion[] = []
  const usedKeys = new Set<string>()

  function dfs(cur: number, start: number, path: number[], depth: number) {
    if (regions.length >= 50 || depth > 16) return
    for (const nb of adj.get(cur) ?? []) {
      if (nb === start && path.length >= 3) {
        const key = [...path].sort((a, b) => a - b).join(',')
        if (!usedKeys.has(key)) {
          usedKeys.add(key)
          regions.push({
            id: `r_${String(regions.length + 1).padStart(3, '0')}`,
            polygon: path.map(id => [nodes[id]![0], nodes[id]![1]] as Vec2),
          })
        }
        return
      }
      if (nb !== path[path.length - 2] && !path.includes(nb)) {
        path.push(nb)
        dfs(nb, start, path, depth + 1)
        path.pop()
      }
    }
  }

  for (const startId of adj.keys()) {
    if (regions.length >= 50) break
    dfs(startId, startId, [startId], 0)
  }

  return regions
}

// ===========================================================================
// Main export
// ===========================================================================

export type MadoriParseOutput = {
  mergeResult: MergeResult
  coords: CoordsJSON
  warnings: string[]
}

/**
 * Parse a 3dMadori /analyze-dxf XML string into a Pascal MergeResult + CoordsJSON.
 * No AI or external services required -- pure geometric conversion.
 *
 * Coordinate system: XML uses cm -- all values divided by 100 to produce metres.
 *
 * Known limitation: the DoorData/WinData Height field in the XML source has a
 * unit bug (~23 cm). We replace it with architectural defaults (door 2.1 m,
 * window 1.2 m). Caller can override per-opening after parsing if needed.
 */
export function parseMadori(xmlString: string): MadoriParseOutput {
  const warnings: string[] = []

  DEFAULT_FURNITURE_REGISTRY.resetSeq()
  const { sceneHigh, walls: rawWalls, openings: rawOpenings, texts, furniture: rawFurniture } = parseXml(xmlString)

  if (rawWalls.length === 0) {
    warnings.push('XML missing WallData -- verify XML is from 3dMadori /analyze-dxf')
    return {
      mergeResult: { walls: [], openings: [], zones: [], furniture: [], warnings },
      coords: { unit: 'm', bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, walls: [], openings: [], closedRegions: [], confidence: 0, warnings },
      warnings,
    }
  }

  // Step 1: snap close endpoints, drop degenerate walls
  const snapped    = snapEndpoints(rawWalls, 0.005)
  const validWalls = snapped.filter(w => dist(w.startX, w.startY, w.endX, w.endY) >= 0.05)
  const dropped    = rawWalls.length - validWalls.length
  if (dropped > 0) warnings.push(`Filtered ${dropped} walls shorter than 5 cm`)

  // Step 2: MergedWall list
  const mergedWalls: MergedWall[] = validWalls.map((w, i) => ({
    kind:        'wall' as const,
    id:          `w_${String(i + 1).padStart(3, '0')}`,
    start:       [w.startX, w.startY] as Vec2,
    end:         [w.endX,   w.endY]   as Vec2,
    thickness:   w.width,
    height:      w.height,
    wallType:    w.wallType,
    layerName:   'MADORI',
    needsReview: false,
  }))

  // Step 3: map openings to walls
  const mergedOpenings: MergedOpening[] = []
  let openingSeq = 0

  for (const o of rawOpenings) {
    const hit = findWallForOpening(o.posX, o.posY, o.rotate, validWalls)
    if (!hit) {
      warnings.push(
        `${o.kind} at (${o.posX.toFixed(2)}, ${o.posY.toFixed(2)}) m -- no matching wall, skipped`,
      )
      continue
    }
    openingSeq++
    mergedOpenings.push({
      kind:              o.kind,
      id:                `o_${String(openingSeq).padStart(3, '0')}`,
      wallId:            mergedWalls[hit.wallIdx]!.id,
      positionAlongWall: hit.t,
      width:             o.length,
      height:            o.height,
      confidence:        0.9,
      source:            'madori',
    })
  }

  const skipped = rawOpenings.length - mergedOpenings.length
  if (skipped > 0) warnings.push(`${skipped} openings had no matching wall (corridor-side openings on unexported wall segments)`)

  // Step 4a: convert Furniture3D elements via registry
  const mergedFurniture: MergedFurniture[] = []
  let furnitureSkipped = 0
  for (const raw of rawFurniture) {
    const result = DEFAULT_FURNITURE_REGISTRY.convert(raw)
    if (result) {
      mergedFurniture.push(result)
    } else {
      furnitureSkipped++
    }
  }
  if (furnitureSkipped > 0) {
    warnings.push(`${furnitureSkipped} furniture items skipped (no Pascal catalog mapping)`)
  }

  // Step 4: closed region detection -> ZoneNodes
  const closedRegions = findClosedRegions(validWalls)

  const mergedZones: MergedZone[] = closedRegions.map((r, i) => {
    const zone: MergedZone = {
      kind:    'zone' as const,
      id:      `z_${String(i + 1).padStart(3, '0')}`,
      polygon: r.polygon,
    }
    // Assign the first text label whose position falls inside the polygon
    for (const t of texts) {
      if (pointInPolygon(t.posX, t.posY, r.polygon)) {
        zone.name = t.text
        break
      }
    }
    return zone
  })

  if (closedRegions.length === 0 && validWalls.length > 0) {
    warnings.push('No closed room regions detected; Zone nodes skipped (add manually)')
  }

  // Step 5: CoordsJSON (bbox for optional GuideNode positioning)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const w of validWalls) {
    minX = Math.min(minX, w.startX, w.endX)
    minY = Math.min(minY, w.startY, w.endY)
    maxX = Math.max(maxX, w.startX, w.endX)
    maxY = Math.max(maxY, w.startY, w.endY)
  }

  const coords: CoordsJSON = {
    unit: 'm',
    bbox: { minX: R3(minX), minY: R3(minY), maxX: R3(maxX), maxY: R3(maxY) },
    walls: mergedWalls.map(w => ({
      id:        w.id,
      start:     w.start as [number, number],
      end:       w.end   as [number, number],
      thickness: w.thickness,
      height:    w.height,
      ...(w.layerName ? { layerName: w.layerName } : {}),
    })),
    openings:      [],     // openings live in mergeResult; not used by buildGraph
    closedRegions,
    confidence:    validWalls.length > 0 ? 0.9 : 0,
    warnings,
  }

  return {
    mergeResult: { walls: mergedWalls, openings: mergedOpenings, zones: mergedZones, furniture: mergedFurniture, warnings },
    coords,
    warnings,
  }
}
