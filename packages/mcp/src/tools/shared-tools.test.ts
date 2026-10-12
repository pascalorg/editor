import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentOperations } from '@pascal-app/core/agent-operations'
import { type PluginAgentTools, refuse } from '@pascal-app/core/agent-tools'
import { type AnyNodeId, BuildingNode, type Collection, LevelNode } from '@pascal-app/core/schema'
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

// A plugin's 'operation' tools, registered by a host as the shared tools are: the contracts from
// the plugin's ./agent-tools, the operations from its ./agent-operations.
describe("a plugin's operation tools over MCP", () => {
  const level = { levelId: z.string() }
  const signage: PluginAgentTools = {
    pluginId: 'acme:signage',
    apiVersion: 1,
    version: '1.0.0',
    tools: [
      {
        name: 'signage_name_level',
        title: 'Name level',
        description: 'Rename a level. Refused with level_not_found for an id that is not a level.',
        input: { ...level, name: z.string().min(1) },
        // A wrong hint: what clients see is the host's annotations, never the plugin's.
        annotations: { readOnlyHint: true },
        runsIn: 'operation',
      },
      {
        name: 'signage_group_level',
        title: 'Group level',
        description: "Collect a level's signs.",
        input: level,
        runsIn: 'operation',
      },
      {
        name: 'signage_name_and_group_level',
        title: 'Name and group level',
        description: 'Rename a level and collect its signs, in one step.',
        input: level,
        runsIn: 'operation',
      },
      {
        name: 'signage_name_after_reconcile',
        title: 'Name level after reconcile',
        description: 'Rename a level once the host has derived its construction.',
        input: level,
        runsIn: 'operation',
      },
    ],
  }
  const signs = {
    id: 'collection_signs',
    name: 'Signs',
    nodeIds: ['level_ground'],
  } as Collection
  const signageOperations = {
    signage_name_level: (nodes, input: { levelId: string; name: string }) => {
      if (nodes[input.levelId]?.type !== 'level')
        refuse('level_not_found', `${input.levelId} is not a level.`)
      return {
        result: { levelId: input.levelId, name: input.name },
        changes: { update: [{ id: input.levelId, data: { name: input.name } }] },
      }
    },
    signage_group_level: () => ({
      result: { collectionId: signs.id },
      changes: { collections: { [signs.id]: signs } },
    }),
    signage_name_and_group_level: (_nodes, input: { levelId: string }) => ({
      result: { collectionId: signs.id },
      changes: {
        update: [{ id: input.levelId, data: { name: 'Signed' } }],
        collections: { [signs.id]: signs },
      },
    }),
    signage_name_after_reconcile: (_nodes, input: { levelId: string }) => ({
      result: { settled: false },
      afterReconcile: (derived) => ({
        result: { settled: true, levelSeen: derived[input.levelId]?.type === 'level' },
        changes: { update: [{ id: input.levelId, data: { name: 'Reconciled' } }] },
      }),
    }),
  } satisfies AgentOperations

  let bridge: SceneBridge
  let client: Client

  beforeEach(async () => {
    bridge = new SceneBridge()
    const building = BuildingNode.parse({ id: 'building_a', children: ['level_ground'] })
    const ground = LevelNode.parse({ id: 'level_ground', parentId: building.id, name: 'Ground' })
    bridge.setScene(
      { [building.id]: building, [ground.id]: ground } as never,
      [building.id] as never,
    )
    bridge.clearHistory()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    const operations = createSceneOperations({ bridge })
    const byName: AgentOperations = signageOperations
    for (const contract of signage.tools) {
      const operation = byName[contract.name]
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
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as Result

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
    const result = await call('signage_name_level', { levelId: 'level_ground', name: 'Main floor' })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({
      levelId: 'level_ground',
      name: 'Main floor',
      achieved: { updated: 1 },
    })
    expect(levelName()).toBe('Main floor')
  })

  test('applies collection writes alone, in one undo step', async () => {
    const result = await call('signage_group_level', { levelId: 'level_ground' })
    expect(result.isError).toBeFalsy()
    expect(bridge.getCollections()).toMatchObject({ [signs.id]: signs })
    expect(bridge.undo()).toBe(1)
    expect(bridge.getCollections()).not.toHaveProperty(signs.id)
  })

  test('applies node changes and collection writes together, in one undo step', async () => {
    const result = await call('signage_name_and_group_level', { levelId: 'level_ground' })
    expect(result.isError).toBeFalsy()
    expect(levelName()).toBe('Signed')
    expect(bridge.getCollections()).toMatchObject({ [signs.id]: signs })
    expect(bridge.undo()).toBe(1)
    expect(levelName()).toBe('Ground')
    expect(bridge.getCollections()).not.toHaveProperty(signs.id)
  })

  test('runs a follow-up planned after reconcile even with no changes before it', async () => {
    const result = await call('signage_name_after_reconcile', { levelId: 'level_ground' })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ settled: true, levelSeen: true })
    expect(levelName()).toBe('Reconciled')
    expect(bridge.undo()).toBe(1)
    expect(levelName()).toBe('Ground')
  })

  test('answers a refusal with its code and leaves the scene as it was', async () => {
    const result = await call('signage_name_level', { levelId: 'level_attic', name: 'Attic' })
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ code: 'level_not_found' })
    expect(levelName()).toBe('Ground')
  })

  test("rejects input the plugin's contract does not parse", async () => {
    const result = await call('signage_name_level', { levelId: 'level_ground', name: '' })
    expect(result.isError).toBe(true)
    expect(levelName()).toBe('Ground')
  })
})
