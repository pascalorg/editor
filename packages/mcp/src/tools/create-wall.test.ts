import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import type { SceneMeta, SceneStore } from '../storage/types'
import { registerCreateWall } from './create-wall'

describe('create_wall', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCreateWall(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('creates a wall with custom thickness', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_wall',
      arguments: {
        levelId: level.id,
        start: [0, 0],
        end: [4, 0],
        thickness: 0.15,
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.wallId).toMatch(/^wall_/)
    const created = bridge.getNode(parsed.wallId)
    expect(created).not.toBeNull()
    expect((created as { thickness?: number }).thickness).toBe(0.15)
  })

  test('publishes a live scene snapshot when bound to a saved scene', async () => {
    const now = new Date().toISOString()
    const savedMeta: SceneMeta = {
      id: 'live-scene',
      name: 'Live Scene',
      projectId: null,
      thumbnailUrl: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ownerId: null,
      sizeBytes: 0,
      nodeCount: Object.keys(bridge.getNodes()).length,
    }
    const savedGraphs: SceneGraph[] = []
    const eventKinds: string[] = []
    const store: SceneStore = {
      backend: 'sqlite',
      async save(opts) {
        expect(opts.id).toBe(savedMeta.id)
        expect(opts.expectedVersion).toBe(1)
        savedGraphs.push(opts.graph)
        return {
          ...savedMeta,
          version: 2,
          updatedAt: new Date().toISOString(),
          sizeBytes: JSON.stringify(opts.graph).length,
          nodeCount: Object.keys(opts.graph.nodes).length,
        }
      },
      async load() {
        return null
      },
      async list() {
        return []
      },
      async delete() {
        return false
      },
      async rename() {
        return savedMeta
      },
      async appendSceneEvent(opts) {
        eventKinds.push(opts.kind)
        return {
          eventId: 1,
          sceneId: opts.sceneId,
          version: opts.version,
          kind: opts.kind,
          createdAt: new Date().toISOString(),
          graph: opts.graph,
        }
      },
    }
    const liveServer = new McpServer({ name: 'test-live', version: '0.0.0' })
    const liveClient = new Client({ name: 'test-live-client', version: '0.0.0' })
    const operations = createSceneOperations({ bridge, store })
    operations.setActiveScene(savedMeta)
    registerCreateWall(liveServer, operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    await Promise.all([liveServer.connect(srvT), liveClient.connect(cliT)])

    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await liveClient.callTool({
      name: 'create_wall',
      arguments: {
        levelId: level.id,
        start: [0, 1],
        end: [4, 1],
      },
    })

    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(savedGraphs).toHaveLength(1)
    expect(savedGraphs[0]!.nodes[parsed.wallId]).toBeDefined()
    expect(eventKinds).toEqual(['create_wall'])
    expect(bridge.getActiveScene()?.version).toBe(2)
  })

  test('rejects unknown level id', async () => {
    const result = await client.callTool({
      name: 'create_wall',
      arguments: {
        levelId: 'level_nope',
        start: [0, 0],
        end: [1, 0],
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects invalid start tuple', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'create_wall',
      arguments: {
        levelId: level.id,
        start: [0],
        end: [1, 0],
      },
    })
    expect(result.isError).toBe(true)
  })
})
