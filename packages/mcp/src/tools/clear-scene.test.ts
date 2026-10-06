import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AGENT_TOOL_CONTRACTS } from '@pascal-app/core/agent-tools'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { type SceneMeta, type SceneStore, SceneWipeBlockedError } from '../storage/types'
import { registerApplyPatch } from './apply-patch'
import { registerClearScene } from './clear-scene'
import { registerCreateWall } from './create-wall'
import { registerCreateRoom } from './room-tools'
import { registerStructureTools } from './structure-tools'

// An agent that starts over clears the project on purpose; a write that would empty it by
// accident is refused, as the hosted store refuses it (the scaffold: a site, a building, a level).
const SCAFFOLD_NODE_COUNT = 4
const isWipe = (previous: number, next: number) =>
  previous > SCAFFOLD_NODE_COUNT && next <= SCAFFOLD_NODE_COUNT && previous - next > 1

/** A store keeping one scene, which refuses an accidental wipe as a hosted store does. */
function guardedStore(meta: SceneMeta) {
  let stored: SceneGraph | null = null
  const saves: { nodeCount: number; allowSceneWipe?: boolean }[] = []
  const store: SceneStore = {
    backend: 'sqlite',
    async save(opts) {
      const previous = Object.keys(stored?.nodes ?? {}).length
      const next = Object.keys(opts.graph.nodes).length
      if (stored && !opts.allowSceneWipe && isWipe(previous, next))
        throw new SceneWipeBlockedError()
      stored = opts.graph
      saves.push({ nodeCount: next, ...(opts.allowSceneWipe ? { allowSceneWipe: true } : {}) })
      return { ...meta, version: meta.version + saves.length, nodeCount: next }
    },
    async load() {
      return stored ? { ...meta, graph: stored } : null
    },
    async list() {
      return []
    },
    async delete() {
      return { deleted: false, hidden: false }
    },
    async rename() {
      return meta
    },
    async appendSceneEvent(opts) {
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
  return { store, saves, seed: (graph: SceneGraph) => (stored = graph) }
}

async function houseSession() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
  for (const [start, end] of [
    [
      [0, 0],
      [5, 0],
    ],
    [
      [5, 0],
      [5, 4],
    ],
    [
      [5, 4],
      [0, 4],
    ],
    [
      [0, 4],
      [0, 0],
    ],
  ] as const)
    bridge.createNode(WallNode.parse({ start: [...start], end: [...end] }), level.id)
  const meta: SceneMeta = {
    id: 'scene_house',
    name: 'House',
    projectId: 'project_house',
    thumbnailUrl: null,
    version: 1,
    createdAt: '2026-10-06T00:00:00Z',
    updatedAt: '2026-10-06T00:00:00Z',
    ownerId: null,
    sizeBytes: 0,
    nodeCount: Object.keys(bridge.getNodes()).length,
  }
  const guarded = guardedStore(meta)
  guarded.seed(bridge.exportJSON())
  const operations = createSceneOperations({ bridge, store: guarded.store })
  operations.setActiveScene(meta)
  const server = new McpServer({ name: 'clear', version: '0.0.0' })
  registerClearScene(server, operations)
  registerApplyPatch(server, operations)
  registerCreateWall(server, operations)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'clear-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    const text = (result.content as { type: string; text: string }[])[0]!.text
    return { isError: !!result.isError, body: JSON.parse(text) as Record<string, unknown> }
  }
  return { bridge, call, guarded, meta }
}

