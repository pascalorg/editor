import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { SlabNode, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerPaintSurfaces } from './paint-surfaces'

type Payload = {
  painted: string[]
  skipped: Array<{ nodeId: string; reason: string }>
}

const slotsOf = (bridge: SceneBridge, id: string) =>
  (bridge.getNode(id as AnyNodeId) as { slots?: Record<string, string> } | null)?.slots

describe('paint_surfaces', () => {
  let client: Client
  let bridge: SceneBridge
  let levelId: AnyNodeId
  let wallId: string
  let slabId: string

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id

    wallId = bridge.createNode(
      WallNode.parse({ parentId: levelId, start: [0, 0], end: [4, 0] }) as AnyNode,
      levelId,
    ) as string
    slabId = bridge.createNode(
      SlabNode.parse({
        parentId: levelId,
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      }) as AnyNode,
      levelId,
    ) as string

    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerPaintSurfaces(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  async function call(args: Record<string, unknown>): Promise<Payload> {
    const result = await client.callTool({ name: 'paint_surfaces', arguments: args })
    return JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text) as Payload
  }

  test('writes the material into the named slot', async () => {
    const payload = await call({
      nodeIds: [wallId],
      slotId: 'interior',
      material: 'library:metal-chrome',
    })

    expect(payload.painted).toEqual([wallId])
    expect(slotsOf(bridge, wallId)?.interior).toBe('library:metal-chrome')
  })

  test('paints several nodes of different kinds in one call', async () => {
    const payload = await call({
      nodeIds: [wallId, slabId],
      slotId: 'surface',
      material: '#ff8800',
    })

    // A wall has no `surface` slot; the slab does. One skips, one paints.
    expect(payload.painted).toEqual([slabId])
    expect(payload.skipped[0]?.nodeId).toBe(wallId)
    expect(slotsOf(bridge, slabId)?.surface).toBe('#ff8800')
  })

  test('leaves slots it was not asked about alone', async () => {
    await call({ nodeIds: [wallId], slotId: 'interior', material: '#111111' })
    await call({ nodeIds: [wallId], slotId: 'exterior', material: '#222222' })

    expect(slotsOf(bridge, wallId)).toEqual({ interior: '#111111', exterior: '#222222' })
  })

  // The reason the tool validates instead of passing the id through: a wrong
  // slot id through `apply_patch` is stored and renders as nothing.
  test('names the valid surfaces when the slot id is wrong', async () => {
    const payload = await call({
      nodeIds: [wallId],
      slotId: 'ceiling',
      material: '#ffffff',
    })

    expect(payload.painted).toHaveLength(0)
    expect(payload.skipped[0]?.reason).toContain('interior')
    expect(slotsOf(bridge, wallId)).toBeUndefined()
  })

  test('rejects a catalog ref that does not exist', async () => {
    await expect(
      call({ nodeIds: [wallId], slotId: 'interior', material: 'library:not-a-material' }),
    ).rejects.toThrow()
    expect(slotsOf(bridge, wallId)).toBeUndefined()
  })

  test('rejects a string that is not a material at all', async () => {
    await expect(
      call({ nodeIds: [wallId], slotId: 'interior', material: 'walnut' }),
    ).rejects.toThrow()
  })

  // Unverifiable here — the scene palette lives in the editor — so it must pass
  // through rather than be rejected as unknown.
  test('accepts a scene palette ref', async () => {
    const payload = await call({
      nodeIds: [wallId],
      slotId: 'interior',
      material: 'scene:mat_custom',
    })

    expect(payload.painted).toEqual([wallId])
    expect(slotsOf(bridge, wallId)?.interior).toBe('scene:mat_custom')
  })

  test('reports a missing node instead of failing the whole batch', async () => {
    const payload = await call({
      nodeIds: [wallId, 'wall_nope'],
      slotId: 'interior',
      material: '#ffffff',
    })

    expect(payload.painted).toEqual([wallId])
    expect(payload.skipped).toEqual([{ nodeId: 'wall_nope', reason: 'not found' }])
  })
})
