/**
 * Phase 8 P1 — scene templates lifecycle end-to-end via stdio MCP.
 *
 * Spawns a dedicated stdio MCP child (isolated PASCAL_DATA_DIR), instantiates
 * every seed template, saves/validates/inspects them, exercises `measure`,
 * deletes them, and asserts error-path behaviour for unknown template ids
 * and missing scene ids.
 *
 * Run: bun packages/mcp/test-reports/phase8/p1-templates.ts
 */
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../../..')
const BIN_PATH = resolve(REPO_ROOT, 'packages/mcp/dist/bin/pascal-mcp.js')
const REPORT_PATH = resolve(__dirname, 'p1-templates.md')
const DATA_DIR = '/tmp/pascal-phase8-p1'

type StepStatus = 'PASS' | 'FAIL'
type Step = { id: string; title: string; status: StepStatus; detail: string }
const steps: Step[] = []

function record(id: string, title: string, status: StepStatus, detail: string): void {
  steps.push({ id, title, status, detail })
  const icon = status === 'PASS' ? '[PASS]' : '[FAIL]'
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

type TemplateSummary = { id: string; name: string; description: string; nodeCount: number }

const TEMPLATE_IDS = ['empty-studio', 'two-bedroom', 'garden-house'] as const

// Per-template snapshot recorded in step 2c.
type SceneSnapshot = {
  templateId: string
  sceneId: string
  sceneName: string
  nodeCount: number
  zoneCount: number
  wallCount: number
  doorCount: number
  windowCount: number
}
const snapshots: SceneSnapshot[] = []

async function main(): Promise<void> {
  // Idempotent cleanup.
  try {
    rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    // ignore
  }

  const t0 = Date.now()
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    env: { ...process.env, PASCAL_DATA_DIR: DATA_DIR },
    stderr: 'inherit',
  })
  const client = new Client({ name: 'p1-templates', version: '0.0.0' })
  await client.connect(transport)

  // ========================================================================
  // 1. list_templates — assert 3 templates with required fields.
  // ========================================================================
  {
    const r = await client.callTool({ name: 'list_templates', arguments: {} })
    const payload = parseText(r.content) ?? (r.structuredContent as any)
    const list = payload?.templates as TemplateSummary[] | undefined
    const ids = (list ?? []).map((t) => t.id).sort()
    const expected = [...TEMPLATE_IDS].sort()
    const idsOk = JSON.stringify(ids) === JSON.stringify(expected)
    const fieldsOk =
      !!list &&
      list.every(
        (t) =>
          typeof t.id === 'string' &&
          typeof t.name === 'string' &&
          typeof t.description === 'string' &&
          typeof t.nodeCount === 'number' &&
          t.nodeCount > 0,
      )
    const status: StepStatus = idsOk && fieldsOk ? 'PASS' : 'FAIL'
    const summary = list
      ? list.map((t) => `${t.id}(${t.nodeCount})`).join(', ')
      : 'missing templates array'
    record('1', 'list_templates', status, `ids=[${ids.join(',')}], ${summary}`)
  }

  // ========================================================================
  // 2. For each template: create_from_template → save_scene → validate → get_scene.
  // ========================================================================
  for (const id of TEMPLATE_IDS) {
    const sceneName = `p1-${id}`
    // 2a. create_from_template + save_scene
    let sceneId: string | null = null
    {
      const cr = await client.callTool({
        name: 'create_from_template',
        arguments: { id, name: sceneName },
      })
      const cpayload = parseText(cr.content) ?? (cr.structuredContent as any)
      const createOk = !cr.isError && cpayload?.templateId === id && (cpayload?.nodeCount ?? 0) > 0
      const sr = await client.callTool({
        name: 'save_scene',
        arguments: { name: sceneName },
      })
      const spayload = parseText(sr.content) ?? (sr.structuredContent as any)
      sceneId = spayload?.id ?? null
      const saveOk = !sr.isError && !!sceneId
      const status: StepStatus = createOk && saveOk ? 'PASS' : 'FAIL'
      record(
        `2a/${id}`,
        'create_from_template + save_scene',
        status,
        `templateId=${cpayload?.templateId}, createdNodes=${cpayload?.nodeCount}, sceneId=${sceneId}, version=${spayload?.version}`,
      )
    }

    // 2b. validate_scene
    {
      const vr = await client.callTool({ name: 'validate_scene', arguments: {} })
      const vp = parseText(vr.content) ?? (vr.structuredContent as any)
      const ok =
        !vr.isError && vp?.valid === true && Array.isArray(vp?.errors) && vp.errors.length === 0
      record(
        `2b/${id}`,
        'validate_scene',
        ok ? 'PASS' : 'FAIL',
        `valid=${vp?.valid}, errors=${vp?.errors?.length}`,
      )
    }

    // 2c. get_scene — record counts per type.
    {
      const gr = await client.callTool({ name: 'get_scene', arguments: {} })
      const gp = parseText(gr.content) ?? (gr.structuredContent as any)
      const nodes = (gp?.nodes as Record<string, { type?: string }> | undefined) ?? {}
      const counts = { zone: 0, wall: 0, door: 0, window: 0 }
      for (const n of Object.values(nodes)) {
        const t = n?.type
        if (t === 'zone' || t === 'wall' || t === 'door' || t === 'window') {
          counts[t] += 1
        }
      }
      const nodeCount = Object.keys(nodes).length
      const ok = !gr.isError && nodeCount > 0
      snapshots.push({
        templateId: id,
        sceneId: sceneId ?? '(missing)',
        sceneName,
        nodeCount,
        zoneCount: counts.zone,
        wallCount: counts.wall,
        doorCount: counts.door,
        windowCount: counts.window,
      })
      record(
        `2c/${id}`,
        'get_scene counts',
        ok ? 'PASS' : 'FAIL',
        `nodes=${nodeCount}, zones=${counts.zone}, walls=${counts.wall}, doors=${counts.door}, windows=${counts.window}`,
      )
    }
  }

  // ========================================================================
  // 3. list_scenes — expect 3 scenes with our names.
  // ========================================================================
  {
    const lr = await client.callTool({ name: 'list_scenes', arguments: {} })
    const lp = parseText(lr.content) ?? (lr.structuredContent as any)
    const names = (lp?.scenes ?? []).map((s: any) => s.name).sort()
    const expected = TEMPLATE_IDS.map((id) => `p1-${id}`).sort()
    const ok =
      !lr.isError && names.length === 3 && JSON.stringify(names) === JSON.stringify(expected)
    record(
      '3',
      'list_scenes',
      ok ? 'PASS' : 'FAIL',
      `scenes=${lp?.scenes?.length}, names=[${names.join(',')}]`,
    )
  }

  // ========================================================================
  // 4. Load two-bedroom; measure between two zones; distance > 0.
  // ========================================================================
  {
    const twoBedroom = snapshots.find((s) => s.templateId === 'two-bedroom')
    if (!twoBedroom || twoBedroom.sceneId === '(missing)') {
      record('4', 'measure between zones', 'FAIL', 'no two-bedroom scene recorded')
    } else {
      const load = await client.callTool({
        name: 'load_scene',
        arguments: { id: twoBedroom.sceneId },
      })
      const loadOk = !load.isError
      const gs = await client.callTool({ name: 'get_scene', arguments: {} })
      const gsp = parseText(gs.content) ?? (gs.structuredContent as any)
      const nodes = (gsp?.nodes as Record<string, { id?: string; type?: string }> | undefined) ?? {}
      const zones = Object.values(nodes).filter((n) => n.type === 'zone')
      if (!loadOk || zones.length < 2) {
        record('4', 'measure between zones', 'FAIL', `loadOk=${loadOk}, zones=${zones.length}`)
      } else {
        const from = zones[0]!.id as string
        const to = zones[1]!.id as string
        const mr = await client.callTool({
          name: 'measure',
          arguments: { fromId: from, toId: to },
        })
        const mp = parseText(mr.content) ?? (mr.structuredContent as any)
        const dist = mp?.distanceMeters as number | undefined
        const ok = !mr.isError && typeof dist === 'number' && dist > 0
        record(
          '4',
          'measure between zones',
          ok ? 'PASS' : 'FAIL',
          `from=${from}, to=${to}, distance=${dist?.toFixed?.(3)}m`,
        )
      }
    }
  }

  // ========================================================================
  // 5. delete each scene, then list_scenes → 0.
  // ========================================================================
  for (const snap of snapshots) {
    if (snap.sceneId === '(missing)') continue
    const dr = await client.callTool({
      name: 'delete_scene',
      arguments: { id: snap.sceneId },
    })
    const dp = parseText(dr.content) ?? (dr.structuredContent as any)
    const ok = !dr.isError && dp?.deleted === true
    record(
      `5/${snap.templateId}`,
      'delete_scene',
      ok ? 'PASS' : 'FAIL',
      `id=${snap.sceneId}, deleted=${dp?.deleted}`,
    )
  }
  {
    const lr = await client.callTool({ name: 'list_scenes', arguments: {} })
    const lp = parseText(lr.content) ?? (lr.structuredContent as any)
    const count = lp?.scenes?.length ?? -1
    const ok = !lr.isError && count === 0
    record('5/final', 'list_scenes empty', ok ? 'PASS' : 'FAIL', `remaining scenes=${count}`)
  }

  // ========================================================================
  // 6a. Error: create_from_template with unknown id → McpError(InvalidParams).
  // ========================================================================
  {
    let status: StepStatus = 'FAIL'
    let detail = ''
    try {
      const r = await client.callTool({
        name: 'create_from_template',
        arguments: { id: 'nonexistent' },
      })
      if (r.isError) {
        const textArr = r.content as TextContent
        const text = textArr?.[0]?.text ?? ''
        const looksInvalid = /unknown_template|InvalidParams|nonexistent/i.test(text)
        status = looksInvalid ? 'PASS' : 'FAIL'
        detail = `tool_error text="${String(text).slice(0, 160)}"`
      } else {
        detail = 'unexpected success'
      }
    } catch (err) {
      if (err instanceof McpError) {
        // ErrorCode.InvalidParams = -32602
        const ok = err.code === -32602
        status = ok ? 'PASS' : 'FAIL'
        detail = `McpError code=${err.code} msg="${err.message}"`
      } else {
        detail = `threw non-McpError: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    record('6a', 'create_from_template unknown id', status, detail)
  }

  // ========================================================================
  // 6b. Error: load_scene missing id → expect error.
  // ========================================================================
  {
    let status: StepStatus = 'FAIL'
    let detail = ''
    try {
      const r = await client.callTool({
        name: 'load_scene',
        arguments: { id: 'missing-id-xyz' },
      })
      if (r.isError) {
        const textArr = r.content as TextContent
        const text = textArr?.[0]?.text ?? ''
        const looksMissing = /scene_not_found|missing|not found/i.test(text)
        status = looksMissing ? 'PASS' : 'FAIL'
        detail = `tool_error text="${String(text).slice(0, 160)}"`
      } else {
        detail = 'unexpected success'
      }
    } catch (err) {
      if (err instanceof McpError) {
        const ok = err.code === -32602 || /scene_not_found|not found/i.test(err.message)
        status = ok ? 'PASS' : 'FAIL'
        detail = `McpError code=${err.code} msg="${err.message}"`
      } else {
        detail = `threw non-McpError: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    record('6b', 'load_scene missing id', status, detail)
  }

  const elapsed = Date.now() - t0
  await client.close()

  // --- Write markdown report ---
  const passed = steps.filter((s) => s.status === 'PASS').length
  const failed = steps.filter((s) => s.status === 'FAIL').length
  const total = steps.length

  const lines: string[] = []
  lines.push('# Phase 8 P1 — templates lifecycle (stdio MCP)')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(
    `Transport: stdio (\`bun packages/mcp/dist/bin/pascal-mcp.js --stdio\`), data dir \`${DATA_DIR}\`.`,
  )
  lines.push('')
  lines.push(`**Summary:** ${passed}/${total} PASS, ${failed} FAIL, ${elapsed} ms.`)
  lines.push('')
  lines.push('## Steps')
  lines.push('')
  lines.push('| # | Step | Status | Detail |')
  lines.push('|---|------|--------|--------|')
  for (const s of steps) {
    const safe = s.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${s.id} | ${s.title} | ${s.status} | ${safe} |`)
  }
  lines.push('')
  lines.push('## Per-template snapshot (step 2c)')
  lines.push('')
  lines.push('| Template | Scene name | nodes | zones | walls | doors | windows |')
  lines.push('|----------|------------|-------|-------|-------|-------|---------|')
  for (const snap of snapshots) {
    lines.push(
      `| ${snap.templateId} | ${snap.sceneName} | ${snap.nodeCount} | ${snap.zoneCount} | ${snap.wallCount} | ${snap.doorCount} | ${snap.windowCount} |`,
    )
  }
  lines.push('')

  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8')
  console.log(`\n[p1] report: ${REPORT_PATH}`)
  console.log(`[p1] ${passed}/${total} PASS, ${failed} FAIL in ${elapsed}ms`)

  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[p1] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(2)
})
