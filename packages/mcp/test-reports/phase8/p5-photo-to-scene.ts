/**
 * Phase 8 P5: exercise `photo_to_scene` over stdio with a mocked MCP sampling
 * response. The client advertises the `sampling` capability and installs a
 * request handler that returns a canned floor-plan JSON — no real vision API
 * is contacted.
 *
 * Run:
 *   PASCAL_DATA_DIR=/tmp/pascal-phase8-p5 \
 *     bun run packages/mcp/test-reports/phase8/p5-photo-to-scene.ts
 */

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../../..')
const BIN_PATH = resolve(REPO_ROOT, 'packages/mcp/dist/bin/pascal-mcp.js')
const REPORT_PATH = resolve(__dirname, 'p5-photo-to-scene.md')

type Row = {
  name: string
  status: 'pass' | 'fail'
  summary: string
  detail?: string
}

const rows: Row[] = []

function record(name: string, status: 'pass' | 'fail', summary: string, detail?: string): void {
  rows.push({ name, status, summary, detail })
  const tag = status === 'pass' ? 'OK' : 'FAIL'
  console.log(`${tag}  ${name}  — ${summary}`)
}

function pickText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type?: string; text?: string }> | undefined
  if (!Array.isArray(content) || content.length === 0) return ''
  return content[0]?.text ?? ''
}

/** Canned valid floor-plan reply. */
const CANNED_FLOORPLAN = {
  walls: [
    { start: [0, 0], end: [5, 0], thickness: 0.2 },
    { start: [5, 0], end: [5, 3], thickness: 0.2 },
    { start: [5, 3], end: [0, 3], thickness: 0.2 },
    { start: [0, 3], end: [0, 0], thickness: 0.2 },
  ],
  rooms: [
    {
      name: 'living room',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 3],
        [0, 3],
      ],
      approximateAreaSqM: 15,
    },
  ],
  approximateDimensions: { widthM: 5, depthM: 3 },
  confidence: 0.85,
}

type SamplingReplyBuilder = (req: unknown) => unknown

function makeClient(opts: {
  withSampling: boolean
  samplingReply?: SamplingReplyBuilder
  name: string
}): { client: Client; transport: StdioClientTransport } {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    stderr: 'inherit',
    env: {
      ...process.env,
      PASCAL_DATA_DIR: process.env.PASCAL_DATA_DIR ?? '/tmp/pascal-phase8-p5',
    },
  })
  const client = new Client(
    { name: opts.name, version: '0.0.0' },
    {
      capabilities: opts.withSampling ? { sampling: {} } : {},
    },
  )
  if (opts.withSampling && opts.samplingReply) {
    const build = opts.samplingReply
    client.setRequestHandler(CreateMessageRequestSchema, async (req) => (await build(req)) as never)
  }
  return { client, transport }
}

