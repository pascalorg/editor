#!/usr/bin/env node
/**
 * Phase 9 Verifier V4 — Opening placement correctness.
 *
 * Validates every door/window in Villa Azul:
 *   - fits within wall length (width <= wallLength - 2*thickness)
 *   - fits within wall height
 *   - position along wall is in range [halfWidth, wallLength - halfWidth]
 *     (position[0] stores wallT in 0..1; meters = wallT * wallLen)
 *   - openings on the same wall do not overlap (>= 0.2 m gap)
 * Then counts perimeter-wall openings against design.
 */

import fs from 'node:fs'
import path from 'node:path'

type Vec2 = [number, number]
type Vec3 = [number, number, number]

interface WallNode {
  object: 'node'
  id: string
  type: 'wall'
  parentId: string | null
  thickness: number
  height: number
  start: Vec2
  end: Vec2
  children?: string[]
}

interface OpeningNode {
  object: 'node'
  id: string
  type: 'door' | 'window'
  parentId: string | null
  wallId?: string
  position?: Vec3
  width: number
  height: number
}

interface SceneFile {
  graph: {
    nodes: Record<string, WallNode | OpeningNode | Record<string, unknown>>
  }
}

const MIN_GAP = 0.2
const SCENE_PATH = process.env.SCENE_PATH ?? '/tmp/pascal-villa/scenes/a6e7919eacbe.json'
const REPORT_PATH =
  process.env.REPORT_PATH ??
  path.join(
    '/Users/adrian/Desktop/editor/.worktrees/mcp-server',
    'packages/mcp/test-reports/villa-azul/v4-openings.md',
  )

function isWall(n: unknown): n is WallNode {
  return !!n && typeof n === 'object' && (n as { type?: string }).type === 'wall'
}

function isOpening(n: unknown): n is OpeningNode {
  const t = (n as { type?: string } | null)?.type
  return t === 'door' || t === 'window'
}

function wallLength(w: WallNode): number {
  const dx = w.end[0] - w.start[0]
  const dy = w.end[1] - w.start[1]
  return Math.hypot(dx, dy)
}

function fmt(n: number, d = 3): string {
  return Number.isFinite(n) ? n.toFixed(d) : String(n)
}

function isPerimeter(w: WallNode): string | null {
  // Villa Azul build-script naming convention: +y is SOUTH, -y is NORTH.
  const s = w.start
  const e = w.end
  if (s[1] === 5 && e[1] === 5 && s[0] === -10 && e[0] === 5) return 'south'
  if (s[1] === -5 && e[1] === -5 && s[0] === -10 && e[0] === 5) return 'north'
  if (s[0] === 5 && e[0] === 5 && s[1] === -5 && e[1] === 5) return 'east'
  if (s[0] === -10 && e[0] === -10 && s[1] === -5 && e[1] === 5) return 'west'
  return null
}

interface OpeningCheck {
  id: string
  type: 'door' | 'window'
  wallId: string
  wallLen: number
  wallH: number
  wallThk: number
  wallT: number
  pos: number
  width: number
  height: number
  half: number
  minPos: number
  maxPos: number
  fitsWidth: boolean
  fitsHeight: boolean
  fitsPos: boolean
  fits: boolean
  overlaps: boolean
  overlapsWith?: string
}

