import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

const DIALECT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

async function listRawSchemas() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()

  const server = createPascalMcpServer({ bridge })
  const [srvT, cliT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'schema-dialect', version: '0.0.0' })
  await Promise.all([server.connect(srvT), client.connect(cliT)])
  const { tools } = await client.listTools()

  const dialects = new Set<string>()
  for (const tool of tools) {
    const input = tool.inputSchema as Record<string, unknown> | undefined
    const output = tool.outputSchema as Record<string, unknown> | undefined
    if (typeof input?.$schema === 'string') dialects.add(input.$schema)
    if (typeof output?.$schema === 'string') dialects.add(output.$schema)
  }
  return dialects
}

describe('tools/list schema dialect', () => {
  test('every declared $schema is JSON Schema 2020-12', async () => {
    const dialects = await listRawSchemas()

    expect(dialects.size).toBeGreaterThan(0)
    expect([...dialects]).toEqual([DIALECT_2020_12])
  })
})
