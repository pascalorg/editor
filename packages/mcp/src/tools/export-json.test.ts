import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerExportJson } from './export-json'

describe('export_json', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerExportJson(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('returns serialisable JSON', async () => {
    const result = await client.callTool({
      name: 'export_json',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(typeof parsed.json).toBe('string')
    const reparsed = JSON.parse(parsed.json)
    expect(Array.isArray(reparsed.rootNodeIds)).toBe(true)
    expect(typeof reparsed.nodes).toBe('object')
  })

  test('pretty=true produces indented output', async () => {
    const result = await client.callTool({
      name: 'export_json',
      arguments: { pretty: true },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.json.includes('\n')).toBe(true)
  })

  test('pretty=false (default) produces compact output', async () => {
    const result = await client.callTool({
      name: 'export_json',
      arguments: { pretty: false },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.json.includes('\n')).toBe(false)
  })
})
