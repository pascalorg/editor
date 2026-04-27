import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerSaveScene } from './save-scene'
import {
  createTestSceneOperations,
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from './test-utils'

describe('save_scene', () => {
  let client: Client
  let bridge: SceneBridge
  let store: InMemorySceneStore

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    store = new InMemorySceneStore()
    const { operations } = createTestSceneOperations({ bridge, store })
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSaveScene(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('saves the current scene and returns SceneMeta with url', async () => {
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'My Scene' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.name).toBe('My Scene')
    expect(typeof parsed.id).toBe('string')
    expect(parsed.version).toBe(1)
    expect(parsed.url).toBe(`/scene/${parsed.id}`)
    expect(parsed.nodeCount).toBeGreaterThan(0)
  })

  test('saves a provided graph when includeCurrentScene is false', async () => {
    // The graph is now re-validated against AnyNode at the save boundary
    // (security fix from Phase 8 P4). Use a schema-compliant site node id
    // that matches `site_*`.
    const siteId = 'site_provided01'
    const graph = {
      nodes: {
        [siteId]: {
          object: 'node',
          id: siteId,
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          polygon: {
            type: 'polygon',
            points: [
              [-5, -5],
              [5, -5],
              [5, 5],
              [-5, 5],
            ],
          },
          children: [],
        },
      },
      rootNodeIds: [siteId],
    }
    const result = await client.callTool({
      name: 'save_scene',
      arguments: {
        name: 'From Graph',
        includeCurrentScene: false,
        graph,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.name).toBe('From Graph')
    expect(parsed.nodeCount).toBe(1)
  })

  test('rejects a graph with a malicious URL (P4 security fix)', async () => {
    const siteId = 'site_evil0000001'
    const itemId = 'item_evil0000001'
    const graph = {
      nodes: {
        [siteId]: {
          object: 'node',
          id: siteId,
          type: 'site',
          parentId: null,
          visible: true,
          metadata: {},
          polygon: {
            type: 'polygon',
            points: [
              [-5, -5],
              [5, -5],
              [5, 5],
              [-5, 5],
            ],
          },
          children: [],
        },
        [itemId]: {
          object: 'node',
          id: itemId,
          type: 'item',
          parentId: null,
          visible: true,
          metadata: {},
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          asset: {
            id: 'evil',
            name: 'evil',
            category: 'x',
            src: 'javascript:alert(1)',
            dimensions: [1, 1, 1],
            offset: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          children: [],
        },
      },
      rootNodeIds: [siteId],
    }
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'Evil', includeCurrentScene: false, graph },
    })
    expect(result.isError).toBe(true)
  })

  test('errors when includeCurrentScene is false and no graph is provided', async () => {
    const result = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'No Graph', includeCurrentScene: false },
    })
    expect(result.isError).toBe(true)
  })

  test('returns version_conflict when expectedVersion mismatches', async () => {
    const first = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'Original' },
    })
    const parsed = parseToolText(first.content as StoredTextContent[])
    const result = await client.callTool({
      name: 'save_scene',
      arguments: {
        id: parsed.id as string,
        name: 'Second',
        expectedVersion: 99,
      },
    })
    expect(result.isError).toBe(true)
  })
})
