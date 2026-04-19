/**
 * T4 — Error contract verification for the MCP HTTP server.
 *
 * Sends intentionally invalid calls to the live server at :3917 and captures
 * the structured response (code + message, or tool payload isError). Each case
 * is logged with a verdict: PASS (expectation matched), WARN (acceptable but
 * different shape), or FAIL (wrong behaviour / bug).
 *
 * Run:
 *   bun packages/mcp/test-reports/t4-errors/run.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'

const SERVER_URL = new URL('http://localhost:3917/')

type Verdict = 'PASS' | 'WARN' | 'FAIL'

type CaseResult = {
  id: string
  tool: string
  description: string
  input: unknown
  expected: string
  actual: {
    kind: 'mcp_error' | 'tool_error' | 'unexpected_success' | 'client_error'
    code?: number
    message?: string
    data?: unknown
    structuredContent?: unknown
    rawContent?: unknown
  }
  verdict: Verdict
  note?: string
}

const results: CaseResult[] = []
let client: Client | null = null

/**
 * Call a tool and normalise the outcome into one of three shapes:
 *   - mcp_error: server threw McpError (protocol-level JSON-RPC error).
 *   - tool_error: tool returned `{ isError: true, content: [...] }`.
 *   - unexpected_success: tool returned a normal payload.
 * Anything else (timeout, transport crash) becomes `client_error`.
 */
