import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { registerListScenes } from './list-scenes'
import { InMemorySceneStore, parseToolText, type StoredTextContent } from './test-utils'

const emptyGraph: SceneGraph = { nodes: {}, rootNodeIds: [] }

describe('list_scenes', () => {
  let client: Client
  let store: InMemorySceneStore

  beforeEach(async () => {
    store = new InMemorySceneStore()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerListScenes(server, store)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('returns all saved scenes by default', async () => {
    await store.save({ id: 'a', name: 'A', graph: emptyGraph })
    await store.save({ id: 'b', name: 'B', graph: emptyGraph })

    const result = await client.callTool({
      name: 'list_scenes',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    const scenes = parsed.scenes as unknown[]
    expect(scenes).toHaveLength(2)
  })

  test('filters by projectId', async () => {
    await store.save({ id: 'a', name: 'A', projectId: 'p1', graph: emptyGraph })
    await store.save({ id: 'b', name: 'B', projectId: 'p2', graph: emptyGraph })

    const result = await client.callTool({
      name: 'list_scenes',
      arguments: { projectId: 'p1' },
    })
    const parsed = parseToolText(result.content as StoredTextContent[])
    const scenes = parsed.scenes as { id: string }[]
    expect(scenes).toHaveLength(1)
    expect(scenes[0]!.id).toBe('a')
  })

  test('rejects non-positive limit per schema', async () => {
    const result = await client.callTool({
      name: 'list_scenes',
      arguments: { limit: 0 },
    })
    expect(result.isError).toBe(true)
  })

  test('caps results with limit', async () => {
    await store.save({ id: 'a', name: 'A', graph: emptyGraph })
    await store.save({ id: 'b', name: 'B', graph: emptyGraph })
    await store.save({ id: 'c', name: 'C', graph: emptyGraph })

    const result = await client.callTool({
      name: 'list_scenes',
      arguments: { limit: 2 },
    })
    const parsed = parseToolText(result.content as StoredTextContent[])
    const scenes = parsed.scenes as unknown[]
    expect(scenes).toHaveLength(2)
  })
})
