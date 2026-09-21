import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  UnitNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS, READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { registerTools } from './index'
import { createTestSceneOperations, type InMemorySceneStore } from './scene-lifecycle/test-utils'

describe('unit tools', () => {
  let client: Client
  let server: McpServer
  let bridge: SceneBridge
  let store: InMemorySceneStore
  let operations: SceneOperations
  let buildingId: AnyNodeId
  let levelId: AnyNodeId
  let upperLevelId: AnyNodeId
  let zoneId: ZoneNode['id']
  let upperZoneId: ZoneNode['id']
  let otherBuildingId: AnyNodeId
  let otherZoneId: ZoneNode['id']

  function addZone(parentId: AnyNodeId, name = 'Room'): ZoneNode['id'] {
    const zone = ZoneNode.parse({
      name,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })
    bridge.createNode(zone, parentId)
    return zone.id
  }

  function addUnit(members: ZoneNode['id'][] = [zoneId]): UnitNode['id'] {
    const unit = UnitNode.parse({ name: 'Duplex', members })
    bridge.createNode(unit, buildingId)
    return unit.id
  }

  async function call(name: string, args: Record<string, unknown>) {
    return await client.callTool({ name, arguments: args })
  }

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    buildingId = Object.values(bridge.getNodes()).find((node) => node.type === 'building')!.id
    levelId = Object.values(bridge.getNodes()).find((node) => node.type === 'level')!.id
    upperLevelId = bridge.createNode(LevelNode.parse({ level: 1 }), buildingId)
    zoneId = addZone(levelId, 'Living room')
    upperZoneId = addZone(upperLevelId, 'Bedroom')
    otherBuildingId = bridge.createNode(BuildingNode.parse({ name: 'Other building' }))
    const otherLevelId = bridge.createNode(LevelNode.parse({ level: 0 }), otherBuildingId)
    otherZoneId = addZone(otherLevelId)
    const testOperations = createTestSceneOperations({ bridge })
    store = testOperations.store
    operations = testOperations.operations
    server = new McpServer({ name: 'test', version: '0.0.0' })
    registerTools(server, testOperations.operations)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
    bridge.clearHistory()
  })

  afterEach(async () => {
    await client.close()
    await server.close()
  })

  test('registers the tools with mutation and read-only annotations', async () => {
    const { tools } = await client.listTools()
    expect(tools.find((tool) => tool.name === 'create_unit')?.annotations).toEqual(
      ADDITIVE_TOOL_ANNOTATIONS,
    )
    expect(tools.find((tool) => tool.name === 'set_unit_members')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    })
    expect(tools.find((tool) => tool.name === 'list_units')?.annotations).toEqual(
      READ_ONLY_TOOL_ANNOTATIONS,
    )
  })

  test('creates an empty unit with schema defaults as a building child', async () => {
    const result = await call('create_unit', { buildingId, name: 'Apartment 1' })
    expect(result.isError).toBeFalsy()
    const payload = result.structuredContent!
    expect(payload.unitId).toMatch(/^unit_/)
    expect(payload.persistence).toMatchObject({ status: 'unbound' })
    expect(bridge.getNode(payload.unitId as AnyNodeId)).toMatchObject({
      type: 'unit',
      parentId: buildingId,
      name: 'Apartment 1',
      kind: 'apartment',
      color: '#f59e0b',
      members: [],
    })
    expect(bridge.getChildren(buildingId).map((node) => node.id)).toContain(payload.unitId)
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNode(payload.unitId as AnyNodeId)).toBeNull()
  })

  test('creates a unit spanning two levels and persists a live snapshot', async () => {
    const meta = await store.save({ name: 'Units', graph: operations.exportSceneGraph() })
    bridge.setActiveScene(meta)
    const result = await call('create_unit', {
      buildingId,
      name: 'Duplex',
      kind: 'hotel-room',
      color: '#123456',
      memberZoneIds: [zoneId, upperZoneId],
    })
    expect(result.isError).toBeFalsy()
    const payload = result.structuredContent!
    expect(payload.persistence).toBeUndefined()
    expect(bridge.getNode(payload.unitId as AnyNodeId)).toMatchObject({
      name: 'Duplex',
      kind: 'hotel-room',
      color: '#123456',
      members: [zoneId, upperZoneId],
    })
    const saved = await store.load(meta.id)
    expect(saved?.graph.nodes[payload.unitId as AnyNodeId]).toMatchObject({
      members: [zoneId, upperZoneId],
    })
    expect((await store.listSceneEvents(meta.id)).map((event) => event.kind)).toEqual([
      'create_unit',
    ])
  })

  test('rejects unknown and non-building parents without mutation', async () => {
    const before = operations.exportSceneGraph()
    for (const invalidId of ['building_missing', levelId]) {
      const result = await call('create_unit', { buildingId: invalidId, name: 'Invalid' })
      expect(result.isError).toBe(true)
    }
    expect(operations.exportSceneGraph()).toEqual(before)
    expect(bridge.getHistory().pastCount).toBe(0)
  })

  test('rejects invalid kinds', async () => {
    expect(
      (await call('create_unit', { buildingId, name: 'Invalid', kind: 'invalid' })).isError,
    ).toBe(true)
    expect(bridge.getHistory().pastCount).toBe(0)
  })

  for (const toolName of ['create_unit', 'set_unit_members']) {
    test(`${toolName} rejects missing, non-zone, foreign, and non-level members atomically`, async () => {
      const unitId = addUnit()
      const buildingZoneId = addZone(buildingId)
      const orphanZoneId = addZone(levelId)
      bridge.updateNode(orphanZoneId, { parentId: null })
      bridge.updateNode(levelId, { children: [zoneId] })
      bridge.clearHistory()
      const before = operations.exportSceneGraph()
      for (const invalidId of [
        'zone_missing',
        levelId,
        otherZoneId,
        buildingZoneId,
        orphanZoneId,
      ]) {
        const result = await call(toolName, {
          ...(toolName === 'create_unit' ? { buildingId, name: 'Invalid' } : { unitId }),
          memberZoneIds: [upperZoneId, invalidId],
        })
        expect(result.isError).toBe(true)
        expect(operations.exportSceneGraph()).toEqual(before)
        expect(bridge.getHistory().pastCount).toBe(0)
      }
    })
  }

  test('replaces and clears members without deleting zones, with one undo step', async () => {
    const unitId = addUnit()
    bridge.clearHistory()
    const result = await call('set_unit_members', { unitId, memberZoneIds: [upperZoneId] })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({
      unitId,
      memberCount: 1,
      persistence: { status: 'unbound' },
    })
    expect(bridge.getNode(unitId)).toMatchObject({ members: [upperZoneId] })
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.getNode(unitId)).toMatchObject({ members: [zoneId] })
    const cleared = await call('set_unit_members', { unitId, memberZoneIds: [] })
    expect(cleared.isError).toBeFalsy()
    expect(cleared.structuredContent).toMatchObject({ unitId, memberCount: 0 })
    expect(bridge.getNode(unitId)).toMatchObject({ members: [] })
    expect(bridge.getNode(zoneId)).not.toBeNull()
    expect(bridge.getNode(upperZoneId)).not.toBeNull()
  })

  test('persists membership replacements and emits a live event', async () => {
    const unitId = addUnit()
    const meta = await store.save({ name: 'Units', graph: operations.exportSceneGraph() })
    bridge.setActiveScene(meta)
    const result = await call('set_unit_members', { unitId, memberZoneIds: [zoneId, upperZoneId] })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ unitId, memberCount: 2 })
    expect((await store.load(meta.id))?.graph.nodes[unitId]).toMatchObject({
      members: [zoneId, upperZoneId],
    })
    expect((await store.listSceneEvents(meta.id)).map((event) => event.kind)).toEqual([
      'set_unit_members',
    ])
  })

  test('rejects unknown, non-unit, and invalid-building targets', async () => {
    for (const unitId of ['unit_missing', zoneId]) {
      expect((await call('set_unit_members', { unitId, memberZoneIds: [] })).isError).toBe(true)
    }
    const unitId = addUnit()
    for (const parentId of [null, 'building_missing' as AnyNodeId, levelId]) {
      bridge.updateNode(unitId, { parentId })
      bridge.clearHistory()
      expect((await call('set_unit_members', { unitId, memberZoneIds: [] })).isError).toBe(true)
      expect(bridge.getNode(unitId)).toMatchObject({ members: [zoneId] })
      expect(bridge.getHistory().pastCount).toBe(0)
    }
  })

  test('allows a zone to be shared by units', async () => {
    addUnit()
    const result = await call('create_unit', {
      buildingId,
      name: 'Shared',
      memberZoneIds: [zoneId],
    })
    expect(result.isError).toBeFalsy()
    expect(bridge.getNode(result.structuredContent!.unitId as AnyNodeId)).toMatchObject({
      members: [zoneId],
    })
  })

  test('lists units across buildings, filters by building, and returns current reports without writes', async () => {
    const unitId = addUnit([zoneId, upperZoneId])
    const otherUnit = UnitNode.parse({ name: 'Other', members: [otherZoneId], kind: 'commercial' })
    bridge.createNode(otherUnit, otherBuildingId)
    bridge.clearHistory()
    const before = operations.exportSceneGraph()
    const all = await call('list_units', {})
    expect(all.isError).toBeFalsy()
    expect(all.structuredContent!.units).toHaveLength(2)
    const filtered = await call('list_units', { buildingId })
    expect(filtered.isError).toBeFalsy()
    expect(filtered.structuredContent!.units).toEqual([
      {
        unitId,
        name: 'Duplex',
        kind: 'apartment',
        color: '#f59e0b',
        members: [zoneId, upperZoneId],
        report: {
          memberCount: 2,
          levelSpan: { minOrdinal: 0, maxOrdinal: 1, count: 2 },
          grossAreaM2: 24,
          members: [
            { zoneId, name: 'Living room', levelId, levelOrdinal: 0, areaM2: 12 },
            {
              zoneId: upperZoneId,
              name: 'Bedroom',
              levelId: upperLevelId,
              levelOrdinal: 1,
              areaM2: 12,
            },
          ],
        },
      },
    ])
    expect(operations.exportSceneGraph()).toEqual(before)
    expect(bridge.getHistory().pastCount).toBe(0)
    bridge.updateNode(upperZoneId, {
      polygon: [
        [0, 0],
        [2, 0],
        [2, 3],
        [0, 3],
      ],
    })
    const updated = await call('list_units', { buildingId })
    expect(updated.structuredContent!.units).toMatchObject([{ report: { grossAreaM2: 18 } }])
  })

  test('lists empty scenes and empty units', async () => {
    expect((await call('list_units', {})).structuredContent).toEqual({ units: [] })
    addUnit([])
    const result = await call('list_units', { buildingId })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent!.units).toMatchObject([
      {
        members: [],
        report: { memberCount: 0, levelSpan: null, grossAreaM2: 0, members: [] },
      },
    ])
    expect((await call('list_units', { buildingId: otherBuildingId })).structuredContent).toEqual({
      units: [],
    })
  })

  test('rejects unknown and non-building list filters', async () => {
    for (const invalidId of ['building_missing', levelId]) {
      expect((await call('list_units', { buildingId: invalidId })).isError).toBe(true)
    }
  })
})
