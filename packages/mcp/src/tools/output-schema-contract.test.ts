import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DoorNode, WallNode, ZoneNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

/**
 * Every real MCP host (Claude Desktop, Claude Code, Codex, Cursor) calls
 * `tools/list` before `tools/call`. Once the SDK client has cached a tool's
 * output schema it validates `structuredContent` against it with
 * `additionalProperties: false`, so a payload field that the schema does not
 * declare fails the call with -32602 in production while passing every test
 * that never listed the tools first.
 *
 * These read-only tools are exercised through a client that lists first, which
 * is the only configuration where that mismatch is observable.
 */
async function connectListedClient() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()

  const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')
  if (!level) throw new Error('default scene has no level')
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
  bridge.createNode(wall, level.id)
  bridge.createNode(DoorNode.parse({ wallId: wall.id, position: [2, 1.05, 0] }), wall.id)
  bridge.createNode(
    ZoneNode.parse({
      name: 'Room',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    }),
    level.id,
  )

  const server = createPascalMcpServer({ bridge })
  const [srvT, cliT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'output-schema-contract', version: '0.0.0' })
  await Promise.all([server.connect(srvT), client.connect(cliT)])
  await client.listTools()
  return { bridge, client, levelId: level.id }
}

describe('registered tool output schemas', () => {
  test('read-only tools satisfy their declared output schema for a listed client', async () => {
    const { client, levelId } = await connectListedClient()

    const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [
      { name: 'get_scene', arguments: {} },
      { name: 'list_levels', arguments: {} },
      { name: 'get_level_summary', arguments: { levelId } },
      { name: 'get_walls', arguments: { levelId } },
      { name: 'get_zones', arguments: { levelId } },
      { name: 'verify_scene', arguments: {} },
      { name: 'validate_scene', arguments: {} },
      { name: 'check_collisions', arguments: {} },
      { name: 'find_nodes', arguments: { type: 'wall' } },
      { name: 'export_json', arguments: {} },
      { name: 'list_templates', arguments: {} },
    ]

    const failures: string[] = []
    for (const call of calls) {
      try {
        const result = await client.callTool(call)
        if (result.isError) failures.push(`${call.name}: isError`)
      } catch (err) {
        failures.push(`${call.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    expect(failures).toEqual([])
  })

  test('create_from_template declares the no-store saveSkipped field', async () => {
    const { client } = await connectListedClient()

    const result = await client.callTool({
      name: 'create_from_template',
      arguments: { id: 'garden-house', save: true },
    })

    expect(result.isError).toBeFalsy()
    expect((result.structuredContent as { saveSkipped?: boolean }).saveSkipped).toBe(true)
  })
})
