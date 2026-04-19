/**
 * Phase 9 Verifier V3 — Dimensional Accuracy
 *
 * Computes areas from polygons via the shoelace formula and compares against
 * the Villa Azul design spec. Also verifies total interior footprint, pool
 * area, site polygon area, and the centroid distance from Pool to Master
 * bedroom.
 *
 * Run with: npx tsx packages/mcp/test-reports/villa-azul/v3-dimensions.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

type Point = [number, number]

const SCENE_PATH = '/tmp/pascal-villa/scenes/a6e7919eacbe.json'
const REPORT_PATH = path.resolve(
  '/Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/test-reports/villa-azul/v3-dimensions.md',
)

const TOLERANCE_PCT = 1.0

interface Expected {
  name: string
  expected: number
}

const expectedZones: Expected[] = [
  { name: 'Master bedroom', expected: 18 },
  { name: 'Master bath', expected: 12 },
  { name: 'Bedroom 2', expected: 12 },
  { name: 'Shared bath', expected: 6 },
  { name: 'Bedroom 3', expected: 12 },
  { name: 'Living dining', expected: 42 },
  { name: 'Kitchen', expected: 18 },
  { name: 'Entry hall', expected: 15 },
  { name: 'Corridor', expected: 15 },
  { name: 'Pool', expected: 32 },
  { name: 'Outdoor kitchen', expected: 15 },
  { name: 'Driveway', expected: 29.25 },
  { name: 'Back patio', expected: 20 },
]

const INTERIOR_ZONE_NAMES = new Set([
  'Master bedroom',
  'Master bath',
  'Bedroom 2',
  'Shared bath',
  'Bedroom 3',
  'Living dining',
  'Kitchen',
  'Entry hall',
  'Corridor',
])

function shoelaceArea(points: Point[]): number {
  let sum = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

function centroid(points: Point[]): Point {
  let cx = 0
  let cy = 0
  let a = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    const cross = x1 * y2 - x2 * y1
    a += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  a /= 2
  cx /= 6 * a
  cy /= 6 * a
  return [cx, cy]
}

function distance(a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.sqrt(dx * dx + dy * dy)
}

function pctError(expected: number, actual: number): number {
  if (expected === 0) return actual === 0 ? 0 : Infinity
  return (Math.abs(actual - expected) / expected) * 100
}

function fmt(n: number, d = 3): string {
  return n.toFixed(d)
}

interface ZoneRecord {
  name: string
  expected: number
  actual: number
  absErr: number
  pctErr: number
  pass: boolean
  centroid: Point
}

function main() {
  const raw = fs.readFileSync(SCENE_PATH, 'utf8')
  const scene = JSON.parse(raw)
  const nodes = scene.graph.nodes as Record<string, any>

  // Collect zones by name
  const zonesByName: Record<string, any> = {}
  for (const id in nodes) {
    const n = nodes[id]
    if (n.type === 'zone' && Array.isArray(n.polygon)) {
      zonesByName[n.name] = n
    }
  }

  const records: ZoneRecord[] = []
  const missing: string[] = []
  for (const e of expectedZones) {
    const zone = zonesByName[e.name]
    if (!zone) {
      missing.push(e.name)
      continue
    }
    const poly = zone.polygon as Point[]
    const actual = shoelaceArea(poly)
    const c = centroid(poly)
    const absErr = Math.abs(actual - e.expected)
    const pctErr = pctError(e.expected, actual)
    records.push({
      name: e.name,
      expected: e.expected,
      actual,
      absErr,
      pctErr,
      pass: pctErr < TOLERANCE_PCT,
      centroid: c,
    })
  }

  const interior = records.filter((r) => INTERIOR_ZONE_NAMES.has(r.name))
  const interiorSum = interior.reduce((s, r) => s + r.actual, 0)
  const interiorTargetSum = 150
  const interiorPct = pctError(interiorTargetSum, interiorSum)
  const interiorPass = interiorPct < TOLERANCE_PCT

  const pool = records.find((r) => r.name === 'Pool')!
  const poolExact = Math.abs(pool.actual - 32) < 1e-9

  // Site polygon
  const siteNode = Object.values(nodes).find((n: any) => n.type === 'site') as any
  const sitePts: Point[] = siteNode?.polygon?.points ?? []
  const siteArea = shoelaceArea(sitePts)
  const siteExpected = 500
  const sitePctErr = pctError(siteExpected, siteArea)
  const sitePass = sitePctErr < TOLERANCE_PCT

  // Centroid distance: Pool vs Master bedroom
  const master = records.find((r) => r.name === 'Master bedroom')!
  const poolMasterDist = distance(pool.centroid, master.centroid)
  const distPass = poolMasterDist >= 17 && poolMasterDist <= 20

  // Build report
  const now = new Date().toISOString()
  const lines: string[] = []
  lines.push('# Villa Azul — V3 Dimensional Accuracy Report\n')
  lines.push(`- Scene file: \`${SCENE_PATH}\``)
  lines.push(`- Generated: ${now}`)
  lines.push(`- Tolerance: < ${TOLERANCE_PCT}% per-zone area error\n`)

  lines.push('## Per-zone areas\n')
  lines.push('| Zone | Expected (m²) | Actual (m²) | Abs err (m²) | % err | Pass |')
  lines.push('|---|---:|---:|---:|---:|:---:|')
  for (const r of records) {
    lines.push(
      `| ${r.name} | ${fmt(r.expected, 2)} | ${fmt(r.actual, 3)} | ${fmt(
        r.absErr,
        3,
      )} | ${fmt(r.pctErr, 3)}% | ${r.pass ? 'PASS' : 'FAIL'} |`,
    )
  }
  for (const m of missing) {
    lines.push(`| ${m} | — | MISSING | — | — | FAIL |`)
  }

  lines.push('\n## Aggregate checks\n')
  lines.push('| Check | Expected | Actual | % err | Pass |')
  lines.push('|---|---:|---:|---:|:---:|')
  lines.push(
    `| Interior sum (first 9 zones) | ${fmt(interiorTargetSum, 2)} m² | ${fmt(
      interiorSum,
      3,
    )} m² | ${fmt(interiorPct, 3)}% | ${interiorPass ? 'PASS' : 'FAIL'} |`,
  )
  lines.push(
    `| Pool exactly 32 m² (8×4) | 32 m² | ${fmt(pool.actual, 3)} m² | ${fmt(
      pctError(32, pool.actual),
      3,
    )}% | ${poolExact ? 'PASS' : 'FAIL'} |`,
  )
  lines.push(
    `| Site polygon area | 500 m² | ${fmt(siteArea, 3)} m² | ${fmt(sitePctErr, 3)}% | ${
      sitePass ? 'PASS' : 'FAIL'
    } |`,
  )
  lines.push(
    `| Pool↔Master bedroom centroid dist | 17–20 m | ${fmt(
      poolMasterDist,
      3,
    )} m | — | ${distPass ? 'PASS' : 'FAIL'} |`,
  )

  lines.push('\n## Centroids (reference)\n')
  lines.push('| Zone | cx | cy |')
  lines.push('|---|---:|---:|')
  for (const r of records) {
    lines.push(`| ${r.name} | ${fmt(r.centroid[0], 3)} | ${fmt(r.centroid[1], 3)} |`)
  }

  lines.push('\n## Summary\n')
  const allZonesPass = records.every((r) => r.pass) && missing.length === 0
  const allPass = allZonesPass && interiorPass && poolExact && sitePass && distPass
  lines.push(`- Zones pass (<${TOLERANCE_PCT}%): ${allZonesPass ? 'YES' : 'NO'}`)
  lines.push(`- Interior sum pass: ${interiorPass ? 'YES' : 'NO'}`)
  lines.push(`- Pool exact pass: ${poolExact ? 'YES' : 'NO'}`)
  lines.push(`- Site polygon pass: ${sitePass ? 'YES' : 'NO'}`)
  lines.push(`- Pool↔Master distance pass: ${distPass ? 'YES' : 'NO'}`)
  lines.push(`- Overall: ${allPass ? 'PASS' : 'FAIL'}`)

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8')
  // eslint-disable-next-line no-console
  console.log(`Wrote ${REPORT_PATH}`)
  // eslint-disable-next-line no-console
  console.log(`Overall: ${allPass ? 'PASS' : 'FAIL'}`)
}

main()
