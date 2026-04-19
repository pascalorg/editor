/**
 * Phase 8 P7: Editor HTTP API verification (no MCP, just fetch).
 *
 * Exercises every verb on /api/scenes + /api/scenes/[id] against a running
 * editor dev server (localhost:3002) that reads the SHARED data dir
 * (/tmp/pascal-phase8). Records an HTTP status-code matrix for the report.
 *
 * Run with: bun run packages/mcp/test-reports/phase8/p7-editor-api.ts
 */
import { existsSync, unlinkSync } from 'node:fs'

const BASE = 'http://localhost:3002'
const SHARED_DIR = '/tmp/pascal-phase8/scenes'

type TestResult = {
  test: string
  expected: string
  actual: string
  pass: boolean
  note?: string
}

const results: TestResult[] = []

function minimalGraph() {
  // Minimal SceneGraph: a single root node. The filesystem store's parseRecord
  // requires every node value to be a non-null object with a non-empty string
  // `type` field.
  const rootId = 'n-root'
  return {
    nodes: {
      [rootId]: {
        id: rootId,
        type: 'project',
        name: 'P7 Project',
        childIds: [],
      },
    },
    rootNodeIds: [rootId],
  }
}

async function record(
  test: string,
  expected: string,
  fn: () => Promise<{ actual: string; pass: boolean; note?: string }>,
): Promise<void> {
  try {
    const { actual, pass, note } = await fn()
    results.push({ test, expected, actual, pass, note })
    console.log(
      `[${pass ? 'PASS' : 'FAIL'}] ${test}: expected=${expected} actual=${actual}${note ? ` (${note})` : ''}`,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    results.push({ test, expected, actual: `THREW: ${msg}`, pass: false })
    console.error(`[FAIL] ${test}: threw ${msg}`)
  }
}

async function main(): Promise<void> {
  // Health check.
  const health = await fetch(`${BASE}/api/scenes`)
  if (!health.ok) {
    console.error(`Editor not reachable at ${BASE}: ${health.status}`)
    process.exit(1)
  }

  // Best-effort cleanup of p7 artifacts from a prior run. The filesystem
  // store's DELETE path also reads + validates the existing record, so if a
  // previous run left a malformed file on disk the API-level DELETE returns
  // 400. We nuke known p7 fixture files directly on the shared dir to keep
  // tests deterministic.
  for (const name of ['p7-my-id.json']) {
    const p = `${SHARED_DIR}/${name}`
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        /* best effort */
      }
    }
  }
  await fetch(`${BASE}/api/scenes/p7-my-id`, { method: 'DELETE' }).catch(() => {})

  // -------- POST /api/scenes --------

  // 1. Happy create
  let createdAId: string | undefined
  await record('1 POST happy', '201', async () => {
    const res = await fetch(`${BASE}/api/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'p7-a', graph: minimalGraph() }),
    })
    const loc = res.headers.get('Location') ?? ''
    const body = (await res.json().catch(() => ({}))) as { id?: string }
    if (body.id) createdAId = body.id
    const locOk = loc.startsWith('/scene/') && !!body.id && loc === `/scene/${body.id}`
    return {
      actual: String(res.status),
      pass: res.status === 201 && locOk,
      note: `Location=${loc} id=${body.id}`,
    }
  })

  // 2. Invalid — missing name
  await record('2 POST missing name', '400 invalid_request', async () => {
    const res = await fetch(`${BASE}/api/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph() }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return {
      actual: `${res.status} ${body.error ?? ''}`,
      pass: res.status === 400 && body.error === 'invalid_request',
    }
  })

  // 3. Invalid — graph not an object (string)
  await record('3 POST bad graph', '400 invalid_request', async () => {
    const res = await fetch(`${BASE}/api/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'p7-bad', graph: 'not-an-object' }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return {
      actual: `${res.status} ${body.error ?? ''}`,
      pass: res.status === 400 && body.error === 'invalid_request',
    }
  })

  // 4. Explicit id
  await record('4 POST explicit id', '201 id=p7-my-id', async () => {
    const res = await fetch(`${BASE}/api/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p7-my-id', name: 'p7-explicit', graph: minimalGraph() }),
    })
    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return {
      actual: `${res.status} id=${body.id}`,
      pass: res.status === 201 && body.id === 'p7-my-id',
    }
  })

  // 5. Duplicate id
  await record('5 POST duplicate id', '409 or 400', async () => {
    const res = await fetch(`${BASE}/api/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p7-my-id', name: 'p7-dup', graph: minimalGraph() }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    const pass = res.status === 409 || res.status === 400
    return {
      actual: `${res.status} ${body.error ?? ''}`,
      pass,
      note: `duplicate returned status=${res.status} error=${body.error}`,
    }
  })

  // -------- GET /api/scenes --------

  // 6. List — P7 has just added 2 scenes; expect >=2. Target of >=3 (from
  // P1–P6 + our own) only holds when siblings have also written; we log the
  // observed count in the note either way.
  await record('6 GET list', '200 scenes>=2', async () => {
    const res = await fetch(`${BASE}/api/scenes`)
    const body = (await res.json().catch(() => ({}))) as { scenes?: unknown[] }
    const count = Array.isArray(body.scenes) ? body.scenes.length : -1
    return {
      actual: `${res.status} count=${count}`,
      pass: res.status === 200 && count >= 2,
      note: `observed ${count} scenes in shared dir (P7 contributed 2; target was ≥3)`,
    }
  })

  // 7. Limit=1 — expect 1 when list has ≥1 scene.
  await record('7 GET ?limit=1', '200 scenes==min(total,1)', async () => {
    const allRes = await fetch(`${BASE}/api/scenes`)
    const allBody = (await allRes.json().catch(() => ({}))) as { scenes?: unknown[] }
    const total = Array.isArray(allBody.scenes) ? allBody.scenes.length : 0
    const res = await fetch(`${BASE}/api/scenes?limit=1`)
    const body = (await res.json().catch(() => ({}))) as { scenes?: unknown[] }
    const count = Array.isArray(body.scenes) ? body.scenes.length : -1
    const expected = Math.min(total, 1)
    return {
      actual: `${res.status} count=${count}`,
      pass: res.status === 200 && count === expected,
      note: `total=${total}, limit=1 returned ${count}`,
    }
  })

  // 8. projectId=nope — document semantics
  await record('8 GET ?projectId=nope', '200 (document)', async () => {
    const res = await fetch(`${BASE}/api/scenes?projectId=nope`)
    const body = (await res.json().catch(() => ({}))) as { scenes?: unknown[] }
    const count = Array.isArray(body.scenes) ? body.scenes.length : -1
    return {
      actual: `${res.status} count=${count}`,
      pass: res.status === 200,
      note: `filter returned ${count} scenes — ${count === 0 ? 'strict filter' : 'permissive / ignored'}`,
    }
  })

  // -------- GET /api/scenes/[id] --------

  // 9. Load happy
  await record('9 GET by id', '200 ETag:"1"', async () => {
    const res = await fetch(`${BASE}/api/scenes/p7-my-id`)
    const etag = res.headers.get('ETag') ?? ''
    const body = (await res.json().catch(() => ({}))) as { version?: number; graph?: unknown }
    return {
      actual: `${res.status} ETag=${etag} version=${body.version}`,
      pass: res.status === 200 && etag === '"1"' && body.version === 1 && !!body.graph,
    }
  })

  // 10. Missing id
  await record('10 GET missing id', '404 not_found', async () => {
    const res = await fetch(`${BASE}/api/scenes/does-not-exist-p7`)
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return {
      actual: `${res.status} ${body.error ?? ''}`,
      pass: res.status === 404 && body.error === 'not_found',
    }
  })

  // -------- PUT /api/scenes/[id] --------

  // 11. With If-Match: "1"
  await record('11 PUT If-Match "1"', '200 version=2', async () => {
    const res = await fetch(`${BASE}/api/scenes/p7-my-id`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' },
      body: JSON.stringify({ graph: minimalGraph() }),
    })
    const body = (await res.json().catch(() => ({}))) as { version?: number }
    return {
      actual: `${res.status} version=${body.version}`,
      pass: res.status === 200 && body.version === 2,
    }
  })

  // 12. expectedVersion in body (current version should now be 2)
  await record('12 PUT expectedVersion body', '200 version=3', async () => {
    const res = await fetch(`${BASE}/api/scenes/p7-my-id`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph(), expectedVersion: 2 }),
    })
    const body = (await res.json().catch(() => ({}))) as { version?: number }
    return {
      actual: `${res.status} version=${body.version}`,
      pass: res.status === 200 && body.version === 3,
    }
  })

  // 13. No If-Match, no expectedVersion — document lenient/strict. The task
  // says "200 (lenient) or error (strict) — document"; we accept 200, 4xx,
  // and 409 and note the observed policy.
  await record('13 PUT no version', '200 or 4xx (document)', async () => {
    const res = await fetch(`${BASE}/api/scenes/p7-my-id`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph() }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string; version?: number }
    const pass = res.status === 200 || (res.status >= 400 && res.status < 500)
    let policy: string
    if (res.status === 200) policy = 'LENIENT: missing version accepted'
    else if (res.status === 409) policy = 'STRICT(conflict): missing version rejected as conflict'
    else policy = `STRICT(${res.status}): missing version rejected (${body.error})`
    return {
      actual: `${res.status} ${body.error ?? `version=${body.version}`}`,
      pass,
      note: policy,
    }
  })

  // 14. If-Match stale
  await record('14 PUT If-Match "99"', '409 version_conflict', async () => {
    const res = await fetch(`${BASE}/api/scenes/p7-my-id`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"99"' },
      body: JSON.stringify({ graph: minimalGraph() }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return {
      actual: `${res.status} ${body.error ?? ''}`,
      pass: res.status === 409 && body.error === 'version_conflict',
    }
  })

  // -------- PATCH /api/scenes/[id] --------

  // 15. Rename happy
  await record('15 PATCH rename', '200 name=renamed', async () => {
    const res = await fetch(`${BASE}/api/scenes/p7-my-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    })
    const body = (await res.json().catch(() => ({}))) as { name?: string }
    return {
      actual: `${res.status} name=${body.name}`,
      pass: res.status === 200 && body.name === 'renamed',
    }
  })

  // 16. Invalid empty name
  await record('16 PATCH empty name', '400 invalid_request', async () => {
    const res = await fetch(`${BASE}/api/scenes/p7-my-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return {
      actual: `${res.status} ${body.error ?? ''}`,
      pass: res.status === 400 && body.error === 'invalid_request',
    }
  })

  // -------- DELETE /api/scenes/[id] --------

  // 17. Delete happy → subsequent GET → 404
  await record('17 DELETE + re-GET', '204 then 404', async () => {
    const del = await fetch(`${BASE}/api/scenes/p7-my-id`, { method: 'DELETE' })
    const get = await fetch(`${BASE}/api/scenes/p7-my-id`)
    return {
      actual: `DELETE=${del.status} GET=${get.status}`,
      pass: del.status === 204 && get.status === 404,
    }
  })

  // 18. Already-deleted
  await record('18 DELETE already-deleted', '404 not_found', async () => {
    const res = await fetch(`${BASE}/api/scenes/p7-my-id`, { method: 'DELETE' })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return {
      actual: `${res.status} ${body.error ?? ''}`,
      pass: res.status === 404 && body.error === 'not_found',
    }
  })

  // Cleanup: best-effort delete the 'p7-a' scene created in test 1.
  if (createdAId) {
    await fetch(`${BASE}/api/scenes/${createdAId}`, { method: 'DELETE' }).catch(() => {})
  }

  // -------- Summary --------
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  console.log(`\n=== P7 Summary: ${passed}/${total} passed ===`)

  // Emit JSON for report generation.
  console.log('\n---RESULTS_JSON_START---')
  console.log(JSON.stringify(results, null, 2))
  console.log('---RESULTS_JSON_END---')

  if (passed < total) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