async function main(): Promise<void> {
  const t0 = Date.now()
  console.log('---- P5 photo_to_scene (stdio + mocked sampling) ----')
  console.log(`BIN=${BIN_PATH}`)
  console.log(`PASCAL_DATA_DIR=${process.env.PASCAL_DATA_DIR ?? '/tmp/pascal-phase8-p5'}`)

  // Primary client with sampling + valid handler. A mutable holder lets us swap
  // the behaviour of the handler between tests without reconnecting.
  type Mode = 'valid' | 'not-json'
  let mode: Mode = 'valid'
  const { client, transport } = makeClient({
    name: 'p5',
    withSampling: true,
    samplingReply: () => {
      if (mode === 'not-json') {
        return {
          model: 'test-model',
          role: 'assistant',
          content: { type: 'text', text: 'not json at all' },
          stopReason: 'endTurn',
        }
      }
      return {
        model: 'test-model',
        role: 'assistant',
        content: { type: 'text', text: JSON.stringify(CANNED_FLOORPLAN) },
        stopReason: 'endTurn',
      }
    },
  })
  await client.connect(transport)
  console.log('OK  connected primary client (sampling enabled)')

  let observedSceneId: string | undefined
  let observedNodeCount: number | undefined

  // --- Test 1: happy path, save: true -------------------------------------
  // Per the P5 plan the input was `https://example.com/plan.png`, but the
  // sandbox has no outbound network so `resolveImageBlock` cannot fetch it.
  // Send a data URI instead — the mocked sampling handler ignores the image
  // bytes, so the end-to-end contract under test (vision JSON → scene) is
  // unchanged.
  try {
    const res: any = await client.callTool({
      name: 'photo_to_scene',
      arguments: {
        image: 'data:image/png;base64,aGVsbG8=',
        name: 'p5-photo',
        save: true,
      },
    })
    if (res.isError) throw new Error(`tool error: ${pickText(res)}`)
    const s = res.structuredContent as {
      sceneId?: string
      url?: string
      walls: number
      rooms: number
      confidence: number
    }
    const problems: string[] = []
    if (!s.sceneId) problems.push('sceneId missing')
    if (!s.url) problems.push('url missing')
    if (s.walls !== 4) problems.push(`walls=${s.walls} (expected 4)`)
    if (s.rooms !== 1) problems.push(`rooms=${s.rooms} (expected 1)`)
    if (Math.abs(s.confidence - 0.85) > 1e-6) {
      problems.push(`confidence=${s.confidence} (expected 0.85)`)
    }
    if (problems.length === 0) {
      observedSceneId = s.sceneId
      record(
        '1. happy path photo_to_scene(save:true)',
        'pass',
        `sceneId=${s.sceneId} url=${s.url} walls=${s.walls} rooms=${s.rooms} confidence=${s.confidence}`,
        JSON.stringify(s),
      )
    } else {
      record(
        '1. happy path photo_to_scene(save:true)',
        'fail',
        problems.join('; '),
        JSON.stringify(s),
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    record('1. happy path photo_to_scene(save:true)', 'fail', `threw: ${msg}`)
  }

  // --- Test 2: list_scenes sees the new scene ------------------------------
  try {
    const res: any = await client.callTool({ name: 'list_scenes', arguments: {} })
    if (res.isError) throw new Error(`tool error: ${pickText(res)}`)
    const s = res.structuredContent as { scenes: Array<{ id: string; name: string }> }
    const match = s.scenes.find((x) => x.id === observedSceneId)
    if (match) {
      record(
        '2. list_scenes includes new scene',
        'pass',
        `found id=${match.id} name="${match.name}" (total=${s.scenes.length})`,
        JSON.stringify({ total: s.scenes.length, match }),
      )
    } else {
      record(
        '2. list_scenes includes new scene',
        'fail',
        `id=${observedSceneId} not found among ${s.scenes.length}`,
        JSON.stringify(s).slice(0, 300),
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    record('2. list_scenes includes new scene', 'fail', `threw: ${msg}`)
  }

  // --- Test 3: load_scene + validate_scene ---------------------------------
  try {
    if (!observedSceneId) throw new Error('no sceneId from test 1')
    const load: any = await client.callTool({
      name: 'load_scene',
      arguments: { id: observedSceneId },
    })
    if (load.isError) throw new Error(`load_scene: ${pickText(load)}`)
    observedNodeCount = (load.structuredContent as { nodeCount?: number }).nodeCount

    const valid: any = await client.callTool({ name: 'validate_scene', arguments: {} })
    if (valid.isError) throw new Error(`validate_scene: ${pickText(valid)}`)
    const v = valid.structuredContent as { valid: boolean; errors?: unknown[] }
    if (v.valid === true) {
      record(
        '3. load_scene + validate_scene',
        'pass',
        `nodeCount=${observedNodeCount} valid=true errors=${v.errors?.length ?? 0}`,
        JSON.stringify({ load: load.structuredContent, validate: v }),
      )
    } else {
      record(
        '3. load_scene + validate_scene',
        'fail',
        `valid=${v.valid} errors=${JSON.stringify(v.errors)}`,
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    record('3. load_scene + validate_scene', 'fail', `threw: ${msg}`)
  }

  // --- Test 4: save:false variant, base64 input ---------------------------
  try {
    const res: any = await client.callTool({
      name: 'photo_to_scene',
      arguments: {
        image: 'base64here',
        save: false,
        name: 'p5-photo-inline',
      },
    })
    if (res.isError) throw new Error(`tool error: ${pickText(res)}`)
    const s = res.structuredContent as {
      sceneId?: string
      url?: string
      walls: number
      rooms: number
      confidence: number
      graph?: { nodes?: Record<string, unknown>; rootNodeIds?: string[] }
    }
    const problems: string[] = []
    if (s.sceneId !== undefined) problems.push(`sceneId should be absent, got ${s.sceneId}`)
    if (s.url !== undefined) problems.push(`url should be absent, got ${s.url}`)
    if (!s.graph) problems.push('graph missing')
    if (s.graph && !s.graph.nodes) problems.push('graph.nodes missing')
    if (s.graph && !s.graph.rootNodeIds) problems.push('graph.rootNodeIds missing')
    if (s.walls !== 4) problems.push(`walls=${s.walls}`)
    if (s.rooms !== 1) problems.push(`rooms=${s.rooms}`)
    const nodeCount = s.graph?.nodes ? Object.keys(s.graph.nodes).length : 0
    if (problems.length === 0) {
      record(
        '4. save:false returns graph inline',
        'pass',
        `inline graph nodes=${nodeCount}, rootIds=${s.graph?.rootNodeIds?.length}, walls=${s.walls}, rooms=${s.rooms}`,
        JSON.stringify({
          walls: s.walls,
          rooms: s.rooms,
          confidence: s.confidence,
          nodes: nodeCount,
          roots: s.graph?.rootNodeIds?.length,
        }),
      )
    } else {
      record('4. save:false returns graph inline', 'fail', problems.join('; '))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    record('4. save:false returns graph inline', 'fail', `threw: ${msg}`)
  }

  // --- Test 5: invalid (non-JSON) sampling response -----------------------
  try {
    mode = 'not-json'
    const res: any = await client.callTool({
      name: 'photo_to_scene',
      arguments: {
        image: 'base64here',
        save: false,
      },
    })
    const text = pickText(res)
    if (res.isError && text.includes('sampling_response_unparseable')) {
      record(
        '5. invalid sampling JSON → sampling_response_unparseable',
        'pass',
        'received expected error',
        text.slice(0, 240),
      )
    } else {
      record(
        '5. invalid sampling JSON → sampling_response_unparseable',
        'fail',
        `isError=${res.isError} text=${text.slice(0, 200)}`,
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('sampling_response_unparseable')) {
      record(
        '5. invalid sampling JSON → sampling_response_unparseable',
        'pass',
        'thrown with expected code',
        msg.slice(0, 240),
      )
    } else {
      record(
        '5. invalid sampling JSON → sampling_response_unparseable',
        'fail',
        `unexpected throw: ${msg.slice(0, 240)}`,
      )
    }
  } finally {
    mode = 'valid'
  }

  await client.close()
  console.log('OK  closed primary client')

  // --- Test 6: secondary client WITHOUT sampling capability ---------------
  try {
    const { client: noSampleClient, transport: noSampleTransport } = makeClient({
      name: 'p5-nosample',
      withSampling: false,
    })
    await noSampleClient.connect(noSampleTransport)
    try {
      const res: any = await noSampleClient.callTool({
        name: 'photo_to_scene',
        arguments: {
          image: 'base64here',
          save: false,
        },
      })
      const text = pickText(res)
      if (res.isError && text.includes('sampling_unavailable')) {
        record(
          '6. no sampling capability → sampling_unavailable',
          'pass',
          'received expected error',
          text.slice(0, 240),
        )
      } else {
        record(
          '6. no sampling capability → sampling_unavailable',
          'fail',
          `isError=${res.isError} text=${text.slice(0, 200)}`,
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('sampling_unavailable')) {
        record(
          '6. no sampling capability → sampling_unavailable',
          'pass',
          'thrown with expected code',
          msg.slice(0, 240),
        )
      } else {
        record(
          '6. no sampling capability → sampling_unavailable',
          'fail',
          `unexpected throw: ${msg.slice(0, 240)}`,
        )
      }
    } finally {
      await noSampleClient.close()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    record('6. no sampling capability → sampling_unavailable', 'fail', `setup threw: ${msg}`)
  }

  const elapsedMs = Date.now() - t0
  const passed = rows.filter((r) => r.status === 'pass').length
  const failed = rows.filter((r) => r.status === 'fail').length

  // Write report
  const ts = new Date().toISOString()
  const md: string[] = []
  md.push('# Phase 8 P5 — `photo_to_scene` via stdio with mocked sampling')
  md.push('')
  md.push(`Generated: ${ts}`)
  md.push('')
  md.push('## Summary')
  md.push('')
  md.push(`- Transport: stdio (\`bun packages/mcp/dist/bin/pascal-mcp.js --stdio\`)`)
  md.push(`- Data dir: \`${process.env.PASCAL_DATA_DIR ?? '/tmp/pascal-phase8-p5'}\``)
  md.push(`- Sampling: mocked via \`client.setRequestHandler(CreateMessageRequestSchema, …)\``)
  md.push(`- Passed: **${passed}/${rows.length}**`)
  md.push(`- Failed: **${failed}/${rows.length}**`)
  md.push(`- Total run time: **${elapsedMs} ms**`)
  if (observedSceneId) md.push(`- Observed sceneId: \`${observedSceneId}\``)
  if (observedNodeCount !== undefined) {
    md.push(`- Node count after load_scene: **${observedNodeCount}**`)
  }
  md.push('')
  md.push('## Tests')
  md.push('')
  md.push('| # | Test | Status | Summary |')
  md.push('|---|------|--------|---------|')
  rows.forEach((row, i) => {
    const tag = row.status === 'pass' ? 'PASS' : 'FAIL'
    const safe = row.summary.replace(/\|/g, '\\|')
    md.push(`| ${i + 1} | ${row.name} | ${tag} | ${safe} |`)
  })
  md.push('')
  md.push('## Details')
  md.push('')
  rows.forEach((row, i) => {
    md.push(`### ${i + 1}. ${row.name} — ${row.status.toUpperCase()}`)
    md.push('')
    md.push(`Summary: ${row.summary}`)
    if (row.detail) {
      md.push('')
      md.push('```json')
      md.push(row.detail)
      md.push('```')
    }
    md.push('')
  })
  md.push('## Canned sampling payload')
  md.push('')
  md.push('```json')
  md.push(JSON.stringify(CANNED_FLOORPLAN, null, 2))
  md.push('```')
  md.push('')

  writeFileSync(REPORT_PATH, md.join('\n'), 'utf8')
  console.log(`\nreport written: ${REPORT_PATH}`)
  console.log(
    `passed=${passed}/${rows.length} failed=${failed}/${rows.length} elapsedMs=${elapsedMs}`,
  )

  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[p5] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(2)
})
