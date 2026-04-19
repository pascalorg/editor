/**
 * Phase 9 Verifier V8 — Load-Save Round-Trip for Villa Azul.
 *
 * Copies Villa Azul from the shared store into an ISOLATED store via MCP stdio,
 * then verifies byte-level fidelity across save → load → get_scene → duplicate.
 *
 * Run with:
 *   bun packages/mcp/test-reports/villa-azul/v8-roundtrip.ts
 *
 * Notes:
 *   - Spawns a dedicated stdio MCP server with `PASCAL_DATA_DIR=/tmp/pascal-villa-v8`
 *     (ISOLATED — avoids the shared /tmp/pascal-villa directory used by HTTP :3917).
 *   - Reads the Villa Azul scene from `/tmp/pascal-villa/scenes/a6e7919eacbe.json`.
 */

import * as fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../../..')
const BIN_PATH = resolve(REPO_ROOT, 'packages/mcp/dist/bin/pascal-mcp.js')
const REPORT_PATH = resolve(__dirname, 'v8-roundtrip.md')
const SHARED_SCENE_PATH = '/tmp/pascal-villa/scenes/a6e7919eacbe.json'
const PASCAL_DATA_DIR = '/tmp/pascal-villa-v8'

type Node = Record<string, unknown> & { id: string; type: string; parentId?: string | null }
type SceneGraph = {
  nodes: Record<string, Node>
  rootNodeIds: string[]
  collections?: Record<string, unknown>
}

type StepOutcome = { name: string; pass: boolean; detail: string }
const outcomes: StepOutcome[] = []

