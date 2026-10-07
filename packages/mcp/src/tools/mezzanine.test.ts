import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SceneBridge } from '../bridge/scene-bridge'
import { createPascalMcpServer } from '../server'

test('create_mezzanine validates, derives, edits and deletes through intent with one undo per call', async () => {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })
  const client = new Client({ name: 'mezzanine-contract', version: '1' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args })
      expect(response.isError, JSON.stringify(response)).toBeFalsy()
      return response.structuredContent as { zoneId: string }
    }
    const levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id
    const host = await call('create_room', {
      levelId,
      name: 'Host',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
    })
    const before = bridge.getNodes()
    bridge.clearHistory()
    const mezzanine = await call('create_mezzanine', {
      hostZoneId: host.zoneId,
      polygon: [
        [1, 1],
        [4, 1],
        [4, 3],
        [1, 3],
      ],
    })
    const nodes = bridge.getNodes()
    expect(nodes[host.zoneId]).toEqual(before[host.zoneId])
    expect(nodes[mezzanine.zoneId]).toMatchObject({
      hostZoneId: host.zoneId,
      floor: { support: 'open', thickness: 0.2 },
    })
    const plate = Object.values(nodes).find(
      (n) => n.type === 'slab' && n.zoneIds?.includes(mezzanine.zoneId),
    )!
    expect(plate).toMatchObject({ support: 'open' })
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNodes()).toEqual(before)
    bridge.redo()
    for (const command of ['set_zone_intent', 'delete_zone']) {
      const snapshot = bridge.getNodes()
      bridge.clearHistory()
      await call(
        command,
        command === 'set_zone_intent'
          ? {
              zoneId: mezzanine.zoneId,
              patch: {
                floor: { elevation: 1.8, thickness: 0.25, finish: 'wood' },
              },
            }
          : { zoneId: mezzanine.zoneId, contents: 'keep' },
      )
      expect(bridge.getHistory().pastCount).toBe(1)
      if (command === 'delete_zone') expect(bridge.getNodes()[plate.id]).toBeUndefined()
      else expect(bridge.getNodes()[plate.id]).toMatchObject({ elevation: 1.8, thickness: 0.25 })
      bridge.undo()
      expect(bridge.getNodes()).toEqual(snapshot)
    }
    const invalid = await client.callTool({
      name: 'create_mezzanine',
      arguments: {
        hostZoneId: host.zoneId,
        polygon: [
          [-1, 1],
          [3, 1],
          [3, 3],
          [-1, 3],
        ],
      },
    })
    expect(invalid.structuredContent).toMatchObject({
      changes: 0,
      conflicts: [{ code: 'outside-host' }],
    })
    const denied = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'update', id: plate.id, data: { railing: [] } }] },
    })
    expect(denied.isError).toBe(true)
  } finally {
    await client.close()
    await server.close()
  }
})

test('mezzanine MCP enforces immutable support and structured bounds, preserves lower furniture and copies/deletes stacked rooms', async () => {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const server = createPascalMcpServer({ bridge })
  const client = new Client({ name: 'mezzanine-audit', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args })
    expect(response.isError, JSON.stringify(response)).toBeFalsy()
    return response.structuredContent as {
      zoneId: string
      conflicts?: { code: string }[]
      changes: number
      idMap: Record<string, string[]>
    }
  }
  try {
    const levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id
    const host = await call('create_room', {
      levelId,
      name: 'Host',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
    })
    await call('apply_patch', {
      patches: [
        {
          op: 'create',
          node: {
            id: 'item_lower',
            type: 'item',
            parentId: levelId,
            position: [2, 0, 2],
            asset: {
              id: 'chair',
              name: 'Chair',
              category: 'seating',
              thumbnail: '',
              src: 'asset://chair',
            },
          },
          parentId: levelId,
        },
      ],
    })
    const polygon = [
      [0.1, 0.1],
      [4, 0.1],
      [4, 3],
      [0.1, 3],
    ]
    const invalid = await call('create_mezzanine', {
      hostZoneId: host.zoneId,
      polygon,
      elevation: 0.2,
    })
    expect(invalid.conflicts?.[0]?.code).toBe('mezzanine-elevation')
    expect(invalid.changes).toBe(0)
    const mezz = await call('create_mezzanine', { hostZoneId: host.zoneId, polygon })
    const ground = Object.values(bridge.getNodes()).find(
      (n) => n.type === 'slab' && n.zoneIds?.includes(host.zoneId),
    )!
    expect(bridge.getNodes().item_lower).toMatchObject({ supportSlabId: ground.id })
    expect(
      (await call('create_mezzanine', { hostZoneId: host.zoneId, polygon })).conflicts?.[0]?.code,
    ).toBe('overlaps-mezzanine')
    const denied = await client.callTool({
      name: 'set_zone_intent',
      arguments: { zoneId: mezz.zoneId, patch: { floor: { support: 'open' } } },
    })
    expect(denied.isError).toBe(true)
    const tools = (await client.listTools()).tools
    const schema = JSON.stringify(tools.find((t) => t.name === 'set_zone_intent')!.inputSchema)
    expect(schema).not.toContain('"support"')
    expect(
      (await call('set_zone_intent', { zoneId: mezz.zoneId, patch: { floor: { elevation: 100 } } }))
        .conflicts?.[0]?.code,
    ).toBe('mezzanine-elevation')
    const snapshot = bridge.getNodes()
    bridge.clearHistory()
    const copy = await call('duplicate_zone', { zoneId: host.zoneId, translate: [20, 0] })
    const copiedMezz = copy.idMap[mezz.zoneId]![0]!
    expect(bridge.getNodes()[copiedMezz]).toMatchObject({
      hostZoneId: copy.zoneId,
      floor: { support: 'open' },
    })
    const copiedGround = Object.values(bridge.getNodes()).find(
      (n) => n.type === 'slab' && n.zoneIds?.includes(copy.zoneId),
    )!
    expect(bridge.getNodes()[copy.idMap.item_lower![0]!]).toMatchObject({
      supportSlabId: copiedGround.id,
    })
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNodes()).toEqual(snapshot)
    await call('delete_zone', { zoneId: mezz.zoneId, contents: 'delete' })
    expect(bridge.getNodes().item_lower).toBeDefined()
    bridge.undo()
    await call('delete_zone', { zoneId: host.zoneId, contents: 'delete' })
    expect(bridge.getNodes()[mezz.zoneId]).toBeUndefined()
    expect(bridge.getNodes().item_lower).toBeUndefined()
  } finally {
    await client.close()
    await server.close()
  }
})

