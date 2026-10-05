import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { AGENT_TOOL_CASES } from '../../../core/src/agent-operations/__fixtures__/cases'
import { SceneBridge } from '../bridge/scene-bridge'
import { type AssetCatalog, builtInCatalog } from './asset-catalog'
import { registerSharedTools } from './shared-tools'

// Layer 2 of 3: the MCP tools, through a real client, on every shared tool's edge cases.
type Result = {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent?: Record<string, unknown>
}

describe('shared tools over MCP', () => {
  let bridge: SceneBridge
  let client: Client
  // The host's library for the case at hand: its own, else the server's built-in list.
  let catalog: AssetCatalog = builtInCatalog

  beforeEach(async () => {
    bridge = new SceneBridge()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSharedTools(server, bridge, () => catalog())
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    await client.listTools()
  })

  for (const c of AGENT_TOOL_CASES) {
    if (c.surfaces && !c.surfaces.includes('mcp')) continue
    test(`${c.tool}: ${c.name}`, async () => {
      const { nodes, rootNodeIds } = c.scene()
      bridge.setScene(nodes as never, rootNodeIds as never)
      const own = c.context?.catalog
      catalog = own ? async () => own : builtInCatalog
      const result = (await client.callTool({ name: c.tool, arguments: c.input })) as Result
      const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>
      if ('refusal' in c.expect) {
        expect(result.isError).toBe(true)
        expect(payload.code).toBe(c.expect.refusal)
        for (const text of c.expect.mentions ?? []) expect(String(payload.error)).toContain(text)
        return
      }
      expect(result.isError).toBeFalsy()
      expect(payload).toMatchObject(c.expect.result)
      for (const id of c.expect.present ?? []) expect(bridge.getNode(id as AnyNodeId)).toBeTruthy()
      for (const id of c.expect.absent ?? []) expect(bridge.getNode(id as AnyNodeId)).toBeFalsy()
      for (const [id, fields] of Object.entries(c.expect.after ?? {}))
        expect(bridge.getNode(id as AnyNodeId)).toMatchObject(fields)
      for (const [key, entries] of Object.entries(c.expect.contains ?? {}))
        for (const entry of entries)
          expect((payload as Record<string, unknown[]>)[key]).toContainEqual(
            expect.objectContaining(entry),
          )
      for (const [key, entries] of Object.entries(c.expect.lacks ?? {}))
        for (const entry of entries)
          expect((payload as Record<string, unknown[]>)[key]).not.toContainEqual(
            expect.objectContaining(entry),
          )
      for (const text of c.expect.mentions ?? []) expect(JSON.stringify(payload)).toContain(text)
      expect(c.expect.check?.(payload, bridge.getNodes()) ?? []).toEqual([])
    })
  }
})

// Hawkesbury run 1 (2026-10-03): the hosted MCP searched 23 built-in items, no light or plant,
// while the chat searched the app's library; the agent found no wall light and left them out.
describe("search_assets over MCP reads the host's catalog", () => {
  async function search(query: string, catalog?: AssetCatalog) {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSharedTools(server, new SceneBridge(), catalog)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const result = (await client.callTool({
      name: 'search_assets',
      arguments: { queries: [{ query }] },
    })) as Result
    const payload = JSON.parse(result.content[0]!.text)
    return payload.groups[0].results.map((item: { id: string }) => item.id) as string[]
  }

  test('a standalone server searches its built-in list', async () => {
    expect(await search('sofa')).toContain('sofa')
  })

  test('a host searches the library it passes, not the built-in list', async () => {
    const palm = {
      id: 'palm',
      category: 'outdoor',
      name: 'Palm',
      tags: ['tree', 'plant', 'garden'],
      thumbnail: '',
      src: 'asset://palm',
      dimensions: [1.5, 3, 1.5] as [number, number, number],
    }
    expect(await search('plant', async () => [palm])).toEqual(['palm'])
    expect(await search('sofa', async () => [palm])).toEqual([])
  })
})
