/**
 * Villa Azul - Phase 9 Verifier V9: Spatial queries + MCP tool validation.
 *
 * Spawns stdio MCP against PASCAL_DATA_DIR=/tmp/pascal-villa, loads Villa Azul,
 * and exercises find_nodes / describe_node / measure / check_collisions /
 * get_node / zone-filter plus the scene-summary and constraints resources.
 *
 * Usage:
 *   PASCAL_DATA_DIR=/tmp/pascal-villa \
 *     bun run packages/mcp/test-reports/villa-azul/v9-spatial.ts
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
const REPORT_PATH = resolve(__dirname, 'v9-spatial.md')
const DATA_DIR = process.env.PASCAL_DATA_DIR ?? '/tmp/pascal-villa'
const SCENE_ID = 'a6e7919eacbe'

type Status = 'PASS' | 'FAIL'
type Row = { name: string; status: Status; note: string }
const rows: Row[] = []

function record(name: string, status: Status, note: string): void {
  rows.push({ name, status, note })
  const tag = status === 'PASS' ? '[PASS]' : '[FAIL]'
  console.log(`${tag} ${name} - ${note}`)
}

function pickText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type?: string; text?: string }> | undefined
  if (!Array.isArray(content) || content.length === 0) return ''
  return content[0]?.text ?? ''
}

type Node = {
  id: string
  type: string
  name?: string
  polygon?: Array<[number, number]>
  elevation?: number
  parentId?: string | null
  position?: [number, number, number]
  start?: [number, number]
  end?: [number, number]
  [k: string]: unknown
}

async function main(): Promise<void> {
  const t0 = Date.now()
  console.log('---- Phase 9 V9 spatial + MCP tool validation ----')
  console.log(`BIN=${BIN_PATH}`)
  console.log(`DATA_DIR=${DATA_DIR}`)
  console.log(`SCENE_ID=${SCENE_ID}`)

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [BIN_PATH, '--stdio'],
    stderr: 'inherit',
    env: { ...process.env, PASCAL_DATA_DIR: DATA_DIR },
  })
  const client = new Client({ name: 'v9-spatial', version: '0.0.0' })
  await client.connect(transport)
  console.log('OK  client connected')

  async function callTool<T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ ok: boolean; structured?: T; text: string; err?: string }> {
    try {
      const res = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean
        structuredContent?: T
        content?: unknown
      }
      const text = pickText(res)
      if (res.isError) {
        return { ok: false, structured: res.structuredContent, text, err: text }
      }
      return { ok: true, structured: res.structuredContent, text }
    } catch (err) {
      return { ok: false, text: '', err: err instanceof Error ? err.message : String(err) }
    }
  }

  try {
    // --- load the Villa Azul scene ---
    const loadRes = await callTool<{ id: string; name: string; nodeCount: number }>('load_scene', {
      id: SCENE_ID,
    })
    if (loadRes.ok && loadRes.structured?.id === SCENE_ID) {
      record(
        'load_scene',
        'PASS',
        `id=${loadRes.structured.id} name='${loadRes.structured.name}' nodes=${loadRes.structured.nodeCount}`,
      )
    } else {
      record('load_scene', 'FAIL', loadRes.err ?? 'scene did not load')
      throw new Error(`load_scene failed: ${loadRes.err ?? 'unknown'}`)
    }

    // Discover levelId via find_nodes.
    const levels = await callTool<{ nodes: Node[] }>('find_nodes', { type: 'level' })
    const levelId = levels.structured?.nodes?.[0]?.id
    if (!levelId) throw new Error('no level found in Villa Azul')
    console.log(`levelId=${levelId}`)

    // -----------------------------------------------------------------
    // 1. find_nodes zones on level -> 13
    // -----------------------------------------------------------------
    const zonesRes = await callTool<{ nodes: Node[] }>('find_nodes', {
      type: 'zone',
      levelId,
    })
    const zones = zonesRes.structured?.nodes ?? []
    record(
      '1. find_nodes(zone, levelId)',
      zonesRes.ok && zones.length === 13 ? 'PASS' : 'FAIL',
      `got ${zones.length} (expected 13)`,
    )

    // Index zones by name for later lookups.
    const zoneByName = new Map<string, Node>()
    for (const z of zones) {
      if (typeof z.name === 'string') zoneByName.set(z.name, z)
    }

    // -----------------------------------------------------------------
    // 2. find_nodes doors -> 10
    // -----------------------------------------------------------------
    const doorsRes = await callTool<{ nodes: Node[] }>('find_nodes', { type: 'door' })
    const doors = doorsRes.structured?.nodes ?? []
    record(
      '2. find_nodes(door)',
      doorsRes.ok && doors.length === 10 ? 'PASS' : 'FAIL',
      `got ${doors.length} (expected 10)`,
    )

    // -----------------------------------------------------------------
    // 3. find_nodes windows -> 12
    // -----------------------------------------------------------------
    const winsRes = await callTool<{ nodes: Node[] }>('find_nodes', { type: 'window' })
    const wins = winsRes.structured?.nodes ?? []
    record(
      '3. find_nodes(window)',
      winsRes.ok && wins.length === 12 ? 'PASS' : 'FAIL',
      `got ${wins.length} (expected 12)`,
    )

    // -----------------------------------------------------------------
    // 4. find_nodes fences -> 5
    // -----------------------------------------------------------------
    const fencesRes = await callTool<{ nodes: Node[] }>('find_nodes', { type: 'fence' })
    const fences = fencesRes.structured?.nodes ?? []
    record(
      '4. find_nodes(fence)',
      fencesRes.ok && fences.length === 5 ? 'PASS' : 'FAIL',
      `got ${fences.length} (expected 5)`,
    )

    // -----------------------------------------------------------------
    // 5. describe_node on Living dining zone
    // -----------------------------------------------------------------
    const livingDining = zoneByName.get('Living dining')
    if (!livingDining) {
      record('5. describe_node(living-dining)', 'FAIL', 'Living dining zone not found')
    } else {
      const dn = await callTool<{ type: string; description: string }>('describe_node', {
        id: livingDining.id,
      })
      const desc = dn.structured?.description ?? ''
      const hasZone = /zone/i.test(desc)
      // "area hint" = vertex count, name, or polygon dims. describe() returns
      // `Zone "<name>" with <N> vertices` which is the area hint.
      const hasAreaHint = /"Living dining"/.test(desc) && /\d+\s*vertices/i.test(desc)
      record(
        '5. describe_node(living-dining)',
        dn.ok && hasZone && hasAreaHint ? 'PASS' : 'FAIL',
        `desc='${desc}'`,
      )
    }

    // -----------------------------------------------------------------
    // 6. measure master-bedroom -> pool (expect > 10 m)
    // -----------------------------------------------------------------
    const master = zoneByName.get('Master bedroom')
    const pool = zoneByName.get('Pool')
    if (!master || !pool) {
      record('6. measure(master,pool)', 'FAIL', 'missing zone(s)')
    } else {
      const m = await callTool<{ distanceMeters: number }>('measure', {
        fromId: master.id,
        toId: pool.id,
      })
      const d = m.structured?.distanceMeters ?? -1
      record(
        '6. measure(master,pool)',
        m.ok && d > 10 ? 'PASS' : 'FAIL',
        `distance=${d.toFixed(3)}m (expected > 10m)`,
      )
    }

    // -----------------------------------------------------------------
    // 7. check_collisions on level -> 0
    // -----------------------------------------------------------------
    const coll = await callTool<{ collisions: unknown[] }>('check_collisions', { levelId })
    const collCount = coll.structured?.collisions?.length ?? -1
    record(
      '7. check_collisions',
      coll.ok && collCount === 0 ? 'PASS' : 'FAIL',
      `collisions=${collCount} (expected 0)`,
    )

    // -----------------------------------------------------------------
    // 8. get_node on pool slab -> elevation -2
    // -----------------------------------------------------------------
    const slabsRes = await callTool<{ nodes: Node[] }>('find_nodes', { type: 'slab' })
    const slabs = slabsRes.structured?.nodes ?? []
    // pool basin was created with metadata.kind='pool-basin' and elevation -2.
    const poolSlab =
      slabs.find((s) => {
        const meta = (s as { metadata?: { kind?: string } }).metadata
        return meta?.kind === 'pool-basin'
      }) ??
      slabs.find((s) => typeof s.elevation === 'number' && Math.abs((s.elevation ?? 0) + 2) < 1e-6)
    if (!poolSlab) {
      record('8. get_node(pool-slab)', 'FAIL', `no pool slab among ${slabs.length} slabs`)
    } else {
      const gn = await callTool<{ node: Node }>('get_node', { id: poolSlab.id })
      const elev = gn.structured?.node?.elevation
      record(
        '8. get_node(pool-slab)',
        gn.ok && elev === -2 ? 'PASS' : 'FAIL',
        `slab ${poolSlab.id} elevation=${String(elev)} (expected -2)`,
      )
    }

    // -----------------------------------------------------------------
    // 9. find_nodes with zoneId=<Living dining> -> doors/windows whose
    //    representative point falls in that polygon.
    // -----------------------------------------------------------------
    if (!livingDining) {
      record('9. find_nodes(zoneId=living-dining)', 'FAIL', 'Living dining zone missing')
    } else {
      const zr = await callTool<{ nodes: Node[] }>('find_nodes', {
        zoneId: livingDining.id,
      })
      const hits = zr.structured?.nodes ?? []
      const hitTypes = hits.reduce<Record<string, number>>((acc, n) => {
        acc[n.type] = (acc[n.type] ?? 0) + 1
        return acc
      }, {})
      const hitDoorOrWindow = hits.some((n) => n.type === 'door' || n.type === 'window')
      record(
        '9. find_nodes(zoneId=living-dining)',
        zr.ok && hitDoorOrWindow ? 'PASS' : 'FAIL',
        `${hits.length} nodes in polygon, types=${JSON.stringify(hitTypes)}`,
      )
    }

    // -----------------------------------------------------------------
    // 10. resource pascal://scene/current/summary
    //     expect markdown, zone count 13 or "Villa Azul".
    // -----------------------------------------------------------------
    try {
      const r = await client.readResource({ uri: 'pascal://scene/current/summary' })
      const c = r.contents?.[0]
      const text = typeof c?.text === 'string' ? c.text : ''
      const mime = String(c?.mimeType ?? '')
      const hasName = /Villa Azul/.test(text)
      // look for either a "zone=13" or "zone = 13" style token
      const hasZoneCount = /zone=13/.test(text)
      const ok = mime === 'text/markdown' && (hasName || hasZoneCount)
      record(
        '10. resource scene/current/summary',
        ok ? 'PASS' : 'FAIL',
        `mime=${mime} bytes=${text.length} hasVillaAzul=${hasName} hasZone=13=${hasZoneCount}`,
      )
    } catch (err) {
      record(
        '10. resource scene/current/summary',
        'FAIL',
        `threw: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // -----------------------------------------------------------------
    // 11. resource pascal://constraints/{levelId}
    //     expect slabs + wallPolygons arrays, slabs include the pool.
    // -----------------------------------------------------------------
    try {
      const r = await client.readResource({ uri: `pascal://constraints/${levelId}` })
      const c = r.contents?.[0]
      const text = typeof c?.text === 'string' ? c.text : ''
      const mime = String(c?.mimeType ?? '')
      const parsed = JSON.parse(text) as {
        slabs?: Array<{ id: string; elevation?: number; metadata?: { kind?: string } }>
        wallPolygons?: Array<{ wallId: string; footprint: Array<[number, number]> }>
        error?: string
      }
      const slabCount = Array.isArray(parsed.slabs) ? parsed.slabs.length : -1
      const wallPolyCount = Array.isArray(parsed.wallPolygons) ? parsed.wallPolygons.length : -1
      const poolInSlabs = Array.isArray(parsed.slabs)
        ? parsed.slabs.some(
            (s) =>
              s.metadata?.kind === 'pool-basin' ||
              (typeof s.elevation === 'number' && Math.abs(s.elevation + 2) < 1e-6),
          )
        : false
      const ok =
        mime === 'application/json' &&
        !parsed.error &&
        slabCount > 0 &&
        wallPolyCount > 0 &&
        poolInSlabs
      record(
        '11. resource constraints/{levelId}',
        ok ? 'PASS' : 'FAIL',
        `mime=${mime} slabs=${slabCount} wallPolygons=${wallPolyCount} poolInSlabs=${poolInSlabs}`,
      )
    } catch (err) {
      record(
        '11. resource constraints/{levelId}',
        'FAIL',
        `threw: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } finally {
    try {
      await client.close()
    } catch {
      /* ignore */
    }
  }

  const pass = rows.filter((r) => r.status === 'PASS').length
  const fail = rows.length - pass
  const overall = fail === 0 ? 'PASS' : 'FAIL'
  const durationMs = Date.now() - t0

  // --- write report ---
  const lines: string[] = []
  lines.push('# Villa Azul - V9 Spatial + MCP Tool Validation Report')
  lines.push('')
  lines.push(`- Scene id: \`${SCENE_ID}\``)
  lines.push(`- Data dir: \`${DATA_DIR}\``)
  lines.push(`- Transport: stdio (\`${BIN_PATH}\`)`)
  lines.push(`- Generated: ${new Date().toISOString()}`)
  lines.push(`- Duration: ${durationMs} ms`)
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push('| # | Check | Status | Note |')
  lines.push('|---|---|:---:|---|')
  for (const r of rows) {
    lines.push(`| | ${r.name} | ${r.status} | ${r.note} |`)
  }
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Pass: ${pass}/${rows.length}`)
  lines.push(`- Fail: ${fail}`)
  lines.push(`- Overall: ${overall}`)
  writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8')
  console.log(`\nwrote ${REPORT_PATH}`)
  console.log(`Overall: ${overall} (${pass}/${rows.length})`)
}

main().catch((err) => {
  console.error('[v9-spatial] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(1)
})
