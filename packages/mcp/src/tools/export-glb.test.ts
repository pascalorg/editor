import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerExportGlb } from './export-glb'

describe('export_glb', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerExportGlb(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('returns not_implemented structurally (not an error)', async () => {
    const result = await client.callTool({
      name: 'export_glb',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.status).toBe('not_implemented')
    expect(typeof parsed.reason).toBe('string')
  })

  test('structuredContent exposes the status', async () => {
    const result = await client.callTool({
      name: 'export_glb',
      arguments: {},
    })
    expect((result.structuredContent as { status: string }).status).toBe('not_implemented')
  })
})
