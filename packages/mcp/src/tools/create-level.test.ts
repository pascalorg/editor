import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { registerCreateLevel } from './create-level'

describe('create_level', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCreateLevel(server, createSceneOperations({ bridge }))
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('creates a level on a building', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')
    if (!building) throw new Error('expected a building node')
    const result = await client.callTool({
      name: 'create_level',
      arguments: { buildingId: building.id, elevation: 3, label: 'Second' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]?.text ?? '')
    expect(parsed.levelId).toMatch(/^level_/)
    const created = bridge.getNode(parsed.levelId)
    expect(created).not.toBeNull()
    if (!created) return
    expect(created.type).toBe('level')
    expect((created as { level: number }).level).toBe(3)
  })

  test('rejects unknown building id', async () => {
    const result = await client.callTool({
      name: 'create_level',
      arguments: { buildingId: 'building_nope' },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects non-building parent', async () => {
    const wallLike = Object.values(bridge.getNodes()).find((n) => n.type === 'level')
    if (!wallLike) throw new Error('expected a wallLike node')
    const result = await client.callTool({
      name: 'create_level',
      arguments: { buildingId: wallLike.id },
    })
    expect(result.isError).toBe(true)
  })
})
