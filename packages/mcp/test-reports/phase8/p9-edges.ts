/**
 * Phase 8 P9 — edge cases & error-handling depth (stdio MCP).
 *
 * Spawns an isolated stdio MCP child using PASCAL_DATA_DIR=/tmp/pascal-phase8-p9
 * and drives every edge case in the P9 plan:
 *   - scene-size limits (5k nodes, 10 MB cap)
 *   - slug safety (path-traversal, dirty chars, empty id)
 *   - invalid inputs (empty/too-long names, null template id, empty rename)
 *   - listing at scale (50 scenes, pagination, negative limit)
 *   - data-dir issues (nonexistent root directory)
 *
 * Run: bun packages/mcp/test-reports/phase8/p9-edges.ts
 */
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../../..')
const BIN_PATH = resolve(REPO_ROOT, 'packages/mcp/dist/bin/pascal-mcp.js')
const REPORT_PATH = resolve(__dirname, 'p9-edges.md')
const DATA_DIR = '/tmp/pascal-phase8-p9'
const NONEXIST_DATA_DIR = '/tmp/pascal-phase8-p9-nonexistent-root/sub/dir'

type StepStatus = 'PASS' | 'FAIL' | 'WARN'
type Step = { id: string; title: string; status: StepStatus; detail: string }
const steps: Step[] = []

function record(id: string, title: string, status: StepStatus, detail: string): void {
  steps.push({ id, title, status, detail })
  const icon = status === 'PASS' ? '[PASS]' : status === 'WARN' ? '[WARN]' : '[FAIL]'
  console.log(`${icon} ${id} ${title} — ${detail}`)
}

type TextContent = Array<{ type?: string; text?: string }>
function parseText(content: unknown): any {
  const arr = content as TextContent
  const first = Array.isArray(arr) ? arr[0] : undefined
  if (!first || typeof first.text !== 'string') return null
  try {
    return JSON.parse(first.text)
  } catch {
    return null
  }
}

function truncate(s: string, max = 220): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/**
 * Build a raw SceneGraph with N wall nodes hanging off a minimal level.
 * We bypass the bridge and save via `includeCurrentScene: false, graph: …`
 * so we can create 5k nodes in one tool call.
 */
function buildWallyGraph(wallCount: number, padBytesPerNode = 0): unknown {
  const siteId = 'site_bulk'
  const buildingId = 'building_bulk'
  const levelId = 'level_bulk'
  const wallIds: string[] = []
  const nodes: Record<string, unknown> = {}
  const padding = padBytesPerNode > 0 ? 'x'.repeat(padBytesPerNode) : ''

  for (let i = 0; i < wallCount; i++) {
    const id = `wall_bulk_${i}`
    wallIds.push(id)
    const x = (i % 100) * 0.5
    const z = Math.floor(i / 100) * 0.5
    nodes[id] = {
      object: 'node',
      id,
      type: 'wall',
      parentId: levelId,
      visible: true,
      metadata: padding ? { padding } : {},
      start: [x, z],
      end: [x + 0.4, z],
      thickness: 0.1,
      height: 2.5,
      frontSide: 'unknown',
      backSide: 'unknown',
      children: [],
    }
  }

  nodes[levelId] = {
    object: 'node',
    id: levelId,
    type: 'level',
    parentId: buildingId,
    visible: true,
    metadata: {},
    elevation: 0,
    height: 3,
    children: wallIds,
  }
  nodes[buildingId] = {
    object: 'node',
    id: buildingId,
    type: 'building',
    parentId: siteId,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: [levelId],
  }
  nodes[siteId] = {
    object: 'node',
    id: siteId,
    type: 'site',
    parentId: null,
    visible: true,
    metadata: {},
    polygon: {
      type: 'polygon',
      points: [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
      ],
    },
    children: [buildingId],
  }

  return { nodes, rootNodeIds: [siteId] }
}

async function withClient<T>(
  dataDir: string,
  label: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    env: { ...process.env, PASCAL_DATA_DIR: dataDir },
    stderr: 'inherit',
  })
  const client = new Client({ name: `p9-edges-${label}`, version: '0.0.0' })
  await client.connect(transport)
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

