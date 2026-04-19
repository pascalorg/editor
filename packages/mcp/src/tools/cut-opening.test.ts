import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerCutOpening } from './cut-opening'

describe('cut_opening', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCutOpening(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('creates a door opening on a wall', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level.id)

    const result = await client.callTool({
      name: 'cut_opening',
      arguments: {
        wallId: wall.id,
        type: 'door',
        position: 0.5,
        width: 0.9,
        height: 2.1,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.openingId).toMatch(/^door_/)
    const created = bridge.getNode(parsed.openingId)
    expect((created as { wallId?: string }).wallId).toBe(wall.id)
    expect((created as { width: number }).width).toBe(0.9)
  })

  test('creates a window opening on a wall', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level.id)

    const result = await client.callTool({
      name: 'cut_opening',
      arguments: {
        wallId: wall.id,
        type: 'window',
        position: 0.25,
        width: 1.2,
        height: 1.2,
      },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.openingId).toMatch(/^window_/)
  })

  test('rejects unknown wall id', async () => {
    const result = await client.callTool({
      name: 'cut_opening',
      arguments: {
        wallId: 'wall_nope',
        type: 'door',
        position: 0.5,
        width: 1,
        height: 2,
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects out-of-range position', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level.id)

    const result = await client.callTool({
      name: 'cut_opening',
      arguments: {
        wallId: wall.id,
        type: 'door',
        position: 1.5,
        width: 1,
        height: 2,
      },
    })
    expect(result.isError).toBe(true)
  })
})