async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CaseResult['actual']> {
  try {
    const result = await client!.callTool({ name, arguments: args })
    if (result.isError) {
      const rawContent = (result.content ?? []) as Array<{ type: string; text?: string }>
      const textBlock = rawContent.find((b) => b.type === 'text')
      return {
        kind: 'tool_error',
        message: textBlock?.text ?? JSON.stringify(rawContent),
        rawContent: result.content,
        structuredContent: result.structuredContent,
      }
    }
    return {
      kind: 'unexpected_success',
      message: 'tool returned successfully with no isError flag',
      structuredContent: result.structuredContent,
      rawContent: result.content,
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

function record(
  id: string,
  tool: string,
  description: string,
  input: unknown,
  expected: string,
  actual: CaseResult['actual'],
  verdict: Verdict,
  note?: string,
): void {
  results.push({ id, tool, description, input, expected, actual, verdict, note })
  const icon = verdict === 'PASS' ? '[PASS]' : verdict === 'WARN' ? '[WARN]' : '[FAIL]'
  const line = `${icon} ${id} (${tool}): ${description}`
  console.log(line)
  if (actual.kind === 'mcp_error') {
    console.log(`        -> McpError code=${actual.code} msg="${actual.message}"`)
  } else if (actual.kind === 'tool_error') {
    console.log(`        -> tool_error msg="${actual.message}"`)
  } else if (actual.kind === 'unexpected_success') {
    console.log(`        -> SUCCESS payload=${JSON.stringify(actual.structuredContent)}`)
  } else {
    console.log(`        -> client_error msg="${actual.message}"`)
  }
  if (note) console.log(`        note: ${note}`)
}

/** Verify actual matches expectation of "any structured error surface". */
function classifyRejection(
  actual: CaseResult['actual'],
  allowMcp = true,
  allowTool = true,
): Verdict {
  if (actual.kind === 'mcp_error' && allowMcp) return 'PASS'
  if (actual.kind === 'tool_error' && allowTool) return 'PASS'
  if (actual.kind === 'unexpected_success') return 'FAIL'
  if (actual.kind === 'client_error') return 'FAIL'
  return 'WARN'
}

async function main(): Promise<void> {
  // --- Connect ---
  const transport = new StreamableHTTPClientTransport(SERVER_URL)
  client = new Client({ name: 't4-error-tester', version: '0.0.0' })
  await client.connect(transport)
  console.log(`connected to ${SERVER_URL.href}`)

  // --- Baseline: scene snapshot ---
  const scene0 = await client.callTool({ name: 'get_scene', arguments: {} })
  const nodes0 = (scene0.structuredContent as { nodes?: Record<string, unknown> })?.nodes ?? {}
  const nodeCount0 = Object.keys(nodes0).length
  console.log(`baseline node count = ${nodeCount0}`)

  // Discover real IDs for positive-side assertions (e.g. real wall, real level).
  const scenePayload = scene0.structuredContent as {
    nodes: Record<string, { id: string; type: string; children?: string[] }>
  }
  const allNodes = Object.values(scenePayload.nodes ?? {}) as Array<{
    id: string
    type: string
    children?: string[]
  }>
  const findFirst = (t: string) => allNodes.find((n) => n.type === t)
  const realSite = findFirst('site')
  const realBuilding = findFirst('building')
  const realLevel = findFirst('level')
  const realWall = findFirst('wall')

  // Try to locate a node with children (for delete_node cascade=false case).
  let nodeWithChildren = allNodes.find((n) => (n.children?.length ?? 0) > 0)
  // Fallback to site/building/level if they have children.
  if (!nodeWithChildren) nodeWithChildren = realSite ?? realBuilding ?? realLevel
  console.log(
    `discovered: site=${realSite?.id} building=${realBuilding?.id} level=${realLevel?.id} wall=${realWall?.id}`,
  )
  console.log(
    `node-with-children=${nodeWithChildren?.id} type=${nodeWithChildren?.type} children=${nodeWithChildren?.children?.length ?? 0}`,
  )

  // ==========================================================================
  // TESTS
  // ==========================================================================

  // 1. get_node — nonexistent id
  {
    const input = { id: 'node_doesnotexist_xyz' }
    const actual = await callTool('get_node', input)
    record(
      'T4-01',
      'get_node',
      'nonexistent id',
      input,
      'McpError InvalidParams (-32602) "Node not found" OR structured tool error',
      actual,
      classifyRejection(actual),
    )
  }

  // 2. describe_node — nonexistent id
  {
    const input = { id: 'node_missing_123' }
    const actual = await callTool('describe_node', input)
    record(
      'T4-02',
      'describe_node',
      'nonexistent id',
      input,
      'McpError InvalidParams (-32602) "Node not found"',
      actual,
      classifyRejection(actual),
    )
  }

  // 3. find_nodes — invalid type enum
  {
    const input = { type: 'hamster' }
    const actual = await callTool('find_nodes', input)
    // Zod validation should fail before handler runs → MCP error.
    const isZod =
      actual.kind === 'mcp_error' &&
      (actual.message?.toLowerCase().includes('invalid') ||
        actual.message?.toLowerCase().includes('enum') ||
        actual.message?.toLowerCase().includes('hamster'))
    record(
      'T4-03',
      'find_nodes',
      'invalid type enum "hamster"',
      input,
      'Zod validation error (MCP InvalidParams -32602)',
      actual,
      isZod ? 'PASS' : classifyRejection(actual),
    )
  }

  // 4. measure — nonexistent fromId
  {
    const input = { fromId: 'node_nosuch_f', toId: realSite?.id ?? 'x' }
    const actual = await callTool('measure', input)
    record(
      'T4-04',
      'measure',
      'nonexistent fromId',
      input,
      'McpError InvalidParams "Node not found"',
      actual,
      classifyRejection(actual),
    )
  }

  // 5. apply_patch — patch with invalid node (missing type field)
  //    The schema accepts `node: z.record(z.string(), z.unknown())` so missing
  //    `type` slips past Zod; the bridge's core validator catches it and
  //    apply-patch converts that into an McpError via its try/catch.
  {
    const input = {
      patches: [
        {
          op: 'create',
          node: { foo: 'bar' /* no type */ },
          parentId: realLevel?.id ?? 'missing',
        },
      ],
    }
    const actual = await callTool('apply_patch', input)
    record(
      'T4-05',
      'apply_patch',
      'patches with one invalid node (missing type)',
      input,
      'McpError InvalidParams, all-or-nothing rollback (no partial state change)',
      actual,
      classifyRejection(actual),
    )
  }

  // 6. apply_patch — delete nonexistent id
  {
    const input = {
      patches: [{ op: 'delete', id: 'node_nonexistent_delete_xyz' }],
    }
    const actual = await callTool('apply_patch', input)
    record(
      'T4-06',
      'apply_patch',
      'delete nonexistent id',
      input,
      'McpError InvalidParams, no state change',
      actual,
      classifyRejection(actual),
    )
  }

  // 7. create_level — buildingId that isn't a building (feed it a site/wall/level)
  {
    const notBuildingId = realWall?.id ?? realLevel?.id ?? realSite?.id ?? 'missing'
    const input = { buildingId: notBuildingId, elevation: 0 }
    const actual = await callTool('create_level', input)
    record(
      'T4-07',
      'create_level',
      'buildingId is not a building (passed a wall/level/site id)',
      input,
      'McpError InvalidParams "expected building"',
      actual,
      classifyRejection(actual),
    )
  }

  // 8. create_wall — levelId that doesn't exist
  {
    const input = {
      levelId: 'level_nosuch_999',
      start: [0, 0],
      end: [5, 0],
    }
    const actual = await callTool('create_wall', input)
    record(
      'T4-08',
      'create_wall',
      "levelId doesn't exist",
      input,
      'McpError InvalidParams "Level not found"',
      actual,
      classifyRejection(actual),
    )
  }

  // 9. create_wall — start/end not tuples
  {
    const input = {
      levelId: realLevel?.id ?? 'x',
      start: 'not-a-tuple',
      end: [5, 0],
    }
    const actual = await callTool('create_wall', input)
    record(
      'T4-09',
      'create_wall',
      'start not a tuple',
      input,
      'Zod validation error (MCP InvalidParams -32602)',
      actual,
      classifyRejection(actual),
    )
  }

  // 10. place_item — targetNodeId doesn't exist
  {
    const input = {
      catalogItemId: 'chair-1',
      targetNodeId: 'node_nosuch_target',
      position: [0, 0, 0],
    }
    const actual = await callTool('place_item', input)
    record(
      'T4-10',
      'place_item',
      "targetNodeId doesn't exist",
      input,
      'McpError InvalidParams "Target node not found"',
      actual,
      classifyRejection(actual),
    )
  }

  // 11. cut_opening — wallId isn't a wall (pass a site/building/level)
  {
    const notWallId = realSite?.id ?? realBuilding?.id ?? realLevel?.id ?? 'missing'
    const input = {
      wallId: notWallId,
      type: 'door',
      position: 0.5,
      width: 0.8,
      height: 2.0,
    }
    const actual = await callTool('cut_opening', input)
    record(
      'T4-11',
      'cut_opening',
      'wallId is not a wall',
      input,
      'McpError InvalidParams "expected wall"',
      actual,
      classifyRejection(actual),
    )
  }

  // 12. cut_opening — position out of [0,1]
  {
    const input = {
      wallId: realWall?.id ?? 'missing_wall',
      type: 'door',
      position: 2.5,
      width: 0.8,
      height: 2.0,
    }
    const actual = await callTool('cut_opening', input)
    record(
      'T4-12',
      'cut_opening',
      'position out of [0,1]',
      input,
      'Zod validation error (MCP InvalidParams) — position must be <= 1',
      actual,
      classifyRejection(actual),
    )
  }

  // 13. set_zone — polygon with < 3 points
  {
    const input = {
      levelId: realLevel?.id ?? 'missing',
      polygon: [
        [0, 0],
        [5, 0],
      ],
      label: 'Tiny',
    }
    const actual = await callTool('set_zone', input)
    record(
      'T4-13',
      'set_zone',
      'polygon with < 3 points',
      input,
      'Zod validation error (MCP InvalidParams) — polygon must have >= 3 points',
      actual,
      classifyRejection(actual),
    )
  }

  // 14. duplicate_level — levelId isn't a level (pass a wall/site/building)
  {
    const notLevelId = realWall?.id ?? realSite?.id ?? realBuilding?.id ?? 'missing'
    const input = { levelId: notLevelId }
    const actual = await callTool('duplicate_level', input)
    record(
      'T4-14',
      'duplicate_level',
      'levelId is not a level',
      input,
      'McpError InvalidParams "expected level"',
      actual,
      classifyRejection(actual),
    )
  }

  // 15. delete_node — id with children, cascade=false (happy-path for the rejection)
  //    NOTE: this one mutates state if it succeeds. Since we expect it to REJECT
  //    when cascade=false, there should be no state change. We'll verify below
  //    via validate_scene.
  {
    const target = nodeWithChildren
    if (!target) {
      record(
        'T4-15',
        'delete_node',
        'cascade=false with children',
        { id: 'no-candidate-found' },
        'McpError "node has children"',
        { kind: 'client_error', message: 'no node with children available in scene' },
        'WARN',
        'skipped: no node with children in the default scene',
      )
    } else {
      const input = { id: target.id, cascade: false }
      const actual = await callTool('delete_node', input)
      record(
        'T4-15',
        'delete_node',
        `cascade=false with children (target ${target.type} ${target.id} children=${target.children?.length ?? 0})`,
        input,
        'McpError InvalidRequest "node has children" (no delete)',
        actual,
        classifyRejection(actual),
      )
    }
  }

  // 16. undo — negative steps
  {
    const input = { steps: -1 }
    const actual = await callTool('undo', input)
    record(
      'T4-16a',
      'undo',
      'negative steps',
      input,
      'Zod validation error (MCP InvalidParams) — steps must be positive int',
      actual,
      classifyRejection(actual),
    )
  }

  // 16b. redo — negative steps
  {
    const input = { steps: -2 }
    const actual = await callTool('redo', input)
    record(
      'T4-16b',
      'redo',
      'negative steps',
      input,
      'Zod validation error (MCP InvalidParams) — steps must be positive int',
      actual,
      classifyRejection(actual),
    )
  }

  // 17. export_json — prettify is string 'yes' instead of bool
  {
    const input = { pretty: 'yes' }
    const actual = await callTool('export_json', input)
    record(
      'T4-17',
      'export_json',
      "pretty='yes' (string not bool)",
      input,
      'Zod validation error (MCP InvalidParams) — pretty must be boolean',
      actual,
      classifyRejection(actual),
    )
  }

  // 18. check_collisions — levelId doesn't exist (spec: empty result OR graceful error)
  {
    const input = { levelId: 'level_nosuch_zzz' }
    const actual = await callTool('check_collisions', input)
    // Spec allows either. Success with empty collisions is the friendly path.
    let verdict: Verdict = 'WARN'
    let note: string | undefined
    if (actual.kind === 'unexpected_success') {
      const sc = actual.structuredContent as { collisions?: unknown[] } | undefined
      const empty = Array.isArray(sc?.collisions) && sc.collisions.length === 0
      verdict = empty ? 'PASS' : 'WARN'
      note = empty ? 'returned empty collisions (graceful)' : 'returned non-empty result'
    } else if (actual.kind === 'mcp_error' || actual.kind === 'tool_error') {
      verdict = 'PASS'
      note = 'structured error (also acceptable per spec)'
    } else {
      verdict = 'FAIL'
    }
    record(
      'T4-18',
      'check_collisions',
      "levelId doesn't exist",
      input,
      'Empty collisions result OR graceful error',
      actual,
      verdict,
      note,
    )
  }

  // 19. validate_scene — no args → should succeed (baseline, not an error test)
  {
    const input = {}
    const actual = await callTool('validate_scene', input)
    const ok = actual.kind === 'unexpected_success'
    record(
      'T4-19',
      'validate_scene',
      'baseline: no args',
      input,
      'Success — structured { valid, errors[] }',
      actual,
      ok ? 'PASS' : 'FAIL',
      ok ? 'baseline passed' : 'baseline failed',
    )
  }

  // 20. analyze_floorplan_image — image: ''
  {
    const input = { image: '' }
    const actual = await callTool('analyze_floorplan_image', input)
    // Expected: Zod string.min rule (we have no min, so it accepts empty),
    // falling through to sampling_unavailable (no client caps on HTTP).
    // Either is acceptable — this is a validation/sampling-guard test.
    let verdict = classifyRejection(actual)
    let note: string | undefined
    if (actual.kind === 'mcp_error') {
      if (actual.message?.includes('sampling_unavailable')) {
        note = 'sampling_unavailable (no client capabilities) — acceptable'
        verdict = 'PASS'
      } else {
        note = 'structured error'
      }
    }
    record(
      'T4-20a',
      'analyze_floorplan_image',
      "image: '' (empty string)",
      input,
      'Validation error OR sampling_unavailable',
      actual,
      verdict,
      note,
    )
  }

  // 20b. analyze_floorplan_image — image: 'not-a-url-or-base64'
  {
    const input = { image: 'not-a-url-or-base64' }
    const actual = await callTool('analyze_floorplan_image', input)
    let verdict = classifyRejection(actual)
    let note: string | undefined
    if (actual.kind === 'mcp_error' && actual.message?.includes('sampling_unavailable')) {
      note = 'sampling_unavailable (no client capabilities)'
      verdict = 'PASS'
    }
    record(
      'T4-20b',
      'analyze_floorplan_image',
      "image: 'not-a-url-or-base64'",
      input,
      'Validation error OR sampling_unavailable',
      actual,
      verdict,
      note,
    )
  }

  // 21. analyze_room_photo — image: ''
  {
    const input = { image: '' }
    const actual = await callTool('analyze_room_photo', input)
    let verdict = classifyRejection(actual)
    let note: string | undefined
    if (actual.kind === 'mcp_error' && actual.message?.includes('sampling_unavailable')) {
      note = 'sampling_unavailable (no client capabilities)'
      verdict = 'PASS'
    }
    record(
      'T4-21a',
      'analyze_room_photo',
      "image: '' (empty string)",
      input,
      'Validation error OR sampling_unavailable',
      actual,
      verdict,
      note,
    )
  }

  // 21b. analyze_room_photo — image: 'not-a-url-or-base64'
  {
    const input = { image: 'not-a-url-or-base64' }
    const actual = await callTool('analyze_room_photo', input)
    let verdict = classifyRejection(actual)
    let note: string | undefined
    if (actual.kind === 'mcp_error' && actual.message?.includes('sampling_unavailable')) {
      note = 'sampling_unavailable (no client capabilities)'
      verdict = 'PASS'
    }
    record(
      'T4-21b',
      'analyze_room_photo',
      "image: 'not-a-url-or-base64'",
      input,
      'Validation error OR sampling_unavailable',
      actual,
      verdict,
      note,
    )
  }

  // --- Post-check: scene count should be unchanged (all error paths) ---
  const scene1 = await client.callTool({ name: 'get_scene', arguments: {} })
  const nodes1 = (scene1.structuredContent as { nodes?: Record<string, unknown> })?.nodes ?? {}
  const nodeCount1 = Object.keys(nodes1).length
  console.log(`\nfinal node count = ${nodeCount1} (baseline ${nodeCount0})`)
  const delta = nodeCount1 - nodeCount0
  if (delta !== 0) {
    console.log(`WARN: node count changed by ${delta}`)
  }

  const validationFinal = await client.callTool({
    name: 'validate_scene',
    arguments: {},
  })
  const vf = validationFinal.structuredContent as { valid: boolean; errors: unknown[] }
  console.log(`final validation: valid=${vf.valid} errors=${vf.errors.length}`)

  // --- Emit report ---
  await writeReport(nodeCount0, nodeCount1, vf)

  await client.close()
}

async function writeReport(
  nodeCountBefore: number,
  nodeCountAfter: number,
  finalValidation: { valid: boolean; errors: unknown[] },
): Promise<void> {
  const pass = results.filter((r) => r.verdict === 'PASS').length
  const warn = results.filter((r) => r.verdict === 'WARN').length
  const fail = results.filter((r) => r.verdict === 'FAIL').length

  const lines: string[] = []
  lines.push('# T4 — Error Contract Verification Report')
  lines.push('')
  lines.push(`Server: \`${SERVER_URL.href}\``)
  lines.push(`Run date: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- PASS: ${pass}`)
  lines.push(`- WARN: ${warn}`)
  lines.push(`- FAIL: ${fail}`)
  lines.push(`- Total cases: ${results.length}`)
  lines.push('')
  lines.push(`Baseline node count: ${nodeCountBefore}`)
  lines.push(`Final node count: ${nodeCountAfter} (delta=${nodeCountAfter - nodeCountBefore})`)
  lines.push(
    `Final validation: valid=${finalValidation.valid}, errors=${finalValidation.errors.length}`,
  )
  lines.push('')

  if (fail > 0) {
    lines.push('## Failures (real bugs)')
    lines.push('')
    for (const r of results.filter((x) => x.verdict === 'FAIL')) {
      lines.push(`- **${r.id}** \`${r.tool}\`: ${r.description}`)
      lines.push(`  - Expected: ${r.expected}`)
      lines.push(`  - Actual kind: \`${r.actual.kind}\``)
      if (r.actual.code !== undefined) lines.push(`  - Code: \`${r.actual.code}\``)
      if (r.actual.message) lines.push(`  - Message: \`${r.actual.message}\``)
    }
    lines.push('')
  }

  lines.push('## Cases')
  lines.push('')
  for (const r of results) {
    const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'WARN' ? '⚠️' : '❌'
    lines.push(`### ${r.id} — \`${r.tool}\` — ${r.description}`)
    lines.push('')
    lines.push(`**Verdict:** ${icon} ${r.verdict}`)
    lines.push('')
    lines.push('**Input:**')
    lines.push('```json')
    lines.push(JSON.stringify(r.input, null, 2))
    lines.push('```')
    lines.push('')
    lines.push(`**Expected:** ${r.expected}`)
    lines.push('')
    lines.push('**Actual:**')
    lines.push('```json')
    lines.push(JSON.stringify(r.actual, null, 2))
    lines.push('```')
    if (r.note) {
      lines.push('')
      lines.push(`**Note:** ${r.note}`)
    }
    lines.push('')
  }

  const { writeFile } = await import('node:fs/promises')
  const reportPath = new URL('./REPORT.md', import.meta.url)
  await writeFile(reportPath, lines.join('\n'), 'utf8')
  console.log(`\nwrote report: ${reportPath.pathname}`)
  console.log(`summary: PASS=${pass} WARN=${warn} FAIL=${fail}`)
}

main().catch((err) => {
  console.error('[t4] fatal:', err)
  process.exit(1)
})
