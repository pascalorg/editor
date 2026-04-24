import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { registerDeleteScene } from './delete-scene'
import { InMemorySceneStore, parseToolText, type StoredTextContent } from './test-utils'

const emptyGraph: SceneGraph = { nodes: {}, rootNodeIds: [] }

describe('delete_scene', () => {
  let client: Client
  let store: InMemorySceneStore

  beforeEach(async () => {
    store = new InMemorySceneStore()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerDeleteScene(server, store)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('deletes an existing scene and returns { deleted: true }', async () => {
    await store.save({ id: 'gone-in-60', name: 'Expendable', graph: emptyGraph })

    const result = await client.callTool({
      name: 'delete_scene',
      arguments: { id: 'gone-in-60' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.deleted).toBe(true)
    expect(await store.load('gone-in-60')).toBeNull()
  })

  test('throws scene_not_found when deleting an unknown id', async () => {
    const result = await client.callTool({
      name: 'delete_scene',
      arguments: { id: 'ghost' },
    })
    expect(result.isError).toBe(true)
  })

  test('throws version_conflict when expectedVersion mismatches', async () => {
    await store.save({ id: 'locked', name: 'Locked', graph: emptyGraph })

    const result = await client.callTool({
      name: 'delete_scene',
      arguments: { id: 'locked', expectedVersion: 99 },
    })
    expect(result.isError).toBe(true)
    // Still present after failed delete.
    expect(await store.load('locked')).not.toBeNull()
  })
})
