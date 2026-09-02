/**
 * Blueprint round-2 harness (review-only, never committed).
 * Fetches a scene over HTTP, injects a bones:framing node, computes members,
 * builds the plan set, writes each sheet SVG to /tmp/bp-round-2/.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { extractLevels, extractWalls } from './src/core/wall-model'
import { computeLevel } from './src/framing/compute'
import { FramingNode } from './src/framing/schema'
import { profileFor } from './src/jurisdiction/profiles'
import { buildPlanSet } from './src/plans/plan-set'

const OUT = '/tmp/bp-round-2'

type AnyNodes = Record<string, Record<string, unknown>>

function runSet(
  label: string,
  nodes: AnyNodes,
  groundLevelId: string,
  jurisdiction: string,
  projectName: string,
  levelName: string,
) {
  const rawFraming = {
    object: 'node',
    id: 'bonesframing_qa',
    type: 'bones:framing',
    name: 'X-Ray',
    parentId: groundLevelId,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    jurisdiction,
    detail: '400',
    studSpacingIn: 16,
    showWalls: true,
    showFloor: true,
    showRoof: true,
    showFoundation: true,
    showElectrical: true,
    showPlumbing: true,
    showHvac: true,
    seeThrough: true,
    wallOverrides: {},
  }
  const framing = FramingNode.parse(rawFraming)
  nodes[framing.id] = rawFraming as unknown as Record<string, unknown>

  const result = computeLevel(nodes, framing)
  const levels = extractLevels(nodes)
  const levelBaseY = Object.fromEntries(levels.map((l) => [l.id, l.baseY]))

  console.log(`\n=== ${label} ===`)
  console.log('jurisdiction resolved:', result.jurisdiction)
  console.log('members:', result.members.length, 'fixtures:', result.fixtures.length)
  console.log('warnings:', JSON.stringify(result.warnings, null, 1))
  console.log('levels/baseY:', JSON.stringify(levelBaseY))
  const bySystem = new Map<string, number>()
  for (const m of result.members) bySystem.set(m.system, (bySystem.get(m.system) ?? 0) + 1)
  console.log('members by system:', JSON.stringify(Object.fromEntries(bySystem)))
  // Y range per system (grade/levelBaseY sanity)
  const yRange = new Map<string, [number, number]>()
  for (const m of result.members) {
    const r = yRange.get(m.system) ?? [Infinity, -Infinity]
    r[0] = Math.min(r[0], m.position[1] - m.dims[1] / 2)
    r[1] = Math.max(r[1], m.position[1] + m.dims[1] / 2)
    yRange.set(m.system, r)
  }
  for (const [s, r] of yRange) console.log(`  y-range ${s}: ${r[0].toFixed(2)} .. ${r[1].toFixed(2)}`)
  const tagged = result.members.filter((m) => m.levelId)
  console.log('cross-level (tagged) members:', tagged.length, 'levelIds:', [
    ...new Set(tagged.map((m) => m.levelId)),
  ])
  // known-dimension spot check: longest wall on the ground level
  const walls = extractWalls(nodes, groundLevelId)
  const longest = [...walls].sort((a, b) => b.length - a.length)[0]
  if (longest) {
    console.log(
      `longest wall ${longest.id}: len=${longest.length.toFixed(3)} m, start=${JSON.stringify(longest.start)}, end=${JSON.stringify(longest.end)}, height=${longest.height}`,
    )
  }

  const sheets = buildPlanSet(result.members, result.fixtures, {
    projectName,
    levelName,
    jurisdiction: result.jurisdiction,
    codeName: profileFor(result.jurisdiction).residentialCode,
    date: new Date().toLocaleDateString('en-US'),
    warnings: result.warnings,
    studSpacingIn: framing.studSpacingIn,
    levelBaseY,
  })
  const dir = `${OUT}/${label}`
  mkdirSync(dir, { recursive: true })
  sheets.forEach((s, i) => {
    const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    writeFileSync(`${dir}/${String(i + 1).padStart(2, '0')}-${slug}.svg`, s.svg)
  })
  console.log(
    'sheets:',
    sheets.map((s, i) => `${i + 1}. ${s.title}`),
  )
  delete nodes[framing.id]
}

// ---- Plan 1: demo scene over HTTP --------------------------------------
const res = await fetch('http://localhost:3002/api/scenes/fc866f2f271b')
if (!res.ok) throw new Error(`scene fetch failed: ${res.status}`)
const scene = (await res.json()) as { name?: string; graph: { nodes: AnyNodes } }
const nodes = scene.graph.nodes
const wallsPerLevel = new Map<string, number>()
for (const n of Object.values(nodes)) {
  if (n.type === 'wall' && typeof n.parentId === 'string') {
    wallsPerLevel.set(n.parentId, (wallsPerLevel.get(n.parentId) ?? 0) + 1)
  }
}
const ground = [...wallsPerLevel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
if (!ground) throw new Error('no wall-bearing level found')
runSet('demo-house-FL', nodes, ground, 'FL', scene.name ?? 'Pascal project', 'Ground floor')

// ---- Plan 2: gabled composite (protocol: non-rectangular, oblique walls) ---
// Wall list = the gate's 'gabled-plan composite' scenario (interpenetration
// round-12), lifted into scene-node form with a door + a window for headers.
const g: AnyNodes = {
  building_g: { object: 'node', id: 'building_g', type: 'building', children: ['level_g'] },
  level_g: {
    object: 'node',
    id: 'level_g',
    type: 'level',
    parentId: 'building_g',
    level: 0,
    height: 2.5,
    baseElevation: 0,
  },
}
const gWalls: [string, [number, number], [number, number], boolean][] = [
  ['p_w', [0, 4], [0, 10], true],
  ['p_s', [0, 10], [7, 10], true],
  ['p_spine', [7, 10], [7, 1], true],
  ['p_roofL', [0, 4], [7, 1], true],
  ['p_roofR', [7, 1], [14, 3], true],
  ['p_e', [14, 3], [14, 11], true],
  ['p_s2', [14, 11], [7, 11], true],
  ['p_link', [7, 11], [7, 10], false],
]
for (const [id, start, end, exterior] of gWalls) {
  g[id] = {
    object: 'node',
    id,
    type: 'wall',
    parentId: 'level_g',
    start,
    end,
    thickness: 0.15,
    height: 2.5,
    frontSide: exterior ? 'exterior' : 'interior',
    backSide: 'interior',
    children: id === 'p_s' ? ['door_g'] : id === 'p_e' ? ['win_g'] : [],
  }
}
g.door_g = {
  object: 'node',
  id: 'door_g',
  type: 'door',
  parentId: 'p_s',
  position: [3.5, 0, 0],
  width: 0.9,
  height: 2.1,
}
g.win_g = {
  object: 'node',
  id: 'win_g',
  type: 'window',
  parentId: 'p_e',
  position: [4, 1.5, 0],
  width: 1.5,
  height: 1.2,
}
// pitched gable roof over the left loop — the demo's roof is flat, so this
// is the only pitched-rafter coverage in the round
g.roofseg_g = {
  object: 'node',
  id: 'roofseg_g',
  type: 'roof-segment',
  parentId: 'level_g',
  roofType: 'gable',
  position: [3.5, 2.5, 7],
  rotation: 0,
  width: 7,
  depth: 6,
  pitch: 40,
  overhang: 0.3,
  wallHeight: 0.4,
}
runSet('gabled-composite-NY', g, 'level_g', 'NY', 'Gabled composite', 'Ground floor')