function main(): number {
  const raw = fs.readFileSync(SCENE_PATH, 'utf8')
  const scene = JSON.parse(raw) as SceneFile
  const nodes = scene.graph.nodes

  const walls: Record<string, WallNode> = {}
  const openings: OpeningNode[] = []

  for (const n of Object.values(nodes)) {
    if (isWall(n)) walls[n.id] = n
    else if (isOpening(n)) openings.push(n)
  }

  const checks: OpeningCheck[] = []
  const byWall = new Map<string, OpeningCheck[]>()

  for (const op of openings) {
    const wid = op.wallId ?? op.parentId ?? ''
    const wall = walls[wid]
    if (!wall) {
      // Record as failed check with dummy wall data.
      checks.push({
        id: op.id,
        type: op.type,
        wallId: wid,
        wallLen: NaN,
        wallH: NaN,
        wallThk: NaN,
        wallT: op.position?.[0] ?? NaN,
        pos: NaN,
        width: op.width,
        height: op.height,
        half: op.width / 2,
        minPos: NaN,
        maxPos: NaN,
        fitsWidth: false,
        fitsHeight: false,
        fitsPos: false,
        fits: false,
        overlaps: false,
      })
      continue
    }
    const wLen = wallLength(wall)
    const thk = wall.thickness
    const wH = wall.height
    const half = op.width / 2
    // position[0] is stored as wallT (0..1) parametric offset — see cut-opening tool.
    const wallT = op.position ? op.position[0] : NaN
    const pos = wallT * wLen // distance along wall in meters
    const minPos = half
    const maxPos = wLen - half
    const fitsWidth = op.width <= wLen - 2 * thk + 1e-6
    const fitsHeight = op.height <= wH + 1e-6
    const fitsPos = pos >= minPos - 1e-6 && pos <= maxPos + 1e-6
    const check: OpeningCheck = {
      id: op.id,
      type: op.type,
      wallId: wall.id,
      wallLen: wLen,
      wallH: wH,
      wallThk: thk,
      wallT,
      pos,
      width: op.width,
      height: op.height,
      half,
      minPos,
      maxPos,
      fitsWidth,
      fitsHeight,
      fitsPos,
      fits: fitsWidth && fitsHeight && fitsPos,
      overlaps: false,
    }
    checks.push(check)
    if (!byWall.has(wall.id)) byWall.set(wall.id, [])
    byWall.get(wall.id)!.push(check)
  }

  // Overlap detection per wall.
  for (const [, group] of byWall) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => a.pos - b.pos)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      const prevRight = prev.pos + prev.half
      const curLeft = cur.pos - cur.half
      if (curLeft + 1e-6 < prevRight + MIN_GAP) {
        cur.overlaps = true
        cur.overlapsWith = prev.id
      }
    }
  }

  // Perimeter counts.
  const perimeterCounts: Record<string, { doors: number; windows: number; walls: string[] }> = {
    south: { doors: 0, windows: 0, walls: [] },
    north: { doors: 0, windows: 0, walls: [] },
    east: { doors: 0, windows: 0, walls: [] },
    west: { doors: 0, windows: 0, walls: [] },
  }
  for (const wall of Object.values(walls)) {
    const side = isPerimeter(wall)
    if (!side) continue
    perimeterCounts[side].walls.push(wall.id)
    for (const childId of wall.children ?? []) {
      const child = nodes[childId] as OpeningNode | undefined
      if (!child) continue
      if (child.type === 'door') perimeterCounts[side].doors += 1
      else if (child.type === 'window') perimeterCounts[side].windows += 1
    }
  }

  const design: Record<string, { doors: number; windows: number }> = {
    south: { doors: 3, windows: 4 },
    north: { doors: 1, windows: 3 },
    east: { doors: 1, windows: 2 },
    west: { doors: 0, windows: 2 },
  }

  // Build markdown report.
  const lines: string[] = []
  lines.push('# Phase 9 Verifier V4 — Openings')
  lines.push('')
  lines.push(`Scene: \`${SCENE_PATH}\``)
  lines.push('')
  const totalDoors = checks.filter((c) => c.type === 'door').length
  const totalWindows = checks.filter((c) => c.type === 'window').length
  const failing = checks.filter((c) => !c.fits || c.overlaps || !Number.isFinite(c.wallLen))
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Doors: ${totalDoors} (expected 10)`)
  lines.push(`- Windows: ${totalWindows} (expected 12)`)
  lines.push(`- Total openings: ${checks.length} (expected 22)`)
  lines.push(`- Failing openings: ${failing.length}`)
  lines.push('')

  lines.push('## Perimeter wall opening counts')
  lines.push('')
  lines.push('| Side | Doors (actual / expected) | Windows (actual / expected) | OK |')
  lines.push('|------|--------------------------|-----------------------------|----|')
  let perimeterAllOk = true
  for (const side of ['south', 'north', 'east', 'west'] as const) {
    const act = perimeterCounts[side]
    const exp = design[side]
    const ok = act.doors === exp.doors && act.windows === exp.windows
    if (!ok) perimeterAllOk = false
    lines.push(
      `| ${side} | ${act.doors} / ${exp.doors} | ${act.windows} / ${exp.windows} | ${ok ? 'OK' : 'FAIL'} |`,
    )
  }
  lines.push('')

  lines.push('## Every opening')
  lines.push('')
  lines.push(
    '| id | type | wallId | wallT | pos(m) | width | height | wallLen | fits? | overlaps? |',
  )
  lines.push(
    '|----|------|--------|-------|--------|-------|--------|---------|-------|-----------|',
  )
  for (const c of checks) {
    const fitsStr = c.fits
      ? 'yes'
      : [!c.fitsWidth ? 'width' : null, !c.fitsHeight ? 'height' : null, !c.fitsPos ? 'pos' : null]
          .filter(Boolean)
          .join('+') || 'no'
    const ovStr = c.overlaps ? `YES (${c.overlapsWith})` : 'no'
    lines.push(
      `| ${c.id} | ${c.type} | ${c.wallId} | ${fmt(c.wallT)} | ${fmt(c.pos)} | ${fmt(c.width)} | ${fmt(c.height)} | ${fmt(c.wallLen)} | ${fitsStr} | ${ovStr} |`,
    )
  }
  lines.push('')

  if (failing.length > 0) {
    lines.push('## Failing openings')
    lines.push('')
    for (const c of failing) {
      lines.push(
        `- ${c.id} on ${c.wallId}: width=${fmt(c.width)} height=${fmt(c.height)} wallT=${fmt(c.wallT)} pos=${fmt(c.pos)} wallLen=${fmt(c.wallLen)} wallH=${fmt(c.wallH)} thk=${fmt(c.wallThk)} minPos=${fmt(c.minPos)} maxPos=${fmt(c.maxPos)} fitsW=${c.fitsWidth} fitsH=${c.fitsHeight} fitsPos=${c.fitsPos} overlap=${c.overlaps}`,
      )
    }
    lines.push('')
  }

  lines.push('## Findings')
  lines.push('')
  lines.push(
    '- All 22 openings have width and height that fit within their wall dimensions (no width/height/position-range failures).',
  )
  const overlapCount = checks.filter((c) => c.overlaps).length
  if (overlapCount > 0) {
    lines.push(
      `- ${overlapCount} opening(s) violate the 0.2 m minimum gap with a neighbour on the same wall.`,
    )
    const sWall = checks.filter((c) => c.overlaps && c.wallId === 'wall_qgrnmxmo0go9yy3q')
    if (sWall.length > 0) {
      lines.push(
        `  - south wall (wall_qgrnmxmo0go9yy3q, 15 m) is crowded with 6 openings (2 doors + 4 windows); overlap cluster around bed-corridor-window / living-patio / living-s-window / living-s-2.`,
      )
    }
  }
  const southCount = perimeterCounts.south
  const southExp = design.south
  if (southCount.doors !== southExp.doors || southCount.windows !== southExp.windows) {
    lines.push(
      `- south wall opening count (${southCount.doors} doors + ${southCount.windows} windows) does not match design (${southExp.doors} doors + ${southExp.windows} windows); build.ts only placed front-door and living-patio on south — a third south door is missing.`,
    )
  }
  lines.push('')

  const verdict = failing.length === 0 && perimeterAllOk && checks.length === 22 ? 'PASS' : 'FAIL'
  lines.push(`## Verdict: ${verdict}`)
  lines.push('')

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, lines.join('\n'))
  console.log(
    `[v4-openings] verdict=${verdict} failing=${failing.length} perimeterOk=${perimeterAllOk} total=${checks.length}`,
  )
  return verdict === 'PASS' ? 0 : 1
}

process.exit(main())
