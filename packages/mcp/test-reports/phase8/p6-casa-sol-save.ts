/**
 * Phase 8 P6 — Casa del Sol via save_scene.
 *
 * Replicates the Casa del Sol build (packages/mcp/test-reports/casa-sol/DESIGN.md)
 * but spawns the stdio MCP transport and persists through `save_scene` instead
 * of export_json + window.__pascalScene injection.
 *
 * Transport: StdioClientTransport spawning `bun dist/bin/pascal-mcp.js --stdio`
 * with PASCAL_DATA_DIR=/tmp/pascal-phase8 so the editor (same shared dir) can
 * load the scene back via /api/scenes/[id].
 *
 * Run:
 *   PASCAL_DATA_DIR=/tmp/pascal-phase8 \
 *     bun run packages/mcp/test-reports/phase8/p6-casa-sol-save.ts
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __filename = fileURLToPath(import.meta.url)
const HERE = dirname(__filename)
const REPO_ROOT = resolve(HERE, '../../../..')
const BIN_PATH = resolve(REPO_ROOT, 'packages/mcp/dist/bin/pascal-mcp.js')
const REPORT_PATH = resolve(HERE, 'p6-casa-sol-save.md')
const SCENE_JSON_PATH = resolve(HERE, 'casa-sol-v2.json')

const PASCAL_DATA_DIR = process.env.PASCAL_DATA_DIR ?? '/tmp/pascal-phase8'
const EDITOR_URL = process.env.EDITOR_URL ?? 'http://localhost:3002'

// Pre-create the shared dir so both the spawned MCP and the running editor see it.
if (!existsSync(PASCAL_DATA_DIR)) {
  mkdirSync(PASCAL_DATA_DIR, { recursive: true })
}

type Vec2 = [number, number]

type WallSpec = { key: string; designId: number; start: Vec2; end: Vec2 }

const PERIMETER_WALLS: WallSpec[] = [
  { key: 'south-outer', designId: 1, start: [-8, 4], end: [4, 4] },
  { key: 'north-outer', designId: 2, start: [-8, -4], end: [4, -4] },
  { key: 'west-outer', designId: 3, start: [-8, -4], end: [-8, 4] },
  { key: 'east-outer', designId: 4, start: [4, -4], end: [4, 4] },
]

const INTERIOR_WALLS: WallSpec[] = [
  { key: 'living-kitchen-split', designId: 5, start: [-1, 0], end: [-1, 4] },
  { key: 'north-bedrooms-split', designId: 6, start: [-1, -4], end: [-1, 0] },
  { key: 'bedroom2-east', designId: 7, start: [-4, -4], end: [-4, 0] },
  { key: 'hallway-north-edge', designId: 8, start: [-4, -1], end: [-1, -1] },
  { key: 'hallway-south-edge', designId: 9, start: [-4, -2], end: [-1, -2] },
]

type ZoneSpec = { label: string; polygon: Vec2[]; properties?: Record<string, unknown> }

const INTERIOR_ZONES: ZoneSpec[] = [
  {
    label: 'living-dining',
    polygon: [
      [-8, 0],
      [-1, 0],
      [-1, 4],
      [-8, 4],
    ],
  },
  {
    label: 'kitchen',
    polygon: [
      [-1, 0],
      [4, 0],
      [4, 4],
      [-1, 4],
    ],
  },
  {
    label: 'bedroom-2',
    polygon: [
      [-8, -4],
      [-4, -4],
      [-4, 0],
      [-8, 0],
    ],
  },
  {
    label: 'hallway',
    polygon: [
      [-4, -2],
      [-1, -2],
      [-1, -1],
      [-4, -1],
    ],
  },
  {
    label: 'bathroom-2',
    polygon: [
      [-4, -4],
      [-1, -4],
      [-1, -2],
      [-4, -2],
    ],
  },
  {
    label: 'bathroom-1',
    polygon: [
      [-4, -1],
      [-1, -1],
      [-1, 0],
      [-4, 0],
    ],
  },
  {
    label: 'master-bedroom',
    polygon: [
      [-1, -4],
      [4, -4],
      [4, 0],
      [-1, 0],
    ],
  },
]

type OpeningSpec = {
  wallDesignId: number
  kind: 'door' | 'window'
  position: number
  width: number
  height: number
  label: string
}

const OPENINGS: OpeningSpec[] = [
  { wallDesignId: 1, kind: 'door', position: 0.2, width: 0.9, height: 2.1, label: 'front-door' },
  { wallDesignId: 1, kind: 'door', position: 0.75, width: 2.2, height: 2.1, label: 'sliding-pool' },
  { wallDesignId: 2, kind: 'door', position: 0.65, width: 0.9, height: 2.1, label: 'kitchen-back' },
  { wallDesignId: 6, kind: 'door', position: 0.3, width: 0.8, height: 2.1, label: 'master-door' },
  {
    wallDesignId: 7,
    kind: 'door',
    position: 0.5,
    width: 0.8,
    height: 2.1,
    label: 'bedroom-2-door',
  },
  { wallDesignId: 9, kind: 'door', position: 0.5, width: 0.7, height: 2.0, label: 'bath2-door' },
  { wallDesignId: 1, kind: 'window', position: 0.3, width: 2.0, height: 1.4, label: 'living-pic' },
  { wallDesignId: 1, kind: 'window', position: 0.45, width: 1.4, height: 1.4, label: 'living-2' },
  { wallDesignId: 3, kind: 'window', position: 0.25, width: 1.0, height: 1.1, label: 'kitchen-w' },
  { wallDesignId: 4, kind: 'window', position: 0.25, width: 1.4, height: 1.4, label: 'master-w' },
  {
    wallDesignId: 4,
    kind: 'window',
    position: 0.75,
    width: 1.4,
    height: 1.4,
    label: 'bedroom-2-w',
  },
  { wallDesignId: 2, kind: 'window', position: 0.3, width: 0.8, height: 0.6, label: 'bath2-high' },
]

const POOL_POLY: Vec2[] = [
  [5, -1.5],
  [10, -1.5],
  [10, 1.5],
  [5, 1.5],
]

type FenceSpec = { label: string; start: Vec2; end: Vec2 }
const FENCES: FenceSpec[] = [
  { label: 'south-west', start: [-10, 7.5], end: [-1, 7.5] },
  { label: 'south-east', start: [1, 7.5], end: [10, 7.5] },
  { label: 'east', start: [10, 7.5], end: [10, -7.5] },
  { label: 'north', start: [10, -7.5], end: [-10, -7.5] },
  { label: 'west', start: [-10, -7.5], end: [-10, 7.5] },
]

const SITE_POLY: Vec2[] = [
  [-10, -7.5],
  [10, -7.5],
  [10, 7.5],
  [-10, 7.5],
]

type Validation = {
  valid: boolean
  errors: Array<{ nodeId: string; path: string; message: string }>
}

type StepEntry = { n: number; name: string; ok: boolean; summary: string; durationMs: number }

const steps: StepEntry[] = []

function log(msg: string): void {
  console.log(msg)
}

async function recordStep<T>(
  n: number,
  name: string,
  fn: () => Promise<{ summary: string; result: T }>,
): Promise<T> {
  const t0 = Date.now()
  try {
    const { summary, result } = await fn()
    const durationMs = Date.now() - t0
    steps.push({ n, name, ok: true, summary, durationMs })
    log(`[p6] ${String(n).padStart(2, '0')} ${name.padEnd(22)} OK   (${summary}, ${durationMs}ms)`)
    return result
  } catch (err) {
    const durationMs = Date.now() - t0
    const msg = err instanceof Error ? err.message : String(err)
    steps.push({ n, name, ok: false, summary: `FAILED: ${msg}`, durationMs })
    log(`[p6] ${String(n).padStart(2, '0')} ${name.padEnd(22)} FAIL (${msg}, ${durationMs}ms)`)
    throw err
  }
}

async function callTool<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content?: Array<{ text?: string }>
    structuredContent?: unknown
  }
  if (res.isError) {
    const text = Array.isArray(res.content) ? res.content.map((c) => c.text ?? '').join('\n') : ''
    throw new Error(`tool ${name} error: ${text || 'unknown'}`)
  }
  return (res.structuredContent ?? {}) as T
}

async function validate(client: Client, phase: string): Promise<Validation> {
  const v = await callTool<Validation>(client, 'validate_scene', {})
  log(`[p6]    validate(${phase}): valid=${v.valid}, errors=${v.errors.length}`)
  if (!v.valid) {
    for (const e of v.errors.slice(0, 5)) {
      log(`[p6]      - ${e.nodeId} @ ${e.path}: ${e.message}`)
    }
  }
  return v
}

async function main(): Promise<void> {
  log(`[p6] spawning stdio MCP: bun ${BIN_PATH} --stdio`)
  log(`[p6] PASCAL_DATA_DIR=${PASCAL_DATA_DIR}`)

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    stderr: 'inherit',
    env: { ...process.env, PASCAL_DATA_DIR },
  })
  const client = new Client({ name: 'p6-casa-sol-save', version: '0.1.0' })
  await client.connect(transport)
  log('[p6] stdio transport connected')

  const validations: Record<string, Validation> = {}

  // --- 1. Discover building + level ---
  const { buildingId, levelId } = await recordStep(1, 'discover', async () => {
    const buildings = await callTool<{ nodes: Array<{ id: string }> }>(client, 'find_nodes', {
      type: 'building',
    })
    const levels = await callTool<{ nodes: Array<{ id: string; parentId?: string }> }>(
      client,
      'find_nodes',
      { type: 'level' },
    )
    if (!buildings.nodes.length) throw new Error('no building in default scene')
    if (!levels.nodes.length) throw new Error('no level in default scene')
    const b = buildings.nodes[0]!
    const l = levels.nodes.find((lv) => lv.parentId === b.id) ?? levels.nodes[0]!
    return {
      summary: `building=${b.id}, level=${l.id}`,
      result: { buildingId: b.id, levelId: l.id },
    }
  })
  void buildingId

  const initialCount = (await callTool<{ nodes: unknown[] }>(client, 'find_nodes', {})).nodes.length

  validations.initial = await validate(client, 'initial')

  // --- 2. Perimeter walls ---
  const perimeterIds: Record<string, string> = {}
  await recordStep(2, 'perimeter walls', async () => {
    const ids: string[] = []
    for (const w of PERIMETER_WALLS) {
      const r = await callTool<{ wallId: string }>(client, 'create_wall', {
        levelId,
        start: w.start,
        end: w.end,
        thickness: 0.2,
        height: 2.7,
      })
      perimeterIds[w.key] = r.wallId
      ids.push(r.wallId)
    }
    return { summary: `${ids.length} walls`, result: ids }
  })

  // --- 3. Interior walls via apply_patch ---
  const interiorIds: Record<string, string> = {}
  await recordStep(3, 'interior walls', async () => {
    const res = await callTool<{ createdIds: string[] }>(client, 'apply_patch', {
      patches: INTERIOR_WALLS.map((w) => ({
        op: 'create',
        parentId: levelId,
        node: {
          type: 'wall',
          start: w.start,
          end: w.end,
          thickness: 0.2,
          height: 2.7,
        },
      })),
    })
    INTERIOR_WALLS.forEach((w, i) => {
      const id = res.createdIds[i]
      if (id) interiorIds[w.key] = id
    })
    return { summary: `${res.createdIds.length} walls`, result: res.createdIds }
  })

  const wallByDesignId = new Map<number, string>()
  for (const w of PERIMETER_WALLS) {
    const id = perimeterIds[w.key]
    if (id) wallByDesignId.set(w.designId, id)
  }
  for (const w of INTERIOR_WALLS) {
    const id = interiorIds[w.key]
    if (id) wallByDesignId.set(w.designId, id)
  }

  validations.afterWalls = await validate(client, 'walls')

  // --- 4. Zones ---
  await recordStep(4, 'zones', async () => {
    const ids: string[] = []
    for (const z of INTERIOR_ZONES) {
      const r = await callTool<{ zoneId: string }>(client, 'set_zone', {
        levelId,
        label: z.label,
        polygon: z.polygon,
        properties: z.properties ?? {},
      })
      ids.push(r.zoneId)
    }
    return { summary: `${ids.length} zones`, result: ids }
  })

  validations.afterZones = await validate(client, 'zones')

  // --- 5. Openings (doors + windows) ---
  let doorCount = 0
  let windowCount = 0
  await recordStep(5, 'openings', async () => {
    const failures: string[] = []
    for (const o of OPENINGS) {
      const wallId = wallByDesignId.get(o.wallDesignId)
      if (!wallId) {
        failures.push(`${o.label}: wall designId=${o.wallDesignId} not found`)
        continue
      }
      try {
        await callTool<{ openingId: string }>(client, 'cut_opening', {
          wallId,
          type: o.kind,
          position: o.position,
          width: o.width,
          height: o.height,
        })
        if (o.kind === 'door') doorCount++
        else windowCount++
      } catch (err) {
        failures.push(`${o.label}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return {
      summary: `${doorCount} doors, ${windowCount} windows, ${failures.length} failures`,
      result: { doorCount, windowCount, failures },
    }
  })

  validations.afterOpenings = await validate(client, 'openings')

  // --- 6. Pool zone + pool slab ---
  await recordStep(6, 'pool zone + slab', async () => {
    const zoneRes = await callTool<{ zoneId: string }>(client, 'set_zone', {
      levelId,
      label: 'pool',
      polygon: POOL_POLY,
      properties: { kind: 'pool', depthM: 1.8, finish: 'tile' },
    })
    const slabRes = await callTool<{ createdIds: string[] }>(client, 'apply_patch', {
      patches: [
        {
          op: 'create',
          parentId: levelId,
          node: { type: 'slab', polygon: POOL_POLY, elevation: -1.8 },
        },
      ],
    })
    return {
      summary: `zone=${zoneRes.zoneId}, slab=${slabRes.createdIds[0]}`,
      result: { zoneId: zoneRes.zoneId, slabId: slabRes.createdIds[0] },
    }
  })

  validations.afterPool = await validate(client, 'pool')

  // --- 7. Privacy fences ---
  await recordStep(7, 'privacy fences', async () => {
    const res = await callTool<{ createdIds: string[] }>(client, 'apply_patch', {
      patches: FENCES.map((f) => ({
        op: 'create',
        parentId: levelId,
        node: {
          type: 'fence',
          start: f.start,
          end: f.end,
          height: 1.8,
          style: 'privacy',
          thickness: 0.08,
        },
      })),
    })
    return { summary: `${res.createdIds.length} fences`, result: res.createdIds }
  })

  validations.afterFences = await validate(client, 'fences')

  // --- 8. Garden zone ---
  await recordStep(8, 'garden zone', async () => {
    const r = await callTool<{ zoneId: string }>(client, 'set_zone', {
      levelId,
      label: 'garden',
      polygon: SITE_POLY,
      properties: { kind: 'garden' },
    })
    return { summary: `zone=${r.zoneId}`, result: r.zoneId }
  })

  validations.afterGarden = await validate(client, 'garden')

  // --- Assertion: ≥30 nodes ---
  const allNodes = (await callTool<{ nodes: Array<{ type: string }> }>(client, 'find_nodes', {}))
    .nodes
  const tally: Record<string, number> = {}
  for (const n of allNodes) tally[n.type] = (tally[n.type] ?? 0) + 1
  log(
    `[p6]    total nodes=${allNodes.length}, walls=${tally.wall ?? 0} zones=${tally.zone ?? 0} doors=${tally.door ?? 0} windows=${tally.window ?? 0} fences=${tally.fence ?? 0} slabs=${tally.slab ?? 0}`,
  )
  if (allNodes.length < 30) {
    throw new Error(`node count ${allNodes.length} < 30`)
  }

  // --- 9. save_scene ---
  const saved = await recordStep(9, 'save_scene', async () => {
    const r = await callTool<{
      id: string
      name: string
      version: number
      nodeCount: number
      sizeBytes: number
      url: string
    }>(client, 'save_scene', { name: 'Casa del Sol' })
    return {
      summary: `id=${r.id}, nodeCount=${r.nodeCount}, size=${r.sizeBytes}B, url=${r.url}`,
      result: r,
    }
  })

  // --- 10. File on disk ---
  const expectedPath = resolve(PASCAL_DATA_DIR, 'scenes', `${saved.id}.json`)
  const fileOk = await recordStep(10, 'file on disk', async () => {
    if (!existsSync(expectedPath)) {
      throw new Error(`scene file missing at ${expectedPath}`)
    }
    const st = statSync(expectedPath)
    return {
      summary: `${expectedPath} (${st.size}B)`,
      result: { path: expectedPath, size: st.size },
    }
  })
  void fileOk

  // --- 11. GET /api/scenes/<id> ---
  const apiOk = await recordStep(11, 'GET /api/scenes/:id', async () => {
    const res = await fetch(`${EDITOR_URL}/api/scenes/${saved.id}`)
    if (res.status !== 200) throw new Error(`status=${res.status}`)
    const body = (await res.json()) as { graph: { nodes: Record<string, unknown> } }
    const got = Object.keys(body.graph.nodes).length
    if (got !== saved.nodeCount) {
      throw new Error(`nodeCount mismatch: saved=${saved.nodeCount}, api=${got}`)
    }
    return { summary: `200 OK, ${got} nodes`, result: got }
  })
  void apiOk

  // --- 12. GET /scene/<id> (HTML) ---
  await recordStep(12, 'GET /scene/:id (HTML)', async () => {
    const res = await fetch(`${EDITOR_URL}/scene/${saved.id}`)
    if (res.status !== 200) throw new Error(`status=${res.status}`)
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html')) throw new Error(`content-type=${ct}`)
    const txt = await res.text()
    return { summary: `200 OK, ${ct}, ${txt.length}B`, result: txt.length }
  })

  // --- 13. Write casa-sol-v2.json evidence ---
  await recordStep(13, 'write v2 scene.json', async () => {
    const r = await callTool<{ json: string }>(client, 'export_json', { pretty: true })
    writeFileSync(SCENE_JSON_PATH, r.json, 'utf8')
    return { summary: `${r.json.length}B -> ${SCENE_JSON_PATH}`, result: r.json.length }
  })

  // --- Final validate ---
  validations.final = await validate(client, 'final')

  await client.close()

  // --- Write report ---
  const allValid = Object.values(validations).every((v) => v.valid)
  const passed = steps.filter((s) => s.ok).length
  const total = steps.length

  const md: string[] = []
  md.push('# Phase 8 P6 — Casa del Sol via save_scene')
  md.push('')
  md.push(`Generated: ${new Date().toISOString()}`)
  md.push(`Transport: stdio (spawned \`bun ${BIN_PATH} --stdio\`)`)
  md.push(`PASCAL_DATA_DIR: \`${PASCAL_DATA_DIR}\``)
  md.push(`Editor URL: ${EDITOR_URL}`)
  md.push('')
  md.push('## Result summary')
  md.push('')
  md.push(`- Steps passed: **${passed}/${total}**`)
  md.push(`- Initial node count: ${initialCount}`)
  md.push(`- Final node count: **${allNodes.length}** (threshold ≥ 30)`)
  md.push(
    `- doors=${tally.door ?? 0}, windows=${tally.window ?? 0}, zones=${tally.zone ?? 0}, walls=${tally.wall ?? 0}, fences=${tally.fence ?? 0}, slabs=${tally.slab ?? 0}`,
  )
  md.push(`- All validate_scene calls valid=true: **${allValid}**`)
  md.push(`- Saved scene id: \`${saved.id}\``)
  md.push(`- Scene file: \`${expectedPath}\``)
  md.push('')
  md.push(`### Open in browser: ${EDITOR_URL}/scene/${saved.id}`)
  md.push('')
  md.push('## Per-step results')
  md.push('')
  md.push('| # | Step | Status | Duration | Summary |')
  md.push('|---|------|--------|----------|---------|')
  for (const s of steps) {
    md.push(
      `| ${s.n} | ${s.name} | ${s.ok ? 'PASS' : 'FAIL'} | ${s.durationMs}ms | ${s.summary.replace(/\|/g, '\\|')} |`,
    )
  }
  md.push('')
  md.push('## Validation history')
  md.push('')
  md.push('| Phase | valid | errors |')
  md.push('|-------|-------|--------|')
  for (const [phase, v] of Object.entries(validations)) {
    md.push(`| ${phase} | ${v.valid} | ${v.errors.length} |`)
  }
  md.push('')
  md.push('## save_scene response')
  md.push('')
  md.push('```json')
  md.push(JSON.stringify(saved, null, 2))
  md.push('```')
  md.push('')
  md.push('## Assertions')
  md.push('')
  md.push(`- [${allNodes.length >= 30 ? 'x' : ' '}] ≥30 nodes total`)
  md.push(`- [${allValid ? 'x' : ' '}] validate_scene valid:true at every phase`)
  md.push(`- [${saved.id ? 'x' : ' '}] save_scene returned id=\`${saved.id}\``)
  md.push(`- [${existsSync(expectedPath) ? 'x' : ' '}] file exists on disk at \`${expectedPath}\``)
  md.push(
    `- [${steps.find((s) => s.name === 'GET /api/scenes/:id')?.ok ? 'x' : ' '}] GET /api/scenes/<id> returned 200 with matching node count`,
  )
  md.push(
    `- [${steps.find((s) => s.name === 'GET /scene/:id (HTML)')?.ok ? 'x' : ' '}] GET /scene/<id> returned 200 HTML`,
  )
  md.push(`- [${existsSync(SCENE_JSON_PATH) ? 'x' : ' '}] wrote \`${SCENE_JSON_PATH}\``)
  md.push('')

  writeFileSync(REPORT_PATH, md.join('\n'), 'utf8')
  log(`[p6] report written: ${REPORT_PATH}`)
  log(`[p6] final URL: ${EDITOR_URL}/scene/${saved.id}`)
  log(`[p6] DONE — ${passed}/${total} steps passed`)
}

main().catch((err) => {
  console.error('[p6] FATAL:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(1)
})
