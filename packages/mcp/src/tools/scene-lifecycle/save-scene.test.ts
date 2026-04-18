import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerSaveScene } from './save-scene'
import { InMemorySceneStore, parseToolText, type StoredTextContent } from './test-utils'

describe('save_scene', () => {
  let client: Client
  let bridge: SceneBridge
  let store: InMemorySceneStore

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    store = new InMemorySceneStore()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSaveScene(server, bridge, store)
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
    const graph = {
      nodes: { root: { id: 'root', type: 'site', parentId: null, children: [] } },
      rootNodeIds: ['root'],
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
