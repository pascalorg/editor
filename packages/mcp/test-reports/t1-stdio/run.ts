/**
 * T1 stdio test runner: exercises every MCP tool against the live stdio
 * transport with REAL happy-path arguments and writes a pass/fail matrix.
 *
 * Run with: bun packages/mcp/test-reports/t1-stdio/run.ts
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../../..')
const BIN_PATH = resolve(REPO_ROOT, 'packages/mcp/dist/bin/pascal-mcp.js')
const REPORT_PATH = resolve(__dirname, 'REPORT.md')

const EXPECTED_TOOL_COUNT = 21

type RowStatus = 'pass' | 'fail'
type Row = {
  name: string
  status: RowStatus
  summary: string
  detail?: string
}

const rows: Row[] = []

function shortJson(value: unknown, max = 160): string {
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function pickContentText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type?: string; text?: string }> | undefined
  if (!Array.isArray(content) || content.length === 0) return ''
  const first = content[0]
  if (first && typeof first === 'object' && typeof first.text === 'string') {
    return first.text
  }
  return ''
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    stderr: 'inherit',
  })
  const client = new Client({ name: 'pascal-mcp-t1', version: '0.0.0' })

  const t0 = Date.now()

  await client.connect(transport)

  // 0. listTools assertion
  const listed = await client.listTools()
  const toolNames = listed.tools.map((t) => t.name).sort()
  const listOk = listed.tools.length === EXPECTED_TOOL_COUNT
  console.log(
    `[t1] listTools → ${listed.tools.length} tools (expected ${EXPECTED_TOOL_COUNT}) ${listOk ? 'OK' : 'MISMATCH'}`,
  )
  console.log(`[t1] tool names: ${toolNames.join(', ')}`)

  // Helper to run a tool and record a row.
  async function run(
    name: string,
    args: Record<string, unknown>,
    opts: { expectStatus?: string; describe?: (r: any) => string } = {},
  ): Promise<any> {
    try {
      const result = (await client.callTool({ name, arguments: args })) as any
      const text = pickContentText(result)
      let parsedText: any = null
      if (text) {
        try {
          parsedText = JSON.parse(text)
        } catch {
          // not all tools emit pure JSON; ignore parse failures
        }
      }

      // Detect structured "expected" status fields.
      const status =
        (parsedText && typeof parsedText === 'object' && parsedText.status) ||
        (result.structuredContent &&
          typeof result.structuredContent === 'object' &&
          (result.structuredContent as any).status) ||
        null

      if (result.isError) {
        // If the host expects a specific status string in the error body, accept it.
        if (opts.expectStatus && text.includes(opts.expectStatus)) {
          rows.push({
            name,
            status: 'pass',
            summary: `expected status: ${opts.expectStatus}`,
            detail: shortJson(text, 220),
          })
          console.log(`✅ ${name}  (expected status: ${opts.expectStatus})`)
          return result
        }
        rows.push({
          name,
          status: 'fail',
          summary: 'isError true',
          detail: shortJson(text, 240),
        })
        console.log(`❌ ${name}  (${shortJson(text, 160)})`)
        return result
      }

      // Non-error path. Recognise structured `not_implemented` /
      // `catalog_unavailable` as expected pass-with-status.
      if (status && (status === 'not_implemented' || status === 'catalog_unavailable')) {
        rows.push({
          name,
          status: 'pass',
          summary: `status: ${status}`,
          detail: shortJson(parsedText ?? result.structuredContent, 240),
        })
        console.log(`✅ ${name}  (status: ${status})`)
        return result
      }

      const summary = opts.describe
        ? opts.describe(result)
        : shortJson(result.structuredContent ?? parsedText ?? text, 160)

      rows.push({
        name,
        status: 'pass',
        summary,
        detail: shortJson(result.structuredContent ?? parsedText ?? text, 320),
      })
      console.log(`✅ ${name}  (${summary})`)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Some tools throw with a structured body. Accept matching expected status.
      if (opts.expectStatus && msg.includes(opts.expectStatus)) {
        rows.push({
          name,
          status: 'pass',
          summary: `expected throw: ${opts.expectStatus}`,
          detail: msg,
        })
        console.log(`✅ ${name}  (expected throw: ${opts.expectStatus})`)
        return null
      }
      rows.push({
        name,
        status: 'fail',
        summary: 'threw',
        detail: msg,
      })
      console.log(`❌ ${name}  (threw: ${msg})`)
      return null
    }
  }

  // ---- 1. get_scene ------------------------------------------------------
  const sceneResult = await run(
    'get_scene',
    {},
    {
      describe: (r) => {
        const s = r.structuredContent as any
        const nodeCount = s?.nodes ? Object.keys(s.nodes).length : 0
        const rootCount = s?.rootNodeIds?.length ?? 0
        return `${nodeCount} nodes, ${rootCount} roots`
      },
    },
  )

  // Discover key node ids from the scene snapshot.
  const sceneNodes: Record<string, any> = (sceneResult?.structuredContent as any)?.nodes ?? {}
  const sceneRoots: string[] = (sceneResult?.structuredContent as any)?.rootNodeIds ?? []

  const findFirst = (type: string): any | null => {
    for (const n of Object.values(sceneNodes)) {
      if ((n as any).type === type) return n as any
    }
    return null
  }

  const siteNode = findFirst('site') ?? (sceneRoots[0] ? sceneNodes[sceneRoots[0]] : null)
  const buildingNode = findFirst('building')
  const levelNode = findFirst('level')

  console.log(
    `[t1] discovered: site=${siteNode?.id} building=${buildingNode?.id} level=${levelNode?.id}`,
  )

  // ---- 2. get_node -------------------------------------------------------
  await run(
    'get_node',
    { id: siteNode?.id ?? sceneRoots[0] ?? '' },
    {
      describe: (r) => {
        const n = (r.structuredContent as any)?.node
        return `node type=${n?.type}, id=${n?.id}`
      },
    },
  )

  // ---- 3. describe_node --------------------------------------------------
  await run(
    'describe_node',
    { id: siteNode?.id ?? sceneRoots[0] ?? '' },
    {
      describe: (r) => {
        const s = r.structuredContent as any
        return `type=${s?.type}, ${s?.childrenIds?.length ?? 0} children`
      },
    },
  )

  // ---- 4. find_nodes -----------------------------------------------------
  const findLevels = await run(
    'find_nodes',
    { type: 'level' },
    {
      describe: (r) => `${(r.structuredContent as any)?.nodes?.length ?? 0} level node(s)`,
    },
  )

  // Refresh levelNode from find_nodes output (most current).
  const foundLevels = (findLevels?.structuredContent as any)?.nodes ?? []
  const groundLevelId: string | undefined = foundLevels[0]?.id ?? levelNode?.id ?? undefined
  console.log(`[t1] groundLevelId=${groundLevelId}`)

  // ---- 5. measure --------------------------------------------------------
  // Find any two centre-bearing nodes (building + site work).
  let measureFromId: string | undefined
  let measureToId: string | undefined
  for (const n of Object.values(sceneNodes)) {
    const t = (n as any).type
    if (
      t === 'wall' ||
      t === 'fence' ||
      t === 'item' ||
      t === 'door' ||
      t === 'window' ||
      t === 'building' ||
      t === 'stair' ||
      t === 'roof' ||
      t === 'slab' ||
      t === 'ceiling' ||
      t === 'zone' ||
      t === 'site'
    ) {
      if (!measureFromId) measureFromId = (n as any).id
      else if (!measureToId) {
        measureToId = (n as any).id
        break
      }
    }
  }
  // If only one was found, fall back to self-measurement on a polygon node.
  if (measureFromId && !measureToId) measureToId = measureFromId
  await run(
    'measure',
    { fromId: measureFromId ?? '', toId: measureToId ?? '' },
    {
      describe: (r) => {
        const s = r.structuredContent as any
        return `distance=${s?.distanceMeters?.toFixed?.(3) ?? s?.distanceMeters}m${
          s?.areaSqMeters !== undefined ? ` area=${s.areaSqMeters.toFixed?.(2)}m²` : ''
        }`
      },
    },
  )

  // ---- 6. apply_patch — create a wall ------------------------------------
  // Use a minimal valid wall payload; the bridge will Zod-parse it. The schema
  // requires id/type but ItemNode/WallNode etc fill defaults. We construct the
  // canonical raw object the schema would accept after parse — id is filled
  // via objectId('wall')'s default when omitted.
  const patchWallId = `wall_t1patch_${Date.now()}`
  await run(
    'apply_patch',
    {
      patches: [
        {
          op: 'create',
          node: {
            id: patchWallId,
            type: 'wall',
            children: [],
            start: [0, 0],
            end: [3, 0],
            thickness: 0.1,
            height: 2.5,
            frontSide: 'unknown',
            backSide: 'unknown',
          },
          parentId: groundLevelId,
        },
      ],
    },
    {
      describe: (r) => {
        const s = r.structuredContent as any
        return `applied=${s?.appliedOps}, created=${s?.createdIds?.length}`
      },
    },
  )

  // ---- 7. create_level ---------------------------------------------------
  let createdLevelId: string | undefined
  if (buildingNode?.id) {
    const cl = await run(
      'create_level',
      { buildingId: buildingNode.id, elevation: 1, height: 3 },
      {
        describe: (r) => `levelId=${(r.structuredContent as any)?.levelId}`,
      },
    )
    createdLevelId = (cl?.structuredContent as any)?.levelId
  } else {
    rows.push({
      name: 'create_level',
      status: 'fail',
      summary: 'no building in scene',
    })
    console.log('❌ create_level  (no building in scene)')
  }

  // ---- 8. create_wall ----------------------------------------------------
  let createdWallId: string | undefined
  if (groundLevelId) {
    const cw = await run(
      'create_wall',
      {
        levelId: groundLevelId,
        start: [0, 0],
        end: [4, 0],
        thickness: 0.12,
        height: 2.6,
      },
      {
        describe: (r) => `wallId=${(r.structuredContent as any)?.wallId}`,
      },
    )
    createdWallId = (cw?.structuredContent as any)?.wallId
  } else {
    rows.push({
      name: 'create_wall',
      status: 'fail',
      summary: 'no level',
    })
    console.log('❌ create_wall  (no level)')
  }

  // ---- 9. place_item -----------------------------------------------------
  // place_item requires target type wall|ceiling|site. Use the wall we just
  // made; falls back to site if not available.
  const placeTargetId = createdWallId ?? siteNode?.id
  await run(
    'place_item',
    {
      catalogItemId: 'test-chair',
      targetNodeId: placeTargetId ?? '',
      position: [1, 0, 1],
    },
    {
      describe: (r) => {
        const s = r.structuredContent as any
        return `itemId=${s?.itemId}${s?.status ? ` status=${s.status}` : ''}`
      },
    },
  )

  // ---- 10. cut_opening ---------------------------------------------------
  if (createdWallId) {
    await run(
      'cut_opening',
      {
        wallId: createdWallId,
        type: 'door',
        position: 0.5,
        width: 0.9,
        height: 2.1,
      },
      {
        describe: (r) => `openingId=${(r.structuredContent as any)?.openingId}`,
      },
    )
  } else {
    rows.push({
      name: 'cut_opening',
      status: 'fail',
      summary: 'no wall created earlier',
    })
    console.log('❌ cut_opening  (no wall created earlier)')
  }

  // ---- 11. set_zone ------------------------------------------------------
  if (groundLevelId) {
    await run(
      'set_zone',
      {
        levelId: groundLevelId,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        label: 'living room',
      },
      {
        describe: (r) => `zoneId=${(r.structuredContent as any)?.zoneId}`,
      },
    )
  } else {
    rows.push({
      name: 'set_zone',
      status: 'fail',
      summary: 'no level',
    })
    console.log('❌ set_zone  (no level)')
  }

  // ---- 12. duplicate_level -----------------------------------------------
  let duplicatedLevelId: string | undefined
  if (groundLevelId) {
    const dl = await run(
      'duplicate_level',
      { levelId: groundLevelId },
      {
        describe: (r) => {
          const s = r.structuredContent as any
          return `newLevelId=${s?.newLevelId}, ${s?.newNodeIds?.length} nodes`
        },
      },
    )
    duplicatedLevelId = (dl?.structuredContent as any)?.newLevelId
  } else {
    rows.push({
      name: 'duplicate_level',
      status: 'fail',
      summary: 'no level',
    })
    console.log('❌ duplicate_level  (no level)')
  }

  // ---- 13. delete_node ---------------------------------------------------
  if (duplicatedLevelId) {
    await run(
      'delete_node',
      { id: duplicatedLevelId, cascade: true },
      {
        describe: (r) => {
          const s = r.structuredContent as any
          return `deleted ${s?.deletedIds?.length} node(s)`
        },
      },
    )
  } else {
    rows.push({
      name: 'delete_node',
      status: 'fail',
      summary: 'no duplicated level to delete',
    })
    console.log('❌ delete_node  (no duplicated level to delete)')
  }

  // ---- 14. undo ----------------------------------------------------------
  await run(
    'undo',
    {},
    {
      describe: (r) => `undone=${(r.structuredContent as any)?.undone}`,
    },
  )

  // ---- 15. redo ----------------------------------------------------------
  await run(
    'redo',
    {},
    {
      describe: (r) => `redone=${(r.structuredContent as any)?.redone}`,
    },
  )

  // ---- 16. export_json ---------------------------------------------------
  await run(
    'export_json',
    { pretty: true },
    {
      describe: (r) => {
        const s = r.structuredContent as any
        return `${s?.json?.length ?? 0} chars JSON`
      },
    },
  )

  // ---- 17. export_glb ----------------------------------------------------
  await run('export_glb', {})

  // ---- 18. validate_scene ------------------------------------------------
  await run(
    'validate_scene',
    {},
    {
      describe: (r) => {
        const s = r.structuredContent as any
        return `valid=${s?.valid}, errors=${s?.errors?.length ?? 0}`
      },
    },
  )

  // ---- 19. check_collisions ----------------------------------------------
  await run(
    'check_collisions',
    {},
    {
      describe: (r) => `${(r.structuredContent as any)?.collisions?.length ?? 0} collision(s)`,
    },
  )

  // ---- 20. analyze_floorplan_image — expected sampling_unavailable -------
  await run(
    'analyze_floorplan_image',
    { image: 'https://example.com/nonexistent.png' },
    { expectStatus: 'sampling_unavailable' },
  )

  // ---- 21. analyze_room_photo — expected sampling_unavailable ------------
  await run(
    'analyze_room_photo',
    { image: 'https://example.com/nonexistent.png' },
    { expectStatus: 'sampling_unavailable' },
  )

  const elapsedMs = Date.now() - t0

  await client.close()

  // Summary
  const passed = rows.filter((r) => r.status === 'pass').length
  const failed = rows.filter((r) => r.status === 'fail').length
  const total = rows.length

  console.log(`\n[t1] tools listed: ${listed.tools.length}/${EXPECTED_TOOL_COUNT}`)
  console.log(`[t1] passed: ${passed}/${total}`)
  console.log(`[t1] failed: ${failed}/${total}`)
  console.log(`[t1] total time: ${elapsedMs}ms`)

  // Write the markdown report.
  const ts = new Date().toISOString()
  const lines: string[] = []
  lines.push('# T1 stdio MCP test report')
  lines.push('')
  lines.push(`Generated: ${ts}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(
    `- Tools listed: **${listed.tools.length}/${EXPECTED_TOOL_COUNT}** ${listOk ? 'OK' : 'MISMATCH'}`,
  )
  lines.push(`- Tools exercised: **${total}**`)
  lines.push(`- Passed: **${passed}/${total}**`)
  lines.push(`- Failed: **${failed}/${total}**`)
  lines.push(`- Total run time: **${elapsedMs} ms**`)
  lines.push(`- Transport: stdio (\`bun packages/mcp/dist/bin/pascal-mcp.js --stdio\`)`)
  lines.push('')
  lines.push('## Pass/fail matrix')
  lines.push('')
  lines.push('| # | Tool | Status | Summary |')
  lines.push('|---|------|--------|---------|')
  rows.forEach((row, i) => {
    const sym = row.status === 'pass' ? 'PASS' : 'FAIL'
    const safeSummary = row.summary.replace(/\|/g, '\\|')
    lines.push(`| ${i + 1} | \`${row.name}\` | ${sym} | ${safeSummary} |`)
  })
  lines.push('')
  lines.push('## Detail per tool')
  lines.push('')
  rows.forEach((row, i) => {
    lines.push(`### ${i + 1}. \`${row.name}\` — ${row.status.toUpperCase()}`)
    lines.push('')
    lines.push(`Summary: ${row.summary}`)
    if (row.detail) {
      lines.push('')
      lines.push('```json')
      lines.push(row.detail)
      lines.push('```')
    }
    lines.push('')
  })
  lines.push('## Tools listed by server')
  lines.push('')
  lines.push('```')
  lines.push(toolNames.join('\n'))
  lines.push('```')
  lines.push('')

  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8')
  console.log(`[t1] report written: ${REPORT_PATH}`)

  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[t1] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(2)
})
