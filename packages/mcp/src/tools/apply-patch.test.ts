import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LevelNode, SlabNode, StairNode, StairSegmentNode, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerApplyPatch } from './apply-patch'

describe('apply_patch', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerApplyPatch(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('applies a batch of create + update', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })

    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: wall, parentId: level.id },
          { op: 'update', id: wall.id, data: { thickness: 0.2 } },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.appliedOps).toBe(2)
    expect(parsed.createdIds).toContain(wall.id)
    // Wait a tick for RAF-scheduled dirty-marking to settle.
    await new Promise((r) => setTimeout(r, 10))
    const stored = bridge.getNode(wall.id)
    expect(stored).not.toBeNull()
    expect((stored as { thickness?: number }).thickness).toBe(0.2)
  })

  test('syncs derived stair openings after stair patches', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const ground = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const upper = LevelNode.parse({ name: 'Upper Floor', level: 1 })
    const upperSlab = SlabNode.parse({
      name: 'Upper Floor Slab',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    const segment = StairSegmentNode.parse({
      width: 1,
      length: 2.6,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      name: 'Main Stair',
      position: [2, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      openingOffset: 0.1,
      children: [segment.id],
    })

    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: upper, parentId: building.id },
          { op: 'create', node: upperSlab, parentId: upper.id },
          { op: 'create', node: stair, parentId: ground.id },
          { op: 'create', node: segment, parentId: stair.id },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    const slab = bridge.getNode(upperSlab.id)
    expect(slab?.type).toBe('slab')
    if (slab?.type !== 'slab') return
    expect(slab.holes).toHaveLength(1)
    expect(slab.holeMetadata[0]).toEqual({ source: 'stair', stairId: stair.id })
  })

  test('rejects update to a non-existent node', async () => {
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [{ op: 'update', id: 'wall_none', data: { thickness: 0.1 } }],
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects malformed patch shape', async () => {
    const result = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [{ op: 'nope', garbage: true } as unknown as object],
      },
    })
    expect(result.isError).toBe(true)
  })
})
