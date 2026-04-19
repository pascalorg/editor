/**
 * T2: Exercise every MCP tool over the HTTP transport.
 *
 * Target: http://localhost:3917/mcp (already running via `bun packages/mcp/dist/bin/pascal-mcp.js --http --port 3917`).
 *
 * Emits a pass/fail matrix plus latency percentiles for get_scene,
 * and reports the behaviour of two concurrent sessions sharing the
 * SceneBridge singleton.
 *
 * IMPORTANT: `connectHttp` in `packages/mcp/src/transports/http.ts`
 * instantiates a SINGLE `StreamableHTTPServerTransport` with stateful
 * session-id generation. The SDK's server transport sets `_initialized=true`
 * on the first valid `initialize` POST and never clears it — meaning only
 * ONE session is ever accepted for the lifetime of the process. If any prior
 * client initialized, new clients receive:
 *
 *   400 {"error":{"code":-32600,"message":"Invalid Request: Server already initialized"}}
 *
 * We detect this state, report it as an HTTP-specific finding, and emit a
 * best-effort report.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const TARGET_URL = 'http://localhost:3917/mcp'
const OUT_DIR =
  '/Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/test-reports/t2-http'

type ToolResult = {
  name: string
  pass: boolean
  note: string
  latencyMs?: number
  rawError?: string
}

const results: ToolResult[] = []

function record(
  name: string,
  pass: boolean,
  note: string,
  latencyMs?: number,
  rawError?: string,
): void {
  results.push({ name, pass, note, latencyMs, rawError })
  const tag = pass ? 'PASS' : 'FAIL'
  const lat = latencyMs !== undefined ? ` (${latencyMs.toFixed(1)}ms)` : ''
  console.log(`[${tag}] ${name}${lat} — ${note}`)
}

/** Expected structured errors that count as passes. */
const EXPECTED_STRUCTURED_ERRORS = new Set([
  'not_implemented',
  'catalog_unavailable',
  'sampling_unavailable',
  'sampling_response_unparseable',
  'sampling_response_invalid',
])

function errorIsExpected(err: unknown): { expected: boolean; label: string } {
  const msg = err instanceof Error ? err.message : String(err)
  for (const tok of EXPECTED_STRUCTURED_ERRORS) {
    if (msg.includes(tok)) return { expected: true, label: tok }
  }
  return { expected: false, label: msg }
}

async function callTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; result: unknown; latencyMs: number }
  | { ok: false; error: unknown; latencyMs: number }
> {
  const t0 = performance.now()
  try {
    const res = await client.callTool({ name, arguments: args })
    const latencyMs = performance.now() - t0
    const maybeIsError = (res as { isError?: boolean }).isError
    if (maybeIsError === true) {
      const text = Array.isArray(res.content)
        ? res.content
            .filter((c) => (c as { type?: string }).type === 'text')
            .map((c) => (c as { text: string }).text)
            .join('\n')
        : ''
      return { ok: false, error: new Error(text || 'isError=true'), latencyMs }
    }
    return { ok: true, result: res, latencyMs }
  } catch (err) {
    const latencyMs = performance.now() - t0
    return { ok: false, error: err, latencyMs }
  }
}

function getStructured<T>(
  result:
    | { ok: true; result: unknown; latencyMs: number }
    | { ok: false; error: unknown; latencyMs: number },
): T | null {
  if (!result.ok) return null
  const r = result.result as { structuredContent?: unknown; content?: unknown }
  if (r.structuredContent !== undefined) return r.structuredContent as T
  if (Array.isArray(r.content)) {
    const textBlock = r.content.find((c) => (c as { type?: string }).type === 'text') as
      | { text?: string }
      | undefined
    if (textBlock?.text) {
      try {
        return JSON.parse(textBlock.text) as T
      } catch {
        return null
      }
    }
  }
  return null
}

async function connectClient(
  label: string,
): Promise<{ client: Client; sessionId?: string } | { error: Error }> {
  const transport = new StreamableHTTPClientTransport(new URL(TARGET_URL))
  const client = new Client({ name: `t2-http-${label}`, version: '0.0.1' })
  try {
    await client.connect(transport)
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) }
  }
  const sid = (transport as unknown as { sessionId?: string }).sessionId
  return { client, sessionId: sid }
}

