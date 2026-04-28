import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerValidateScene } from './validate-scene'

describe('validate_scene', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerValidateScene(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('default scene is valid', async () => {
    const result = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.valid).toBe(true)
    expect(Array.isArray(parsed.errors)).toBe(true)
  })

  test('reports structured errors', async () => {
    const result = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    for (const err of parsed.errors) {
      expect(typeof err.nodeId).toBe('string')
      expect(typeof err.path).toBe('string')
      expect(typeof err.message).toBe('string')
    }
  })

  test('returns structuredContent', async () => {
    const result = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    expect(result.structuredContent).toBeDefined()
    expect((result.structuredContent as { valid: boolean }).valid).toBe(true)
  })
})
