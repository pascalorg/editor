// Runs inside a Web Worker — zero Node.js-only imports.

// ─── Input types (dxf-parser output shape) ────────────────────────────────────

export type DxfHeader = { $INSUNITS?: number; [k: string]: unknown }

// dxf-parser v1.1.2 stores LINE endpoints as vertices[0] and vertices[1],
// NOT as start/end. Both shapes are declared so the null checks below work.
export type DxfRawLine = {
  type: 'LINE'
  layer?: string
  vertices?: Array<{ x: number; y: number; z?: number }>
  /** Legacy alias used by older dxf-parser builds — may be undefined. */
  start?: { x: number; y: number; z?: number }
  end?: { x: number; y: number; z?: number }
}

/** Return the start point of a LINE entity regardless of dxf-parser version. */
function lineStart(l: DxfRawLine): { x: number; y: number } | undefined {
  return l.start ?? l.vertices?.[0]
}

/** Return the end point of a LINE entity regardless of dxf-parser version. */
function lineEnd(l: DxfRawLine): { x: number; y: number } | undefined {
  return l.end ?? l.vertices?.[1]
}

export type DxfRawLwPolyline = {
  type: 'LWPOLYLINE'
  layer?: string
  vertices: Array<{ x: number; y: number }>
  shape?: boolean  // dxf-parser uses `shape` for closed polylines
  closed?: boolean // kept for compatibility
}

export type DxfRawArc = {
  type: 'ARC'
  layer?: string
  center: { x: number; y: number }
  radius: number
  startAngle: number
  endAngle: number
}

export type DxfRawInsert = {
  type: 'INSERT'
  layer?: string
  name: string
  position: { x: number; y: number; z?: number }
}

export type DxfRawEntity =
  | DxfRawLine
  | DxfRawLwPolyline
  | DxfRawArc
  | DxfRawInsert
  | { type: string; layer?: string; [k: string]: unknown }

export type DxfParsed = { header?: DxfHeader; entities: DxfRawEntity[] }

// ─── Output types (CoordsJSON schema — §3.3.6) ────────────────────────────────

export type WallRecord = {
  id: string
  start: [number, number]
  end: [number, number]
  thickness: number
  height: number
  layerName?: string
}

export type OpeningRecord = {
  id: string
  type: 'door' | 'window' | 'unresolved'
  wallId: string
  positionAlongWall: number // 0–1 along wall centreline
  width: number
  height: number
  confidence: number
}

export type ClosedRegion = {
  id: string
  polygon: Array<[number, number]>
}

export type CoordsJSON = {
  unit: 'm'
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  walls: WallRecord[]
  openings: OpeningRecord[]
  closedRegions: ClosedRegion[]
  confidence: number
  warnings: string[]
}

// ─── Layer keyword lists ──────────────────────────────────────────────────────

const WALL_KEYWORDS = ['WALL', '墙', 'A-WALL', '承重墙', '隔墙', 'ARCH-WALL']
const SKIP_KEYWORDS = ['HATCH', 'TEXT', 'DIM', 'ANNO', 'FURNITURE', '家具', '标注']

function isWallLayer(layer: string): boolean {
  const u = layer.toUpperCase()
  return WALL_KEYWORDS.some(k => u.includes(k))
}

function isSkipLayer(layer: string): boolean {
  const u = layer.toUpperCase()
  return SKIP_KEYWORDS.some(k => u.includes(k))
}

// ─── Internal geometry primitives ────────────────────────────────────────────

type Vec2 = [number, number]
type Seg = { x1: number; y1: number; x2: number; y2: number; layer?: string }

const R3 = (v: number) => Math.round(v * 1000) / 1000 // round to 1 mm

function segLen(s: Seg): number {
  const dx = s.x2 - s.x1,
    dy = s.y2 - s.y1
  return Math.sqrt(dx * dx + dy * dy)
}

function segAngle(s: Seg): number {
  return Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
}

function ptDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
}

function perpDistPtToLine(
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

/** Compute intersection of two infinite lines. Returns null if parallel. */
function lineIntersect(
  ax1: number,
  ay1: number,
  ax2: number,
  ay2: number,
  bx1: number,
  by1: number,
  bx2: number,
  by2: number,
): Vec2 | null {
  const dax = ax2 - ax1,
    day = ay2 - ay1
  const dbx = bx2 - bx1,
    dby = by2 - by1
  const denom = dax * dby - day * dbx
  if (Math.abs(denom) < 1e-9) return null
  const t = ((bx1 - ax1) * dby - (by1 - ay1) * dbx) / denom
  return [R3(ax1 + t * dax), R3(ay1 + t * day)]
}

/** Projection overlap of two segments onto the direction of a. */
function projOverlap(a: Seg, b: Seg): number {
  const angle = segAngle(a),
    cos = Math.cos(angle),
    sin = Math.sin(angle)
  const p = (s: Seg) => {
    const p1 = s.x1 * cos + s.y1 * sin,
      p2 = s.x2 * cos + s.y2 * sin
    return p1 < p2 ? ([p1, p2] as const) : ([p2, p1] as const)
  }
  const [a0, a1] = p(a),
    [b0, b1] = p(b)
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/**
 * Construct the wall centreline for a parallel pair (a, b).
 * Centreline is the mid-line within the overlapping projection extent.
 */
function buildCentreline(a: Seg, b: Seg): { start: Vec2; end: Vec2 } {
  const angle = segAngle(a)
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const nx = -sin,
    ny = cos // perpendicular unit

  const proj = (x: number, y: number) => x * cos + y * sin
  const sA = [proj(a.x1, a.y1), proj(a.x2, a.y2)].sort((x, y) => x - y) as [number, number]
  const sB = [proj(b.x1, b.y1), proj(b.x2, b.y2)].sort((x, y) => x - y) as [number, number]

  const pStart = Math.max(sA[0], sB[0])
  const pEnd = Math.min(sA[1], sB[1])

  // Average perpendicular offset of both segments
  const perpOf = (s: Seg) => (s.x1 * nx + s.y1 * ny + s.x2 * nx + s.y2 * ny) / 2
  const midPerp = (perpOf(a) + perpOf(b)) / 2

  return {
    start: [R3(cos * pStart + nx * midPerp), R3(sin * pStart + ny * midPerp)],
    end: [R3(cos * pEnd + nx * midPerp), R3(sin * pEnd + ny * midPerp)],
  }
}

// ─── Step 2: coordinate normalisation ────────────────────────────────────────

/** $INSUNITS: 4=mm, 6=m. Missing → infer from raw bbox size. */
export function inferScale(insunits: number | undefined, maxRawDim: number): number {
  if (insunits === 4) return 0.001
  if (insunits === 6) return 1
  return maxRawDim >= 100 ? 0.001 : 1
}

function computeRawBbox(entities: DxfRawEntity[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  maxDim: number
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity

  const touch = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  for (const e of entities) {
    if (e.type === 'LINE') {
      const l = e as DxfRawLine
      const s = lineStart(l), en = lineEnd(l)
      if (!s || !en) continue
      touch(s.x, s.y)
      touch(en.x, en.y)
    } else if (e.type === 'LWPOLYLINE') {
      const p = e as DxfRawLwPolyline
      if (!p.vertices) continue
      p.vertices.forEach(v => touch(v.x, v.y))
    }
  }

  if (!isFinite(minX)) {
    minX = minY = maxX = maxY = 0
  }
  return { minX, minY, maxX, maxY, maxDim: Math.max(maxX - minX, maxY - minY) }
}

function extractNormalizedSegs(
  entities: DxfRawEntity[],
  scale: number,
  wallLayerOnly: boolean,
): Seg[] {
  const out: Seg[] = []
  for (const e of entities) {
    const layer = e.layer ?? ''
    if (isSkipLayer(layer)) continue
    if (wallLayerOnly && !isWallLayer(layer)) continue

    if (e.type === 'LINE') {
      const l = e as DxfRawLine
      const s = lineStart(l), en = lineEnd(l)
      if (!s || !en) continue
      out.push({
        x1: R3(s.x * scale),
        y1: R3(s.y * scale),
        x2: R3(en.x * scale),
        y2: R3(en.y * scale),
        layer,
      })
    } else if (e.type === 'LWPOLYLINE') {
      const p = e as DxfRawLwPolyline
      if (!p.vertices) continue
      for (let i = 0; i < p.vertices.length - 1; i++) {
        const v = p.vertices[i]!,
          w = p.vertices[i + 1]!
        out.push({
          x1: R3(v.x * scale),
          y1: R3(v.y * scale),
          x2: R3(w.x * scale),
          y2: R3(w.y * scale),
          layer,
        })
      }
      if ((p.shape || p.closed) && p.vertices.length >= 2) {
        const last = p.vertices[p.vertices.length - 1]!,
          first = p.vertices[0]!
        out.push({
          x1: R3(last.x * scale),
          y1: R3(last.y * scale),
          x2: R3(first.x * scale),
          y2: R3(first.y * scale),
          layer,
        })
      }
    }
  }
  return out
}

/**
 * Snap endpoints within `tolerance` metres of each other to their centroid.
 * Uses union-find for O(n²) pairwise comparison with fast cluster resolution.
 */
export function snapEndpoints(segs: Seg[], tolerance: number): Seg[] {
  const n = segs.length * 2
  const parent = Array.from({ length: n }, (_, i) => i)
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)

  segs.forEach((s, i) => {
    xs[2 * i] = s.x1
    ys[2 * i] = s.y1
    xs[2 * i + 1] = s.x2
    ys[2 * i + 1] = s.y2
  })

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }

  const tol2 = tolerance * tolerance
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xs[i]! - xs[j]!,
        dy = ys[i]! - ys[j]!
      if (dx * dx + dy * dy <= tol2) parent[find(i)] = find(j)
    }
  }

  // Centroid per cluster
  const sum = new Map<number, { sx: number; sy: number; cnt: number }>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const c = sum.get(r) ?? { sx: 0, sy: 0, cnt: 0 }
    c.sx += xs[i]!
    c.sy += ys[i]!
    c.cnt++
    sum.set(r, c)
  }
  const rep = new Map<number, Vec2>()
  sum.forEach((c, r) => rep.set(r, [R3(c.sx / c.cnt), R3(c.sy / c.cnt)]))

  return segs.map((s, i) => {
    const [sx, sy] = rep.get(find(2 * i))!
    const [ex, ey] = rep.get(find(2 * i + 1))!
    return { x1: sx, y1: sy, x2: ex, y2: ey, layer: s.layer }
  })
}

