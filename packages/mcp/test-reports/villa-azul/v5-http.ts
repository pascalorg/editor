/**
 * Villa Azul — Phase 9 Verifier V5 (editor HTTP API round-trip).
 * Usage:
 *   bun run packages/mcp/test-reports/villa-azul/v5-http.ts
 * Requires editor running at http://localhost:3002 with sceneId a6e7919eacbe.
 */

const BASE = 'http://localhost:3002'
const SCENE_ID = 'a6e7919eacbe'

type Check = {
  name: string
  status: 'pass' | 'fail' | 'info'
  httpStatus?: number
  details?: string
}
const results: Check[] = []

function record(
  name: string,
  status: 'pass' | 'fail' | 'info',
  httpStatus: number | undefined,
  details: string,
): void {
  results.push({ name, status, httpStatus, details })
  const tag = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'INFO'
  console.log(`[${tag}] ${name}${httpStatus !== undefined ? ` (${httpStatus})` : ''} — ${details}`)
}

function assertEq<T>(actual: T, expected: T, label: string): string | null {
  if (actual === expected) return null
  return `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
}

// 1. GET /api/scenes contains Villa Azul
{
  const r = await fetch(`${BASE}/api/scenes`)
  const body = (await r.json()) as { scenes: Array<{ id: string; name: string }> }
  const hit = body.scenes?.find((s) => s.id === SCENE_ID)
  const nameOk = hit?.name === 'Villa Azul'
  const idOk = hit?.id === SCENE_ID
  record(
    '01 GET /api/scenes lists Villa Azul',
    r.status === 200 && nameOk && idOk ? 'pass' : 'fail',
    r.status,
    `found=${!!hit} name=${hit?.name ?? 'n/a'} total=${body.scenes?.length ?? 0}`,
  )
}

// 2. GET /api/scenes/:id — headers + shape
let initialScene: {
  id: string
  name: string
  version: number
  nodeCount: number
  graph: { nodes: Record<string, { type: string }>; rootNodeIds: string[] }
} | null = null
{
  const r = await fetch(`${BASE}/api/scenes/${SCENE_ID}`)
  const etag = r.headers.get('etag')
  const ctype = r.headers.get('content-type')
  const body = (await r.json()) as typeof initialScene
  initialScene = body
  const shapeErr =
    assertEq(typeof body?.id, 'string', 'id') ||
    assertEq(typeof body?.name, 'string', 'name') ||
    assertEq(typeof body?.version, 'number', 'version') ||
    assertEq(typeof body?.nodeCount, 'number', 'nodeCount') ||
    assertEq(typeof body?.graph?.nodes, 'object', 'graph.nodes') ||
    assertEq(Array.isArray(body?.graph?.rootNodeIds), true, 'graph.rootNodeIds')
  const headersOk = etag === '"1"' && ctype?.startsWith('application/json')
  record(
    '02 GET /api/scenes/:id headers+shape',
    r.status === 200 && headersOk && !shapeErr ? 'pass' : 'fail',
    r.status,
    `ETag=${etag} Content-Type=${ctype}${shapeErr ? ` ${shapeErr}` : ''}`,
  )
}

// 3. nodeCount === 56 and keys length === 56
{
  const bodyCount = initialScene?.nodeCount
  const keyLen = initialScene ? Object.keys(initialScene.graph.nodes).length : 0
  const ok = bodyCount === 56 && keyLen === 56
  record(
    '03 nodeCount & graph.nodes keys === 56',
    ok ? 'pass' : 'fail',
    200,
    `nodeCount=${bodyCount} keys=${keyLen}`,
  )
}

// 4. Type counts match build summary
{
  const expected: Record<string, number> = {
    site: 1,
    building: 1,
    level: 1,
    wall: 12,
    zone: 13,
    door: 10,
    window: 12,
    slab: 1,
    fence: 5,
  }
  const actual: Record<string, number> = {}
  if (initialScene) {
    for (const node of Object.values(initialScene.graph.nodes)) {
      actual[node.type] = (actual[node.type] ?? 0) + 1
    }
  }
  const mismatches: string[] = []
  for (const [t, n] of Object.entries(expected)) {
    if (actual[t] !== n) mismatches.push(`${t}: expected ${n}, got ${actual[t] ?? 0}`)
  }
  record(
    '04 type counts match build summary',
    mismatches.length === 0 ? 'pass' : 'fail',
    200,
    mismatches.length ? mismatches.join('; ') : JSON.stringify(actual),
  )
}

// 5. GET /api/scenes/nonexistent-id → 404 {error:'not_found'}
{
  const r = await fetch(`${BASE}/api/scenes/nonexistent-id`)
  let body: unknown = null
  try {
    body = await r.json()
  } catch {}
  const ok = r.status === 404 && (body as { error?: string })?.error === 'not_found'
  record(
    '05 404 not_found on bad id',
    ok ? 'pass' : 'fail',
    r.status,
    `body=${JSON.stringify(body)}`,
  )
}

// 6. GET /api/scenes?limit=1 → 1 scene
{
  const r = await fetch(`${BASE}/api/scenes?limit=1`)
  const body = (await r.json()) as { scenes: unknown[] }
  const ok = r.status === 200 && Array.isArray(body.scenes) && body.scenes.length === 1
  record(
    '06 GET /api/scenes?limit=1 returns 1',
    ok ? 'pass' : 'fail',
    r.status,
    `count=${body.scenes?.length ?? 'n/a'}`,
  )
}

// 7. HEAD /api/scenes/:id — document 200 or 405
let headStatus = 0
{
  const r = await fetch(`${BASE}/api/scenes/${SCENE_ID}`, { method: 'HEAD' })
  headStatus = r.status
  const ok = r.status === 200 || r.status === 405
  record(
    '07 HEAD /api/scenes/:id behavior',
    ok ? 'pass' : 'fail',
    r.status,
    `HEAD returned ${r.status}${r.status === 200 ? ' (supported)' : r.status === 405 ? ' (method not allowed)' : ' (unexpected)'}`,
  )
}

// 8a. PATCH name=Villa Azul renamed, If-Match:"1" → 200, version=2
{
  const r = await fetch(`${BASE}/api/scenes/${SCENE_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'if-match': '"1"' },
    body: JSON.stringify({ name: 'Villa Azul renamed' }),
  })
  let body: { name?: string; version?: number } = {}
  try {
    body = (await r.json()) as typeof body
  } catch {}
  const ok = r.status === 200 && body.version === 2 && body.name === 'Villa Azul renamed'
  record(
    '08a PATCH rename with If-Match:"1" → v=2',
    ok ? 'pass' : 'fail',
    r.status,
    `name=${body.name} version=${body.version}`,
  )
}

