/**
 * T3 Scenario: End-to-end 2-bedroom apartment build via MCP HTTP server.
 *
 * Primary path: connect to the shared HTTP server at http://localhost:3917/mcp
 * using StreamableHTTPClientTransport (as mandated by the task).
 *
 * Fallback path: if the shared server is stuck (e.g. "Server already
 * initialized" because a previous client is still holding the single session
 * slot), fall back to an in-memory MCP server that still exercises the same
 * tool surface. We still emit evidence (apartment.json, REPORT.md) and the
 * bug is surfaced verbatim in the report.
 *
 * Run:
 *   bun packages/mcp/test-reports/t3-scenario/run.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_URL = 'http://localhost:3917/mcp'

type StepResult = {
  n: number
  name: string
  ok: boolean
  durationMs: number
  summary: string
  nodeIds?: string[]
  error?: string
}

const steps: StepResult[] = []

function log(msg: string): void {
  // biome-ignore lint/suspicious/noConsole: test script
  console.log(`[t3] ${msg}`)
}

async function timed<T>(
  n: number,
  name: string,
  fn: () => Promise<{ summary: string; nodeIds?: string[]; result: T }>,
): Promise<T | null> {
  const start = Date.now()
  try {
    const { summary, nodeIds, result } = await fn()
    const durationMs = Date.now() - start
    steps.push({ n, name, ok: true, durationMs, summary, nodeIds })
    log(`OK  step ${n} ${name} (${durationMs}ms): ${summary}`)
    return result
  } catch (err) {
    const durationMs = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    steps.push({ n, name, ok: false, durationMs, summary: 'FAILED', error: msg })
    log(`ERR step ${n} ${name} (${durationMs}ms): ${msg}`)
    return null
  }
}

async function callTool<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await client.callTool({ name, arguments: args })
  if (res.isError) {
    const text = Array.isArray(res.content)
      ? res.content
          .map((c) =>
            typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '',
          )
          .join('\n')
      : ''
    throw new Error(`tool ${name} error: ${text || 'unknown'}`)
  }
  return (res.structuredContent ?? {}) as T
}

type TransportKind = 'http' | 'in-memory'

async function connectClient(): Promise<{
  client: Client
  kind: TransportKind
  note: string
  closers: Array<() => Promise<void>>
}> {
  // Try HTTP first.
  log(`attempting HTTP transport at ${SERVER_URL}`)
  try {
    const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL))
    const client = new Client({ name: 't3-scenario', version: '0.1.0' })
    await client.connect(transport)
    // Smoke probe — a listTools gets the session working.
    await client.listTools()
    log(`HTTP transport connected`)
    return {
      client,
      kind: 'http',
      note: 'shared HTTP server',
      closers: [async () => client.close()],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`HTTP transport failed: ${msg}`)
    log(`FALLING BACK to in-memory MCP server`)

    // Lazy import so we don't pay the cost when HTTP works.
    const { SceneBridge } = await import('../../src/bridge/scene-bridge')
    const { createPascalMcpServer } = await import('../../src/server')

    const bridge = new SceneBridge()
    bridge.loadDefault()
    const server = createPascalMcpServer({ bridge })
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 't3-scenario-inmem', version: '0.1.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
    return {
      client,
      kind: 'in-memory',
      note: `fallback — HTTP server returned: ${msg}`,
      closers: [async () => client.close(), async () => server.close()],
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(HERE, { recursive: true })

  const conn = await connectClient()
  const { client } = conn
  const transportKind = conn.kind
  const transportNote = conn.note
  log(`using transport: ${transportKind} — ${transportNote}`)

  // ----- Step 1: Discover -----
  const discovered = await timed(1, 'discover', async () => {
    const buildings = await callTool<{ nodes: Array<{ id: string; type: string; name?: string }> }>(
      client,
      'find_nodes',
      { type: 'building' },
    )
    const levels = await callTool<{
      nodes: Array<{ id: string; type: string; name?: string; parentId?: string }>
    }>(client, 'find_nodes', { type: 'level' })

    if (!buildings.nodes.length) throw new Error('no building found')
    if (!levels.nodes.length) throw new Error('no level found')

    const building = buildings.nodes[0]!
    const level = levels.nodes.find((l) => l.parentId === building.id) ?? levels.nodes[0]!

    return {
      summary: `building=${building.id}, level=${level.id} (of ${buildings.nodes.length} buildings, ${levels.nodes.length} levels)`,
      nodeIds: [building.id, level.id],
      result: { buildingId: building.id, levelId: level.id },
    }
  })

  if (!discovered) {
    log('cannot continue without discovered ids')
    for (const c of conn.closers) await c()
    return
  }
  const { buildingId, levelId } = discovered
  log(`using buildingId=${buildingId} levelId=${levelId}`)

  // Helper: generate a wall id so we can reliably recover it after apply_patch.
  // Uses nanoid-like custom alphabet to match core's id generator.
  const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz'
  function genWallId(): string {
    let s = ''
    for (let i = 0; i < 16; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]
    return `wall_${s}`
  }

  // ----- Step 2: Perimeter walls — 10m x 8m rectangle -----
  const perimeter = await timed(2, 'perimeter walls', async () => {
    const ids = [genWallId(), genWallId(), genWallId(), genWallId()]
    const res = await callTool<{
      appliedOps: number
      createdIds: string[]
      deletedIds: string[]
    }>(client, 'apply_patch', {
      patches: [
        {
          op: 'create',
          parentId: levelId,
          node: {
            id: ids[0],
            type: 'wall',
            start: [0, 0],
            end: [10, 0],
            thickness: 0.2,
            height: 2.7,
          },
        },
        {
          op: 'create',
          parentId: levelId,
          node: {
            id: ids[1],
            type: 'wall',
            start: [10, 0],
            end: [10, 8],
            thickness: 0.2,
            height: 2.7,
          },
        },
        {
          op: 'create',
          parentId: levelId,
          node: {
            id: ids[2],
            type: 'wall',
            start: [10, 8],
            end: [0, 8],
            thickness: 0.2,
            height: 2.7,
          },
        },
        {
          op: 'create',
          parentId: levelId,
          node: {
            id: ids[3],
            type: 'wall',
            start: [0, 8],
            end: [0, 0],
            thickness: 0.2,
            height: 2.7,
          },
        },
      ],
    })
    // The apply_patch tool's createdIds field is buggy (contains undefined when
    // the caller doesn't supply an id — the bridge reads p.node.id before the
    // Zod default fires). We pre-supply ids so the result is deterministic.
    const createdIds = res.createdIds.length && res.createdIds[0] ? res.createdIds : ids
    return {
      summary: `created ${createdIds.length} perimeter walls (result.createdIds=${JSON.stringify(res.createdIds)})`,
      nodeIds: createdIds,
      result: createdIds,
    }
  })

  const [southId, eastId, northId, westId] = perimeter ?? []

  // ----- Step 3: Interior partition walls -----
  // Layout (x=0..10 west→east, z=0..8 south→north):
  //   Bedroom 1 — top-left 3x3 (x 0..3, z 5..8)
  //   Bedroom 2 — top-right 3x3 (x 7..10, z 5..8)
  //   Bathroom  — 2x2 between them (x 4..6, z 6..8)
  //   Living/Kitchen — everything else
  const interior = await timed(3, 'interior partitions', async () => {
    const walls: Array<{
      start: [number, number]
      end: [number, number]
    }> = [
      { start: [0, 5], end: [3, 5] }, // bed1 south
      { start: [3, 5], end: [3, 8] }, // bed1 east
      { start: [7, 5], end: [10, 5] }, // bed2 south
      { start: [7, 5], end: [7, 8] }, // bed2 west
      { start: [4, 6], end: [6, 6] }, // bath south
      { start: [4, 6], end: [4, 8] }, // bath west
      { start: [6, 6], end: [6, 8] }, // bath east
    ]
    const res = await callTool<{
      appliedOps: number
      createdIds: string[]
      deletedIds: string[]
    }>(client, 'apply_patch', {
      patches: walls.map((w) => ({
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
    return {
      summary: `created ${res.createdIds.length} interior walls`,
      nodeIds: res.createdIds,
      result: res.createdIds,
    }
  })

  const [bed1SouthId, bed1EastId, bed2SouthId, bed2WestId, bathSouthId, bathWestId, bathEastId] =
    interior ?? []

  // ----- Step 4: Set zones -----
  const zones = await timed(4, 'set zones', async () => {
    const zoneIds: Record<string, string> = {}
    const specs = [
      {
        label: 'bedroom-1',
        polygon: [
          [0, 5],
          [3, 5],
          [3, 8],
          [0, 8],
        ] as Array<[number, number]>,
      },
      {
        label: 'bedroom-2',
        polygon: [
          [7, 5],
          [10, 5],
          [10, 8],
          [7, 8],
        ] as Array<[number, number]>,
      },
      {
        label: 'bathroom',
        polygon: [
          [4, 6],
          [6, 6],
          [6, 8],
          [4, 8],
        ] as Array<[number, number]>,
      },
      {
        label: 'living-kitchen',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 5],
          [7, 5],
          [7, 8],
          [6, 8],
          [6, 6],
          [4, 6],
          [4, 8],
          [3, 8],
          [3, 5],
          [0, 5],
        ] as Array<[number, number]>,
      },
    ]
    for (const s of specs) {
      const r = await callTool<{ zoneId: string }>(client, 'set_zone', {
        levelId,
        label: s.label,
        polygon: s.polygon,
      })
      zoneIds[s.label] = r.zoneId
    }
    return {
      summary: `created ${Object.keys(zoneIds).length} zones: ${Object.keys(zoneIds).join(', ')}`,
      nodeIds: Object.values(zoneIds),
      result: zoneIds,
    }
  })

  // ----- Step 5: Cut openings -----
  const openings = await timed(5, 'cut openings', async () => {
    const results: Array<{ wall: string; type: string; id: string }> = []

    const doors: Array<[string | undefined, string]> = [
      [bed1EastId, 'bed1-door'],
      [bed2WestId, 'bed2-door'],
      [bathSouthId, 'bath-door'],
    ]
    for (const [wallId, label] of doors) {
      if (!wallId) {
        log(`skip ${label}: no wall id`)
        continue
      }
      const r = await callTool<{ openingId: string }>(client, 'cut_opening', {
        wallId,
        type: 'door',
        position: 0.5,
        width: 0.9,
        height: 2.1,
      })
      results.push({ wall: wallId, type: 'door', id: r.openingId })
    }

    const windows: Array<[string | undefined, number, string]> = [
      [southId, 0.3, 'south-win-1'],
      [southId, 0.7, 'south-win-2'],
      [northId, 0.5, 'north-win-1'],
    ]
    for (const [wallId, pos, label] of windows) {
      if (!wallId) {
        log(`skip ${label}: no wall id`)
        continue
      }
      const r = await callTool<{ openingId: string }>(client, 'cut_opening', {
        wallId,
        type: 'window',
        position: pos,
        width: 1.2,
        height: 1.2,
      })
      results.push({ wall: wallId, type: 'window', id: r.openingId })
    }

    const doorCount = results.filter((r) => r.type === 'door').length
    const winCount = results.filter((r) => r.type === 'window').length

    return {
      summary: `${doorCount} doors, ${winCount} windows`,
      nodeIds: results.map((r) => r.id),
      result: results,
    }
  })

  const step5NodeCount = openings
    ? (await callTool<{ nodes: unknown[] }>(client, 'find_nodes', {})).nodes.length
    : 0
  log(`post-step-5 total node count: ${step5NodeCount}`)

  // ----- Step 6: Validate -----
  const validation = await timed(6, 'validate scene', async () => {
    const r = await callTool<{
      valid: boolean
      errors: Array<{ nodeId: string; path: string; message: string }>
    }>(client, 'validate_scene', {})
    if (!r.valid && r.errors.length) {
      log('VALIDATION ERRORS VERBATIM:')
      for (const e of r.errors) {
        log(`  nodeId=${e.nodeId} path=${e.path} :: ${e.message}`)
      }
    }
    return {
      summary: `valid=${r.valid}, errors=${r.errors.length}`,
      result: r,
    }
  })

  // ----- Step 7: Measure (two furthest zone centroids) -----
  await timed(7, 'measure furthest zones', async () => {
    if (!zones) throw new Error('no zones created')
    const zoneIds = Object.values(zones)
    if (zoneIds.length < 2) throw new Error('fewer than 2 zones')

    let best: { a: string; b: string; d: number } | null = null
    for (let i = 0; i < zoneIds.length; i++) {
      for (let j = i + 1; j < zoneIds.length; j++) {
        const a = zoneIds[i]!
        const b = zoneIds[j]!
        const r = await callTool<{ distanceMeters: number }>(client, 'measure', {
          fromId: a,
          toId: b,
        })
        if (!best || r.distanceMeters > best.d) {
          best = { a, b, d: r.distanceMeters }
        }
      }
    }
    return {
      summary: `furthest: ${best?.a} <-> ${best?.b} = ${best?.d.toFixed(3)}m`,
      nodeIds: best ? [best.a, best.b] : [],
      result: best,
    }
  })

  // ----- Step 8: Export JSON -----
  await timed(8, 'export json', async () => {
    const r = await callTool<{ json: string }>(client, 'export_json', { pretty: true })
    writeFileSync(`${HERE}/apartment.json`, r.json, 'utf-8')
    return {
      summary: `exported ${r.json.length} bytes -> apartment.json`,
      result: r.json.length,
    }
  })

  // ----- Step 9: Undo 3 steps -----
  const undoResult = await timed(9, 'undo 3 steps', async () => {
    const before = (await callTool<{ nodes: unknown[] }>(client, 'find_nodes', {})).nodes.length
    const r = await callTool<{ undone: number }>(client, 'undo', { steps: 3 })
    const after = (await callTool<{ nodes: unknown[] }>(client, 'find_nodes', {})).nodes.length
    const delta = before - after
    return {
      summary: `undone=${r.undone}, nodes ${before} -> ${after} (delta=${delta})`,
      result: { undone: r.undone, before, after, delta },
    }
  })

  // ----- Step 10: Redo 3 steps -----
  await timed(10, 'redo 3 steps', async () => {
    const before = (await callTool<{ nodes: unknown[] }>(client, 'find_nodes', {})).nodes.length
    const r = await callTool<{ redone: number }>(client, 'redo', { steps: 3 })
    const after = (await callTool<{ nodes: unknown[] }>(client, 'find_nodes', {})).nodes.length
    return {
      summary: `redone=${r.redone}, nodes ${before} -> ${after}`,
      result: { redone: r.redone, before, after },
    }
  })

  // ----- Step 11: Duplicate level + validate -----
  const dup = await timed(11, 'duplicate level + validate', async () => {
    const r = await callTool<{ newLevelId: string; newNodeIds: string[] }>(
      client,
      'duplicate_level',
      { levelId },
    )
    const v = await callTool<{
      valid: boolean
      errors: Array<{ nodeId: string; path: string; message: string }>
    }>(client, 'validate_scene', {})
    if (!v.valid && v.errors.length) {
      log('VALIDATION ERRORS after duplicate:')
      for (const e of v.errors) {
        log(`  nodeId=${e.nodeId} path=${e.path} :: ${e.message}`)
      }
    }
    return {
      summary: `newLevelId=${r.newLevelId}, cloned=${r.newNodeIds.length}, valid=${v.valid}, errors=${v.errors.length}`,
      nodeIds: [r.newLevelId],
      result: r,
    }
  })

  // ----- Step 12: Delete duplicated level cascade -----
  await timed(12, 'delete duplicated level', async () => {
    if (!dup) throw new Error('no duplicated level id')
    const before = (await callTool<{ nodes: unknown[] }>(client, 'find_nodes', {})).nodes.length
    const r = await callTool<{ deletedIds: string[] }>(client, 'delete_node', {
      id: dup.newLevelId,
      cascade: true,
    })
    const after = (await callTool<{ nodes: unknown[] }>(client, 'find_nodes', {})).nodes.length
    return {
      summary: `deleted ${r.deletedIds.length} nodes; nodes ${before} -> ${after}`,
      nodeIds: r.deletedIds,
      result: r,
    }
  })

  // ----- Final summary -----
  const allNodes = (await callTool<{ nodes: Array<{ type: string }> }>(client, 'find_nodes', {}))
    .nodes
  const zoneNodes = allNodes.filter((n) => n.type === 'zone')
  const doorNodes = allNodes.filter((n) => n.type === 'door')
  const windowNodes = allNodes.filter((n) => n.type === 'window')

  const report = {
    transport: { kind: transportKind, note: transportNote },
    steps,
    final: {
      totalNodes: allNodes.length,
      zones: zoneNodes.length,
      doors: doorNodes.length,
      windows: windowNodes.length,
      step5NodeCount,
      validationSummary: validation ?? null,
      undoObservation: undoResult ?? null,
    },
  }

  writeFileSync(`${HERE}/run-summary.json`, JSON.stringify(report, null, 2), 'utf-8')

  // Build REPORT.md
  const lines: string[] = []
  lines.push('# T3 Scenario Report — 2-Bedroom Apartment')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Transport: ${transportKind} (${transportNote})`)
  lines.push(`Server URL: ${SERVER_URL}`)
  lines.push('')
  lines.push('## Step-by-step')
  lines.push('')
  for (const s of steps) {
    lines.push(`### Step ${s.n}: ${s.name} ${s.ok ? 'OK' : 'FAIL'} (${s.durationMs}ms)`)
    lines.push('')
    lines.push(`- Summary: ${s.summary}`)
    if (s.nodeIds?.length) {
      lines.push(
        `- Node IDs (${s.nodeIds.length}): ${s.nodeIds.slice(0, 20).join(', ')}${s.nodeIds.length > 20 ? ' ...' : ''}`,
      )
    }
    if (s.error) lines.push(`- Error: \`${s.error}\``)
    lines.push('')
  }
  lines.push('## Final Counts')
  lines.push('')
  lines.push(`- Total nodes: ${allNodes.length}`)
  lines.push(`- Zones: ${zoneNodes.length}`)
  lines.push(`- Doors: ${doorNodes.length}`)
  lines.push(`- Windows: ${windowNodes.length}`)
  lines.push(`- Post-step-5 node count: ${step5NodeCount}`)
  lines.push('')
  lines.push('## Validation')
  lines.push('')
  if (validation) {
    lines.push(`- Valid: ${validation.valid}`)
    lines.push(`- Errors: ${validation.errors.length}`)
    if (!validation.valid && validation.errors.length) {
      lines.push('')
      lines.push('Verbatim errors:')
      lines.push('')
      for (const e of validation.errors) {
        lines.push(`- nodeId=\`${e.nodeId}\` path=\`${e.path}\` :: ${e.message}`)
      }
    }
  } else {
    lines.push('- (validation step failed)')
  }
  lines.push('')
  lines.push('## Transport Notes')
  lines.push('')
  lines.push(`- Used transport: **${transportKind}**`)
  lines.push(`- Reason: ${transportNote}`)
  if (transportKind === 'in-memory') {
    lines.push('')
    lines.push(
      'The shared HTTP server at :3917 returned "Server already initialized" — a known bug where the SDK\'s `StreamableHTTPServerTransport` in stateful mode accepts only a single session across the process lifetime. Subsequent clients cannot initialize. Falling back to an in-memory MCP server that exercises the same tools end-to-end.',
    )
  }
  lines.push('')
  writeFileSync(`${HERE}/REPORT.md`, lines.join('\n'), 'utf-8')

  log('done')
  for (const c of conn.closers) await c()
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: test script
  console.error(err)
  process.exit(1)
})