// ─── Step 3: parallel line pair detection (§3.3.3) ───────────────────────────

type WallCandidate = {
  start: Vec2
  end: Vec2
  thickness: number
  height: number
  layerName?: string
}

export function detectWalls(
  segs: Seg[],
  thicknessMin: number,
  thicknessMax: number,
): WallCandidate[] {
  const ANGLE_TOL = Math.PI / 180 // 1°
  const LENGTH_DIFF_MAX = 0.2 // 20%
  const OVERLAP_RATIO_MIN = 0.3 // 30% of shorter segment

  const walls: WallCandidate[] = []
  const paired = new Set<number>()

  for (let i = 0; i < segs.length; i++) {
    if (paired.has(i)) continue
    const a = segs[i]!
    const lenA = segLen(a)
    if (lenA < 0.05) continue
    const angleA = segAngle(a)

    let bestJ = -1,
      bestScore = -1

    for (let j = i + 1; j < segs.length; j++) {
      if (paired.has(j)) continue
      const b = segs[j]!
      const lenB = segLen(b)
      if (lenB < 0.05) continue

      // Angle difference normalised to [0, π/2]
      let diff = Math.abs(angleA - segAngle(b))
      if (diff > Math.PI) diff = 2 * Math.PI - diff
      if (diff > Math.PI / 2) diff = Math.PI - diff
      if (diff > ANGLE_TOL) continue

      if (Math.abs(lenA - lenB) / Math.max(lenA, lenB) > LENGTH_DIFF_MAX) continue

      // Perpendicular distance (midpoint of b → line through a)
      const mx = (b.x1 + b.x2) / 2,
        my = (b.y1 + b.y2) / 2
      const dist = perpDistPtToLine(mx, my, a.x1, a.y1, a.x2, a.y2)
      if (dist < thicknessMin || dist > thicknessMax) continue

      const overlap = projOverlap(a, b)
      if (overlap < Math.min(lenA, lenB) * OVERLAP_RATIO_MIN) continue

      // Pick the best match: highest overlap × (1 / distance_variance)
      const midDist = (thicknessMin + thicknessMax) / 2
      const score = overlap / (Math.abs(dist - midDist) + 0.01)
      if (score > bestScore) {
        bestScore = score
        bestJ = j
      }
    }

    if (bestJ >= 0) {
      paired.add(i)
      paired.add(bestJ)
      const b = segs[bestJ]!
      const mx = (b.x1 + b.x2) / 2,
        my = (b.y1 + b.y2) / 2
      const thickness = R3(perpDistPtToLine(mx, my, a.x1, a.y1, a.x2, a.y2))
      const { start, end } = buildCentreline(a, b)
      walls.push({ start, end, thickness, height: 2.8, layerName: a.layer || b.layer })
    }
  }
  return walls
}