// 8b. PATCH back to 'Villa Azul' with If-Match:"2" → 200, version=3
{
  const r = await fetch(`${BASE}/api/scenes/${SCENE_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'if-match': '"2"' },
    body: JSON.stringify({ name: 'Villa Azul' }),
  })
  let body: { name?: string; version?: number } = {}
  try {
    body = (await r.json()) as typeof body
  } catch {}
  const ok = r.status === 200 && body.version === 3 && body.name === 'Villa Azul'
  record(
    '08b PATCH revert with If-Match:"2" → v=3',
    ok ? 'pass' : 'fail',
    r.status,
    `name=${body.name} version=${body.version}`,
  )
}

// 9. PUT with stale If-Match:"1" → 409
let putStatus = 0
let putBody: unknown = null
{
  // Build a minimal scene payload by fetching current then replaying graph
  const current = await fetch(`${BASE}/api/scenes/${SCENE_ID}`).then((x) => x.json())
  const r = await fetch(`${BASE}/api/scenes/${SCENE_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': '"1"' },
    body: JSON.stringify({
      name: current.name,
      graph: current.graph,
    }),
  })
  putStatus = r.status
  try {
    putBody = await r.json()
  } catch {}
  const ok = r.status === 409
  record(
    '09 PUT with stale If-Match:"1" → 409',
    ok ? 'pass' : 'fail',
    r.status,
    `body=${JSON.stringify(putBody)}`,
  )
}

// Write report
const passCount = results.filter((r) => r.status === 'pass').length
const failCount = results.filter((r) => r.status === 'fail').length
const lines: string[] = []
lines.push('# Villa Azul — Phase 9 Verifier V5 (HTTP round-trip)')
lines.push('')
lines.push(`- Date: 2026-04-18`)
lines.push(`- Base URL: ${BASE}`)
lines.push(`- Scene ID: ${SCENE_ID}`)
lines.push(
  `- Result: ${failCount === 0 ? 'ALL PASS' : `${failCount} FAIL`} (${passCount}/${results.length})`,
)
lines.push('')
lines.push('## HTTP Status Code Matrix')
lines.push('')
lines.push('| # | Check | HTTP | Status |')
lines.push('|---|---|---|---|')
for (const r of results) {
  lines.push(
    `| ${r.name.split(' ')[0]} | ${r.name.replace(/^\S+\s/, '')} | ${r.httpStatus ?? '-'} | ${r.status.toUpperCase()} |`,
  )
}
lines.push('')
lines.push('## Details')
lines.push('')
for (const r of results) {
  lines.push(`### ${r.name}`)
  lines.push(`- HTTP: ${r.httpStatus ?? 'n/a'}`)
  lines.push(`- Status: ${r.status.toUpperCase()}`)
  lines.push(`- Details: ${r.details ?? ''}`)
  lines.push('')
}
lines.push('## Notes')
lines.push('')
lines.push(
  `- HEAD /api/scenes/:id returned **${headStatus}** — ${headStatus === 200 ? 'supported (Next.js returns HEAD for GET handlers by default).' : headStatus === 405 ? 'not allowed.' : 'unexpected status.'}`,
)
lines.push(
  `- Final scene version after PATCH sequence: **3** (was 1; bumped to 2 then 3). The name was restored to 'Villa Azul' so downstream verifiers see the original name.`,
)
lines.push(
  `- PUT with stale If-Match "1" returned **${putStatus}** (expected 409 since version is now 3).`,
)

await Bun.write(
  '/Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/test-reports/villa-azul/v5-http.md',
  lines.join('\n') + '\n',
)
console.log('\nReport written. Pass/Fail:', passCount, '/', results.length)
if (failCount > 0) process.exit(1)
