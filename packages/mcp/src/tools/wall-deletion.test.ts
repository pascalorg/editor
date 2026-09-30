import { beforeEach, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type AnyNodeId, DoorNode, SlabNode, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerApplyPatch } from './apply-patch'
import { registerSharedTools } from './shared-tools'

let bridge: SceneBridge
let client: Client
beforeEach(async () => {
  bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const level = bridge.findNodes({ type: 'level' })[0]!
  const points: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 4],
    [0, 4],
  ]
  for (const [i, start] of points.entries())
    bridge.createNode(WallNode.parse({ start, end: points[(i + 1) % 4] }), level.id)
  bridge.deriveStructure()
  bridge.clearHistory()
  const server = new McpServer({ name: 'wall-deletion', version: '0.0.0' })
  registerSharedTools(server, bridge)
  registerApplyPatch(server, bridge)
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
})

test('delete_node replaces an exterior wall and preserves room construction through undo', async () => {
  const before = bridge.exportJSON()
  const wall = bridge.findNodes({ type: 'wall' })[0]!
  const surfaces = Object.values(before.nodes).filter((n) =>
    ['zone', 'slab', 'ceiling'].includes(n.type),
  )
  const result = await client.callTool({ name: 'delete_node', arguments: { id: wall.id } })
  expect(result.isError).toBeFalsy()
  expect(bridge.findNodes({ type: 'separator' })).toHaveLength(1)
  for (const node of surfaces) expect(bridge.getNode(node.id)?.type).toBe(node.type)
  expect(bridge.findNodes({ type: 'zone' })[0]).toMatchObject({ enclosureStatus: 'enclosed' })
  expect(bridge.getHistory().pastCount).toBe(1)
  bridge.undo()
  expect(bridge.exportJSON()).toEqual(before)
})

test('delete_node on a shared wall merges both rooms without a separator', async () => {
  const level = bridge.findNodes({ type: 'level' })[0]!
  const partition = WallNode.parse({ start: [2, 0], end: [2, 4] })
  bridge.createNode(partition, level.id)
  bridge.deriveStructure()
  expect(bridge.findNodes({ type: 'zone' })).toHaveLength(2)
  const result = await client.callTool({ name: 'delete_node', arguments: { id: partition.id } })
  expect(result.isError).toBeFalsy()
  expect(bridge.findNodes({ type: 'zone' })).toHaveLength(1)
  expect(bridge.findNodes({ type: 'ceiling' })).toHaveLength(1)
  expect(bridge.findNodes({ type: 'separator' })).toHaveLength(0)
})

test('apply_patch deletes exterior walls as one selection and reports the new separators', async () => {
  const walls = bridge.findNodes({ type: 'wall' })
  const result = await client.callTool({
    name: 'apply_patch',
    arguments: { patches: walls.slice(0, 2).map((wall) => ({ op: 'delete', id: wall.id })) },
  })
  expect(result.isError).toBeFalsy()
  expect(bridge.findNodes({ type: 'separator' })).toHaveLength(2)
  expect(result.structuredContent).toMatchObject({
    createdIds: bridge.findNodes({ type: 'separator' }).map((n) => n.id),
  })
  expect(bridge.findNodes({ type: 'zone' })[0]).toMatchObject({ enclosureStatus: 'enclosed' })
  expect(bridge.getHistory().pastCount).toBe(1)
})

test('apply_patch deleting all boundaries with interleaved updates removes the room in one undo step', async () => {
  const before = bridge.exportJSON()
  const level = bridge.findNodes({ type: 'level' })[0]!
  const walls = bridge.findNodes({ type: 'wall' })
  const result = await client.callTool({
    name: 'apply_patch',
    arguments: {
      patches: walls.flatMap((wall, i) => [
        { op: 'delete', id: wall.id },
        { op: 'update', id: level.id, data: { name: `Level ${i}` } },
      ]),
    },
  })
  expect(result.isError).toBeFalsy()
  for (const type of ['zone', 'slab', 'ceiling', 'separator'] as const)
    expect(bridge.findNodes({ type })).toHaveLength(0)
  expect(bridge.getHistory().pastCount).toBe(1)
  bridge.undo()
  expect(bridge.exportJSON()).toEqual(before)
})

test('apply_patch replacing a wall with another wall does not add a separator', async () => {
  const wall = bridge.findNodes({ type: 'wall' })[0]!
  const replacement = WallNode.parse({ ...wall, id: 'wall_replacement' })
  const result = await client.callTool({
    name: 'apply_patch',
    arguments: {
      patches: [
        { op: 'delete', id: wall.id },
        { op: 'create', node: replacement, parentId: wall.parentId },
      ],
    },
  })
  expect(result.isError).toBeFalsy()
  expect(bridge.findNodes({ type: 'separator' })).toHaveLength(0)
  expect(bridge.findNodes({ type: 'zone' })[0]).toMatchObject({ enclosureStatus: 'enclosed' })
})