function record(name: string, pass: boolean, detail: string): void {
  outcomes.push({ name, pass, detail })
  // eslint-disable-next-line no-console
  console.log(`[v8] ${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}

function structured<T>(result: { content?: unknown; structuredContent?: unknown }): T {
  if (result.structuredContent !== undefined) {
    return result.structuredContent as T
  }
  const content = result.content as Array<{ text?: string }> | undefined
  const text = content?.[0]?.text ?? ''
  return JSON.parse(text) as T
}

async function call<T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const r = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content?: Array<{ text?: string }>
    structuredContent?: unknown
  }
  if (r.isError) {
    const text = r.content?.[0]?.text ?? ''
    throw new Error(`${name} failed: ${text.slice(0, 400)}`)
  }
  return structured<T>(r)
}

// Deterministic deep stringify: sort keys so two equivalent objects hash to
// the same string regardless of insertion order.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function typeCounts(nodes: Record<string, Node>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const n of Object.values(nodes)) {
    counts[n.type] = (counts[n.type] ?? 0) + 1
  }
  return counts
}

function shallowCountsEqual(
  a: Record<string, number>,
  b: Record<string, number>,
): { equal: boolean; diff: string[] } {
  const diff: string[] = []
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) {
      diff.push(`${k}: ${a[k] ?? 0} vs ${b[k] ?? 0}`)
    }
  }
  return { equal: diff.length === 0, diff }
}

async function main(): Promise<void> {
  // ---- Step 1: read original scene graph from disk ----
  const rawShared = fs.readFileSync(SHARED_SCENE_PATH, 'utf8')
  const sharedFile = JSON.parse(rawShared) as { graph: SceneGraph; meta: Record<string, unknown> }
  const origGraph: SceneGraph = sharedFile.graph
  const origNodeIds = Object.keys(origGraph.nodes).sort()
  const origCounts = typeCounts(origGraph.nodes)
  record(
    '1.read-original',
    origNodeIds.length > 0 && origGraph.rootNodeIds.length > 0,
    `nodes=${origNodeIds.length}, roots=${origGraph.rootNodeIds.length}, types=${JSON.stringify(origCounts)}`,
  )

  // ---- Step 2: spawn isolated stdio MCP with PASCAL_DATA_DIR=/tmp/pascal-villa-v8 ----
  // eslint-disable-next-line no-console
  console.log(
    `[v8] spawning stdio MCP: bun ${BIN_PATH} --stdio (PASCAL_DATA_DIR=${PASCAL_DATA_DIR})`,
  )
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    stderr: 'inherit',
    env: { ...(process.env as Record<string, string>), PASCAL_DATA_DIR },
  })
  const client = new Client({ name: 'v8-roundtrip', version: '0.0.0' })
  await client.connect(transport)
  record('2.spawn-isolated-stdio', true, `PASCAL_DATA_DIR=${PASCAL_DATA_DIR}`)

  let newSceneId = ''
  let loadedGraph: SceneGraph | null = null
  let rebuiltSceneId = ''
  let duplicateSceneId = ''

  try {
    // ---- Step 3: save_scene with provided graph ----
    const savePayload = {
      name: 'Villa Azul (copied)',
      includeCurrentScene: false,
      graph: { nodes: origGraph.nodes, rootNodeIds: origGraph.rootNodeIds },
    }
    const saveMeta = await call<{
      id: string
      version: number
      nodeCount: number
      sizeBytes: number
    }>(client, 'save_scene', savePayload)
    newSceneId = saveMeta.id
    const savedOk =
      !!saveMeta.id &&
      saveMeta.version === 1 &&
      saveMeta.nodeCount === origNodeIds.length &&
      saveMeta.sizeBytes > 0
    record(
      '3.save_scene(copy)',
      savedOk,
      `id=${saveMeta.id} version=${saveMeta.version} nodes=${saveMeta.nodeCount} bytes=${saveMeta.sizeBytes}`,
    )

    // ---- Step 4: load_scene → get_scene → deep-equal with original ----
    await call(client, 'load_scene', { id: newSceneId })
    const loaded = await call<SceneGraph>(client, 'get_scene', {})
    loadedGraph = loaded

    const loadedIds = Object.keys(loaded.nodes).sort()
    const idsMatch =
      loadedIds.length === origNodeIds.length && loadedIds.every((v, i) => v === origNodeIds[i])
    record(
      '4a.load→get_scene ids preserved',
      idsMatch,
      `${loadedIds.length} ids, match=${idsMatch}`,
    )

    const rootsMatchAsSet =
      loaded.rootNodeIds.length === origGraph.rootNodeIds.length &&
      [...loaded.rootNodeIds].sort().join(',') === [...origGraph.rootNodeIds].sort().join(',')
    record(
      '4b.load→get_scene rootNodeIds',
      rootsMatchAsSet,
      `orig=[${origGraph.rootNodeIds.join(',')}] loaded=[${loaded.rootNodeIds.join(',')}]`,
    )

    // Deep equal per-node using stable stringify (keys sorted).
    const origPerNode = new Map<string, string>()
    for (const [k, v] of Object.entries(origGraph.nodes)) origPerNode.set(k, stableStringify(v))
    const loadedPerNode = new Map<string, string>()
    for (const [k, v] of Object.entries(loaded.nodes)) loadedPerNode.set(k, stableStringify(v))
    const diffNodes: string[] = []
    for (const [id, sig] of origPerNode) {
      if (loadedPerNode.get(id) !== sig) diffNodes.push(id)
    }
    for (const id of loadedPerNode.keys()) {
      if (!origPerNode.has(id)) diffNodes.push(`+${id}`)
    }
    record(
      '4c.load→get_scene deep-equal per-node',
      diffNodes.length === 0,
      `diffs=${diffNodes.length}${diffNodes.length ? ': ' + diffNodes.slice(0, 3).join(', ') : ''}`,
    )

    // ---- Step 5: apply_patch — rebuild the graph from scratch into a NEW scene ----
    // Load into bridge first then delete its root to start fresh? Instead, we
    // load a minimal template and patch nodes into it. The simplest path here:
    // just re-use the loaded graph and save with a NEW id (no graph rebuild
    // needed for counts). But the spec asks for "rebuild nodes from scratch
    // using the same schemas" — so we issue apply_patch creates for every
    // original node against a freshly-loaded scene after clearing its content.
    //
    // Strategy: load a bare scene by saving+loading a graph containing only
    // the site/building/level roots, then apply_patch the rest.
    //
    // First, extract site/building/level from original as the "shell".
    const shellNodes: Record<string, Node> = {}
    for (const n of Object.values(origGraph.nodes)) {
      if (n.type === 'site' || n.type === 'building' || n.type === 'level') {
        shellNodes[n.id] = n
      }
    }
    // Save the shell as a temp scene, load it.
    const shellMeta = await call<{ id: string }>(client, 'save_scene', {
      name: 'Villa Azul (shell for rebuild)',
      includeCurrentScene: false,
      graph: { nodes: shellNodes, rootNodeIds: origGraph.rootNodeIds },
    })
    await call(client, 'load_scene', { id: shellMeta.id })
    // Now patch-create the rest.
    const shellIds = new Set(Object.keys(shellNodes))
    const toCreate = Object.values(origGraph.nodes).filter((n) => !shellIds.has(n.id))
    // Sort by type so walls precede openings; slabs/zones/fences don't depend on each other.
    const typeOrder = [
      'wall',
      'slab',
      'ceiling',
      'roof',
      'stair',
      'zone',
      'door',
      'window',
      'fence',
      'item',
    ]
    const orderOf = (t: string): number => {
      const i = typeOrder.indexOf(t)
      return i < 0 ? typeOrder.length : i
    }
    toCreate.sort((a, b) => orderOf(a.type) - orderOf(b.type))
    const patches = toCreate.map((n) => ({
      op: 'create' as const,
      node: n,
      ...(n.parentId ? { parentId: n.parentId as string } : {}),
    }))
    const patchResult = await call<{ appliedOps: number; createdIds: string[] }>(
      client,
      'apply_patch',
      { patches },
    )
    const rebuiltMeta = await call<{ id: string; nodeCount: number }>(client, 'save_scene', {
      name: 'Villa Azul (rebuilt via apply_patch)',
    })
    rebuiltSceneId = rebuiltMeta.id

    // Compare counts against original.
    await call(client, 'load_scene', { id: rebuiltMeta.id })
    const rebuilt = await call<SceneGraph>(client, 'get_scene', {})
    const rebuiltCounts = typeCounts(rebuilt.nodes)
    const ok5 = shallowCountsEqual(origCounts, rebuiltCounts)
    record(
      '5.apply_patch rebuild counts',
      ok5.equal,
      `ops=${patchResult.appliedOps} created=${patchResult.createdIds.length} total=${Object.keys(rebuilt.nodes).length} diffs=${ok5.diff.join(' | ') || 'none'}`,
    )

    // ---- Step 6: duplicate_level on the original (copied) scene ----
    // Load the first copy, duplicate, save.
    await call(client, 'load_scene', { id: newSceneId })
    const levelNode = Object.values(origGraph.nodes).find((n) => n.type === 'level')!
    const dup = await call<{ newLevelId: string; newNodeIds: string[] }>(
      client,
      'duplicate_level',
      {
        levelId: levelNode.id,
      },
    )
    const validation = await call<{ valid: boolean; errors: unknown[] }>(client, 'validate_scene')
    const dupMeta = await call<{ id: string; nodeCount: number }>(client, 'save_scene', {
      name: 'Villa Azul (copied + duplicated)',
    })
    duplicateSceneId = dupMeta.id

    // Re-load and count nodes.
    await call(client, 'load_scene', { id: dupMeta.id })
    const dupLoaded = await call<SceneGraph>(client, 'get_scene', {})
    const dupCounts = typeCounts(dupLoaded.nodes)

    // Expectation: each per-level node type doubled; site/building remain at 1.
    const expectedDupCounts: Record<string, number> = {}
    for (const [t, n] of Object.entries(origCounts)) {
      if (t === 'site' || t === 'building') expectedDupCounts[t] = n
      else expectedDupCounts[t] = n * 2
    }
    const ok6 = shallowCountsEqual(expectedDupCounts, dupCounts)
    record(
      '6.duplicate_level + save + reload counts',
      ok6.equal && validation.valid,
      `valid=${validation.valid} new=${dup.newNodeIds.length} total=${Object.keys(dupLoaded.nodes).length} diffs=${ok6.diff.join(' | ') || 'none'}`,
    )

    // ---- Step 7: round-trip integrity check — stableStringify equality ----
    await call(client, 'load_scene', { id: newSceneId })
    const reloaded = await call<SceneGraph>(client, 'get_scene', {})
    const origSerialized = stableStringify(origGraph.nodes)
    const reloadedSerialized = stableStringify(reloaded.nodes)
    const byteEqual = origSerialized === reloadedSerialized
    record(
      '7.stableStringify(orig.nodes) === stableStringify(reloaded.nodes)',
      byteEqual,
      `orig=${origSerialized.length}ch reloaded=${reloadedSerialized.length}ch equal=${byteEqual}`,
    )

    // Extra: file-level byte comparison (graph portion only) — read the
    // isolated-dir file and compare its graph to the shared-dir file.
    const isolatedPath = `${PASCAL_DATA_DIR}/scenes/${newSceneId}.json`
    if (fs.existsSync(isolatedPath)) {
      const isolatedFile = JSON.parse(fs.readFileSync(isolatedPath, 'utf8')) as {
        graph: SceneGraph
      }
      const fileGraphEqual =
        stableStringify(isolatedFile.graph.nodes) === stableStringify(origGraph.nodes) &&
        stableStringify([...isolatedFile.graph.rootNodeIds].sort()) ===
          stableStringify([...origGraph.rootNodeIds].sort())
      record(
        '7b.on-disk isolated file graph === shared file graph',
        fileGraphEqual,
        `path=${isolatedPath} equal=${fileGraphEqual}`,
      )
    } else {
      record('7b.on-disk isolated file graph', false, `missing file ${isolatedPath}`)
    }
  } finally {
    await client.close()
  }

  // ---- Write report ----
  const now = new Date().toISOString()
  const lines: string[] = []
  lines.push('# Villa Azul — V8 Load-Save Round-Trip Report')
  lines.push('')
  lines.push(`- Generated: ${now}`)
  lines.push(`- Shared source: \`${SHARED_SCENE_PATH}\``)
  lines.push(`- Isolated data dir: \`${PASCAL_DATA_DIR}\``)
  lines.push(`- Transport: stdio (\`bun ${BIN_PATH} --stdio\`)`)
  lines.push(`- New sceneId (copy): \`${newSceneId}\``)
  lines.push(`- Rebuilt sceneId (apply_patch): \`${rebuiltSceneId}\``)
  lines.push(`- Duplicated sceneId: \`${duplicateSceneId}\``)
  lines.push('')

  lines.push('## Original node-type counts')
  lines.push('')
  lines.push('| Type | Count |')
  lines.push('|---|---:|')
  for (const [t, n] of Object.entries(origCounts).sort()) lines.push(`| ${t} | ${n} |`)
  lines.push(`| **total** | **${Object.keys(origGraph.nodes).length}** |`)
  lines.push('')

  lines.push('## Results')
  lines.push('')
  lines.push('| # | Check | Status | Detail |')
  lines.push('|---|---|:---:|---|')
  outcomes.forEach((o, i) => {
    lines.push(
      `| ${i + 1} | ${o.name} | ${o.pass ? 'PASS' : 'FAIL'} | ${o.detail.replace(/\|/g, '\\|')} |`,
    )
  })
  lines.push('')

  const passed = outcomes.filter((o) => o.pass).length
  const failed = outcomes.length - passed
  const overall = failed === 0 ? 'PASS' : 'FAIL'
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Passed: **${passed}/${outcomes.length}**`)
  lines.push(`- Failed: **${failed}/${outcomes.length}**`)
  lines.push(`- Overall: **${overall}**`)
  lines.push('')

  if (loadedGraph) {
    const loadedCounts = typeCounts(loadedGraph.nodes)
    const bothKeys = Array.from(
      new Set([...Object.keys(origCounts), ...Object.keys(loadedCounts)]),
    ).sort()
    lines.push('## Original vs loaded-after-save — per-type count diff')
    lines.push('')
    lines.push('| Type | Original | Loaded | Match |')
    lines.push('|---|---:|---:|:---:|')
    for (const k of bothKeys) {
      const a = origCounts[k] ?? 0
      const b = loadedCounts[k] ?? 0
      lines.push(`| ${k} | ${a} | ${b} | ${a === b ? 'YES' : 'NO'} |`)
    }
    lines.push('')
  }

  lines.push('## Notes')
  lines.push('')
  lines.push(
    '- `save_scene({ includeCurrentScene: false, graph })` should persist the graph verbatim, preserving all node ids.',
  )
  lines.push(
    '- `stableStringify` normalises key order so byte equality is order-independent; this is the canonical "deep-equal" check here.',
  )
  lines.push(
    '- Step 5 rebuilds the scene by save/load-ing a shell (site+building+level) then replaying every remaining node as an `apply_patch` `create` op. Only counts-per-type are compared (node ids on the rebuild will equal the originals because we reuse the same ids in the patches).',
  )
  lines.push(
    '- Step 6 exercises `duplicate_level` against the copied scene; the site/building remain shared (count=1), while per-level types should double.',
  )
  lines.push('')

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8')
  // eslint-disable-next-line no-console
  console.log(`[v8] report written: ${REPORT_PATH}`)
  // eslint-disable-next-line no-console
  console.log(`[v8] overall: ${overall} (${passed}/${outcomes.length})`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[v8] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(2)
})
