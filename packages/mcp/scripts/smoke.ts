/**
 * End-to-end smoke test for @pascal-app/mcp.
 *
 * Spawns the compiled stdio binary as a child process, connects as an MCP
 * client, and exercises a handful of representative tools. This test requires
 * the package to be built first (`bun run build`) — the compiled bin is what
 * `package.json`'s `bin` entry ships to users.
 *
 * Run with: bun run scripts/smoke.ts
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const BIN_PATH = resolve(__dirname, '../dist/bin/pascal-mcp.js')

async function main(): Promise<void> {
  if (!existsSync(BIN_PATH)) {
    console.error(`[smoke] bin not found at ${BIN_PATH}`)
    console.error('[smoke] run `bun run build` first')
    process.exit(1)
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN_PATH, '--stdio'],
    stderr: 'inherit',
  })
  const client = new Client({ name: 'pascal-mcp-smoke', version: '0.0.0' })

  try {
    await client.connect(transport)

    const tools = await client.listTools()
    console.log(`[smoke] tools registered: ${tools.tools.length}`)
    if (tools.tools.length === 0) {
      throw new Error('no tools registered')
    }

    const getScene = await client.callTool({ name: 'get_scene', arguments: {} })
    if (getScene.isError) {
      throw new Error(`get_scene failed: ${JSON.stringify(getScene)}`)
    }
    console.log('[smoke] get_scene: OK')

    // create_level — buildingId may not match a real node depending on the
    // default scene; we just verify the tool returns a structured response
    // rather than crash.
    const createLevel = await client.callTool({
      name: 'create_level',
      arguments: { buildingId: 'tbd', elevation: 1, height: 3 },
    })
    console.log('[smoke] create_level:', createLevel.isError ? 'structured error (ok)' : 'OK')

    const validate = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    console.log('[smoke] validate_scene:', validate.isError ? 'ERROR' : 'OK')

    // Parcel vertical. The in-process suite drives these handlers directly,
    // which proves the logic and nothing about registration or the transport —
    // a tool whose schema the SDK rejects still passes there.
    const names = new Set(tools.tools.map((tool) => tool.name))
    for (const name of [
      'search_parcel',
      'apply_parcel_to_site',
      'set_setbacks',
      'get_buildable_area',
    ]) {
      if (!names.has(name)) throw new Error(`${name} is not registered`)
    }
    console.log('[smoke] parcel tools registered: OK')

    // `search_parcel` is left out on purpose: it reaches TKGM, and a smoke run
    // must not fail because a third party is down or the machine is offline.
    const setbacks = await client.callTool({
      name: 'set_setbacks',
      arguments: { defaultSetback: 5, edges: [{ index: '0', role: 'road', distance: 5 }] },
    })
    if (setbacks.isError) throw new Error(`set_setbacks failed: ${JSON.stringify(setbacks)}`)
    console.log('[smoke] set_setbacks: OK')

    const buildable = await client.callTool({ name: 'get_buildable_area', arguments: {} })
    if (buildable.isError)
      throw new Error(`get_buildable_area failed: ${JSON.stringify(buildable)}`)
    const reading = JSON.parse((buildable.content as Array<{ text: string }>)[0]!.text)
    if (!(reading.buildableArea > 0)) {
      throw new Error(`get_buildable_area returned no ground: ${JSON.stringify(reading)}`)
    }
    console.log(`[smoke] get_buildable_area: OK (${reading.buildableArea.toFixed(1)} m²)`)

    const applied = await client.callTool({
      name: 'apply_parcel_to_site',
      arguments: {
        parcelData: {
          ring: [
            { latitude: 39.9, longitude: 32.85 },
            { latitude: 39.9, longitude: 32.850467 },
            { latitude: 39.900269, longitude: 32.850467 },
            { latitude: 39.900269, longitude: 32.85 },
          ],
          il: 'Ankara',
          ilce: 'Çankaya',
          mahalle: 'Kızılay',
          mahalleId: 12345,
          ada: '2705',
          parsel: '15',
          registeredAreaRaw: '1.295,00',
        },
      },
    })
    if (applied.isError) {
      throw new Error(`apply_parcel_to_site failed: ${JSON.stringify(applied)}`)
    }
    console.log('[smoke] apply_parcel_to_site: OK')

    const undone = await client.callTool({ name: 'undo', arguments: {} })
    console.log('[smoke] undo:', undone.isError ? 'ERROR' : 'OK')

    console.log('[smoke] passed')
  } finally {
    try {
      await client.close()
    } catch {
      // client may already be closed; ignore.
    }
  }
}

main().catch((err) => {
  console.error('[smoke] failed:', err)
  process.exit(1)
})
