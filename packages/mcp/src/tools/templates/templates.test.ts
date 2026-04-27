import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../../bridge/scene-bridge'
import { createSceneOperations } from '../../operations'
import {
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from '../scene-lifecycle/test-utils'
import { registerCreateFromTemplate } from './create-from-template'
import { registerListTemplates } from './list-templates'

describe('list_templates', () => {
  let client: Client

  beforeEach(async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerListTemplates(server)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('enumerates all three seed templates', async () => {
    const result = await client.callTool({ name: 'list_templates', arguments: {} })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    const list = parsed.templates as Array<{
      id: string
      name: string
      description: string
      nodeCount: number
    }>
    const ids = list.map((t) => t.id).sort()
    expect(ids).toEqual(['empty-studio', 'garden-house', 'two-bedroom'])
    for (const t of list) {
      expect(typeof t.name).toBe('string')
      expect(t.name.length).toBeGreaterThan(0)
      expect(typeof t.description).toBe('string')
      expect(t.nodeCount).toBeGreaterThan(0)
    }
  })

  test('returns structuredContent matching the text payload', async () => {
    const result = await client.callTool({ name: 'list_templates', arguments: {} })
    expect(result.structuredContent).toBeDefined()
    const structured = result.structuredContent as { templates: Array<{ id: string }> }
    expect(structured.templates.length).toBe(3)
  })
})

describe('create_from_template', () => {
  let client: Client
  let bridge: SceneBridge
  let store: InMemorySceneStore

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    store = new InMemorySceneStore()
    const operations = createSceneOperations({ bridge, store })
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCreateFromTemplate(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('applies a template to the bridge with fresh ids', async () => {
    const result = await client.callTool({
      name: 'create_from_template',
      arguments: { id: 'empty-studio' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.templateId).toBe('empty-studio')
    expect((parsed.rootNodeIds as string[]).length).toBeGreaterThan(0)
    expect(parsed.nodeCount as number).toBeGreaterThan(0)

    // Fresh ids — placeholder "site_empty" should not appear.
    const bridgeNodes = Object.keys(bridge.getNodes())
    expect(bridgeNodes).not.toContain('site_empty')
    expect(bridgeNodes.length).toBeGreaterThan(0)

    // Root id from the tool response should exist in the bridge.
    for (const rid of parsed.rootNodeIds as string[]) {
      expect(bridge.getNode(rid as any)).not.toBeNull()
    }
  })

  test('rejects unknown template ids', async () => {
    const result = await client.callTool({
      name: 'create_from_template',
      arguments: { id: 'not-a-template' },
    })
    expect(result.isError).toBe(true)
  })

  test('saves to the store when save: true', async () => {
    const result = await client.callTool({
      name: 'create_from_template',
      arguments: { id: 'two-bedroom', save: true, name: 'My flat' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.scene).toBeDefined()
    const scene = parsed.scene as { id: string; name: string; url: string; nodeCount: number }
    expect(scene.name).toBe('My flat')
    expect(scene.url).toBe(`/scene/${scene.id}`)
    expect(scene.nodeCount).toBeGreaterThan(0)

    // Confirm the store actually holds it.
    const loaded = await store.load(scene.id)
    expect(loaded).not.toBeNull()
  })

  test('two invocations produce disjoint id sets', async () => {
    const a = await client.callTool({
      name: 'create_from_template',
      arguments: { id: 'empty-studio' },
    })
    const idsA = (parseToolText(a.content as StoredTextContent[]).rootNodeIds as string[]).sort()
    const b = await client.callTool({
      name: 'create_from_template',
      arguments: { id: 'empty-studio' },
    })
    const idsB = (parseToolText(b.content as StoredTextContent[]).rootNodeIds as string[]).sort()
    for (const id of idsA) {
      expect(idsB).not.toContain(id)
    }
  })
})

describe('create_from_template without a store', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    const operations = createSceneOperations({ bridge })
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    // No store in operations → save should be gracefully skipped.
    registerCreateFromTemplate(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('applies a template without erroring when no store is wired', async () => {
    const result = await client.callTool({
      name: 'create_from_template',
      arguments: { id: 'garden-house' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.templateId).toBe('garden-house')
  })

  test('save:true is a no-op but still succeeds without a store', async () => {
    const result = await client.callTool({
      name: 'create_from_template',
      arguments: { id: 'garden-house', save: true },
    })
    // Does not error; no `scene` field is returned because there is no store.
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.scene).toBeUndefined()
  })
})