async function main(): Promise<void> {
  // Idempotent cleanup.
  try {
    rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    // ignore
  }
  try {
    rmSync('/tmp/pascal-phase8-p9-nonexistent-root', { recursive: true, force: true })
  } catch {
    // ignore
  }

  const t0 = Date.now()

  await withClient(DATA_DIR, 'main', async (client) => {
    // ======================================================================
    // 1. Scene with 5,000 walls — save, check sizeBytes + nodeCount.
    // ======================================================================
    {
      const big = buildWallyGraph(5000, 0)
      const saveRes = await client.callTool({
        name: 'save_scene',
        arguments: {
          id: 'big-scene-5k',
          name: '5k walls',
          includeCurrentScene: false,
          graph: big,
        },
      })
      const payload = parseText(saveRes.content) ?? (saveRes.structuredContent as any)
      const nodeCount = payload?.nodeCount ?? -1
      // 5000 walls + 1 level + 1 building + 1 site = 5003 nodes
      const expectedNodeCount = 5003
      const sizeBytes = payload?.sizeBytes ?? 0
      const ok =
        !saveRes.isError &&
        nodeCount === expectedNodeCount &&
        typeof sizeBytes === 'number' &&
        sizeBytes > 0
      record(
        '1',
        'save 5k-node scene',
        ok ? 'PASS' : 'FAIL',
        `nodeCount=${nodeCount} (expected ${expectedNodeCount}), sizeBytes=${sizeBytes}, version=${payload?.version}`,
      )
    }

    // ======================================================================
    // 2. Scene approaching / exceeding 10 MB — expect SceneTooLargeError.
    // ======================================================================
    {
      // 10 MB cap. 500 nodes × 25 KB padding ≈ 12.5 MB → must exceed cap.
      const oversize = buildWallyGraph(500, 25_000)
      let status: StepStatus = 'FAIL'
      let detail = ''
      try {
        const r = await client.callTool({
          name: 'save_scene',
          arguments: {
            id: 'too-big-scene',
            name: 'oversize',
            includeCurrentScene: false,
            graph: oversize,
          },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          const isTooLarge =
            /too_large|exceeds cap|10\s*MB|10485760|SceneTooLarge/i.test(text) ||
            /\d{7,}/.test(text) // large byte count in message
          status = isTooLarge ? 'PASS' : 'WARN'
          detail = `tool_error text="${truncate(text, 240)}"`
        } else {
          const p = parseText(r.content) ?? (r.structuredContent as any)
          detail = `UNEXPECTED success: sizeBytes=${p?.sizeBytes}`
        }
      } catch (err) {
        if (err instanceof McpError) {
          const msg = err.message ?? ''
          const dataStr = JSON.stringify(err.data ?? {})
          const dataCode = (err.data as { code?: string } | undefined)?.code
          const isTooLarge =
            /too_large|exceeds cap|10\s*MB|SceneTooLarge/i.test(msg) ||
            dataCode === 'too_large' ||
            /too_large/.test(dataStr)
          status = isTooLarge ? 'PASS' : 'WARN'
          detail = `McpError code=${err.code} msg="${truncate(msg, 200)}" data=${truncate(dataStr, 160)}`
        } else {
          detail = `threw non-McpError: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      record('2', 'save 10 MB-ish scene rejected', status, detail)
    }

    // ======================================================================
    // 3. save_scene({ id: '../etc/passwd' }) — sanitised or rejected.
    // ======================================================================
    {
      // Use an empty (valid) graph so name/id branches are exercised.
      const emptyGraph = buildWallyGraph(0, 0)
      let status: StepStatus = 'FAIL'
      let detail = ''
      try {
        const r = await client.callTool({
          name: 'save_scene',
          arguments: {
            id: '../etc/passwd',
            name: 'trav',
            includeCurrentScene: false,
            graph: emptyGraph,
          },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          status = 'PASS'
          detail = `rejected (tool_error): ${truncate(text, 200)}`
        } else {
          const p = parseText(r.content) ?? (r.structuredContent as any)
          const id = p?.id as string | undefined
          // Slug sanitation rules: lowercase alnum + hyphens. Any traversal-style
          // prefix (`..`, `/`) must be stripped.
          const safe =
            typeof id === 'string' &&
            !id.includes('..') &&
            !id.includes('/') &&
            /^[a-z0-9][a-z0-9-]*$/.test(id)
          // Verify the file lives inside scenesDir (no escape).
          const scenesDir = `${DATA_DIR}/scenes`
          const fileExists = existsSync(`${scenesDir}/${id}.json`)
          const noEscape = !existsSync(`${DATA_DIR}/etc/passwd`)
          status = safe && fileExists && noEscape ? 'PASS' : 'FAIL'
          detail = `sanitised id="${id}", fileExists=${fileExists}, noEscape=${noEscape}`
        }
      } catch (err) {
        if (err instanceof McpError) {
          status = 'PASS'
          detail = `rejected McpError code=${err.code} msg="${truncate(err.message, 160)}"`
        } else {
          detail = `non-McpError throw: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      record('3', 'save_scene path-traversal id', status, detail)
    }

    // ======================================================================
    // 4. save_scene({ id: 'UPPER Case! &^', name: 'bad' }) — sanitised.
    // ======================================================================
    {
      const emptyGraph = buildWallyGraph(0, 0)
      let status: StepStatus = 'FAIL'
      let detail = ''
      try {
        const r = await client.callTool({
          name: 'save_scene',
          arguments: {
            id: 'UPPER Case! &^',
            name: 'bad',
            includeCurrentScene: false,
            graph: emptyGraph,
          },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          detail = `tool_error: ${truncate(text, 200)}`
          // Acceptable outcome: reject.
          status = 'PASS'
        } else {
          const p = parseText(r.content) ?? (r.structuredContent as any)
          const id = p?.id as string | undefined
          const sanitised =
            typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && !/[A-Z!&^ ]/.test(id)
          // Expected slug: 'UPPER Case! &^' → 'upper-case'
          const expectedContains = 'upper' // allow 'upper-case' or variants
          const scenesDir = `${DATA_DIR}/scenes`
          const fileExists = typeof id === 'string' && existsSync(`${scenesDir}/${id}.json`)
          status =
            sanitised && fileExists && typeof id === 'string' && id.includes(expectedContains)
              ? 'PASS'
              : 'FAIL'
          detail = `sanitised id="${id}", fileExists=${fileExists}`
        }
      } catch (err) {
        if (err instanceof McpError) {
          status = 'PASS'
          detail = `rejected McpError code=${err.code} msg="${truncate(err.message, 160)}"`
        } else {
          detail = `non-McpError throw: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      record('4', 'save_scene dirty id sanitisation', status, detail)
    }

    // ======================================================================
    // 5. save_scene({ id: '' }) — rejected (Zod min(1)).
    // ======================================================================
    {
      const emptyGraph = buildWallyGraph(0, 0)
      let status: StepStatus = 'FAIL'
      let detail = ''
      try {
        const r = await client.callTool({
          name: 'save_scene',
          arguments: {
            id: '',
            name: 'empty-id',
            includeCurrentScene: false,
            graph: emptyGraph,
          },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          status = 'PASS'
          detail = `tool_error: ${truncate(text, 200)}`
        } else {
          detail = 'UNEXPECTED success for empty id'
        }
      } catch (err) {
        if (err instanceof McpError) {
          const codeOk = err.code === -32602 || err.code === -32600
          status = codeOk ? 'PASS' : 'WARN'
          detail = `McpError code=${err.code} msg="${truncate(err.message, 160)}"`
        } else {
          detail = `non-McpError throw: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      record('5', 'save_scene empty id rejected', status, detail)
    }

    // ======================================================================
    // 6. save_scene({ name: '' }) — rejected (Zod min(1)).
    // ======================================================================
    {
      const emptyGraph = buildWallyGraph(0, 0)
      let status: StepStatus = 'FAIL'
      let detail = ''
      try {
        const r = await client.callTool({
          name: 'save_scene',
          arguments: {
            name: '',
            includeCurrentScene: false,
            graph: emptyGraph,
          },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          status = 'PASS'
          detail = `tool_error: ${truncate(text, 200)}`
        } else {
          detail = 'UNEXPECTED success for empty name'
        }
      } catch (err) {
        if (err instanceof McpError) {
          status = err.code === -32602 ? 'PASS' : 'WARN'
          detail = `McpError code=${err.code} msg="${truncate(err.message, 160)}"`
        } else {
          detail = `non-McpError: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      record('6', 'save_scene empty name rejected', status, detail)
    }

    // ======================================================================
    // 7. save_scene({ name: 'a'.repeat(500) }) — rejected (Zod max(200)).
    // ======================================================================
    {
      const emptyGraph = buildWallyGraph(0, 0)
      let status: StepStatus = 'FAIL'
      let detail = ''
      const longName = 'a'.repeat(500)
      try {
        const r = await client.callTool({
          name: 'save_scene',
          arguments: {
            name: longName,
            includeCurrentScene: false,
            graph: emptyGraph,
          },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          status = 'PASS'
          detail = `tool_error: ${truncate(text, 200)}`
        } else {
          const p = parseText(r.content) ?? (r.structuredContent as any)
          // If not rejected, check whether truncated.
          const returnedName = p?.name as string | undefined
          if (typeof returnedName === 'string' && returnedName.length <= 200) {
            status = 'PASS'
            detail = `truncated to length=${returnedName.length}`
          } else {
            detail = `UNEXPECTED accepted full length=${returnedName?.length}`
          }
        }
      } catch (err) {
        if (err instanceof McpError) {
          status = err.code === -32602 ? 'PASS' : 'WARN'
          detail = `McpError code=${err.code} msg="${truncate(err.message, 160)}"`
        } else {
          detail = `non-McpError: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      record('7', 'save_scene name length 500 rejected', status, detail)
    }

    // ======================================================================
    // 8. create_from_template({ id: null }) — Zod error.
    // ======================================================================
    {
      let status: StepStatus = 'FAIL'
      let detail = ''
      try {
        const r = await client.callTool({
          name: 'create_from_template',
          // @ts-expect-error deliberately pass null
          arguments: { id: null },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          status = 'PASS'
          detail = `tool_error: ${truncate(text, 200)}`
        } else {
          detail = 'UNEXPECTED success for null id'
        }
      } catch (err) {
        if (err instanceof McpError) {
          status = err.code === -32602 ? 'PASS' : 'WARN'
          detail = `McpError code=${err.code} msg="${truncate(err.message, 160)}"`
        } else {
          detail = `non-McpError: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      record('8', 'create_from_template null id rejected', status, detail)
    }

    // ======================================================================
    // 9. rename_scene({ id: 'real-scene', newName: '' }) — rejected.
    //    First create a real scene, then attempt the empty-name rename.
    // ======================================================================
    {
      const emptyGraph = buildWallyGraph(0, 0)
      const createRes = await client.callTool({
        name: 'save_scene',
        arguments: {
          id: 'rename-target',
          name: 'original name',
          includeCurrentScene: false,
          graph: emptyGraph,
        },
      })
      const cPayload = parseText(createRes.content) ?? (createRes.structuredContent as any)
      const realId = cPayload?.id as string | undefined

      let status: StepStatus = 'FAIL'
      let detail = ''
      if (!realId) {
        detail = `setup failed: saved scene has no id (${truncate(JSON.stringify(cPayload ?? {}), 120)})`
      } else {
        try {
          const r = await client.callTool({
            name: 'rename_scene',
            arguments: { id: realId, newName: '' },
          })
          if (r.isError) {
            const text = (r.content as TextContent)?.[0]?.text ?? ''
            status = 'PASS'
            detail = `tool_error: ${truncate(text, 200)}`
          } else {
            detail = 'UNEXPECTED success for empty newName'
          }
        } catch (err) {
          if (err instanceof McpError) {
            status = err.code === -32602 ? 'PASS' : 'WARN'
            detail = `McpError code=${err.code} msg="${truncate(err.message, 160)}"`
          } else {
            detail = `non-McpError: ${err instanceof Error ? err.message : String(err)}`
          }
        }
      }
      record('9', 'rename_scene empty newName rejected', status, detail)
    }

    // ======================================================================
    // 10. Save 50 small scenes, list_scenes({ limit: 100 }) → all 50,
    //     in updated_at DESC.
    // ======================================================================
    const bulkIds: string[] = []
    {
      // First wipe the existing scenes directory so we can count cleanly.
      try {
        rmSync(`${DATA_DIR}/scenes`, { recursive: true, force: true })
      } catch {
        // ignore
      }
      const emptyGraph = buildWallyGraph(0, 0)
      for (let i = 0; i < 50; i++) {
        const sid = `bulk-${String(i).padStart(2, '0')}`
        bulkIds.push(sid)
        await client.callTool({
          name: 'save_scene',
          arguments: {
            id: sid,
            name: `bulk ${i}`,
            includeCurrentScene: false,
            graph: emptyGraph,
          },
        })
        // Small wait so updated_at timestamps differ slightly.
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 5))
      }
      const lr = await client.callTool({
        name: 'list_scenes',
        arguments: { limit: 100 },
      })
      const lp = parseText(lr.content) ?? (lr.structuredContent as any)
      const scenes = (lp?.scenes ?? []) as Array<{ id: string; updatedAt: string }>
      const count = scenes.length
      // Verify updatedAt DESC.
      let descOk = true
      for (let i = 1; i < scenes.length; i++) {
        if ((scenes[i - 1]?.updatedAt ?? '') < (scenes[i]?.updatedAt ?? '')) {
          descOk = false
          break
        }
      }
      const ok = !lr.isError && count === 50 && descOk
      record(
        '10',
        'list 50 scenes updatedAt DESC',
        ok ? 'PASS' : 'FAIL',
        `count=${count}, descOk=${descOk}`,
      )
    }

    // ======================================================================
    // 11. list_scenes({ limit: 10 }) → exactly 10.
    // ======================================================================
    {
      const lr = await client.callTool({
        name: 'list_scenes',
        arguments: { limit: 10 },
      })
      const lp = parseText(lr.content) ?? (lr.structuredContent as any)
      const count = lp?.scenes?.length ?? -1
      const ok = !lr.isError && count === 10
      record('11', 'list_scenes limit=10', ok ? 'PASS' : 'FAIL', `count=${count}`)
    }

    // ======================================================================
    // 12. list_scenes({ limit: -1 }) — rejected or defaulted.
    // ======================================================================
    {
      let status: StepStatus = 'FAIL'
      let detail = ''
      try {
        const r = await client.callTool({
          name: 'list_scenes',
          arguments: { limit: -1 },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          status = 'PASS'
          detail = `rejected: ${truncate(text, 200)}`
        } else {
          const p = parseText(r.content) ?? (r.structuredContent as any)
          const count = p?.scenes?.length ?? -1
          // Defaulted: either returns default limit of results (≥ 1) or empty.
          if (typeof count === 'number' && count >= 0) {
            status = 'PASS'
            detail = `defaulted: count=${count}`
          } else {
            detail = `UNEXPECTED response: ${truncate(JSON.stringify(p ?? {}), 160)}`
          }
        }
      } catch (err) {
        if (err instanceof McpError) {
          status = 'PASS'
          detail = `rejected McpError code=${err.code} msg="${truncate(err.message, 160)}"`
        } else {
          detail = `non-McpError: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      record('12', 'list_scenes limit=-1', status, detail)
    }
  })

  // ========================================================================
  // 13. Data-dir issue: PASCAL_DATA_DIR=nonexistent/root; first save_scene
  //     should auto-create the directory OR fail with a clear error.
  // ========================================================================
  {
    let status: StepStatus = 'FAIL'
    let detail = ''
    try {
      await withClient(NONEXIST_DATA_DIR, 'nonexist', async (client) => {
        const emptyGraph = buildWallyGraph(0, 0)
        const r = await client.callTool({
          name: 'save_scene',
          arguments: {
            id: 'first-scene',
            name: 'first',
            includeCurrentScene: false,
            graph: emptyGraph,
          },
        })
        if (r.isError) {
          const text = (r.content as TextContent)?.[0]?.text ?? ''
          const looksClear = /ENOENT|not found|directory|permission|EACCES|invalid/i.test(text)
          status = looksClear ? 'PASS' : 'WARN'
          detail = `failed gracefully: ${truncate(text, 240)}`
        } else {
          const p = parseText(r.content) ?? (r.structuredContent as any)
          const created = existsSync(NONEXIST_DATA_DIR)
          const fileThere = created && existsSync(`${NONEXIST_DATA_DIR}/scenes/${p?.id ?? ''}.json`)
          status = created && fileThere ? 'PASS' : 'FAIL'
          detail = `auto-created=${created}, file=${fileThere}, id=${p?.id}`
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // A clean error at connect/tool time is also acceptable.
      const looksClear = /ENOENT|not found|directory|permission|EACCES|invalid/i.test(msg)
      status = looksClear ? 'PASS' : 'WARN'
      detail = `error: ${truncate(msg, 240)}`
    }
    record('13', 'PASCAL_DATA_DIR nonexistent root', status, detail)
  }

  const elapsed = Date.now() - t0

  // Sanity listing on the data dir for the report.
  let scenesInDataDir = -1
  try {
    const files = readdirSync(`${DATA_DIR}/scenes`).filter(
      (f) => f.endsWith('.json') && !f.startsWith('.'),
    )
    scenesInDataDir = files.length
  } catch {
    // ignore
  }

  // ========================================================================
  // Write markdown report.
  // ========================================================================
  const passed = steps.filter((s) => s.status === 'PASS').length
  const warned = steps.filter((s) => s.status === 'WARN').length
  const failed = steps.filter((s) => s.status === 'FAIL').length
  const total = steps.length

  const lines: string[] = []
  lines.push('# Phase 8 P9 — edge cases & error-handling depth (stdio MCP)')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(
    `Transport: stdio (\`bun packages/mcp/dist/bin/pascal-mcp.js --stdio\`), data dir \`${DATA_DIR}\`.`,
  )
  lines.push('')
  lines.push(`**Summary:** ${passed}/${total} PASS, ${warned} WARN, ${failed} FAIL, ${elapsed} ms.`)
  lines.push(`Scene files on disk after bulk tests: ${scenesInDataDir}`)
  lines.push('')
  lines.push('## Test cases')
  lines.push('')
  lines.push('| # | Case | Status | Detail |')
  lines.push('|---|------|--------|--------|')
  for (const s of steps) {
    const safe = s.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${s.id} | ${s.title} | ${s.status} | ${safe} |`)
  }
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  lines.push('- Case 1 (5k nodes) constructs walls programmatically and saves via')
  lines.push('  `save_scene({ includeCurrentScene: false, graph })`.')
  lines.push('- Case 2 pads `metadata.padding` on each of 500 walls to push past 10 MB.')
  lines.push('  PASS = structured error mentioning `too_large`; WARN = other rejection reason.')
  lines.push('- Cases 3-5 exercise slug hygiene (`sanitizeSlug` in `storage/slug.ts`).')
  lines.push('- Case 13 spawns a second stdio child with a deep nonexistent data dir.')
  lines.push('  PASS if the dir is auto-created by the filesystem store or the call fails with a')
  lines.push('  clear error (ENOENT/EACCES/etc.).')
  lines.push('')

  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8')
  console.log(`\n[p9] report: ${REPORT_PATH}`)
  console.log(`[p9] ${passed}/${total} PASS, ${warned} WARN, ${failed} FAIL in ${elapsed}ms`)

  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[p9] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(2)
})
