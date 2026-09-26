import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  AnyNode,
  type AnyNodeId,
  BlockNode,
  ColumnNode,
  ImportedMeshNode,
  LevelNode,
  nodeKindOf,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerFindNodes } from './find-nodes'

describe('find_nodes', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerFindNodes(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('filters by type', async () => {
    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'level' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.nodes.length).toBeGreaterThan(0)
    for (const n of parsed.nodes) {
      expect(n.type).toBe('level')
    }
  })

  test('returns empty list for unused type', async () => {
    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'roof' },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(Array.isArray(parsed.nodes)).toBe(true)
    expect(parsed.nodes.length).toBe(0)
  })

  test('zoneId filters walls whose midpoint falls in the zone polygon', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const zone = ZoneNode.parse({
      name: 'Kitchen',
      polygon: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
    })
    bridge.createNode(zone, level.id)
    const inWall = WallNode.parse({ start: [-2, -2], end: [2, 2] })
    bridge.createNode(inWall, level.id)
    const outWall = WallNode.parse({ start: [50, 50], end: [60, 60] })
    bridge.createNode(outWall, level.id)

    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'wall', zoneId: zone.id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    const ids: string[] = parsed.nodes.map((n: { id: string }) => n.id)
    expect(ids).toContain(inWall.id)
    expect(ids).not.toContain(outWall.id)
  })

  describe('source ids', () => {
    // A small slice of the converted /next house: converter nodes carry the
    // SketchUp/ledger ids they came from in `metadata.sourceIds`.
    function seedSourceFixture() {
      const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
      const wall = WallNode.parse({
        id: 'wall_ground-exterior-01',
        start: [0, 0],
        end: [6, 0],
        metadata: { sourceIds: ['ground/exterior-01'] },
      })
      const window = WindowNode.parse({
        id: 'window_primary-rear-window-1',
        wallId: wall.id,
        position: [1, 1.2, 0],
        metadata: { sourceIds: ['ground/exterior-01/window-1', 'sketchup:641553'] },
      })
      const block = BlockNode.parse({
        id: 'block_screen-roof-gutter',
        metadata: { sourceIds: ['screen/roof-gutter'] },
      })
      const column = ColumnNode.parse({
        id: 'column_screen-native-640313-1259',
        metadata: { sourceIds: ['screen/post-640313'] },
      })
      const untagged = WallNode.parse({ start: [0, 4], end: [6, 4] })
      bridge.applyPatch([
        { op: 'create', node: wall, parentId: level.id as AnyNodeId },
        { op: 'create', node: window, parentId: wall.id as AnyNodeId },
        { op: 'create', node: block, parentId: level.id as AnyNodeId },
        { op: 'create', node: column, parentId: level.id as AnyNodeId },
        { op: 'create', node: untagged, parentId: level.id as AnyNodeId },
      ])
      return { wall, window, block, column, untagged }
    }

    async function findIds(args: Record<string, unknown>): Promise<string[]> {
      const result = await client.callTool({ name: 'find_nodes', arguments: args })
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
      return parsed.nodes.map((n: { id: string }) => n.id).sort()
    }

    test('sourceId matches any entry of metadata.sourceIds exactly', async () => {
      const { window } = seedSourceFixture()
      expect(await findIds({ sourceId: 'sketchup:641553' })).toEqual([window.id])
      expect(await findIds({ sourceId: 'ground/exterior-01/window-1' })).toEqual([window.id])
      expect(await findIds({ sourceId: 'ground/exterior' })).toEqual([])
    })

    test('sourceIdPrefix matches every node with an entry starting with it', async () => {
      const { wall, window, block, column } = seedSourceFixture()
      expect(await findIds({ sourceIdPrefix: 'ground/exterior-01' })).toEqual(
        [wall.id, window.id].sort(),
      )
      expect(await findIds({ sourceIdPrefix: 'screen/' })).toEqual([block.id, column.id].sort())
    })

    test('source filters combine with type and parentId', async () => {
      const { wall, window } = seedSourceFixture()
      expect(await findIds({ sourceIdPrefix: 'ground/', type: 'window' })).toEqual([window.id])
      expect(await findIds({ sourceIdPrefix: 'ground/', parentId: wall.id })).toEqual([window.id])
      expect(await findIds({ sourceIdPrefix: 'screen/', type: 'wall' })).toEqual([])
    })
  })

  test('type filter accepts every node kind in the schema', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const block = BlockNode.parse({})
    const column = ColumnNode.parse({})
    bridge.applyPatch([
      { op: 'create', node: block, parentId: level.id as AnyNodeId },
      { op: 'create', node: column, parentId: level.id as AnyNodeId },
    ])
    const rejected: string[] = []
    for (const type of AnyNode.options.map(nodeKindOf)) {
      const result = await client.callTool({ name: 'find_nodes', arguments: { type } })
      if (result.isError) rejected.push(type)
    }
    expect(rejected).toEqual([])
    const blocks = await client.callTool({ name: 'find_nodes', arguments: { type: 'block' } })
    const parsed = JSON.parse((blocks.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual([block.id])
  })

  test('zoneId places the newly filterable kinds that sit on the level', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const zone = ZoneNode.parse({
      name: 'Lanai',
      polygon: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
    })
    const inColumn = ColumnNode.parse({ position: [1, 0, 1] })
    const outColumn = ColumnNode.parse({ position: [20, 0, 20] })
    // Default topology is centred on the block origin.
    const block = BlockNode.parse({ position: [2, 0, 2] })
    // Converter meshes keep their origin at zero and the geometry in the vertices.
    const mesh = ImportedMeshNode.parse({
      primitives: [{ positions: [2, 0, 2, 4, 0, 2, 4, 0, 4] }],
    })
    const farMesh = ImportedMeshNode.parse({
      primitives: [{ positions: [30, 0, 30, 32, 0, 30, 32, 0, 32] }],
    })
    bridge.applyPatch(
      [zone, inColumn, outColumn, block, mesh, farMesh].map((node) => ({
        op: 'create' as const,
        node,
        parentId: level.id as AnyNodeId,
      })),
    )
    const idsFor = async (type: string) => {
      const result = await client.callTool({
        name: 'find_nodes',
        arguments: { type, zoneId: zone.id },
      })
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
      return parsed.nodes.map((n: { id: string }) => n.id)
    }
    expect(await idsFor('column')).toEqual([inColumn.id])
    expect(await idsFor('block')).toEqual([block.id])
    expect(await idsFor('imported-mesh')).toEqual([mesh.id])
  })

  test('type accepts a plugin kind present in the scene', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const pluginNode = {
      object: 'node',
      id: 'bench_plugin-1',
      type: 'fixture:bench',
      parentId: level.id,
      visible: true,
      metadata: {},
      position: [0, 0, 0],
    }
    const nodes = { ...bridge.getNodes(), [pluginNode.id]: pluginNode } as Record<string, unknown>
    bridge.loadJSON({ nodes, rootNodeIds: bridge.getRootNodeIds() } as never)

    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'fixture:bench' },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual([pluginNode.id])
  })

  test('zoneId only returns nodes on the zone’s level', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    const ground = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const upper = LevelNode.parse({ level: 1 })
    const zone = ZoneNode.parse({
      name: 'Kitchen',
      polygon: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
    })
    const groundWall = WallNode.parse({ start: [-2, 0], end: [2, 0] })
    const upperWall = WallNode.parse({ start: [-2, 0], end: [2, 0] })
    bridge.applyPatch([
      { op: 'create', node: upper, parentId: building.id as AnyNodeId },
      { op: 'create', node: zone, parentId: ground.id as AnyNodeId },
      { op: 'create', node: groundWall, parentId: ground.id as AnyNodeId },
      { op: 'create', node: upperWall, parentId: upper.id as AnyNodeId },
    ])
    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'wall', zoneId: zone.id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual([groundWall.id])
  })

  test('zoneId places a hosted window where its wall puts it', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const zone = ZoneNode.parse({
      name: 'Origin room',
      polygon: [
        [-3, -3],
        [3, -3],
        [3, 3],
        [-3, 3],
      ],
    })
    // Wall-local x = 1 on a wall starting at x = 20: the window is at x = 21.
    const farWall = WallNode.parse({ start: [20, 0], end: [26, 0] })
    const farWindow = WindowNode.parse({ wallId: farWall.id, position: [1, 1.2, 0] })
    const nearWall = WallNode.parse({ start: [-2, 0], end: [2, 0] })
    const nearWindow = WindowNode.parse({ wallId: nearWall.id, position: [1, 1.2, 0] })
    bridge.applyPatch([
      { op: 'create', node: zone, parentId: level.id as AnyNodeId },
      { op: 'create', node: farWall, parentId: level.id as AnyNodeId },
      { op: 'create', node: farWindow, parentId: farWall.id as AnyNodeId },
      { op: 'create', node: nearWall, parentId: level.id as AnyNodeId },
      { op: 'create', node: nearWindow, parentId: nearWall.id as AnyNodeId },
    ])
    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'window', zoneId: zone.id },
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual([nearWindow.id])
  })

  test('invalid type is rejected', async () => {
    const result = await client.callTool({
      name: 'find_nodes',
      arguments: { type: 'not-a-type' },
    })
    expect(result.isError).toBe(true)
  })
})
