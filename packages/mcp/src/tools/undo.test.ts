import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerUndo } from './undo'

describe('undo', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    bridge.clearHistory()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerUndo(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('undoes one step', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [1, 0] })
    bridge.createNode(wall, level.id)
    await new Promise((r) => setTimeout(r, 5))

    const result = await client.callTool({
      name: 'undo',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.undone).toBe(1)
    expect(bridge.getNode(wall.id)).toBeNull()
  })

  test('returns 0 when nothing to undo', async () => {
    const result = await client.callTool({
      name: 'undo',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.undone).toBe(0)
  })

  test('rejects non-positive steps', async () => {
    const result = await client.callTool({
      name: 'undo',
      arguments: { steps: 0 },
    })
    expect(result.isError).toBe(true)
  })
})
