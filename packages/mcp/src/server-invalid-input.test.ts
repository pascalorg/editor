import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from './bridge/scene-bridge'
import { createPascalMcpServer } from './server'
import { SqliteSceneStore } from './storage/sqlite-scene-store'

// Arguments a schema rejects are refused with a code, as the chat refuses them (invalid_input):
// the SDK alone answers a bare "Input validation error" message. If an SDK upgrade moves its
// argument check, this fails rather than the code silently going missing.
describe('arguments a tool’s schema rejects', () => {
  test('come back as a tool error with the code invalid_input', async () => {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const store = new SqliteSceneStore({
      databasePath: join(mkdtempSync(join(tmpdir(), 'pascal-mcp-invalid-')), 'pascal.db'),
    })
    const server = createPascalMcpServer({ bridge, store })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'invalid-input-test', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const result = await client.callTool({
      name: 'add_wall',
      arguments: { start: 'here', end: [1, 0] },
    })
    expect(result.isError).toBe(true)
    const answer = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as {
      code: string
      error: string
    }
    expect(answer.code).toBe('invalid_input')
    expect(answer.error).toContain('Invalid arguments for tool add_wall')
    expect(answer.error).toContain('start')
  })
})
