import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  type SceneMaterial,
  SiteNode,
  WallNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { registerSharedTools } from './shared-tools'

// paint through a real client: the operation's scene material reaches the bridge with the nodes
// that use it, in one history step, and is saved with the scene.

type Result = { isError?: boolean; content: Array<{ type: string; text?: string }> }

const TIMBER = { preset: 'custom', properties: { color: '#71503a', roughness: 0.86, metalness: 0 } }

/** Two walls of a room, on one level. */
function scene() {
  const walls = [
    WallNode.parse({ id: 'wall_south', parentId: 'level_m', start: [0, 0], end: [6, 0] }),
    WallNode.parse({ id: 'wall_east', parentId: 'level_m', start: [6, 0], end: [6, 4] }),
  ]
  const nodes: AnyNode[] = [
    SiteNode.parse({ id: 'site_m', children: ['building_m'] }),
    BuildingNode.parse({ id: 'building_m', parentId: 'site_m', children: ['level_m'] }),
    LevelNode.parse({
      id: 'level_m',
      parentId: 'building_m',
      level: 0,
      children: walls.map((wall) => wall.id),
    }),
    ...walls,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

let bridge: SceneBridge
let client: Client
let server: McpServer

const materials = () => bridge.getMaterials() as Record<string, SceneMaterial>
const slotsOf = (id: string) => (bridge.getNodes()[id as AnyNodeId] as WallNode).slots ?? {}

async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as Result
  const text = result.content.find((entry) => entry.type === 'text')?.text ?? ''
  return { isError: !!result.isError, payload: result.isError ? { text } : JSON.parse(text) }
}

beforeEach(async () => {
  bridge = new SceneBridge()
  bridge.setScene(scene(), ['site_m' as AnyNodeId], { materials: {} })
  bridge.clearHistory()
  server = new McpServer({ name: 'paint', version: '1' })
  registerSharedTools(server, createSceneOperations({ bridge }))
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'paint', version: '1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})

afterEach(async () => {
  await client.close()
  await server.close()
})

describe('paint over the MCP', () => {
  test('a native material is kept with the wall that uses it, in one undo step', async () => {
    const before = bridge.exportJSON()
    const painted = await call('paint', {
      targets: ['wall_south'],
      role: 'b',
      material: TIMBER,
      materialName: 'Warm timber',
    })
    expect(painted.isError).toBe(false)
    const ref = slotsOf('wall_south').b!
    expect(painted.payload).toMatchObject({ ok: true, finish: ref, achieved: { updated: 1 } })
    const id = ref.slice('scene:'.length)
    expect(materials()[id]).toMatchObject({ name: 'Warm timber', material: TIMBER })

    const read = await call('get_node', { id: 'wall_south' })
    expect(read.payload).toMatchObject({
      node: { slots: { b: ref } },
      materials: { [id]: { material: TIMBER } },
    })

    const after = bridge.exportJSON()
    expect(bridge.getHistory()).toEqual({ pastCount: 1, futureCount: 0 })
    expect(bridge.undo()).toBe(1)
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.redo()).toBe(1)
    expect(bridge.exportJSON()).toEqual(after)

    bridge.setScene({}, [], { materials: {} })
    bridge.loadJSON(JSON.stringify(after))
    expect(slotsOf('wall_south').b).toBe(ref)
    expect(materials()[id]).toMatchObject({ material: TIMBER })
  })

  test('the next call reuses the material rather than keep a second', async () => {
    await call('paint', { targets: ['wall_south'], role: 'b', material: TIMBER })
    await call('paint', { targets: ['wall_east'], role: 'b', material: TIMBER })
    expect(slotsOf('wall_east').b).toBe(slotsOf('wall_south').b)
    expect(Object.keys(materials())).toHaveLength(1)
  })

  test('a refused call leaves the scene, its materials and its history as they were', async () => {
    const before = bridge.exportJSON()
    for (const args of [
      { targets: ['wall_south', 'wall_gone'], role: 'b', material: TIMBER },
      { targets: ['wall_south'], role: 'b', material: 'scene:mat_missing' },
      { targets: ['wall_south'], role: 'b', material: { properties: { roughness: 2 } } },
    ]) {
      expect((await call('paint', args)).isError).toBe(true)
      expect(bridge.exportJSON()).toEqual(before)
      expect(bridge.getHistory()).toEqual({ pastCount: 0, futureCount: 0 })
    }
  })

  test('search_materials finds the library ref paint takes', async () => {
    const found = await call('search_materials', { queries: [{ query: 'white render' }] })
    const ref = found.payload.groups[0].results[0].ref as string
    expect(ref).toMatch(/^library:/)
    expect((await call('paint', { targets: ['wall_south'], material: ref })).isError).toBe(false)
    expect(slotsOf('wall_south')).toEqual({ a: ref, b: ref })
  })
})
