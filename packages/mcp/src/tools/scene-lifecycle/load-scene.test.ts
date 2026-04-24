import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerLoadScene } from './load-scene'
import { InMemorySceneStore, parseToolText, type StoredTextContent } from './test-utils'

describe('load_scene', () => {
  let client: Client
  let bridge: SceneBridge
  let store: InMemorySceneStore

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    store = new InMemorySceneStore()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerLoadScene(server, bridge, store)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('loads a stored scene and returns its SceneMeta', async () => {
    const graph = {
      nodes: {
        root_a: { id: 'root_a', type: 'site', parentId: null, children: [] },
      },
      rootNodeIds: ['root_a'],
    } as unknown as SceneGraph
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
    expect(bridge.getRootNodeIds()).toContain('root_a')
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
