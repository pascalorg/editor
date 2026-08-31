import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations, type SceneOperations } from '../operations'
import type { SceneStore } from '../storage/types'
import { registerCreateWall } from './create-wall'
import { publishLiveSceneSnapshot } from './live-sync'
import {
  createTestSceneOperations,
  InMemorySceneStore,
  parseToolText,
  type StoredTextContent,
} from './scene-lifecycle/test-utils'

function createBridge(): SceneBridge {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  return bridge
}

/** InMemorySceneStore stripped of its scene-event methods. */
function withoutSceneEvents(base: InMemorySceneStore): SceneStore {
  return {
    backend: base.backend,
    save: (opts) => base.save(opts),
    load: (id) => base.load(id),
    list: (opts) => base.list(opts),
    delete: (id, opts) => base.delete(id, opts),
    rename: (id, newName, opts) => base.rename(id, newName, opts),
  }
}

async function connectCreateWall(operations: SceneOperations): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerCreateWall(server, operations)
  const [srvT, cliT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(srvT), client.connect(cliT)])
  return client
}

async function callCreateWall(
  client: Client,
  bridge: SceneBridge,
): Promise<Record<string, unknown>> {
  const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
  const result = await client.callTool({
    name: 'create_wall',
    arguments: { levelId: level.id, start: [0, 0], end: [4, 0] },
  })
  expect(result.isError).toBeFalsy()
  return parseToolText(result.content as StoredTextContent[])
}

describe('live sync persistence reporting', () => {
  test('warns unbound when no active scene is bound', async () => {
    const bridge = createBridge()
    const { store, operations } = createTestSceneOperations({ bridge })
    const client = await connectCreateWall(operations)

    const parsed = await callCreateWall(client, bridge)
    const persistence = parsed.persistence as { status: string; warning: string }
    expect(persistence.status).toBe('unbound')
    expect(typeof persistence.warning).toBe('string')
    expect(persistence.warning.length).toBeGreaterThan(0)
    expect(await store.listSceneEvents('scene_1')).toEqual([])
  })

  test('omits persistence and appends an event when publish succeeds', async () => {
    const bridge = createBridge()
    const { store, operations } = createTestSceneOperations({ bridge })
    const meta = await store.save({ name: 'Live Scene', graph: operations.exportSceneGraph() })
    operations.setActiveScene(meta)
    const client = await connectCreateWall(operations)

    const parsed = await callCreateWall(client, bridge)
    expect(parsed.persistence).toBeUndefined()
    const events = await store.listSceneEvents(meta.id)
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('create_wall')
    const saved = await store.load(meta.id)
    expect(saved!.version).toBe(meta.version + 1)
    expect(saved!.graph.nodes[parsed.wallId as string]).toBeDefined()
  })

  test('warns events_unsupported when the store lacks scene events', async () => {
    const bridge = createBridge()
    const base = new InMemorySceneStore()
    const operations = createSceneOperations({ bridge, store: withoutSceneEvents(base) })
    const meta = await base.save({ name: 'Live Scene', graph: operations.exportSceneGraph() })
    operations.setActiveScene(meta)
    const client = await connectCreateWall(operations)

    const parsed = await callCreateWall(client, bridge)
    const persistence = parsed.persistence as { status: string; warning: string }
    expect(persistence.status).toBe('events_unsupported')
    expect(typeof persistence.warning).toBe('string')
  })
})

describe('publishLiveSceneSnapshot', () => {
  test('returns unbound without an active scene', async () => {
    const { operations } = createTestSceneOperations({ bridge: createBridge() })
    expect(await publishLiveSceneSnapshot(operations, 'test')).toBe('unbound')
  })

  test('returns events_unsupported when the store lacks scene events', async () => {
    const base = new InMemorySceneStore()
    const operations = createSceneOperations({
      bridge: createBridge(),
      store: withoutSceneEvents(base),
    })
    const meta = await base.save({ name: 'Live Scene', graph: operations.exportSceneGraph() })
    operations.setActiveScene(meta)
    expect(await publishLiveSceneSnapshot(operations, 'test')).toBe('events_unsupported')
  })

  test('returns published when bound to an event-capable store', async () => {
    const { store, operations } = createTestSceneOperations({ bridge: createBridge() })
    const meta = await store.save({ name: 'Live Scene', graph: operations.exportSceneGraph() })
    operations.setActiveScene(meta)
    expect(await publishLiveSceneSnapshot(operations, 'test')).toBe('published')
    expect(await store.listSceneEvents(meta.id)).toHaveLength(1)
  })
})
