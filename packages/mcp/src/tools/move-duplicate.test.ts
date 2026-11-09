import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { duplicateNodeTool, moveNodeTool } from '@pascal-app/core/agent-tools'
import { DoorNode, LevelNode, WallNode, WindowNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerSharedTools } from './shared-tools'

/** One level, one 6 m wall carrying a door at 1 m and a window at 3 m. */
function wallScene() {
  const level = LevelNode.parse({ id: 'level_move' })
  const wall = WallNode.parse({
    id: 'wall_move',
    parentId: level.id,
    start: [0, 0],
    end: [6, 0],
    thickness: 0.2,
    height: 2.5,
    children: ['door_move', 'window_move'],
  })
  const door = DoorNode.parse({
    id: 'door_move',
    parentId: wall.id,
    wallId: wall.id,
    position: [1, 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const win = WindowNode.parse({
    id: 'window_move',
    parentId: wall.id,
    wallId: wall.id,
    position: [3, 1.25, 0],
    width: 1.2,
    height: 1.0,
  })
  return [level, wall, door, win]
}

async function withWall(run: (client: Client, bridge: SceneBridge) => Promise<void>) {
  const nodes = wallScene()
  const bridge = new SceneBridge()
  bridge.setScene(Object.fromEntries(nodes.map((node) => [node.id, node])), ['level_move'])
  bridge.clearHistory()
  const server = new McpServer({ name: 'move-duplicate-test', version: '0.0.0' })
  registerSharedTools(server, bridge)
  const client = new Client({ name: 'move-duplicate-client', version: '0.0.0' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    await run(client, bridge)
  } finally {
    await client.close()
    await server.close()
  }
}

describe('move_node and duplicate_node over MCP', () => {
  test('both register under the shared contracts, as scene writes', async () => {
    await withWall(async (client) => {
      const tools = (await client.listTools()).tools
      const move = tools.find((tool) => tool.name === 'move_node')
      const duplicate = tools.find((tool) => tool.name === 'duplicate_node')
      expect(move?.description).toBe(moveNodeTool.description)
      expect(duplicate?.description).toBe(duplicateNodeTool.description)
      // A move overwrites an existing seat (destructive, like move_zone); a copy only adds.
      expect(move?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
      expect(duplicate?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    })
  })

  test('move_node slides the door along its wall and the scene holds the seat', async () => {
    await withWall(async (client, bridge) => {
      const result = await client.callTool({
        name: 'move_node',
        arguments: { id: 'door_move', by: [0.5, 0] },
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({
        id: 'door_move',
        host: 'wall',
        hostId: 'wall_move',
        position: [1.5, 1.05, 0],
        clamped: false,
      })
      const door = bridge.getNodes().door_move as DoorNode
      expect(door.position).toEqual([1.5, 1.05, 0])
      expect(bridge.getHistory().pastCount).toBe(1)
    })
  })

  test('move_node onto the window answers the core refusal, coded', async () => {
    await withWall(async (client, bridge) => {
      const before = structuredClone(bridge.getNodes())
      const result = await client.callTool({
        name: 'move_node',
        arguments: { id: 'door_move', to: [3, 0] },
      })
      expect(result.isError).toBeTruthy()
      const text = result.content.find((part) => part.type === 'text')
      if (text?.type !== 'text') throw new Error('Expected the refusal as text')
      expect(JSON.parse(text.text)).toMatchObject({ code: 'opening_overlap' })
      expect(bridge.getNodes()).toEqual(before)
    })
  })

  test('duplicate_node copies the wall with its openings onto fresh ids', async () => {
    await withWall(async (client, bridge) => {
      const result = await client.callTool({
        name: 'duplicate_node',
        arguments: { ids: ['wall_move'], offset: [0, 3] },
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({ totalCreated: 3, skippedIds: [] })
      const copies = result.structuredContent?.copies as { copyId: string }[]
      const wallCopy = bridge.getNodes()[copies[0]?.copyId ?? ''] as WallNode
      expect(wallCopy.start).toEqual([0, 3])
      expect(wallCopy.children).toHaveLength(2)
      for (const childId of wallCopy.children) {
        const child = bridge.getNodes()[childId] as DoorNode
        expect(child.parentId).toBe(wallCopy.id)
        expect(child.wallId).toBe(wallCopy.id)
      }
    })
  })
})
