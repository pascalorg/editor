import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ItemNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerCheckCollisions } from './check-collisions'

function makeItem(position: [number, number, number], dims: [number, number, number] = [1, 1, 1]) {
  return ItemNode.parse({
    position,
    asset: {
      id: 'x',
      name: 'x',
      category: 'x',
      thumbnail: '',
      src: 'asset://x',
      dimensions: dims,
    },
  })
}

describe('check_collisions', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCheckCollisions(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  test('detects overlapping item AABBs', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = makeItem([0, 0, 0])
    const b = makeItem([0.5, 0, 0.5])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.collisions.length).toBeGreaterThanOrEqual(1)
    const ids = parsed.collisions.flatMap((c: { aId: string; bId: string }) => [c.aId, c.bId])
    expect(ids).toContain(a.id)
    expect(ids).toContain(b.id)
  })

  test('returns empty array when items do not overlap', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = makeItem([-10, 0, -10])
    const b = makeItem([10, 0, 10])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.collisions.length).toBe(0)
  })

  // This tool reports *actual* overlap, not "too close together". It shares
  // findItemItemCollisions with furnish_room, which defaults to an 8cm spacing
  // gap; if that default ever leaks in here, neighbouring furniture starts
  // getting reported as colliding. 7cm apart must stay clean.
  test('items standing close but not overlapping are not collisions', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    // a spans x [0, 1], b spans x [1.07, 2.07] — 7cm of clear air between them.
    const a = makeItem([0.5, 0, 0])
    const b = makeItem([1.57, 0, 0])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text)
    expect(parsed.collisions.length).toBe(0)
  })

  test('rejects an unknown levelId instead of reporting a clean empty result', async () => {
    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: 'level_missing' },
    })
    expect(result.isError).toBe(true)
  })

  test('preserves level scoping for children-only legacy hierarchy records', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = makeItem([0, 0, 0])
    const b = makeItem([0.5, 0, 0])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)
    const graph = bridge.exportJSON()
    graph.nodes[a.id] = { ...graph.nodes[a.id]!, parentId: null }
    graph.nodes[b.id] = { ...graph.nodes[b.id]!, parentId: null }
    bridge.loadJSON(graph)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: level.id },
    })
    const parsed = result.structuredContent as { collisions: unknown[]; checkedItems: unknown[] }
    expect(parsed.checkedItems).toHaveLength(2)
    expect(parsed.collisions).toHaveLength(1)
  })

  test('advertises the prospective-item assessment as read-only and idempotent', async () => {
    const tools = await client.listTools()
    const tool = tools.tools.find((entry) => entry.name === 'check_collisions')
    expect(tool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    const candidate = (tool?.inputSchema.properties as Record<string, unknown>).candidate as {
      properties: Record<string, { items?: unknown; minItems?: number; maxItems?: number }>
    }
    for (const field of ['position', 'dimensions']) {
      expect(Array.isArray(candidate.properties[field]?.items)).toBe(false)
      expect(candidate.properties[field]?.minItems).toBe(3)
      expect(candidate.properties[field]?.maxItems).toBe(3)
    }
  })

  test('reports units, source dimensions, clearance violations, and limitations', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const a = makeItem([0, 0, 0])
    const b = makeItem([1.05, 0, 0])
    bridge.createNode(a, level.id)
    bridge.createNode(b, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { minimumClearance: '10 cm', floorOnly: true },
    })
    const parsed = result.structuredContent as {
      status: string
      units: string
      minimumClearanceMeters: number
      checkedItems: Array<{ sourceDimensionsMeters: number[]; source: { uri: string } }>
      collisions: Array<{ violation: string }>
      unsupportedChecks: Array<{ check: string }>
    }
    expect(parsed.status).toBe('checked')
    expect(parsed.units).toBe('meters')
    expect(parsed.minimumClearanceMeters).toBeCloseTo(0.1)
    expect(parsed.checkedItems[0]?.sourceDimensionsMeters).toEqual([1, 1, 1])
    expect(parsed.checkedItems[0]?.source.uri).toBe('asset://x')
    expect(parsed.collisions[0]?.violation).toBe('clearance')
    expect(parsed.unsupportedChecks.map((entry) => entry.check)).toContain('delivery_path')
  })

  test('marks unsuitable footprint geometry as insufficient evidence', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const item = makeItem([0, 0, 0], [0, 1, 1])
    bridge.createNode(item, level.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { floorOnly: true },
    })
    const parsed = result.structuredContent as {
      status: string
      checkedItems: unknown[]
      skippedItems: Array<{ reason: string }>
    }
    expect(parsed.status).toBe('insufficient_evidence')
    expect(parsed.checkedItems).toHaveLength(0)
    expect(parsed.skippedItems[0]?.reason).toBe('non_positive_plan_dimensions')
  })

  test('checks a supplied candidate without mutating the scene', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const existing = makeItem([0, 0, 0])
    bridge.createNode(existing, level.id)
    const before = JSON.stringify(bridge.exportJSON())

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {
        minimumClearance: '4 in',
        floorOnly: true,
        candidate: {
          id: 'prospective-sofa',
          name: 'Prospective sofa',
          levelId: level.id,
          position: ['3 ft', 0, 0],
          dimensions: ['6 ft', '32 in', '36 in'],
          rotationY: '90 deg',
          source: { assetId: 'retailer-sofa', uri: 'https://example.test/sofa' },
        },
      },
    })
    const parsed = result.structuredContent as {
      candidateItemId: string | null
      checkedItems: Array<{ id: string; source: { catalog: string } }>
      collisions: Array<{ aId: string; bId: string }>
    }
    expect(result.isError).toBeFalsy()
    expect(parsed.candidateItemId).toBe('prospective-sofa')
    expect(
      parsed.checkedItems.find((entry) => entry.id === 'prospective-sofa')?.source.catalog,
    ).toBe('supplied')
    expect(parsed.collisions).toHaveLength(1)
    expect(JSON.stringify(bridge.exportJSON())).toBe(before)
  })

  test('rejects invalid supplied candidate dimensions', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {
        candidate: {
          levelId: level.id,
          position: [0, 0, 0],
          dimensions: [0, 1, 1],
        },
      },
    })
    expect(result.isError).toBe(true)
  })

  test('rejects a candidate scoped to a different level', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {
        levelId: level.id,
        candidate: {
          levelId: 'level_other',
          position: [0, 0, 0],
          dimensions: [1, 1, 1],
        },
      },
    })
    expect(result.isError).toBe(true)
  })

  test('skips hosted item-local coordinates in floor-only mode', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const floorItem = makeItem([0, 0, 0])
    const host = makeItem([10, 0, 0])
    const hosted = makeItem([0, 0, 0])
    bridge.createNode(floorItem, level.id)
    bridge.createNode(host, level.id)
    bridge.createNode(hosted, host.id)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: level.id, floorOnly: true },
    })
    const parsed = result.structuredContent as {
      status: string
      collisions: unknown[]
      skippedItems: Array<{ id: string; name: string; reason: string }>
    }
    expect(parsed.status).toBe('partial')
    expect(parsed.collisions).toHaveLength(0)
    expect(parsed.skippedItems).toContainEqual({
      id: hosted.id,
      name: hosted.name ?? hosted.asset.name,
      reason: 'unsupported_attachment',
    })

    const unfilteredResult = await client.callTool({
      name: 'check_collisions',
      arguments: { levelId: level.id },
    })
    const unfiltered = unfilteredResult.structuredContent as {
      status: string
      collisions: unknown[]
      skippedItems: Array<{ id: string; reason: string }>
      unsupportedChecks: Array<{ check: string }>
    }
    expect(unfiltered.status).toBe('partial')
    expect(unfiltered.collisions).toHaveLength(0)
    expect(unfiltered.skippedItems).toContainEqual({
      id: hosted.id,
      name: hosted.name ?? hosted.asset.name,
      reason: 'parent_local_coordinates',
    })
    expect(unfiltered.unsupportedChecks.map((entry) => entry.check)).toContain(
      'hosted_item_world_transform',
    )
  })

  test('does not compare an item whose level cannot be resolved', async () => {
    const orphan = makeItem([0, 0, 0])
    bridge.createNode(orphan)

    const result = await client.callTool({
      name: 'check_collisions',
      arguments: {},
    })
    const parsed = result.structuredContent as {
      status: string
      checkedItems: unknown[]
      skippedItems: Array<{ id: string; reason: string }>
    }
    expect(parsed.status).toBe('insufficient_evidence')
    expect(parsed.skippedItems).toContainEqual({
      id: orphan.id,
      name: orphan.name ?? orphan.asset.name,
      reason: 'unresolved_level',
    })
  })
})
