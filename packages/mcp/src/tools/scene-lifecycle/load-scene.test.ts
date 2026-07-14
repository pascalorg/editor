import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SiteNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerLoadScene } from './load-scene'
import {
  createTestSceneOperations,
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from './test-utils'

describe('load_scene', () => {
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
    registerLoadScene(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('loads a stored scene and returns its SceneMeta', async () => {
    const site = SiteNode.parse({ id: 'site_root', parentId: null, children: [] })
    const graph: SceneGraph = {
      nodes: { [site.id]: site },
      rootNodeIds: [site.id],
    }
    const meta = await store.save({ id: 'scene-one', name: 'One', graph })

    const result = await client.callTool({
      name: 'load_scene',
      arguments: { id: 'scene-one' },
    })

    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.id).toBe('scene-one')
    expect(parsed.name).toBe('One')
    expect(parsed.version).toBe(meta.version)
    expect(bridge.getRootNodeIds()).toContain(site.id)
  })

  test('throws scene_not_found when id is unknown', async () => {
    const result = await client.callTool({
      name: 'load_scene',
      arguments: { id: 'does-not-exist' },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects empty id per schema', async () => {
    const result = await client.callTool({
      name: 'load_scene',
      arguments: { id: '' },
    })
    expect(result.isError).toBe(true)
  })
})
