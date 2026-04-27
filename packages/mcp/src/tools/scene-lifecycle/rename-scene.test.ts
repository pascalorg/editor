import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { registerRenameScene } from './rename-scene'
import {
  createTestSceneOperations,
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from './test-utils'

const emptyGraph: SceneGraph = { nodes: {}, rootNodeIds: [] }

describe('rename_scene', () => {
  let client: Client
  let store: InMemorySceneStore

  beforeEach(async () => {
    store = new InMemorySceneStore()
    const { operations } = createTestSceneOperations({ store })
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerRenameScene(server, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('renames a scene and returns the new SceneMeta', async () => {
    await store.save({ id: 'to-rename', name: 'Old Name', graph: emptyGraph })

    const result = await client.callTool({
      name: 'rename_scene',
      arguments: { id: 'to-rename', newName: 'Brand New Name' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = parseToolText(result.content as StoredTextContent[])
    expect(parsed.id).toBe('to-rename')
    expect(parsed.name).toBe('Brand New Name')
    expect(parsed.version).toBe(2)
  })

  test('throws scene_not_found for missing ids', async () => {
    const result = await client.callTool({
      name: 'rename_scene',
      arguments: { id: 'ghost', newName: 'Does Not Matter' },
    })
    expect(result.isError).toBe(true)
  })

  test('throws version_conflict when expectedVersion mismatches', async () => {
    await store.save({ id: 'locked-name', name: 'Stable', graph: emptyGraph })

    const result = await client.callTool({
      name: 'rename_scene',
      arguments: {
        id: 'locked-name',
        newName: 'Attempted',
        expectedVersion: 42,
      },
    })
    expect(result.isError).toBe(true)
  })
})
