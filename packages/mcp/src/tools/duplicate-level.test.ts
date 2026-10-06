import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerRoomTools } from './room-tools'
import { registerSharedTools } from './shared-tools'

describe('duplicate_level', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerSharedTools(server, bridge)
    registerRoomTools(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('duplicates a level with its wall descendants', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [3, 0] })
    bridge.createNode(wall, level.id)

    const result = await client.callTool({
      name: 'duplicate_level',
      arguments: { levelId: level.id },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.newLevelId).toMatch(/^level_/)
    expect(parsed.newLevelId).not.toBe(level.id)
    expect(parsed.newNodeIds.length).toBeGreaterThanOrEqual(2)

    const newLevel = bridge.getNode(parsed.newLevelId)
    expect(newLevel).not.toBeNull()
    expect(newLevel!.type).toBe('level')
  })

  test('copies a level with automatic room surfaces and can undo the copy', async () => {
    const level = bridge.findNodes({ type: 'level' })[0]!
    const room = await client.callTool({
      name: 'create_room',
      arguments: {
        levelId: level.id,
        name: 'Room',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    })
    expect(room.isError).toBeFalsy()
    expect(bridge.findNodes({ type: 'ceiling' })[0]).toMatchObject({ boundary: 'auto' })
    bridge.clearHistory()
    const before = bridge.exportJSON()
    const result = await client.callTool({
      name: 'duplicate_level',
      arguments: { levelId: level.id },
    })
    expect(result.isError).toBeFalsy()
    const { newLevelId } = result.structuredContent as { newLevelId: string }
    expect(bridge.findNodes({ type: 'ceiling', levelId: newLevelId as never })).toHaveLength(1)
    expect(bridge.validateScene().valid).toBe(true)
    expect(bridge.undo(1)).toBe(1)
    expect(bridge.exportJSON()).toEqual(before)
  })

  test('rejects unknown id', async () => {
    const result = await client.callTool({
      name: 'duplicate_level',
      arguments: { levelId: 'level_nope' },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects non-level target', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const result = await client.callTool({
      name: 'duplicate_level',
      arguments: { levelId: building.id },
    })
    expect(result.isError).toBe(true)
  })
})