test('M10 headless bridge updates mezzanine railing on stair and segment writes and deletion', async () => {
  const { mezzanineFixture } = await import('../../../core/src/lib/__fixtures__/mezzanine')
  const { StairNode, StairSegmentNode } = await import('@pascal-app/core/schema')
  const f = mezzanineFixture()
  const bridge = new SceneBridge()
  bridge.setScene(f.nodes, [f.level.id])
  const stair = StairNode.parse({
    id: 'stair_arrival',
    parentId: f.level.id,
    position: [6, 0, 1.5],
    rotation: -Math.PI / 2,
    deckSlabId: f.plate.id,
    children: ['sseg_arrival'],
  })
  const segment = StairSegmentNode.parse({
    id: 'sseg_arrival',
    parentId: stair.id,
    length: 2,
    width: 1.2,
  })
  const length = () => {
    const plate = bridge.getNodes()[f.plate.id]
    if (plate?.type !== 'slab') throw Error('Missing plate')
    return plate.railing!.reduce(
      (sum, { start, end }) => sum + Math.hypot(end[0] - start[0], end[1] - start[1]),
      0,
    )
  }
  bridge.clearHistory()
  const before = bridge.getNodes()
  bridge.applyPatch([
    { op: 'create', node: stair, parentId: f.level.id },
    { op: 'create', node: segment, parentId: stair.id },
  ])
  expect(length()).toBeCloseTo(5.6)
  expect(bridge.getHistory().pastCount).toBe(1)
  bridge.undo()
  expect(bridge.getNodes()).toEqual(before)
  bridge.redo()
  bridge.updateNode(segment.id, { width: 2 })
  expect(length()).toBeCloseTo(4.8)
  bridge.updateNode(stair.id, { rotation: 0 })
  expect(length()).toBeCloseTo(6.8)
  bridge.updateNode(stair.id, { rotation: -Math.PI / 2 })
  expect(length()).toBeCloseTo(4.8)
  bridge.deleteNode(stair.id, true)
  expect(length()).toBeCloseTo(6.8)
})

test('existing move, rotate and duplicate tools carry mezzanines inside their host with atomic refusal and undo', async () => {
  const { mezzanineFixture } = await import('../../../core/src/lib/__fixtures__/mezzanine')
  const f = mezzanineFixture()
  const bridge = new SceneBridge()
  bridge.setScene(f.nodes, [f.level.id])
  const server = createPascalMcpServer({ bridge })
  const client = new Client({ name: 'mezzanine-transform', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    expect(result.isError, JSON.stringify(result)).toBeFalsy()
    return result.structuredContent as {
      zoneId: string
      changes: number
      conflicts?: { code: string }[]
    }
  }
  try {
    bridge.clearHistory()
    const before = bridge.getNodes()
    const refused = await call('move_zone', { zoneId: f.zone.id, translate: [-10, 0], force: true })
    expect(refused).toMatchObject({ changes: 0, conflicts: [{ code: 'outside-host' }] })
    expect(bridge.getNodes()).toEqual(before)
    expect(bridge.getHistory().pastCount).toBe(0)
    await call('move_zone', { zoneId: f.zone.id, translate: [1, 1] })
    expect(bridge.getNodes()[f.zone.id]).toMatchObject({
      hostZoneId: f.host.id,
      polygon: f.zone.polygon.map(([x, z]) => [x + 1, z + 1]),
    })
    expect(bridge.getHistory().pastCount).toBe(1)
    const moved = bridge.getNodes()
    bridge.clearHistory()
    await call('rotate_zone', { zoneId: f.zone.id, quarterTurns: 1 })
    expect(bridge.getHistory().pastCount).toBe(1)
    expect(bridge.getNodes()[f.zone.id]).toMatchObject({ hostZoneId: f.host.id })
    for (const wall of f.walls) expect(bridge.getNodes()[wall.id]).toEqual(before[wall.id])
    bridge.undo()
    expect(bridge.getNodes()).toEqual(moved)
    bridge.setScene(before, [f.level.id])
    bridge.clearHistory()
    const copy = await call('duplicate_zone', { zoneId: f.zone.id, translate: [100, 0] })
    expect(copy.conflicts).toBeUndefined()
    expect(bridge.getNodes()[copy.zoneId]).toMatchObject({
      hostZoneId: f.host.id,
      floor: { support: 'open' },
    })
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNodes()).toEqual(before)
  } finally {
    await client.close()
    await server.close()
  }
})
