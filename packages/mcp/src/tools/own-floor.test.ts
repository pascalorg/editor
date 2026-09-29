import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

test('set_zone_intent exposes own floors, construction edits, and a clear conversion refusal', async () => {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'own-floor', version: '1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, JSON.stringify(result)).toBeFalsy()
      const payload = result.structuredContent as Record<string, unknown>
      expect(payload.conflicts ?? []).toEqual([])
      return payload
    }
    const levelId = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!.id
    const room = await call('create_room', {
      levelId,
      name: 'House',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ],
    })
    await call('divide_zone', {
      zoneId: room.zoneId,
      path: [
        [6, 0],
        [6, 4],
      ],
    })
    const zoneId = Object.values(bridge.getNodes()).find(
      (node) => node.type === 'zone' && node.polygon.every(([x]) => x >= 6),
    )!.id
    await call('set_zone_intent', { zoneId, patch: { name: 'Lanai', floor: { footprint: 'new' } } })
    const keyed = bridge.getNode(zoneId)
    expect(keyed?.type === 'zone' && keyed.floor?.footprint).toStartWith('floor_')
    expect(
      Object.values(bridge.getNodes()).filter(
        (node) => node.type === 'slab' && node.plateRole === 'base',
      ),
    ).toHaveLength(2)
    await call('set_room_floor_construction', { zoneId, patch: { floorHeight: 0.3 } })
    await call('set_zone_intent', { zoneId, patch: { floor: { elevation: 0.4 } } })
    const read = await call('get_zones', { levelId })
    const rooms = read.zones as Array<{
      id: string
      floor_choices: Array<{ key: string | null; current: boolean }>
    }>
    expect(
      rooms
        .find((room) => room.id === zoneId)
        ?.floor_choices.some((choice) => choice.current && choice.key?.startsWith('floor_')),
    ).toBe(true)
    const refused = await client.callTool({
      name: 'set_zone_intent',
      arguments: { zoneId, patch: { floor: { footprint: 'missing-floor' } } },
    })
    expect(JSON.stringify(refused)).toContain('Choose an existing floor key')
    const largerId = Object.values(bridge.getNodes()).find(
      (node) => node.type === 'zone' && node.id !== zoneId,
    )!.id
    const key = keyed?.type === 'zone' ? keyed.floor!.footprint! : ''
    expect(key).toEndWith(`:${zoneId}`)
    await call('set_zone_intent', {
      zoneId: largerId,
      patch: { name: 'Living room', floor: { footprint: key } },
    })
    for (const tool of ['get_zones', 'get_level_summary']) {
      const result = await call(tool, { levelId })
      for (const room of result.zones as Array<{ floor_choices: unknown[] }>)
        expect(room.floor_choices[0]).toMatchObject({ key, name: 'Lanai floor', current: true })
    }
  } finally {
    await client.close()
    await server.close()
  }
})