// ─── Step 4: intersection correction ─────────────────────────────────────────

/**
 * Correct L-junctions (snap close endpoints), T-junctions (split through-wall),
 * and oblique intersections by extending wall centrelines to their computed
 * intersection point when that point lies within `thicknessMax` of an endpoint.
 */
export function correctJunctions(
  walls: WallCandidate[],
  thicknessMax: number,
): WallCandidate[] {
  // Work on mutable copies of the Vec2 tuples so mutations propagate
  type MW = { start: Vec2; end: Vec2; thickness: number; height: number; layerName?: string }
  const ws: MW[] = walls.map(w => ({
    ...w,
    start: [w.start[0], w.start[1]] as Vec2,
    end: [w.end[0], w.end[1]] as Vec2,
  }))
  const extra: MW[] = []

  // Snap tolerance for detecting a junction: generous enough to bridge the
  // centreline-to-corner gap (≈ thicknessMax / 2 for perpendicular walls).
  const JUNCTION_TOL = thicknessMax * 1.2

  for (let i = 0; i < ws.length; i++) {
    for (let j = i + 1; j < ws.length; j++) {
      const wi = ws[i]!,
        wj = ws[j]!

      // Skip nearly-parallel wall pairs — they share no meaningful junction
      const ai = Math.atan2(wi.end[1] - wi.start[1], wi.end[0] - wi.start[0])
      const aj = Math.atan2(wj.end[1] - wj.start[1], wj.end[0] - wj.start[0])
      let ad = Math.abs(ai - aj)
      if (ad > Math.PI) ad = 2 * Math.PI - ad
      if (ad > Math.PI / 2) ad = Math.PI - ad
      if (ad < Math.PI / 12) continue // < 15° → skip

      const pt = lineIntersect(
        wi.start[0],
        wi.start[1],
        wi.end[0],
        wi.end[1],
        wj.start[0],
        wj.start[1],
        wj.end[0],
        wj.end[1],
      )
      if (!pt) continue

      const [ix, iy] = pt

      // Snap any endpoint of wi/wj that lies within JUNCTION_TOL of intersection
      for (const ep of [wi.start, wi.end, wj.start, wj.end]) {
        if (ptDist(ep[0], ep[1], ix, iy) <= JUNCTION_TOL) {
          ep[0] = ix
          ep[1] = iy
        }
      }

      // T-junction: if the intersection sits on the *interior* of wj (t ∈ (0.02, 0.98))
      // and is now exactly the start/end of wi → split wj at that point
      for (const through of [wi, wj]) {
        const proj = projectOnSeg(ix, iy, through.start[0], through.start[1], through.end[0], through.end[1])
        if (proj.t > 0.02 && proj.t < 0.98 && proj.dist < 0.005) {
          // Check that neither endpoint of 'through' already equals the intersection
          if (
            ptDist(through.start[0], through.start[1], ix, iy) > 0.005 &&
            ptDist(through.end[0], through.end[1], ix, iy) > 0.005
          ) {
            const origEnd: Vec2 = [through.end[0], through.end[1]]
            through.end = [ix, iy]
            extra.push({
              start: [ix, iy],
              end: origEnd,
              thickness: through.thickness,
              height: through.height,
              layerName: through.layerName,
            })
          }
        }
      }
    }
  }

  return [...ws, ...extra]
}

