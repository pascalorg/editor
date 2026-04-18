import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerDescribeNode } from './describe-node'

describe('describe_node', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerDescribeNode(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('describes a wall with human sentence', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')
    expect(level).toBeDefined()
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
    bridge.createNode(wall, level!.id)

    const result = await client.callTool({
      name: 'describe_node',
      arguments: { id: wall.id },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.type).toBe('wall')
    expect(parsed.parentId).toBe(level!.id)
    expect(typeof parsed.description).toBe('string')
    expect(parsed.description).toContain('Wall from')
    expect(Array.isArray(parsed.ancestryIds)).toBe(true)
    expect(Array.isArray(parsed.childrenIds)).toBe(true)
    expect(typeof parsed.properties).toBe('object')
  })

  test('ancestry for wall includes level and building', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [3, 0] })
    bridge.createNode(wall, level.id)
    const result = await client.callTool({
      name: 'describe_node',
      arguments: { id: wall.id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.ancestryIds).toContain(level.id)
  })

  test('errors on unknown id', async () => {
    const result = await client.callTool({
      name: 'describe_node',
      arguments: { id: 'wall_nope' },
    })
    expect(result.isError).toBe(true)
  })
})
