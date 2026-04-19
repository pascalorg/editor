/**
 * P3 — Phase 8: version conflict / optimistic locking tests.
 *
 * Tests:
 *   Part A — MCP tool-level version conflicts (save_scene, rename_scene,
 *     delete_scene) via a dedicated stdio MCP server against PASCAL_DATA_DIR
 *     = /tmp/pascal-phase8-p3.
 *   Part B — Editor HTTP API ETag / If-Match semantics on :3002/api/scenes.
 *
 * Writes the markdown report alongside this script.
 * Run with:  bun packages/mcp/test-reports/phase8/p3-locking.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../../..')
const BIN_PATH = resolve(REPO_ROOT, 'packages/mcp/dist/bin/pascal-mcp.js')
const REPORT_PATH = resolve(__dirname, 'p3-locking.md')

const DATA_DIR = '/tmp/pascal-phase8-p3'
const EDITOR_URL = 'http://localhost:3002'

type Verdict = 'PASS' | 'WARN' | 'FAIL'
type Row = {
  id: string
  part: 'A' | 'B'
  description: string
  expected: string
  actual: string
  verdict: Verdict
  note?: string
}

const rows: Row[] = []

function record(row: Row): void {
  rows.push(row)
  const icon = row.verdict === 'PASS' ? '[PASS]' : row.verdict === 'WARN' ? '[WARN]' : '[FAIL]'
  console.log(`${icon} ${row.id} (part ${row.part}): ${row.description}`)
  console.log(`        expected: ${row.expected}`)
  console.log(`        actual:   ${row.actual}`)
  if (row.note) console.log(`        note: ${row.note}`)
}

function shortJson(v: unknown, max = 400): string {
  let text: string
  try {
    text = JSON.stringify(v)
  } catch {
    text = String(v)
  }
  if (text && text.length > max) return `${text.slice(0, max)}…`
  return text
}

/** Minimal valid SceneGraph — a bare site node. */
function minimalGraph(): { nodes: Record<string, unknown>; rootNodeIds: string[] } {
  return {
    nodes: {
      site_p3: {
        object: 'node',
        id: 'site_p3',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
        polygon: {
          type: 'polygon',
          points: [
            [-10, -10],
            [10, -10],
            [10, 10],
            [-10, 10],
          ],
        },
        children: [],
      },
    },
    rootNodeIds: ['site_p3'],
  }
}

// ---------------------------------------------------------------------------
// Helpers for MCP stdio side
// ---------------------------------------------------------------------------