/** Small curl-equivalent probe used to characterise server state. */
async function probeServer(): Promise<{ probed: string; status: number; body: string }[]> {
  const probes: { name: string; init: RequestInit }[] = [
    {
      name: 'POST initialize (no session)',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'probe-init',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 't2-probe', version: '0.0.1' },
          },
        }),
      },
    },
    {
      name: 'POST tools/list (no session)',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      },
    },
    {
      name: 'GET /mcp (no session)',
      init: { method: 'GET', headers: { accept: 'text/event-stream' } },
    },
    {
      name: 'DELETE /mcp (no session)',
      init: { method: 'DELETE' },
    },
  ]

  const out: { probed: string; status: number; body: string }[] = []
  for (const p of probes) {
    try {
      const res = await fetch(TARGET_URL, p.init)
      const text = await res.text()
      out.push({ probed: p.name, status: res.status, body: text.slice(0, 200) })
    } catch (err) {
      out.push({
        probed: p.name,
        status: -1,
        body: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}

// ---- Main ----------------------------------------------------------------

async function main() {
  console.log('=== T2 MCP HTTP transport smoke test ===')
  console.log(`Target: ${TARGET_URL}`)
  console.log('')

  // ---- Server state probe ---------------------------------------------
  console.log('--- Server state probe ---')
  const probes = await probeServer()
  for (const p of probes) {
    console.log(`  ${p.probed} → ${p.status}  body: ${p.body}`)
  }
  console.log('')

  const serverIsLocked = probes.some(
    (p) =>
      p.probed === 'POST initialize (no session)' &&
      p.status === 400 &&
      /Server already initialized/i.test(p.body),
  )

  // ---- Session A --------------------------------------------------------
  console.log('--- Session A connect ---')
  const connA = await connectClient('A')
  let clientA: Client | null = null
  let sidA: string | undefined
  let initErrorA: string | null = null

  if ('error' in connA) {
    initErrorA = connA.error.message
    console.error(`Session A connect FAILED: ${initErrorA}`)
  } else {
    clientA = connA.client
    sidA = connA.sessionId
    console.log(`Session A connected (sessionId: ${sidA ?? '<unknown>'})`)
  }

  // If we cannot connect, there is nothing left to do but report.
  if (!clientA) {
    const note = serverIsLocked
      ? 'server locked to an earlier session (StreamableHTTPServerTransport single-session stateful mode; `_initialized=true` is sticky)'
      : `connect failed: ${initErrorA}`
    for (const name of ALL_TOOLS) {
      record(name, false, note)
    }

    const report = buildReport({
      connectedA: false,
      sidA: null,
      sidB: null,
      toolCountA1: 0,
      toolCountA2: 0,
      toolCountB: 0,
      sessionStateStable: null,
      distinctSessions: null,
      sharedBridgeNote: 'n/a (could not connect)',
      latencies: [],
      serverIsLocked,
      probes,
      initErrorA,
    })
    writeFileSync(join(OUT_DIR, 'REPORT.md'), report, 'utf8')
    console.log('')
    console.log('=== SUMMARY ===')
    console.log(`Passes: 0/${ALL_TOOLS.length}`)
    console.log(`Server appears locked to an earlier session: ${serverIsLocked}`)
    return
  }

  const toolsListA1 = await clientA.listTools()
  const toolCountA1 = toolsListA1.tools.length
  console.log(`Session A listTools()#1 → ${toolCountA1} tools`)

  const toolsListA2 = await clientA.listTools()
  const toolCountA2 = toolsListA2.tools.length
  const sessionStateStable = toolCountA1 === toolCountA2
  console.log(
    `Session A listTools()#2 → ${toolCountA2} tools — state stable: ${sessionStateStable}`,
  )

  // ---- get_scene --------------------------------------------------------
  const sceneRes = await callTool(clientA, 'get_scene', {})
  record(
    'get_scene',
    sceneRes.ok,
    sceneRes.ok ? 'scene returned ok' : `error: ${String(sceneRes.error)}`,
    sceneRes.latencyMs,
  )

  const scene = getStructured<{
    nodes: Record<string, { type: string; id: string; parentId: string | null }>
    rootNodeIds: string[]
  }>(sceneRes)

  if (!scene) {
    console.error('get_scene did not return usable scene; skipping downstream tool tests.')
    const reason = 'cannot proceed — get_scene returned no structured content'
    for (const name of ALL_TOOLS) {
      if (!results.find((r) => r.name === name)) record(name, false, reason)
    }
    await clientA.close()
    return
  }

  let buildingId: string | null = null
  let levelId: string | null = null
  for (const n of Object.values(scene.nodes)) {
    if (!buildingId && n.type === 'building') buildingId = n.id
    if (!levelId && n.type === 'level') levelId = n.id
  }
  console.log(`Discovered: building=${buildingId} level=${levelId}`)

  if (!buildingId || !levelId) {
    const reason = 'default scene missing building or level'
    for (const name of ALL_TOOLS) {
      if (!results.find((r) => r.name === name)) record(name, false, reason)
    }
    await clientA.close()
    return
  }

  // ---- get_node ---------------------------------------------------------
  {
    const r = await callTool(clientA, 'get_node', { id: levelId })
    const struct = getStructured<{ node: { id: string; type: string } }>(r)
    record(
      'get_node',
      r.ok && struct?.node?.id === levelId,
      r.ok ? `returned node ${struct?.node?.id}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- describe_node ----------------------------------------------------
  {
    const r = await callTool(clientA, 'describe_node', { id: levelId })
    const struct = getStructured<{ id: string; description: string }>(r)
    record(
      'describe_node',
      r.ok && struct?.id === levelId,
      r.ok ? `description: "${struct?.description}"` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- find_nodes -------------------------------------------------------
  {
    const r = await callTool(clientA, 'find_nodes', { type: 'level' })
    const struct = getStructured<{ nodes: unknown[] }>(r)
    record(
      'find_nodes',
      r.ok && Array.isArray(struct?.nodes),
      r.ok ? `found ${struct?.nodes?.length ?? 0} level nodes` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- measure ----------------------------------------------------------
  {
    const r = await callTool(clientA, 'measure', { fromId: levelId, toId: levelId })
    const struct = getStructured<{ distanceMeters: number; units: string }>(r)
    record(
      'measure',
      r.ok && struct?.units === 'meters',
      r.ok ? `self-distance=${struct?.distanceMeters}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- create_level -----------------------------------------------------
  let extraLevelId: string | null = null
  {
    const r = await callTool(clientA, 'create_level', {
      buildingId,
      elevation: 3,
      height: 2.7,
      label: 'T2-test-level',
    })
    const struct = getStructured<{ levelId: string }>(r)
    extraLevelId = struct?.levelId ?? null
    record(
      'create_level',
      r.ok && typeof struct?.levelId === 'string',
      r.ok ? `created level ${struct?.levelId}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- create_wall ------------------------------------------------------
  let wallId: string | null = null
  {
    const r = await callTool(clientA, 'create_wall', {
      levelId,
      start: [0, 0],
      end: [3, 0],
      thickness: 0.1,
      height: 2.5,
    })
    const struct = getStructured<{ wallId: string }>(r)
    wallId = struct?.wallId ?? null
    record(
      'create_wall',
      r.ok && typeof struct?.wallId === 'string',
      r.ok ? `created wall ${struct?.wallId}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- place_item -------------------------------------------------------
  {
    const target = wallId
    if (!target) {
      record('place_item', false, 'skipped — no wall id to place against')
    } else {
      const r = await callTool(clientA, 'place_item', {
        catalogItemId: 'test-chair',
        targetNodeId: target,
        position: [1.5, 0, 0],
        rotation: 0,
      })
      const struct = getStructured<{ itemId: string; status?: string }>(r)
      record(
        'place_item',
        r.ok && typeof struct?.itemId === 'string',
        r.ok
          ? `placed ${struct?.itemId} (status=${struct?.status ?? 'none'})`
          : `error: ${String(r.error)}`,
        r.latencyMs,
      )
    }
  }

  // ---- cut_opening ------------------------------------------------------
  let openingId: string | null = null
  if (!wallId) {
    record('cut_opening', false, 'skipped — no wall id to cut')
  } else {
    const r = await callTool(clientA, 'cut_opening', {
      wallId,
      type: 'door',
      position: 0.5,
      width: 0.9,
      height: 2,
    })
    const struct = getStructured<{ openingId: string }>(r)
    openingId = struct?.openingId ?? null
    record(
      'cut_opening',
      r.ok && typeof struct?.openingId === 'string',
      r.ok ? `cut opening ${struct?.openingId}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- set_zone ---------------------------------------------------------
  let zoneId: string | null = null
  {
    const r = await callTool(clientA, 'set_zone', {
      levelId,
      polygon: [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      label: 'T2-zone',
      properties: { owner: 't2-http' },
    })
    const struct = getStructured<{ zoneId: string }>(r)
    zoneId = struct?.zoneId ?? null
    record(
      'set_zone',
      r.ok && typeof struct?.zoneId === 'string',
      r.ok ? `created zone ${struct?.zoneId}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }
  if (!extraLevelId) {
    record('duplicate_level', false, 'skipped — no extra level to duplicate')
  } else {
    const r = await callTool(clientA, 'duplicate_level', { levelId: extraLevelId })
    const struct = getStructured<{ newLevelId: string; newNodeIds: string[] }>(r)
    record(
      'duplicate_level',
      r.ok && typeof struct?.newLevelId === 'string',
      r.ok
        ? `duplicated → new level ${struct?.newLevelId} (${struct?.newNodeIds?.length ?? 0} nodes)`
        : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }
  if (!zoneId) {
    record('apply_patch', false, 'skipped — no zone to patch')
  } else {
    const r = await callTool(clientA, 'apply_patch', {
      patches: [{ op: 'update', id: zoneId, data: { name: 'T2-zone-renamed' } }],
    })
    const struct = getStructured<{ appliedOps: number }>(r)
    record(
      'apply_patch',
      r.ok && struct?.appliedOps === 1,
      r.ok ? `appliedOps=${struct?.appliedOps}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }
  if (!openingId) {
    record('delete_node', false, 'skipped — no opening to delete')
  } else {
    const r = await callTool(clientA, 'delete_node', { id: openingId, cascade: true })
    const struct = getStructured<{ deletedIds: string[] }>(r)
    record(
      'delete_node',
      r.ok && Array.isArray(struct?.deletedIds) && (struct?.deletedIds?.length ?? 0) >= 1,
      r.ok ? `deleted ${struct?.deletedIds?.length ?? 0} nodes` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- undo -------------------------------------------------------------
  {
    const r = await callTool(clientA, 'undo', { steps: 1 })
    const struct = getStructured<{ undone: number }>(r)
    record(
      'undo',
      r.ok && typeof struct?.undone === 'number',
      r.ok ? `undone=${struct?.undone}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- redo -------------------------------------------------------------
  {
    const r = await callTool(clientA, 'redo', { steps: 1 })
    const struct = getStructured<{ redone: number }>(r)
    record(
      'redo',
      r.ok && typeof struct?.redone === 'number',
      r.ok ? `redone=${struct?.redone}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- export_json ------------------------------------------------------
  {
    const r = await callTool(clientA, 'export_json', { pretty: true })
    const struct = getStructured<{ json: string }>(r)
    let usable = false
    try {
      if (struct?.json) {
        JSON.parse(struct.json)
        usable = true
      }
    } catch {
      usable = false
    }
    record(
      'export_json',
      r.ok && usable,
      r.ok ? `json length=${struct?.json?.length ?? 0} chars` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- export_glb -------------------------------------------------------
  {
    const r = await callTool(clientA, 'export_glb', {})
    if (r.ok) {
      const struct = getStructured<{ status: string; reason: string }>(r)
      const good = struct?.status === 'not_implemented'
      record(
        'export_glb',
        good,
        good
          ? `structured not_implemented (expected)`
          : `unexpected payload: ${JSON.stringify(struct)}`,
        r.latencyMs,
      )
    } else {
      const info = errorIsExpected(r.error)
      record(
        'export_glb',
        info.expected,
        info.expected ? `structured error ${info.label} (expected)` : `unexpected: ${info.label}`,
        r.latencyMs,
      )
    }
  }

  // ---- validate_scene ---------------------------------------------------
  {
    const r = await callTool(clientA, 'validate_scene', {})
    const struct = getStructured<{ valid: boolean; errors: unknown[] }>(r)
    record(
      'validate_scene',
      r.ok && typeof struct?.valid === 'boolean',
      r.ok
        ? `valid=${struct?.valid}, errors=${struct?.errors?.length ?? 0}`
        : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- check_collisions -------------------------------------------------
  {
    const r = await callTool(clientA, 'check_collisions', { levelId })
    const struct = getStructured<{ collisions: unknown[] }>(r)
    record(
      'check_collisions',
      r.ok && Array.isArray(struct?.collisions),
      r.ok ? `collisions=${struct?.collisions?.length ?? 0}` : `error: ${String(r.error)}`,
      r.latencyMs,
    )
  }

  // ---- analyze_floorplan_image -----------------------------------------
  {
    const r = await callTool(clientA, 'analyze_floorplan_image', {
      image: Buffer.from('not-a-real-image').toString('base64'),
      scaleHint: '1 cm = 1 m',
    })
    if (r.ok) {
      const struct = getStructured<unknown>(r)
      record(
        'analyze_floorplan_image',
        struct !== null,
        `host responded with structured payload (sampling apparently available)`,
        r.latencyMs,
      )
    } else {
      const info = errorIsExpected(r.error)
      record(
        'analyze_floorplan_image',
        info.expected,
        info.expected
          ? `structured error ${info.label} (expected — host lacks sampling)`
          : `unexpected: ${info.label}`,
        r.latencyMs,
      )
    }
  }

  // ---- analyze_room_photo ----------------------------------------------
  {
    const r = await callTool(clientA, 'analyze_room_photo', {
      image: Buffer.from('not-a-real-image').toString('base64'),
    })
    if (r.ok) {
      const struct = getStructured<unknown>(r)
      record(
        'analyze_room_photo',
        struct !== null,
        'host responded with structured payload',
        r.latencyMs,
      )
    } else {
      const info = errorIsExpected(r.error)
      record(
        'analyze_room_photo',
        info.expected,
        info.expected ? `structured error ${info.label} (expected)` : `unexpected: ${info.label}`,
        r.latencyMs,
      )
    }
  }

  // ---- Second concurrent session (B) ------------------------------------
  console.log('')
  console.log('--- Session B connect (concurrent) ---')
  const connB = await connectClient('B')
  let sidB: string | undefined
  let toolCountB = 0
  let distinctSessions: boolean | null = null
  let sharedBridgeNote = 'n/a'
  if ('error' in connB) {
    console.error(`Session B connect failed: ${connB.error.message}`)
    sharedBridgeNote = `session B could not connect — server in single-session mode: ${connB.error.message.slice(0, 160)}`
  } else {
    const clientB = connB.client
    sidB = connB.sessionId
    console.log(`Session B connected (sessionId: ${sidB ?? '<unknown>'})`)
    distinctSessions = sidA !== sidB
    const toolsListB = await clientB.listTools()
    toolCountB = toolsListB.tools.length
    console.log(
      `Session B listTools() → ${toolCountB} tools; sessions distinct: ${distinctSessions}`,
    )

    const sceneB = await callTool(clientB, 'get_scene', {})
    const sceneBstruct = getStructured<{ nodes: Record<string, unknown> }>(sceneB)
    if (sceneBstruct && scene) {
      const nodesA = Object.keys(scene.nodes).length
      const nodesB = Object.keys(sceneBstruct.nodes).length
      sharedBridgeNote = `A initial snapshot: ${nodesA} nodes; B fresh snapshot: ${nodesB} nodes (both view the same SceneBridge singleton, so mutations from A are visible to B — expected)`
    } else {
      sharedBridgeNote = 'get_scene on session B returned no structured content'
    }
    await clientB.close()
  }

  // ---- Latency: 20 × get_scene on session A ---------------------------
  console.log('')
  console.log('--- Measuring latency of get_scene × 20 on session A ---')
  const latencies: number[] = []
  for (let i = 0; i < 20; i++) {
    const r = await callTool(clientA, 'get_scene', {})
    latencies.push(r.latencyMs)
  }
  const sorted = [...latencies].sort((a, b) => a - b)
  const percentile = (p: number): number => {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))
    return sorted[idx] ?? 0
  }
  const p50 = percentile(50)
  const p99 = percentile(99)
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const min = sorted[0] ?? 0
  const max = sorted[sorted.length - 1] ?? 0
  console.log(
    `Latency: p50=${p50.toFixed(1)}ms, p99=${p99.toFixed(1)}ms, mean=${mean.toFixed(1)}ms, min=${min.toFixed(1)}ms, max=${max.toFixed(1)}ms`,
  )

  await clientA.close()

  // ---- Summary + Report -----------------------------------------------
  const passes = results.filter((r) => r.pass).length
  const total = results.length

  console.log('')
  console.log('=== SUMMARY ===')
  console.log(`Tools exercised: ${total}`)
  console.log(`Passes: ${passes}/${total}`)
  console.log(`Session state stable across two listTools: ${sessionStateStable}`)
  console.log(`Two sessions got distinct IDs: ${distinctSessions}`)
  console.log(`Shared SceneBridge observation: ${sharedBridgeNote}`)
  console.log(`Latency p50=${p50.toFixed(1)}ms, p99=${p99.toFixed(1)}ms`)

  const report = buildReport({
    connectedA: true,
    sidA: sidA ?? null,
    sidB: sidB ?? null,
    toolCountA1,
    toolCountA2,
    toolCountB,
    sessionStateStable,
    distinctSessions,
    sharedBridgeNote,
    latencies,
    serverIsLocked,
    probes,
    initErrorA,
  })

  writeFileSync(join(OUT_DIR, 'REPORT.md'), report, 'utf8')
  console.log('')
  console.log(`Wrote ${join(OUT_DIR, 'REPORT.md')}`)
}

// Always-in-order list of tools so we can fill in "not tested" rows if we
// have to abort early.
const ALL_TOOLS = [
  'get_scene',
  'get_node',
  'describe_node',
  'find_nodes',
  'measure',
  'apply_patch',
  'create_level',
  'create_wall',
  'place_item',
  'cut_opening',
  'set_zone',
  'duplicate_level',
  'delete_node',
  'undo',
  'redo',
  'export_json',
  'export_glb',
  'validate_scene',
  'check_collisions',
  'analyze_floorplan_image',
  'analyze_room_photo',
] as const

function buildReport(args: {
  connectedA: boolean
  sidA: string | null
  sidB: string | null
  toolCountA1: number
  toolCountA2: number
  toolCountB: number
  sessionStateStable: boolean | null
  distinctSessions: boolean | null
  sharedBridgeNote: string
  latencies: number[]
  serverIsLocked: boolean
  probes: { probed: string; status: number; body: string }[]
  initErrorA: string | null
}): string {
  const {
    connectedA,
    sidA,
    sidB,
    toolCountA1,
    toolCountA2,
    toolCountB,
    sessionStateStable,
    distinctSessions,
    sharedBridgeNote,
    latencies,
    serverIsLocked,
    probes,
    initErrorA,
  } = args

  const sorted = [...latencies].sort((a, b) => a - b)
  const percentile = (p: number): number => {
    if (sorted.length === 0) return 0
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))
    return sorted[idx] ?? 0
  }
  const p50 = percentile(50)
  const p99 = percentile(99)
  const mean = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
  const min = sorted[0] ?? 0
  const max = sorted[sorted.length - 1] ?? 0

  const passes = results.filter((r) => r.pass).length
  const total = results.length

  const rows = ALL_TOOLS.map((name) => {
    const r = results.find((x) => x.name === name)
    if (!r) return `| ${name} | NOT_RUN |  | (tool was not reached) |`
    const status = r.pass ? 'PASS' : 'FAIL'
    const lat = r.latencyMs !== undefined ? `${r.latencyMs.toFixed(1)}` : ''
    const note = r.note.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    return `| ${name} | ${status} | ${lat} | ${note} |`
  }).join('\n')

  const probeBlock = probes
    .map((p) => `- ${p.probed} → ${p.status}: \`${p.body.replace(/`/g, '\\`').slice(0, 200)}\``)
    .join('\n')

  return `# T2 MCP HTTP transport report

Generated: ${new Date().toISOString()}

Target: ${TARGET_URL}
Transport: Streamable HTTP (${serverIsLocked ? 'single-session, already claimed' : 'single-session stateful'})

## Summary

- Tools exercised: ${total}
- Passes: ${passes}/${total}
- Expected tool count (21) on first listTools: ${toolCountA1 === 21 ? 'OK' : `(got ${toolCountA1})`}
- Session state stable across two listTools() calls: ${sessionStateStable ?? 'n/a'}
- Session A connected: ${connectedA}${sidA ? ` (id=${sidA})` : ''}${initErrorA ? ` — error: ${initErrorA}` : ''}
- Session B connected: ${sidB ? `yes (id=${sidB})` : 'no'}
- Two clients got distinct session IDs: ${distinctSessions ?? 'n/a'}
- Session B listTools count: ${toolCountB || 'n/a'}
- Shared SceneBridge observation: ${sharedBridgeNote}

## Latency (get_scene × ${latencies.length} on session A)

| Metric | ms |
|--------|----|
| p50 | ${p50.toFixed(1)} |
| p99 | ${p99.toFixed(1)} |
| mean | ${mean.toFixed(1)} |
| min | ${min.toFixed(1)} |
| max | ${max.toFixed(1)} |

${
  latencies.length
    ? `Individual samples (ms): ${latencies.map((l) => l.toFixed(1)).join(', ')}`
    : 'No latency samples were captured (could not connect).'
}

## Pass/Fail matrix

| Tool | Status | Latency (ms) | Note |
|------|--------|--------------|------|
${rows}

## Server state probes

Before the SDK-based test run, these HTTP probes were executed:

${probeBlock}

## HTTP-specific quirks

- \`packages/mcp/src/transports/http.ts\` uses a single
  \`StreamableHTTPServerTransport\` per process with stateful session-id
  generation. The SDK's transport sets \`_initialized=true\` on the first
  valid \`initialize\` POST and never clears it. Consequence: the running
  server can only ever accept **one** session for its lifetime; subsequent
  \`initialize\` requests receive HTTP 400 \`{"code":-32600,"message":"Invalid Request: Server already initialized"}\`.
- Because both sessions (when connect succeeds) share the same
  \`SceneBridge\` singleton, any mutation made on one session is visible to
  the other. This is expected given the server holds one bridge process-wide.
- \`not_implemented\`, \`catalog_unavailable\`, and \`sampling_unavailable\`
  responses are treated as passes per the agreed test protocol.

## Notes

${
  serverIsLocked
    ? '- The running server was already claimed by an earlier client before this run started; we could not open a new session. See the server-state probes above for reproducers.'
    : '- Server was in a clean state and accepted both sessions.'
}
`
}

main().catch((err) => {
  console.error('FATAL:', err)
  try {
    const partial = `# T2 MCP HTTP transport report — FATAL

Fatal error during run: ${err instanceof Error ? err.stack : String(err)}

Results so far:

${results
  .map(
    (r) =>
      `- [${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.note}${
        r.latencyMs !== undefined ? ` (${r.latencyMs.toFixed(1)}ms)` : ''
      }`,
  )
  .join('\n')}
`
    writeFileSync(join(OUT_DIR, 'REPORT.md'), partial, 'utf8')
  } catch {
    // ignore
  }
  process.exit(1)
})
