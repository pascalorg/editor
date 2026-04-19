import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerCreateWall } from './create-wall'

describe('create_wall', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCreateWall(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('creates a wall with custom thickness', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_wall',
      arguments: {
        levelId: level.id,
        start: [0, 0],
        end: [4, 0],
        thickness: 0.15,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.wallId).toMatch(/^wall_/)
    const created = bridge.getNode(parsed.wallId)
    expect(created).not.toBeNull()
    expect((created as { thickness?: number }).thickness).toBe(0.15)
  })

  test('rejects unknown level id', async () => {
    const result = await client.callTool({
      name: 'create_wall',
      arguments: {
        levelId: 'level_nope',
        start: [0, 0],
        end: [1, 0],
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects invalid start tuple', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_wall',
      arguments: {
        levelId: level.id,
        start: [0],
        end: [1, 0],
      },
    })
    expect(result.isError).toBe(true)
  })
})