// ─── Step 5: door and window detection ────────────────────────────────────────

function nearestWall(
  px: number,
  py: number,
  walls: WallCandidate[],
  maxDist: number,
): { wallIdx: number; t: number } | null {
  let best: { wallIdx: number; t: number; dist: number } | null = null
  walls.forEach((w, i) => {
    const proj = projectOnSeg(px, py, w.start[0], w.start[1], w.end[0], w.end[1])
    if (!best || proj.dist < best.dist) best = { wallIdx: i, t: proj.t, dist: proj.dist }
  })
  if (!best) return null
  const b = best as { wallIdx: number; t: number; dist: number }
  return b.dist <= maxDist ? { wallIdx: b.wallIdx, t: b.t } : null
}

function detectOpenings(
  entities: DxfRawEntity[],
  scale: number,
  walls: WallCandidate[],
): OpeningRecord[] {
  const openings: OpeningRecord[] = []
  let oid = 0
  const wallId = (i: number) => `w_${String(i + 1).padStart(3, '0')}`

  // Doors: ARC (door swing) with radius 0.3–1.5 m + short LINE starting at arc centre
  const shortLines = entities
    .filter(e => e.type === 'LINE' && !isSkipLayer(e.layer ?? ''))
    .filter(e => { const l = e as DxfRawLine; return lineStart(l) != null && lineEnd(l) != null })
    .map(e => {
      const l = e as DxfRawLine
      const s = lineStart(l)!, en = lineEnd(l)!
      const x1 = s.x * scale, y1 = s.y * scale
      const x2 = en.x * scale, y2 = en.y * scale
      return { x1, y1, x2, y2, len: Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) }
    })
    .filter(l => l.len > 0.05 && l.len < 1.2)

  for (const e of entities) {
    if (e.type !== 'ARC') continue
    const arc = e as DxfRawArc
    if (isSkipLayer(arc.layer ?? '')) continue
    const cx = arc.center.x * scale,
      cy = arc.center.y * scale
    const r = arc.radius * scale
    if (r < 0.3 || r > 1.5) continue

    // Find a short line whose endpoint is within 50 mm of arc centre (door pivot)
    const pivot = shortLines.find(
      l => ptDist(l.x1, l.y1, cx, cy) < 0.05 || ptDist(l.x2, l.y2, cx, cy) < 0.05,
    )
    if (!pivot) continue

    const hit = nearestWall(cx, cy, walls, r + 0.2)
    if (!hit) continue
    openings.push({
      id: `o_${String(++oid).padStart(3, '0')}`,
      type: 'door',
      wallId: wallId(hit.wallIdx),
      positionAlongWall: R3(hit.t),
      width: R3(r),
      height: 2.1,
      confidence: 0.8,
    })
  }

  // Windows: INSERT block with name containing WIN/WINDOW/窗
  for (const e of entities) {
    if (e.type !== 'INSERT') continue
    const ins = e as DxfRawInsert
    const name = ins.name.toUpperCase()
    if (!name.includes('WIN') && !name.includes('WINDOW') && !name.includes('窗')) continue
    const px = ins.position.x * scale,
      py = ins.position.y * scale
    const hit = nearestWall(px, py, walls, 1.0)
    if (!hit) continue
    openings.push({
      id: `o_${String(++oid).padStart(3, '0')}`,
      type: 'window',
      wallId: wallId(hit.wallIdx),
      positionAlongWall: R3(hit.t),
      width: 1.2,
      height: 1.2,
      confidence: 0.75,
    })
  }

  return openings
}

