import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerGetScene } from './get-scene'

describe('get_scene', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerGetScene(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('returns scene with nodes and rootNodeIds', async () => {
    const result = await client.callTool({ name: 'get_scene', arguments: {} })
    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    const parsed = JSON.parse(text)
    expect(Array.isArray(parsed.rootNodeIds)).toBe(true)
    expect(parsed.rootNodeIds.length).toBeGreaterThan(0)
    expect(typeof parsed.nodes).toBe('object')
    expect(Object.keys(parsed.nodes).length).toBeGreaterThan(0)
  })

  test('reflects mutations to the bridge', async () => {
    const beforeCount = Object.keys(bridge.getNodes()).length
    bridge.setScene({}, [])
    const result = await client.callTool({ name: 'get_scene', arguments: {} })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.rootNodeIds.length).toBe(0)
    expect(Object.keys(parsed.nodes).length).toBe(0)
    expect(beforeCount).toBeGreaterThan(0)
  })

  test('returns structured content', async () => {
    const result = await client.callTool({ name: 'get_scene', arguments: {} })
    expect(result.structuredContent).toBeDefined()
    expect(
      Array.isArray((result.structuredContent as { rootNodeIds: unknown[] }).rootNodeIds),
    ).toBe(true)
  })
})