type CallOutcome =
  | {
      kind: 'success'
      structuredContent?: unknown
      content?: unknown
    }
  | {
      kind: 'tool_error'
      message: string
      rawContent?: unknown
    }
  | {
      kind: 'mcp_error'
      code: number
      message: string
      data?: unknown
    }
  | {
      kind: 'client_error'
      message: string
    }

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallOutcome> {
  try {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean
      content?: unknown
      structuredContent?: unknown
    }
    if (result.isError) {
      const rawContent = (result.content ?? []) as Array<{ type: string; text?: string }>
      const textBlock = rawContent.find((b) => b?.type === 'text')
      return {
        kind: 'tool_error',
        message: textBlock?.text ?? JSON.stringify(rawContent),
        rawContent: result.content,
      }
    }
    return {
      kind: 'success',
      structuredContent: result.structuredContent,
      content: result.content,
    }
  } catch (err) {
    if (err instanceof McpError) {
      return {
        kind: 'mcp_error',
        code: err.code,
        message: err.message,
        data: err.data,
      }
    }
    return {
      kind: 'client_error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

function getStructured<T = Record<string, unknown>>(o: CallOutcome): T | null {
  if (o.kind !== 'success') return null
  if (!o.structuredContent || typeof o.structuredContent !== 'object') return null
  return o.structuredContent as T
}

// ---------------------------------------------------------------------------
// Part A: MCP tools
// ---------------------------------------------------------------------------

async function runPartA(): Promise<void> {
  console.log('\n=== Part A — MCP save_scene / rename_scene / delete_scene ===')
  // Reset data dir for deterministic test.
  try {
    rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    // ignore
  }
  mkdirSync(DATA_DIR, { recursive: true })

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    env: {
      ...process.env,
      PASCAL_DATA_DIR: DATA_DIR,
    },
    stderr: 'inherit',
  })
  const client = new Client({ name: 'p3-locking', version: '0.0.0' })
  await client.connect(transport)
  console.log('[p3] connected via stdio')

  const graph = minimalGraph()
  const sceneId = 'p3-mcp'
  const newGraph = {
    nodes: {
      site_p3: {
        ...(graph.nodes.site_p3 as Record<string, unknown>),
        metadata: { updated: 'v2' },
      },
    },
    rootNodeIds: ['site_p3'],
  }

  // --- A1: fresh save → version 1 ---
  {
    const out = await callTool(client, 'save_scene', {
      id: sceneId,
      name: 'p3-mcp-original',
      includeCurrentScene: false,
      graph,
    })
    const sc = getStructured<{ version: number; id: string }>(out)
    const ok = out.kind === 'success' && sc?.version === 1 && sc?.id === sceneId
    record({
      id: 'A1',
      part: 'A',
      description: 'save_scene fresh → version === 1',
      expected: 'success, version=1',
      actual:
        out.kind === 'success'
          ? `success, version=${sc?.version}, id=${sc?.id}`
          : `${out.kind}: ${JSON.stringify(out).slice(0, 200)}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- A2: save with expectedVersion: 1 → version 2 ---
  {
    const out = await callTool(client, 'save_scene', {
      id: sceneId,
      name: 'p3-mcp-v2',
      includeCurrentScene: false,
      expectedVersion: 1,
      graph: newGraph,
    })
    const sc = getStructured<{ version: number }>(out)
    const ok = out.kind === 'success' && sc?.version === 2
    record({
      id: 'A2',
      part: 'A',
      description: 'save_scene expectedVersion=1 → version === 2',
      expected: 'success, version=2',
      actual:
        out.kind === 'success'
          ? `success, version=${sc?.version}`
          : `${out.kind}: ${JSON.stringify(out).slice(0, 200)}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- A3: save with expectedVersion=5 (stale) → version_conflict ---
  {
    const out = await callTool(client, 'save_scene', {
      id: sceneId,
      name: 'p3-mcp-stale',
      includeCurrentScene: false,
      expectedVersion: 5,
      graph: newGraph,
    })
    const msg =
      out.kind === 'mcp_error'
        ? out.message
        : out.kind === 'tool_error'
          ? out.message
          : out.kind === 'client_error'
            ? out.message
            : 'success (unexpected)'
    const ok =
      (out.kind === 'mcp_error' && out.message.includes('version_conflict')) ||
      (out.kind === 'tool_error' && out.message.includes('version_conflict'))
    record({
      id: 'A3',
      part: 'A',
      description: 'save_scene expectedVersion=5 (stale) → version_conflict',
      expected: 'McpError / tool_error with code=version_conflict',
      actual: `${out.kind}: ${msg}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- A4: save WITHOUT expectedVersion — document actual behaviour ---
  {
    const out = await callTool(client, 'save_scene', {
      id: sceneId,
      name: 'p3-mcp-no-expect',
      includeCurrentScene: false,
      graph: newGraph,
    })
    let actualDesc: string
    let verdict: Verdict = 'WARN'
    let note: string | undefined
    if (out.kind === 'success') {
      const sc = getStructured<{ version: number }>(out)
      actualDesc = `overwrite success, version=${sc?.version}`
      verdict = 'PASS'
      note = 'LENIENT: save without expectedVersion silently overwrote the existing scene'
    } else if (out.kind === 'mcp_error' || out.kind === 'tool_error') {
      actualDesc = `${out.kind}: ${out.message}`
      verdict = 'PASS'
      note = 'STRICT: save without expectedVersion rejected — existing scene protected'
    } else {
      actualDesc = `${out.kind}: ${JSON.stringify(out).slice(0, 200)}`
      verdict = 'FAIL'
    }
    record({
      id: 'A4',
      part: 'A',
      description: 'save_scene WITHOUT expectedVersion on existing id',
      expected: 'Document behaviour: lenient overwrite OR strict reject',
      actual: actualDesc,
      verdict,
      note,
    })
  }

  // --- A5: rename with stale expectedVersion → version_conflict ---
  {
    // Get current version
    const listOut = await callTool(client, 'list_scenes', {})
    const listSc = getStructured<{ scenes: { id: string; version: number }[] }>(listOut)
    const currentVersion = listSc?.scenes.find((s) => s.id === sceneId)?.version ?? -1

    const out = await callTool(client, 'rename_scene', {
      id: sceneId,
      newName: 'p3-mcp-rename',
      expectedVersion: 99, // stale
    })
    const msg =
      out.kind === 'mcp_error'
        ? out.message
        : out.kind === 'tool_error'
          ? out.message
          : out.kind === 'client_error'
            ? out.message
            : 'success (unexpected)'
    const ok =
      (out.kind === 'mcp_error' && out.message.includes('version_conflict')) ||
      (out.kind === 'tool_error' && out.message.includes('version_conflict'))
    record({
      id: 'A5',
      part: 'A',
      description: `rename_scene expectedVersion=99 (current=${currentVersion}) → version_conflict`,
      expected: 'McpError / tool_error with code=version_conflict',
      actual: `${out.kind}: ${msg}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- A6: delete with stale expectedVersion → version_conflict ---
  {
    const out = await callTool(client, 'delete_scene', {
      id: sceneId,
      expectedVersion: 99, // stale
    })
    const msg =
      out.kind === 'mcp_error'
        ? out.message
        : out.kind === 'tool_error'
          ? out.message
          : out.kind === 'client_error'
            ? out.message
            : 'success (unexpected)'
    const ok =
      (out.kind === 'mcp_error' && out.message.includes('version_conflict')) ||
      (out.kind === 'tool_error' && out.message.includes('version_conflict'))
    record({
      id: 'A6',
      part: 'A',
      description: 'delete_scene expectedVersion=99 (stale) → version_conflict',
      expected: 'McpError / tool_error with code=version_conflict',
      actual: `${out.kind}: ${msg}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  await client.close()
  console.log('[p3] Part A disconnected')
}

// ---------------------------------------------------------------------------
// Part B: editor HTTP API
// ---------------------------------------------------------------------------

type HttpResult = {
  status: number
  headers: Record<string, string>
  bodyText: string
  bodyJson: unknown
}

async function http(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...extraHeaders }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${EDITOR_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }
  const hdrs: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    hdrs[k] = v
  })
  return {
    status: res.status,
    headers: hdrs,
    bodyText: text,
    bodyJson: json,
  }
}

async function runPartB(): Promise<void> {
  console.log('\n=== Part B — Editor HTTP API ETag/If-Match ===')
  const id = `p3-http-${Date.now().toString(36)}`
  const graph = minimalGraph()

  // --- B1: POST /api/scenes → 201 ---
  let v1Meta: { id: string; version: number } | null = null
  {
    const res = await http('POST', '/api/scenes', {
      id,
      name: 'p3-http',
      graph,
    })
    const ok = res.status === 201
    if (res.bodyJson && typeof res.bodyJson === 'object') {
      v1Meta = res.bodyJson as { id: string; version: number }
    }
    record({
      id: 'B1',
      part: 'B',
      description: `POST /api/scenes { id: "${id}", name: "p3-http" } → 201`,
      expected: 'status 201, body has version=1',
      actual: `status=${res.status}, body=${shortJson(res.bodyJson)}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- B2: GET /api/scenes/<id> → ETag: "1" ---
  {
    const res = await http('GET', `/api/scenes/${id}`)
    const etag = res.headers.etag ?? res.headers.ETag ?? ''
    const ok = res.status === 200 && etag === '"1"'
    record({
      id: 'B2',
      part: 'B',
      description: `GET /api/scenes/${id} — ETag header matches "1"`,
      expected: 'status 200, ETag: "1"',
      actual: `status=${res.status}, ETag=${JSON.stringify(etag)}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- B3: PUT with If-Match: "1" → 200, new version 2 ---
  {
    const updatedGraph = {
      nodes: {
        site_p3: {
          ...(graph.nodes.site_p3 as Record<string, unknown>),
          metadata: { updated: 'http-v2' },
        },
      },
      rootNodeIds: ['site_p3'],
    }
    const res = await http(
      'PUT',
      `/api/scenes/${id}`,
      { name: 'p3-http-updated', graph: updatedGraph },
      { 'If-Match': '"1"' },
    )
    const etag = res.headers.etag ?? res.headers.ETag ?? ''
    const body = res.bodyJson as { version?: number } | null
    const ok = res.status === 200 && body?.version === 2 && etag === '"2"'
    record({
      id: 'B3',
      part: 'B',
      description: 'PUT with If-Match: "1" (matching current) → 200',
      expected: 'status 200, version=2, ETag: "2"',
      actual: `status=${res.status}, version=${body?.version}, ETag=${JSON.stringify(etag)}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- B4: PUT with If-Match: "99" (stale) → 409 ---
  {
    const res = await http(
      'PUT',
      `/api/scenes/${id}`,
      { name: 'p3-http-stale', graph },
      { 'If-Match': '"99"' },
    )
    const body = res.bodyJson as { error?: string } | null
    const ok = res.status === 409 && body?.error === 'version_conflict'
    record({
      id: 'B4',
      part: 'B',
      description: 'PUT with If-Match: "99" (stale) → 409',
      expected: 'status 409, body { error: "version_conflict" }',
      actual: `status=${res.status}, body=${shortJson(res.bodyJson)}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- B5: DELETE with If-Match: "99" → 409 ---
  {
    const res = await http('DELETE', `/api/scenes/${id}`, undefined, { 'If-Match': '"99"' })
    const body = res.bodyJson as { error?: string } | null
    const ok = res.status === 409 && body?.error === 'version_conflict'
    record({
      id: 'B5',
      part: 'B',
      description: 'DELETE with If-Match: "99" (stale) → 409',
      expected: 'status 409, body { error: "version_conflict" }',
      actual: `status=${res.status}, body=${shortJson(res.bodyJson)}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }

  // --- B6: DELETE with correct If-Match: "2" → 204 ---
  {
    const res = await http('DELETE', `/api/scenes/${id}`, undefined, { 'If-Match': '"2"' })
    const ok = res.status === 204
    record({
      id: 'B6',
      part: 'B',
      description: 'DELETE with correct If-Match: "2" → 204',
      expected: 'status 204, empty body',
      actual: `status=${res.status}, body=${res.bodyText || '(empty)'}`,
      verdict: ok ? 'PASS' : 'FAIL',
    })
  }
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

function writeReport(): void {
  const pass = rows.filter((r) => r.verdict === 'PASS').length
  const warn = rows.filter((r) => r.verdict === 'WARN').length
  const fail = rows.filter((r) => r.verdict === 'FAIL').length
  const lines: string[] = []
  lines.push('# P3 — Phase 8: Version Conflict / Optimistic Locking Report')
  lines.push('')
  lines.push(`Run: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- PASS: ${pass}`)
  lines.push(`- WARN: ${warn}`)
  lines.push(`- FAIL: ${fail}`)
  lines.push(`- Total: ${rows.length}`)
  lines.push('')
  lines.push('## Matrix')
  lines.push('')
  lines.push('| ID | Part | Description | Verdict |')
  lines.push('|----|------|-------------|---------|')
  for (const r of rows) {
    const safe = r.description.replace(/\|/g, '\\|')
    lines.push(`| ${r.id} | ${r.part} | ${safe} | ${r.verdict} |`)
  }
  lines.push('')
  lines.push('## Details')
  lines.push('')
  for (const r of rows) {
    lines.push(`### ${r.id} — part ${r.part} — ${r.description}`)
    lines.push('')
    lines.push(`**Verdict:** ${r.verdict}`)
    lines.push('')
    lines.push(`**Expected:** ${r.expected}`)
    lines.push('')
    lines.push(`**Actual:** ${r.actual}`)
    if (r.note) {
      lines.push('')
      lines.push(`**Note:** ${r.note}`)
    }
    lines.push('')
  }
  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8')
  console.log(`\n[p3] wrote report: ${REPORT_PATH}`)
  console.log(`[p3] PASS=${pass} WARN=${warn} FAIL=${fail}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[p3] DATA_DIR=${DATA_DIR}`)
  console.log(`[p3] EDITOR_URL=${EDITOR_URL}`)
  console.log(`[p3] BIN_PATH=${BIN_PATH}`)

  try {
    await runPartA()
  } catch (err) {
    console.error('[p3] Part A crashed:', err)
    record({
      id: 'A-crash',
      part: 'A',
      description: 'Part A runner threw',
      expected: 'all A tests complete',
      actual: err instanceof Error ? err.message : String(err),
      verdict: 'FAIL',
    })
  }

  try {
    await runPartB()
  } catch (err) {
    console.error('[p3] Part B crashed:', err)
    record({
      id: 'B-crash',
      part: 'B',
      description: 'Part B runner threw',
      expected: 'all B tests complete',
      actual: err instanceof Error ? err.message : String(err),
      verdict: 'FAIL',
    })
  }

  writeReport()
  const fail = rows.filter((r) => r.verdict === 'FAIL').length
  if (fail > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[p3] fatal:', err)
  process.exit(2)
})