// ─── Closed region detection ──────────────────────────────────────────────────

function findClosedRegions(walls: WallCandidate[]): ClosedRegion[] {
  const SNAP = 0.005
  const nodes: Vec2[] = []

  function nodeFor(x: number, y: number): number {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.abs(nodes[i]![0] - x) <= SNAP && Math.abs(nodes[i]![1] - y) <= SNAP) return i
    }
    nodes.push([x, y])
    return nodes.length - 1
  }

  const adj = new Map<number, Set<number>>()
  function link(a: number, b: number) {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }

  for (const w of walls) link(nodeFor(w.start[0], w.start[1]), nodeFor(w.end[0], w.end[1]))

  const regions: ClosedRegion[] = []
  const usedKeys = new Set<string>()

  // DFS-based simple cycle finder (depth-capped for performance)
  function dfs(cur: number, start: number, path: number[], depth: number) {
    if (regions.length >= 50) return
    if (depth > 16) return
    for (const nb of adj.get(cur) ?? []) {
      if (nb === start && path.length >= 3) {
        const key = [...path].sort((a, b) => a - b).join(',')
        if (!usedKeys.has(key)) {
          usedKeys.add(key)
          regions.push({
            id: `r_${String(regions.length + 1).padStart(3, '0')}`,
            polygon: path.map(id => [...nodes[id]!] as Vec2),
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

// ─── Main export ──────────────────────────────────────────────────────────────

export type GeometryParserOptions = {
  wallThicknessMin?: number
  wallThicknessMax?: number
  /** Override automatic unit inference. Pass 0.001 for mm input, 0.01 for cm, 1.0 for m. */
  unitScale?: number
}

export function parseDxfGeometry(dxf: DxfParsed, opts: GeometryParserOptions = {}): CoordsJSON {
  const thicknessMin = opts.wallThicknessMin ?? 0.08
  const thicknessMax = opts.wallThicknessMax ?? 0.4
  const warnings: string[] = []

  // §3.3.2 – Step 1: infer unit from header + raw bbox (explicit override takes priority)
  const raw = computeRawBbox(dxf.entities)
  const scale = opts.unitScale ?? inferScale(dxf.header?.$INSUNITS, raw.maxDim)

  const bbox = {
    minX: R3(raw.minX * scale),
    minY: R3(raw.minY * scale),
    maxX: R3(raw.maxX * scale),
    maxY: R3(raw.maxY * scale),
  }

  // §3.3.1 – Step 1: layer analysis — prefer wall layers, fall back to all lines
  const wallLayerOnly = dxf.entities.some(e => isWallLayer(e.layer ?? ''))
  if (!wallLayerOnly) warnings.push('未找到墙体图层，已对所有线段应用几何识别')

  // §3.3.2 – Step 2: extract and normalise segments
  let segs = extractNormalizedSegs(dxf.entities, scale, wallLayerOnly)

  // Endpoint snapping: < 5 mm → merge to centroid
  segs = snapEndpoints(segs, 0.005)

  // §3.3.3 – Step 3: parallel pair detection
  // When explicit CL (centreline) layers are present (e.g. PASCAL_WALL_EXT_CL from
  // Pascal's own DXF exporter), exclude them from pair detection so FACE-to-FACE pairs
  // are matched instead of CL-to-FACE pairs, which produce half-thickness walls at
  // wrong centreline positions.
  const hasCLLayers = dxf.entities.some(e => {
    const u = (e.layer ?? '').toUpperCase()
    return e.type === 'LINE' && u.includes('WALL') && u.includes('_CL')
  })
  const pairSegs = hasCLLayers
    ? segs.filter(s => !((s.layer ?? '').toUpperCase().includes('_CL')))
    : segs

  let wallCandidates = detectWalls(pairSegs, thicknessMin, thicknessMax)

  // Fallback: when no parallel pairs found, check for explicit centerline layers
  // (e.g. PASCAL_WALL_EXT_CL, PASCAL_WALL_INT_CL — one LINE per wall, no pairs needed).
  if (wallCandidates.length === 0) {
    const clEntities = dxf.entities.filter(e => {
      const u = (e.layer ?? '').toUpperCase()
      return (
        e.type === 'LINE' &&
        u.includes('WALL') &&
        (u.includes('_CL') || u.includes('CENTER') || u.includes('CENTRELINE'))
      )
    })

    if (clEntities.length > 0) {
      warnings.push('平行对检测未找到墙体，已从中心线图层直接提取墙体')
      for (const e of clEntities) {
        const l = e as DxfRawLine
        const s = lineStart(l), en = lineEnd(l)
        if (!s || !en) continue
        const u = (e.layer ?? '').toUpperCase()
        const thickness = u.includes('INT') ? 0.12 : 0.24
        wallCandidates.push({
          start: [R3(s.x * scale), R3(s.y * scale)],
          end:   [R3(en.x * scale), R3(en.y * scale)],
          thickness,
          height: 2.8,
          layerName: e.layer,
        })
      }
    } else {
      warnings.push('未检测到平行线对，无法生成墙体')
    }
  }

  // §3.3.4 – Step 4: junction correction
  const correctedWalls = correctJunctions(wallCandidates, thicknessMax)

  // Build typed WallRecords with sequential IDs
  const walls: WallRecord[] = correctedWalls.map((w, i) => ({
    id: `w_${String(i + 1).padStart(3, '0')}`,
    start: w.start,
    end: w.end,
    thickness: w.thickness,
    height: w.height,
    ...(w.layerName ? { layerName: w.layerName } : {}),
  }))

  // §3.3.5 – Step 5: door and window detection
  const openings = detectOpenings(dxf.entities, scale, correctedWalls)

  // §3.3.6 – Step 6: closed regions from walls + ZONE-layer LWPOLYLINE fallback
  let closedRegions = findClosedRegions(correctedWalls)
  if (closedRegions.length === 0) {
    // Extract rooms from explicit zone-layer LWPOLYLINE polygons
    let zoneIdx = 0
    for (const e of dxf.entities) {
      const u = (e.layer ?? '').toUpperCase()
      if (e.type !== 'LWPOLYLINE') continue
      if (!u.includes('ZONE') && !u.includes('ROOM') && !u.includes('SPACE')) continue
      const p = e as DxfRawLwPolyline
      if (!p.vertices || p.vertices.length < 3) continue
      const polygon = p.vertices.map(
        v => [R3(v.x * scale), R3(v.y * scale)] as [number, number],
      )
      closedRegions.push({ id: `r_${String(++zoneIdx).padStart(3, '0')}`, polygon })
    }
  }

  // Confidence: ratio of wall-matched line segments
  const wallPairRatio = segs.length > 0 ? (wallCandidates.length * 2) / segs.length : 0
  const confidence = R3(Math.max(0.1, Math.min(1, 0.5 + wallPairRatio * 0.4 - warnings.length * 0.05)))

  return { unit: 'm', bbox, walls, openings, closedRegions, confidence, warnings }
}
