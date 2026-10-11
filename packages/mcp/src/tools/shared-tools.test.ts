import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentOperations } from '@pascal-app/core/agent-operations'
import { type PluginAgentTools, refuse } from '@pascal-app/core/agent-tools'
import { type AnyNodeId, BuildingNode, LevelNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import { AGENT_TOOL_CASES } from '../../../core/src/agent-operations/__fixtures__/cases'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { type AssetCatalog, builtInCatalog } from './asset-catalog'
import { registerOperationTool, registerSharedTools } from './shared-tools'

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

// The hosted MCP searched 23 built-in items, no light or plant,
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

// A plugin's 'operation' tool, registered by a host as the shared tools are: the contract from the
// plugin's ./agent-tools, the operation from its ./agent-operations.
describe("a plugin's operation tool over MCP", () => {
  const signage: PluginAgentTools = {
    pluginId: 'acme:signage',
    apiVersion: 1,
    version: '1.0.0',
    tools: [
      {
        name: 'signage_name_level',
        title: 'Name level',
        description: 'Rename a level. Refused with level_not_found for an id that is not a level.',
        input: { levelId: z.string(), name: z.string().min(1) },
        // A wrong hint: what clients see is the host's annotations, never the plugin's.
        annotations: { readOnlyHint: true },
        runsIn: 'operation',
      },
    ],
  }
  const signageOperations: AgentOperations = {
    signage_name_level: (nodes, input: { levelId: string; name: string }) => {
      if (nodes[input.levelId]?.type !== 'level')
        refuse('level_not_found', `${input.levelId} is not a level.`)
      return {
        result: { levelId: input.levelId, name: input.name },
        changes: { update: [{ id: input.levelId, data: { name: input.name } }] },
      }
    },
  }

  let bridge: SceneBridge
  let client: Client

  beforeEach(async () => {
    bridge = new SceneBridge()
    const building = BuildingNode.parse({ id: 'building_a', children: ['level_ground'] })
    const level = LevelNode.parse({ id: 'level_ground', parentId: building.id, name: 'Ground' })
    bridge.setScene({ [building.id]: building, [level.id]: level } as never, [building.id] as never)
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    const operations = createSceneOperations({ bridge })
    for (const contract of signage.tools) {
      const operation = signageOperations[contract.name]
      if (contract.runsIn !== 'operation' || !operation) continue
      registerOperationTool(server, operations, {
        contract,
        operation,
        annotations: ADDITIVE_TOOL_ANNOTATIONS,
      })
    }
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  const levelName = () => (bridge.getNode('level_ground' as AnyNodeId) as { name?: string }).name

  test("lists the tool from the plugin's contract, with the host's annotations", async () => {
    const { tools } = await client.listTools()
    const tool = tools.find(({ name }) => name === 'signage_name_level')
    expect(tool).toMatchObject({
      title: 'Name level',
      description: signage.tools[0]!.description,
      inputSchema: { required: ['levelId', 'name'] },
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    })
  })

  test('applies the operation and answers with what the scene holds', async () => {
    const result = (await client.callTool({
      name: 'signage_name_level',
      arguments: { levelId: 'level_ground', name: 'Main floor' },
    })) as Result
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({
      levelId: 'level_ground',
      name: 'Main floor',
      achieved: { updated: 1 },
    })
    expect(levelName()).toBe('Main floor')
  })

  test('answers a refusal with its code and leaves the scene as it was', async () => {
    const result = (await client.callTool({
      name: 'signage_name_level',
      arguments: { levelId: 'level_attic', name: 'Attic' },
    })) as Result
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ code: 'level_not_found' })
    expect(levelName()).toBe('Ground')
  })

  test("rejects input the plugin's contract does not parse", async () => {
    const result = (await client.callTool({
      name: 'signage_name_level',
      arguments: { levelId: 'level_ground', name: '' },
    })) as Result
    expect(result.isError).toBe(true)
    expect(levelName()).toBe('Ground')
  })
})
