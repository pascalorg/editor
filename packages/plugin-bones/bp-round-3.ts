/**
 * Blueprint round-3 harness (review-only, never committed).
 * Same recipe as round 2: fetch scene over HTTP, inject a bones:framing node
 * (ALL systems on), computeLevel → buildPlanSet, write SVGs to /tmp/bp3/.
 * Round-3 deltas: characteristics block passed through; scene-wipe GET-check
 * (re-PUT from /tmp/bp3/demo-scene.json backup if the autosave bug emptied it);
 * placed sanitary items are the scene's own (toilet + kitchen sink) and the
 * gabled composite gains a toilet+sink pair so fixture-driven plumbing draws.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extractLevels, extractWalls } from './src/core/wall-model'
import { computeLevel } from './src/framing/compute'
import { FramingNode } from './src/framing/schema'
import { profileFor } from './src/jurisdiction/profiles'
import { buildPlanSet } from './src/plans/plan-set'

const OUT = '/tmp/bp3'

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
  console.log('characteristics:', JSON.stringify(result.characteristics))
  const bySystem = new Map<string, number>()
  for (const m of result.members) bySystem.set(m.system, (bySystem.get(m.system) ?? 0) + 1)
  console.log('members by system:', JSON.stringify(Object.fromEntries(bySystem)))
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
    characteristics: result.characteristics ?? undefined,
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

// ---- Plan 1: demo scene over HTTP (scene-wipe GET-check + re-PUT) ---------
const SCENE = 'fc866f2f271b'
let res = await fetch(`http://localhost:3002/api/scenes/${SCENE}`)
if (!res.ok) throw new Error(`scene fetch failed: ${res.status}`)
let scene = (await res.json()) as { name?: string; graph: { nodes: AnyNodes } }
if (!scene.graph?.nodes || Object.keys(scene.graph.nodes).length === 0) {
  console.log('!! scene wiped (autosave bug) — re-PUT from backup')
  const backup = JSON.parse(readFileSync('/tmp/bp3/demo-scene.json', 'utf8')) as {
    name?: string
    graph: { nodes: AnyNodes }
  }
  const put = await fetch(`http://localhost:3002/api/scenes/${SCENE}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: backup.name, graph: backup.graph }),
  })
  if (!put.ok) throw new Error(`re-PUT failed: ${put.status}`)
  res = await fetch(`http://localhost:3002/api/scenes/${SCENE}`)
  scene = (await res.json()) as { name?: string; graph: { nodes: AnyNodes } }
  if (!scene.graph?.nodes || Object.keys(scene.graph.nodes).length === 0)
    throw new Error('scene still empty after re-PUT')
}
console.log('scene GET-check ok:', Object.keys(scene.graph.nodes).length, 'nodes')
const nodes = scene.graph.nodes
const sanitary = Object.values(nodes).filter(
  (n) =>
    n.type === 'item' &&
    ['toilet', 'bathroom-sink', 'shower-square', 'shower-angle', 'bathtub', 'washing-machine', 'kitchen', 'kitchen-counter'].includes(
      String((n.asset as { id?: string } | undefined)?.id),
    ),
)
console.log(
  'placed sanitary items in graph:',
  sanitary.map((n) => `${(n.asset as { id?: string }).id}@${JSON.stringify(n.position)}`),
)
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
// Same wall list as rounds 1–2 (the gate's 'gabled-plan composite' scenario)
// + a placed toilet/sink pair so the rebuilt fixture-driven plumbing (P5)
// draws on oblique geometry too.
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
// placed sanitary items (fixture-driven plumbing, checklist P5)
g.item_toilet_g = {
  object: 'node',
  id: 'item_toilet_g',
  type: 'item',
  parentId: 'level_g',
  visible: true,
  asset: { id: 'toilet' },
  position: [13.5, 0, 5],
  rotation: [0, -Math.PI / 2, 0],
}
g.item_sink_g = {
  object: 'node',
  id: 'item_sink_g',
  type: 'item',
  parentId: 'level_g',
  visible: true,
  asset: { id: 'bathroom-sink' },
  position: [13.5, 0, 6.2],
  rotation: [0, -Math.PI / 2, 0],
}
runSet('gabled-composite-NY', g, 'level_g', 'NY', 'Gabled composite', 'Ground floor')
