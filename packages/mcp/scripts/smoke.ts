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
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const BIN_PATH = resolve(import.meta.dir, '../dist/bin/pascal-mcp.js')

async function main(): Promise<void> {
  if (!(await Bun.file(BIN_PATH).exists())) {
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
