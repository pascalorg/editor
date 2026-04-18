/**
 * Programmatic `@pascal-app/mcp` usage.
 *
 * Runs a full MCP client/server pair over the in-memory transport inside a
 * single Node process. Useful for agent frameworks and tests that want to
 * drive Pascal without spawning a subprocess.
 *
 * Compile with the package's `tsc --build`, or run directly with Bun:
 *
 *   bun run packages/mcp/examples/embed-in-agent.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createPascalMcpServer, SceneBridge } from '@pascal-app/mcp'

async function main(): Promise<void> {
  // 1. Spin up the headless bridge. `loadDefault()` seeds a Site → Building →
  //    Level stack so the client has something to query immediately.
  const bridge = new SceneBridge()
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })

  // 2. Link the server to an in-memory client. Exactly the same API surface
  //    as the stdio / HTTP transports, but without any process boundary.
  const [srvT, cliT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'my-agent', version: '0.1.0' })
  await Promise.all([server.connect(srvT), client.connect(cliT)])

  // 3. Discover available capabilities.
  const tools = await client.listTools()
  console.log(
    'available tools:',
    tools.tools.map((t) => t.name),
  )

  // 4. Inspect the current scene.
  const scene = await client.callTool({ name: 'get_scene', arguments: {} })
  console.log('scene snapshot:', JSON.stringify(scene, null, 2))

  // 5. Find the default level, create a 5 m wall, and undo it.
  const levels = await client.callTool({
    name: 'find_nodes',
    arguments: { type: 'level' },
  })
  const levelId = (levels.structuredContent as { nodes: Array<{ id: string }> }).nodes[0]?.id

  if (levelId) {
    const created = await client.callTool({
      name: 'create_wall',
      arguments: {
        levelId,
        start: [0, 0],
        end: [5, 0],
        thickness: 0.2,
        height: 2.5,
      },
    })
    console.log('created wall:', created.structuredContent)

    const undone = await client.callTool({ name: 'undo', arguments: { steps: 1 } })
    console.log('undone:', undone.structuredContent)
  }

  // 6. Validate and export.
  const validation = await client.callTool({ name: 'validate_scene', arguments: {} })
  console.log('validation:', validation.structuredContent)

  const exported = await client.callTool({
    name: 'export_json',
    arguments: { pretty: true },
  })
  console.log('export size:', (exported.structuredContent as { json: string }).json.length)

  await client.close()
  await server.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
