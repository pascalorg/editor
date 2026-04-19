/**
 * Phase 9 Verifier V2 - Geometric sanity checks for Villa Azul.
 *
 * Pure Node (no deps). Reads the scene JSON and runs checks 1-7 defined in
 * the task spec, then emits a markdown report.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

type Vec2 = [number, number]
type Polygon = Vec2[]

interface WallLike {
  id: string
  start: Vec2
  end: Vec2
  thickness: number
}

interface ZoneLike {
  id: string
  name: string
  polygon: Polygon
  kind?: string
}

interface FenceLike {
  id: string
  start: Vec2
  end: Vec2
}

interface SlabLike {
  id: string
  polygon: Polygon
  kind?: string
}

interface CheckResult {
  name: string
  passed: boolean
  details: string[]
  anomalies: string[]
}

const SCENE_PATH = '/tmp/pascal-villa/scenes/a6e7919eacbe.json'
const REPORT_PATH = path.resolve(
  '/Users/adrian/Desktop/editor/.worktrees/mcp-server',
  'packages/mcp/test-reports/villa-azul/v2-geometry.md',
)

function polygonArea(poly: Polygon): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

function polygonBounds(poly: Polygon) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const [x, y] of poly) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

function boundsOverlap(
  a: ReturnType<typeof polygonBounds>,
  b: ReturnType<typeof polygonBounds>,
): { overlap: boolean; area: number } {
  const ix = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
  const iy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY)
  if (ix <= 0 || iy <= 0) return { overlap: false, area: 0 }
  return { overlap: true, area: ix * iy }
}

function polygonsEqual(a: Polygon, b: Polygon, tol = 1e-6): boolean {
  if (a.length !== b.length) return false
  // allow rotation of indexing / reverse direction
  const tryMatch = (rev: boolean) => {
    for (let off = 0; off < a.length; off++) {
      let ok = true
      for (let i = 0; i < a.length; i++) {
        const [ax, ay] = a[i]
        const j = rev ? (off - i + a.length) % a.length : (off + i) % a.length
        const [bx, by] = b[j]
        if (Math.abs(ax - bx) > tol || Math.abs(ay - by) > tol) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
    return false
  }
  return tryMatch(false) || tryMatch(true)
}

function pointsEqual(a: Vec2, b: Vec2, tol = 1e-3): boolean {
  return Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol
}

function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, tol = 1e-3): boolean {
  const ax = a[0],
    ay = a[1],
    bx = b[0],
    by = b[1],
    px = p[0],
    py = p[1]
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return pointsEqual(p, a, tol)
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < -tol || t > 1 + tol) return false
  const qx = ax + t * dx
  const qy = ay + t * dy
  const d2 = (qx - px) * (qx - px) + (qy - py) * (qy - py)
  return d2 < tol * tol
}

function parseScene() {
  const raw = fs.readFileSync(SCENE_PATH, 'utf8')
  const scene = JSON.parse(raw)
  const nodes = scene.graph.nodes as Record<string, any>

  let site: any = null
  const walls: WallLike[] = []
  const zones: ZoneLike[] = []
  const fences: FenceLike[] = []
  const slabs: SlabLike[] = []

  for (const [id, n] of Object.entries(nodes)) {
    switch (n.type) {
      case 'site':
        site = n
        break
      case 'wall':
        walls.push({
          id,
          start: n.start,
          end: n.end,
          thickness: n.thickness,
        })
        break
      case 'zone':
        zones.push({
          id,
          name: n.name ?? id,
          polygon: n.polygon,
          kind: n.metadata?.kind,
        })
        break
      case 'fence':
        fences.push({ id, start: n.start, end: n.end })
        break
      case 'slab':
        slabs.push({
          id,
          polygon: n.polygon,
          kind: n.metadata?.kind,
        })
        break
    }
  }

  return { site, walls, zones, fences, slabs }
}

// Check 1 - zone polygons closed and non-degenerate
function checkZonesClosed(zones: ZoneLike[]): CheckResult {
  const r: CheckResult = {
    name: 'Zones closed & non-degenerate',
    passed: true,
    details: [],
    anomalies: [],
  }
  for (const z of zones) {
    if (!Array.isArray(z.polygon) || z.polygon.length < 3) {
      r.passed = false
      r.anomalies.push(`${z.id} (${z.name}) has <3 vertices`)
      continue
    }
    const first = z.polygon[0]
    const last = z.polygon[z.polygon.length - 1]
    if (pointsEqual(first, last)) {
      r.anomalies.push(`${z.id} (${z.name}) has explicit first==last (OK but unusual)`)
    }
    const area = polygonArea(z.polygon)
    if (area <= 0.1) {
      r.passed = false
      r.anomalies.push(`${z.id} (${z.name}) degenerate area=${area.toFixed(3)}`)
      continue
    }
    r.details.push(`${z.name}: ${z.polygon.length} verts, area=${area.toFixed(2)}m^2`)
  }
  return r
}

// Check 2 - zones don't overlap (except pool zone with pool basin slab).
// Use bounding-box overlap as a loose proxy (axis-aligned polys here).
function checkZoneOverlap(zones: ZoneLike[]): CheckResult {
  const r: CheckResult = {
    name: "Zones don't overlap",
    passed: true,
    details: [],
    anomalies: [],
  }
  const bounds = zones.map((z) => ({
    id: z.id,
    name: z.name,
    kind: z.kind,
    b: polygonBounds(z.polygon),
  }))
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i]
      const c = bounds[j]
      const ov = boundsOverlap(a.b, c.b)
      if (ov.overlap && ov.area > 0.1) {
        r.passed = false
        r.anomalies.push(`${a.name} overlaps ${c.name} by ~${ov.area.toFixed(2)}m^2`)
      }
    }
  }
  if (r.passed) r.details.push(`Pairwise BB-overlap check clean for ${zones.length} zones`)
  return r
}

// Check 3 - perimeter walls form a closed loop.
// Identify perimeter walls as the 4 outermost thickness=0.22 exterior walls.
function checkPerimeterLoop(walls: WallLike[]): CheckResult {
  const r: CheckResult = {
    name: 'Perimeter walls closed loop',
    passed: true,
    details: [],
    anomalies: [],
  }
  const perim = walls.filter((w) => w.thickness >= 0.2)
  if (perim.length !== 4) {
    r.passed = false
    r.anomalies.push(`Expected 4 perimeter walls (thickness>=0.2), got ${perim.length}`)
  }
  // Build endpoint histogram - every endpoint should be shared exactly once with another wall.
  const endpointCount = new Map<string, number>()
  const k = (p: Vec2) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`
  for (const w of perim) {
    endpointCount.set(k(w.start), (endpointCount.get(k(w.start)) ?? 0) + 1)
    endpointCount.set(k(w.end), (endpointCount.get(k(w.end)) ?? 0) + 1)
  }
  for (const [pt, count] of endpointCount) {
    if (count !== 2) {
      r.passed = false
      r.anomalies.push(`Perimeter endpoint ${pt} connects ${count} wall ends (expected 2)`)
    }
  }
  const corners = [...endpointCount.keys()].sort().join(' | ')
  r.details.push(`Perimeter corners: ${corners}`)
  return r
}

// Check 4 - interior walls connect to perimeter or other interior walls.
// Every wall endpoint must either share with another wall endpoint OR lie on another wall's segment.
function checkInteriorConnectivity(walls: WallLike[]): CheckResult {
  const r: CheckResult = {
    name: 'Interior walls connected (no floating endpoints)',
    passed: true,
    details: [],
    anomalies: [],
  }
  const interior = walls.filter((w) => w.thickness < 0.2)

  const isConnected = (p: Vec2, selfId: string): 'endpoint' | 'segment' | 'none' => {
    for (const other of walls) {
      if (other.id === selfId) continue
      if (pointsEqual(p, other.start) || pointsEqual(p, other.end)) {
        return 'endpoint'
      }
      if (pointOnSegment(p, other.start, other.end)) {
        return 'segment'
      }
    }
    return 'none'
  }

  for (const w of interior) {
    const s = isConnected(w.start, w.id)
    const e = isConnected(w.end, w.id)
    if (s === 'none') {
      r.passed = false
      r.anomalies.push(`${w.id} start (${w.start[0]},${w.start[1]}) floats`)
    }
    if (e === 'none') {
      r.passed = false
      r.anomalies.push(`${w.id} end (${w.end[0]},${w.end[1]}) floats`)
    }
    r.details.push(`${w.id}: start=${s}, end=${e}`)
  }
  return r
}

// Check 5 - wall endpoints fit inside |x|<=12.5, |z|<=10 fenced envelope.
function checkWallBounds(walls: WallLike[]): CheckResult {
  const r: CheckResult = {
    name: 'Wall endpoints inside fenced envelope',
    passed: true,
    details: [],
    anomalies: [],
  }
  const LIM_X = 12.5
  const LIM_Z = 10
  for (const w of walls) {
    for (const label of ['start', 'end'] as const) {
      const [x, z] = w[label]
      if (Math.abs(x) > LIM_X + 1e-3 || Math.abs(z) > LIM_Z + 1e-3) {
        r.passed = false
        r.anomalies.push(`${w.id} ${label} (${x},${z}) outside envelope`)
      }
    }
  }
  if (r.passed)
    r.details.push(`All ${walls.length * 2} wall endpoints within |x|<=${LIM_X}, |z|<=${LIM_Z}`)
  return r
}

// Check 6 - pool basin slab polygon matches pool zone polygon.
function checkPoolMatch(zones: ZoneLike[], slabs: SlabLike[]): CheckResult {
  const r: CheckResult = {
    name: 'Pool basin slab == pool zone polygon',
    passed: true,
    details: [],
    anomalies: [],
  }
  const poolZone = zones.find((z) => z.kind === 'pool' || z.name.toLowerCase() === 'pool')
  const poolSlab = slabs.find((s) => s.kind === 'pool-basin' || s.id.includes('pool'))
  if (!poolZone) {
    r.passed = false
    r.anomalies.push('No pool zone found')
    return r
  }
  if (!poolSlab) {
    r.passed = false
    r.anomalies.push('No pool basin slab found')
    return r
  }
  if (!polygonsEqual(poolZone.polygon, poolSlab.polygon)) {
    r.passed = false
    r.anomalies.push(
      `Pool zone polygon ${JSON.stringify(poolZone.polygon)} != slab polygon ${JSON.stringify(poolSlab.polygon)}`,
    )
  } else {
    r.details.push(`Pool zone & basin share ${poolZone.polygon.length}-vertex polygon`)
  }
  return r
}

// Check 7 - fence gap at south entrance x in [-1,1] on z=10.
// Spec: "x ∈ [-1, 1] on z=10 has no fence". Note: +z is south in this scene.
function checkFenceGap(fences: FenceLike[]): CheckResult {
  const r: CheckResult = {
    name: 'Fence gap at south entrance (x in [-1,1], z=10)',
    passed: true,
    details: [],
    anomalies: [],
  }
  const GAP_X0 = -1
  const GAP_X1 = 1
  const ENTRANCE_Z = 10
  for (const f of fences) {
    const [sx, sz] = f.start
    const [ex, ez] = f.end
    // Only consider fences that touch z=ENTRANCE_Z.
    if (Math.abs(sz - ENTRANCE_Z) > 1e-3 || Math.abs(ez - ENTRANCE_Z) > 1e-3) continue
    const fMinX = Math.min(sx, ex)
    const fMaxX = Math.max(sx, ex)
    const overlapMin = Math.max(fMinX, GAP_X0)
    const overlapMax = Math.min(fMaxX, GAP_X1)
    if (overlapMax - overlapMin > 1e-3) {
      r.passed = false
      r.anomalies.push(`${f.id} covers x in [${overlapMin},${overlapMax}] at z=${ENTRANCE_Z}`)
    } else {
      r.details.push(`${f.id} [${sx},${sz}]->[${ex},${ez}] clears gap`)
    }
  }
  return r
}

function renderReport(results: CheckResult[]): string {
  const ts = new Date().toISOString()
  const lines: string[] = []
  lines.push('# Villa Azul - V2 Geometry Report')
  lines.push('')
  lines.push(`- Scene: \`${SCENE_PATH}\``)
  lines.push(`- Generated: ${ts}`)
  lines.push(`- Script: \`packages/mcp/test-reports/villa-azul/v2-geometry.ts\``)
  lines.push('')
  const passCount = results.filter((x) => x.passed).length
  lines.push(`## Summary: ${passCount}/${results.length} checks passed`)
  lines.push('')
  lines.push('| # | Check | Status |')
  lines.push('|---|-------|--------|')
  results.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.name} | ${r.passed ? 'PASS' : 'FAIL'} |`)
  })
  lines.push('')
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(`## ${i + 1}. ${r.name} - ${r.passed ? 'PASS' : 'FAIL'}`)
    if (r.anomalies.length) {
      lines.push('')
      lines.push('**Anomalies:**')
      for (const a of r.anomalies) lines.push(`- ${a}`)
    }
    if (r.details.length) {
      lines.push('')
      lines.push('**Details:**')
      for (const d of r.details) lines.push(`- ${d}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function main() {
  const { walls, zones, fences, slabs } = parseScene()
  const results: CheckResult[] = [
    checkZonesClosed(zones),
    checkZoneOverlap(zones),
    checkPerimeterLoop(walls),
    checkInteriorConnectivity(walls),
    checkWallBounds(walls),
    checkPoolMatch(zones, slabs),
    checkFenceGap(fences),
  ]
  const md = renderReport(results)
  fs.writeFileSync(REPORT_PATH, md)
  // Console summary for the test runner.
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name}`)
    for (const a of r.anomalies) console.log(`  ! ${a}`)
  }
  const passCount = results.filter((x) => x.passed).length
  console.log(`\n${passCount}/${results.length} passed. Report: ${REPORT_PATH}`)
  if (passCount < results.length) process.exitCode = 1
}

main()
