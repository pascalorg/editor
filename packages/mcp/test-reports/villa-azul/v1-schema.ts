/**
 * Phase 9 Verifier V1 — Zod schema validation of every node in Villa Azul.
 *
 * Pure Node. Reads the scene JSON from disk, runs AnyNode.safeParse against
 * each node, validates parentId/children id references, and sanity-parses one
 * node of each of: wall, door, window, zone, fence, slab.
 *
 * Run: bun packages/mcp/test-reports/villa-azul/v1-schema.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnyNode } from '@pascal-app/core/schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SCENE_PATH = '/tmp/pascal-villa/scenes/a6e7919eacbe.json'
const REPORT_PATH = resolve(__dirname, 'v1-schema.md')

type SceneFile = {
  meta: { id: string; name: string; nodeCount: number; version: number }
  graph: { nodes: Record<string, unknown> }
}

type NodeRecord = {
  id: string
  type: string
  parentId: string | null
  children?: unknown
  [k: string]: unknown
}

type FailureRow = { id: string; type: string; error: string }
type SanityRow = {
  kind: 'wall' | 'door' | 'window' | 'zone' | 'fence' | 'slab'
  id: string
  status: 'PASS' | 'FAIL'
  detail: string
}

console.log('---- Villa Azul v1-schema ----')
console.log(`Reading ${SCENE_PATH}`)
const raw = readFileSync(SCENE_PATH, 'utf8')
const scene = JSON.parse(raw) as SceneFile

const nodes = scene.graph.nodes as Record<string, NodeRecord>
const nodeIds = Object.keys(nodes)
console.log(`Loaded ${nodeIds.length} nodes from dict`)

// Per-type counters
const perTypeTotal = new Map<string, number>()
const perTypePass = new Map<string, number>()
const perTypeFail = new Map<string, number>()
const failures: FailureRow[] = []

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

// Step 1: safeParse every node
for (const id of nodeIds) {
  const node = nodes[id]!
  bump(perTypeTotal, node.type)
  const result = AnyNode.safeParse(node)
  if (result.success) {
    bump(perTypePass, node.type)
  } else {
    bump(perTypeFail, node.type)
    const errText = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ')
    failures.push({ id, type: node.type, error: errText })
    console.log(`[FAIL] ${node.type} ${id} — ${errText}`)
  }
}

const totalPass = Array.from(perTypePass.values()).reduce((a, b) => a + b, 0)
const totalFail = Array.from(perTypeFail.values()).reduce((a, b) => a + b, 0)
const total = nodeIds.length
console.log(`safeParse totals — ${totalPass}/${total} pass, ${totalFail} fail`)

// Step 2: parentId reference integrity
type RefIssue = { id: string; type: string; detail: string }
const parentIssues: RefIssue[] = []
for (const id of nodeIds) {
  const n = nodes[id]!
  const pid = n.parentId
  if (pid === null || pid === undefined) continue
  if (typeof pid !== 'string') {
    parentIssues.push({ id, type: n.type, detail: `parentId not string (${typeof pid})` })
    continue
  }
  if (!(pid in nodes)) {
    parentIssues.push({ id, type: n.type, detail: `parentId "${pid}" not in dict` })
  }
}

// Step 3: children id references (for string[] children — every node EXCEPT site)
const childIssues: RefIssue[] = []
for (const id of nodeIds) {
  const n = nodes[id]!
  if (n.type === 'site') continue // handled separately in step 4
  const c = n.children
  if (c === undefined) continue
  if (!Array.isArray(c)) {
    childIssues.push({ id, type: n.type, detail: `children not array (${typeof c})` })
    continue
  }
  for (const [i, entry] of c.entries()) {
    if (typeof entry !== 'string') {
      childIssues.push({
        id,
        type: n.type,
        detail: `children[${i}] not string (got ${typeof entry})`,
      })
      continue
    }
    if (!(entry in nodes)) {
      childIssues.push({
        id,
        type: n.type,
        detail: `children[${i}]="${entry}" not in dict`,
      })
    }
  }
}

// Step 4: SiteNode.children must be embedded objects (CROSS_CUTTING §2)
const siteIssues: RefIssue[] = []
const sites = nodeIds.filter((id) => nodes[id]!.type === 'site')
for (const sid of sites) {
  const s = nodes[sid]!
  const c = s.children
  if (!Array.isArray(c)) {
    siteIssues.push({ id: sid, type: 'site', detail: `children not array` })
    continue
  }
  for (const [i, entry] of c.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      siteIssues.push({
        id: sid,
        type: 'site',
        detail: `children[${i}] not object (got ${typeof entry}); spec requires embedded building/item per CROSS_CUTTING §2`,
      })
      continue
    }
    const child = entry as Record<string, unknown>
    if (child.type !== 'building' && child.type !== 'item') {
      siteIssues.push({
        id: sid,
        type: 'site',
        detail: `children[${i}].type="${String(child.type)}" must be building|item`,
      })
    }
    if (typeof child.id !== 'string') {
      siteIssues.push({
        id: sid,
        type: 'site',
        detail: `children[${i}].id missing or non-string`,
      })
    }
  }
}

// Step 5: sanity checks — AnyNode.parse (throwing) on 1 of each kind
const sanity: SanityRow[] = []
function firstOfType(t: string): NodeRecord | undefined {
  for (const id of nodeIds) {
    if (nodes[id]!.type === t) return nodes[id]
  }
  return undefined
}
const sanityKinds: SanityRow['kind'][] = ['wall', 'door', 'window', 'zone', 'fence', 'slab']
for (const kind of sanityKinds) {
  const n = firstOfType(kind)
  if (!n) {
    sanity.push({ kind, id: '-', status: 'FAIL', detail: `no ${kind} found in scene` })
    continue
  }
  try {
    AnyNode.parse(n)
    sanity.push({ kind, id: n.id, status: 'PASS', detail: 'parsed without throw' })
    console.log(`[PASS] sanity ${kind} ${n.id}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message.replace(/\n/g, ' ').slice(0, 400) : String(err)
    sanity.push({ kind, id: n.id, status: 'FAIL', detail: msg })
    console.log(`[FAIL] sanity ${kind} ${n.id} — ${msg}`)
  }
}

// ---- Build report ------------------------------------------------------
const allTypes = Array.from(perTypeTotal.keys()).sort()
const perTypeTableRows = allTypes.map((t) => {
  const tot = perTypeTotal.get(t) ?? 0
  const pass = perTypePass.get(t) ?? 0
  const fail = perTypeFail.get(t) ?? 0
  return `| ${t} | ${tot} | ${pass} | ${fail} |`
})

const fmtIssues = (rows: RefIssue[]): string =>
  rows.length === 0
    ? '_None._'
    : rows.map((r) => `- \`${r.id}\` (${r.type}): ${r.detail}`).join('\n')

const fmtFailures = (rows: FailureRow[]): string =>
  rows.length === 0
    ? '_No validation failures._'
    : rows.map((r) => `- \`${r.id}\` (${r.type}): ${r.error}`).join('\n')

const sanityRows = sanity
  .map((s) => `| ${s.kind} | \`${s.id}\` | ${s.status} | ${s.detail} |`)
  .join('\n')

const overallStatus =
  totalFail === 0 &&
  parentIssues.length === 0 &&
  childIssues.length === 0 &&
  siteIssues.length === 0
    ? 'PASS'
    : 'FAIL'
const sanityOverall = sanity.every((s) => s.status === 'PASS') ? 'PASS' : 'FAIL'

const md = `# Phase 9 Verifier V1 — Villa Azul Zod Schema Validation

- Scene: \`${SCENE_PATH}\`
- Scene id: \`${scene.meta.id}\`
- Scene name: \`${scene.meta.name}\`
- Declared nodeCount: ${scene.meta.nodeCount}
- Dict size: ${total}
- AnyNode.safeParse: **${totalPass}/${total} pass, ${totalFail} fail**
- parentId integrity: **${parentIssues.length === 0 ? 'PASS' : 'FAIL'}** (${parentIssues.length} issue${parentIssues.length === 1 ? '' : 's'})
- children[] id integrity (non-site): **${childIssues.length === 0 ? 'PASS' : 'FAIL'}** (${childIssues.length} issue${childIssues.length === 1 ? '' : 's'})
- SiteNode.children embedded objects (CROSS_CUTTING §2): **${siteIssues.length === 0 ? 'PASS' : 'FAIL'}** (${siteIssues.length} issue${siteIssues.length === 1 ? '' : 's'})
- Sanity parse (wall/door/window/zone/fence/slab): **${sanityOverall}**
- **Overall: ${overallStatus}**

## Per-type counts

| type | total | pass | fail |
| --- | --- | --- | --- |
${perTypeTableRows.join('\n')}
| **TOTAL** | **${total}** | **${totalPass}** | **${totalFail}** |

## AnyNode.safeParse failures

${fmtFailures(failures)}

## parentId reference issues

${fmtIssues(parentIssues)}

## children[] reference issues (non-site nodes)

${fmtIssues(childIssues)}

## SiteNode.children embedded-object check (CROSS_CUTTING §2)

${fmtIssues(siteIssues)}

Per CROSS_CUTTING §2, \`SiteNode.children\` is declared as
\`z.array(z.discriminatedUnion('type', [BuildingNode, ItemNode]))\` and must hold
full embedded building/item objects, not string ids. All other containers use
\`string[]\`.

## Sanity-parse results (AnyNode.parse, throwing)

| kind | id | status | detail |
| --- | --- | --- | --- |
${sanityRows}

## Source

- Script: \`packages/mcp/test-reports/villa-azul/v1-schema.ts\`
- Input: \`${SCENE_PATH}\`
- Schema: \`@pascal-app/core/schema\` (AnyNode discriminated union)
`

writeFileSync(REPORT_PATH, md)
console.log(`Wrote ${REPORT_PATH}`)
console.log(`Overall: ${overallStatus}`)

// Exit non-zero on any failure for CI-style signaling (not strictly required).
if (overallStatus !== 'PASS' || sanityOverall !== 'PASS') {
  process.exitCode = 1
}
