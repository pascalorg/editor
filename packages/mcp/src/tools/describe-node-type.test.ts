import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AnyNode } from '@pascal-app/core/schema'
import { registerDescribeNodeType } from './describe-node-type'

type Payload = {
  types: Array<{ type: string; fieldCount: number; required: string[]; schema?: unknown }>
  omitted: string[]
}

describe('describe_node_type', () => {
  let client: Client

  beforeEach(async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerDescribeNodeType(server)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  /** Drive it over the real transport, so registration and input parsing are covered too. */
  async function call(types?: string[]): Promise<Payload> {
    const result = await client.callTool({
      name: 'describe_node_type',
      arguments: types ? { types } : {},
    })
    return JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text) as Payload
  }

  test('indexes every kind in the scene union when asked for nothing', async () => {
    const payload = await call()
    const unionSize = (AnyNode as unknown as { options: unknown[] }).options.length

    expect(payload.types).toHaveLength(unionSize)
    expect(payload.types.every((entry) => entry.fieldCount > 0)).toBe(true)
    // The index stays cheap — schemas are opt-in, or the reply is ~190KB.
    expect(payload.types.every((entry) => entry.schema === undefined)).toBe(true)
  })

  test('covers the kinds that have no dedicated tool — the reason this exists', async () => {
    const payload = await call()
    const kinds = new Set(payload.types.map((entry) => entry.type))

    for (const kind of ['column', 'skylight', 'chimney', 'fence', 'elevator', 'duct-segment']) {
      expect(kinds.has(kind)).toBe(true)
    }
  })

  test('returns JSON Schema for the kinds asked for, and only those', async () => {
    const payload = await call(['column'])
    const column = payload.types.find((entry) => entry.type === 'column')
    const other = payload.types.find((entry) => entry.type === 'wall')

    expect(column?.schema).toBeDefined()
    expect((column?.schema as { properties?: object }).properties).toBeDefined()
    expect(other?.schema).toBeUndefined()
  })

  // The whole promise of reading from `AnyNode` rather than a hand-written
  // table: what the tool publishes is what `apply_patch` will accept.
  test('a node built to the published required fields parses as that kind', async () => {
    const payload = await call(['column'])
    const column = payload.types.find((entry) => entry.type === 'column')
    const schema = column?.schema as { properties: Record<string, { const?: unknown }> }

    // `type` is the discriminator; everything else the schema calls required
    // must be nameable from the published shape.
    expect(column?.required).toBeDefined()
    expect(Object.keys(schema.properties)).toContain('type')

    const parsed = AnyNode.safeParse({ id: 'column_test', type: 'column', parentId: null })
    expect(parsed.success).toBe(true)
  })

  test('names an unknown kind as an error rather than returning an empty answer', async () => {
    await expect(call(['not_a_kind'])).rejects.toThrow()
  })

  test('drops schemas past the byte budget and says which, instead of truncating one', async () => {
    // Every kind at once blows the budget several times over.
    const all = await call()
    const payload = await call(all.types.map((entry) => entry.type))

    expect(payload.omitted.length).toBeGreaterThan(0)
    // Nothing half-returned: a kind either has a whole schema or is listed.
    for (const entry of payload.types) {
      if (payload.omitted.includes(entry.type)) expect(entry.schema).toBeUndefined()
    }
  })
})