describe('clear_scene', () => {
  test('is one of the shared agent tools, named for a person', () => {
    const contract = AGENT_TOOL_CONTRACTS.find((tool) => tool.name === 'clear_scene')
    expect(contract?.title).toBe('Clear the project')
    expect(contract?.description).toContain('scene_wipe_blocked')
  })

  test('empties the project on purpose; the next write lands on the scaffold', async () => {
    const { bridge, call, guarded, meta } = await houseSession()
    // The walls and what they derived (the room, its floor and ceiling) go; the scaffold stays.
    const before = Object.keys(bridge.getNodes()).length
    const cleared = await call('clear_scene', { reason: 'The person asked to start over.' })
    expect(cleared.isError).toBe(false)
    expect(cleared.body.cleared).toEqual({ removed: before - 3 })
    expect(guarded.saves.at(-1)).toEqual({ nodeCount: 3, allowSceneWipe: true })

    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    expect((level as { height?: number }).height).toBe(2.5)
    const wall = await call('create_wall', { levelId: level.id, start: [0, 0], end: [3, 0] })
    expect(wall.isError).toBe(false)

    // A fresh session loads what was stored: the scaffold and the one new wall.
    const stored = await guarded.store.load(meta.id)
    const types = Object.values(stored!.graph.nodes).map((node) => (node as { type: string }).type)
    expect(types.sort()).toEqual(['building', 'level', 'site', 'wall'])
  })

  test('a write that would empty the project by accident is refused, and nothing changed', async () => {
    const { bridge, call, guarded } = await houseSession()
    const before = Object.keys(bridge.getNodes()).sort()
    const site = bridge.getRootNodeIds()[0]!
    const refused = await call('apply_patch', { patches: [{ op: 'delete', id: site }] })
    expect(refused.isError).toBe(true)
    expect(refused.body.code).toBe('scene_wipe_blocked')
    expect(String(refused.body.error)).toContain('nothing changed')
    expect(String(refused.body.error)).toContain('clear_scene')
    expect(guarded.saves).toEqual([])
    // The session holds the project as stored, not the refused write.
    expect(Object.keys(bridge.getNodes()).sort()).toEqual(before)
  })
})

// An agent deletes the only room it built: the store refuses the write as a wipe, and the session
// must not keep the deletion, or its next writes build on a scene the project does not hold.
describe('deleting the only room', () => {
  async function oneRoomSession() {
    const bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const meta: SceneMeta = {
      id: 'scene_room',
      name: 'Room',
      projectId: 'project_room',
      thumbnailUrl: null,
      version: 1,
      createdAt: '2026-10-06T00:00:00Z',
      updatedAt: '2026-10-06T00:00:00Z',
      ownerId: null,
      sizeBytes: 0,
      nodeCount: Object.keys(bridge.getNodes()).length,
    }
    const guarded = guardedStore(meta)
    guarded.seed(bridge.exportJSON())
    const operations = createSceneOperations({ bridge, store: guarded.store })
    operations.setActiveScene(meta)
    const server = new McpServer({ name: 'room', version: '0.0.0' })
    registerCreateRoom(server, operations)
    registerStructureTools(server, operations)
    registerCreateWall(server, operations)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'room-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      return {
        isError: !!result.isError,
        text: (result.content as { type: string; text: string }[])[0]!.text,
      }
    }
    const level = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!
    const room = await call('create_room', {
      levelId: level.id,
      name: 'Studio',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    expect(room.isError).toBe(false)
    return { bridge, call, guarded, meta, levelId: level.id, zoneId: JSON.parse(room.text).zoneId }
  }

  test('is refused as a wipe, the session keeps the room, and the next write matches the store', async () => {
    const { bridge, call, guarded, meta, levelId, zoneId } = await oneRoomSession()
    const before = Object.keys(bridge.getNodes()).sort()
    const saves = guarded.saves.length
    const refused = await call('delete_zone', { zoneId, contents: 'delete' })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('nothing changed')
    expect(refused.text).toContain('only room')
    expect(guarded.saves.length).toBe(saves)
    expect(Object.keys(bridge.getNodes()).sort()).toEqual(before)

    const wall = await call('create_wall', { levelId, start: [6, 0], end: [8, 0] })
    expect(wall.isError).toBe(false)
    const stored = await guarded.store.load(meta.id)
    expect(Object.keys(stored!.graph.nodes).sort()).toEqual(Object.keys(bridge.getNodes()).sort())
    expect(Object.keys(stored!.graph.nodes)).toContain(zoneId)
  })
})
