import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSetZone } from './set-zone'

describe('set_zone', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSetZone(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('creates a zone on a level', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'set_zone',
      arguments: {
        levelId: level.id,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        label: 'Kitchen',
        properties: { primary: true },
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.zoneId).toMatch(/^zone_/)
    const zone = bridge.getNode(parsed.zoneId)
    expect((zone as { name: string }).name).toBe('Kitchen')
  })

  test('rejects polygon with <3 vertices', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'set_zone',
      arguments: {
        levelId: level.id,
        polygon: [
          [0, 0],
          [1, 1],
        ],
        label: 'X',
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects unknown level id', async () => {
    const result = await client.callTool({
      name: 'set_zone',
      arguments: {
        levelId: 'level_nope',
        polygon: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        label: 'X',
      },
    })
    expect(result.isError).toBe(true)
  })
})
