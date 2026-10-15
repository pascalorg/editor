import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { RETIRED_MCP_TOOLS } from '@pascal-app/core/agent-tools'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

async function connect() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'retired-tools-test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

// A retired name is listed nowhere and answered with its replacement, as the hosted chat answers
// one; an unknown name still gets the SDK's own error.
describe('retired tools', () => {
  test('are listed by no server, and their replacement is', async () => {
    const client = await connect()
    const listed = new Set((await client.listTools()).tools.map((tool) => tool.name))
    for (const [name, { replacement }] of Object.entries(RETIRED_MCP_TOOLS)) {
      expect(listed.has(name)).toBe(false)
      expect(listed.has(replacement)).toBe(true)
    }
  })

  test('answer tool_retired with the replacement and how to use it', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'validate_scene', arguments: {} })
    expect(result.isError).toBe(true)
    const answer = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
    expect(answer).toEqual({
      code: 'tool_retired',
      replacement: 'verify_scene',
      error: expect.stringContaining('validate_scene is retired, use verify_scene: '),
    })
    expect(answer.error).toContain('schema_invalid')
  })

  test('answer every retired name, whatever its arguments', async () => {
    const client = await connect()
    for (const [name, { replacement }] of Object.entries(RETIRED_MCP_TOOLS)) {
      const result = await client.callTool({ name, arguments: { id: 'wall_x', type: 'wall' } })
      expect(result.isError).toBe(true)
      const answer = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
      expect(answer).toMatchObject({ code: 'tool_retired', replacement })
    }
  })

  test('leave an unknown name to the SDK', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'no_such_tool', arguments: {} })
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain('no_such_tool')
    expect((result.content as Array<{ text: string }>)[0]!.text).not.toContain('tool_retired')
  })
})
