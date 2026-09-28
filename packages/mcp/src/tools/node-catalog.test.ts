import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadPlugin, nodeRegistry } from '@pascal-app/core/registry'
import { AnyNode, nodeKindOf } from '@pascal-app/core/schema'
import { z } from 'zod'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { registerNodeCatalog } from './node-catalog'

describe('get_node_catalog', () => {
  let client: Client
  let server: McpServer

  beforeEach(async () => {
    nodeRegistry._reset()
    server = new McpServer({ name: 'node-catalog-test', version: '0.0.0' })
    registerNodeCatalog(server)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'node-catalog-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    await client.listTools()
  })

  afterEach(async () => {
    await client.close()
    await server.close()
    nodeRegistry._reset()
  })

  test('lists every native kind without loading any plugin or changing the registry', async () => {
    expect(nodeRegistry.size).toBe(0)
    const result = await client.callTool({ name: 'get_node_catalog', arguments: {} })
    expect(result.isError).toBeFalsy()
    const kinds = result.structuredContent!.kinds as Array<{
      kind: string
      mutationSupported: boolean
      source: string
    }>
    expect(kinds.map((entry) => entry.kind)).toEqual(
      AnyNode.options.map(nodeKindOf).sort((a, b) => a.localeCompare(b)),
    )
    expect(kinds.every((entry) => entry.mutationSupported && entry.source === 'core-schema')).toBe(
      true,
    )
    expect(result.structuredContent!.detail).toBeUndefined()
    expect(nodeRegistry.size).toBe(0)
    const listed = await client.listTools()
    expect(listed.tools[0]?.annotations).toEqual(READ_ONLY_TOOL_ANNOTATIONS)
  })

  test.each([
    'door',
    'window',
  ])('returns complete %s schema choices and defaults to a client that listed tools first', async (kind) => {
    const result = await client.callTool({ name: 'get_node_catalog', arguments: { kind } })
    expect(result.isError).toBeFalsy()
    const detail = result.structuredContent!.detail as {
      kind: string
      jsonSchema: { properties: Record<string, { enum?: string[]; default?: unknown }> }
      defaults: Record<string, unknown>
      openingPropertiesSchema: {
        properties: Record<string, unknown>
        additionalProperties: boolean
      }
    }
    const family = kind === 'door' ? 'doorType' : 'windowType'
    expect(detail.kind).toBe(kind)
    expect(detail.jsonSchema.properties[family]?.enum).toHaveLength(10)
    expect(detail.defaults[family]).toBe(kind === 'door' ? 'hinged' : 'fixed')
    expect(detail.jsonSchema.properties.id?.default).toBeUndefined()
    expect(detail.defaults.id).toBeUndefined()
    expect(detail.openingPropertiesSchema.additionalProperties).toBe(false)
    expect(detail.openingPropertiesSchema.properties[family]).toBeDefined()
    expect(detail.openingPropertiesSchema.properties.width).toBeUndefined()
    expect(detail.openingPropertiesSchema.properties.wallId).toBeUndefined()
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(
      result.structuredContent,
    )
  })

  test('reads current registered plugin schemas without claiming standalone mutation support', async () => {
    const schema = z.object({
      id: z.string(),
      type: z.literal('catalog-test:screen'),
      width: z.number().min(0.2).max(8).default(1.8),
      style: z.enum(['slatted', 'woven']).default('slatted'),
    })
    await loadPlugin({
      id: 'catalog-test:pack',
      apiVersion: 1,
      nodes: [
        {
          kind: 'catalog-test:screen',
          schemaVersion: 2,
          schema,
          category: 'furnish',
          defaults: () => ({ width: 1.8, style: 'slatted' }),
          presentation: { label: 'Screen', description: 'A parametric room divider.' },
          mcp: { description: 'A screen with adjustable width and slat style.' },
        },
      ],
    })
    const result = await client.callTool({
      name: 'get_node_catalog',
      arguments: { kind: 'catalog-test:screen' },
    })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent!.kinds).toEqual([
      {
        kind: 'catalog-test:screen',
        label: 'Screen',
        description: 'A screen with adjustable width and slat style.',
        source: 'node-registry',
        pluginId: 'catalog-test:pack',
        schemaVersion: 2,
        mutationSupported: false,
      },
    ])
    expect(result.structuredContent!.detail).toMatchObject({
      defaults: { width: 1.8, style: 'slatted' },
      jsonSchema: {
        properties: { style: { enum: ['slatted', 'woven'] }, width: { minimum: 0.2, maximum: 8 } },
      },
    })
  })

  test('rejects an unknown kind instead of inventing a schema or preset', async () => {
    const result = await client.callTool({
      name: 'get_node_catalog',
      arguments: { kind: 'imaginary:window' },
    })
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain('Unknown node kind')
  })
})