test('apply_patch wall replacement retains openings explicitly moved to the new host', () => {
  const wall = bridge.findNodes({ type: 'wall' })[0]!
  const door = DoorNode.parse({ parentId: wall.id, wallId: wall.id, position: [2, 0, 0] })
  bridge.createNode(door, wall.id)
  const replacement = WallNode.parse({ ...wall, id: 'wall_opening_replacement', children: [] })
  bridge.applyPatch([
    { op: 'create', node: replacement, parentId: wall.parentId as AnyNodeId },
    { op: 'update', id: door.id, data: { parentId: replacement.id, wallId: replacement.id } },
    { op: 'delete', id: wall.id },
  ])
  expect(bridge.getNode(door.id)).toMatchObject({
    parentId: replacement.id,
    wallId: replacement.id,
  })
  expect(bridge.getNode(replacement.id)).toMatchObject({ children: [door.id] })
  expect(bridge.findNodes({ type: 'separator' })).toHaveLength(0)
})

test('P4a apply_patch removes room A while preserving neighbour B', () => {
  const level = bridge.findNodes({ type: 'level' })[0]!
  bridge.createNode(WallNode.parse({ start: [2, 0], end: [2, 4] }), level.id)
  bridge.deriveStructure()
  const rooms = bridge.findNodes({ type: 'zone' }).filter((n) => n.type === 'zone')
  const a = rooms.find((z) => Math.max(...z.polygon.map((p) => p[0])) === 2)!
  const b = rooms.find((z) => z.id !== a.id)!
  bridge.applyPatch(a.boundaryWallIds.map((id) => ({ op: 'delete', id })))
  expect(bridge.findNodes({ type: 'zone' })).toHaveLength(1)
  expect(bridge.getNode(b.id)).toMatchObject({ enclosureStatus: 'enclosed' })
  expect(bridge.findNodes({ type: 'slab' })).toHaveLength(1)
})

test('apply_patch and delete_node heal collinear walls identically', () => {
  const level = bridge.findNodes({ type: 'level' })[0]!
  const walls = [
    WallNode.parse({ id: 'wall_heal_a', start: [10, 0], end: [12, 0] }),
    WallNode.parse({ id: 'wall_heal_b', start: [12, 0], end: [16, 0] }),
    WallNode.parse({ id: 'wall_heal_stem', start: [12, 0], end: [12, 2] }),
  ]
  for (const wall of walls) bridge.createNode(wall, level.id)
  const before = bridge.exportJSON()
  bridge.deleteNode(walls[2]!.id)
  const expected = bridge.findNodes({ type: 'wall' })
  expect(expected.find((w) => w.id === walls[0]!.id)).toMatchObject({
    start: [10, 0],
    end: [16, 0],
  })
  bridge.setScene(before.nodes, before.rootNodeIds)
  bridge.clearHistory()
  bridge.applyPatch([{ op: 'delete', id: walls[2]!.id }])
  expect(bridge.findNodes({ type: 'wall' })).toEqual(expected)
  expect(bridge.getHistory().pastCount).toBe(1)
})

test('apply_patch slab deletion clears surviving support references', () => {
  const level = bridge.findNodes({ type: 'level' })[0]!
  const slab = SlabNode.parse({
    polygon: [
      [20, 0],
      [22, 0],
      [22, 2],
      [20, 2],
    ],
  })
  bridge.createNode(slab, level.id)
  const wall = bridge.findNodes({ type: 'wall' })[0]!
  bridge.updateNode(wall.id, { supportSlabId: slab.id })
  bridge.applyPatch([{ op: 'delete', id: slab.id }])
  expect(bridge.getNode(wall.id)).toMatchObject({ supportSlabId: undefined })
})

test('apply_patch applies the same wall curve clamp as update_node', () => {
  const levelId = bridge.findNodes({ type: 'level' })[0]!.id
  const walls = [
    WallNode.parse({ id: 'wall_clamp_base', start: [20, 0], end: [24, 0] }),
    WallNode.parse({ id: 'wall_clamp_right', start: [24, 0], end: [22, 3] }),
    WallNode.parse({ id: 'wall_clamp_left', start: [22, 3], end: [20, 0] }),
  ]
  for (const wall of walls) bridge.createNode(wall, levelId)
  bridge.deriveStructure()
  const before = bridge.exportJSON()
  bridge.updateNode(walls[0]!.id, { curveOffset: -2 })
  const expected = bridge.getNode(walls[0]!.id)
  expect(expected?.type === 'wall' ? expected.curveOffset : undefined).toBeGreaterThan(-2)
  bridge.setScene(before.nodes, before.rootNodeIds)
  bridge.applyPatch([{ op: 'update', id: walls[0]!.id, data: { curveOffset: -2 } }])
  expect(bridge.getNode(walls[0]!.id)).toEqual(expected)
})
