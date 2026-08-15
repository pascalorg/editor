import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId, ConstructionDimensionNode } from '@pascal-app/core/schema'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerAddDimension } from './add-dimension'

type Payload = { dimensionId: string; anchorCount: number; spanMeters: number }

describe('add_dimension', () => {
  let client: Client
  let bridge: SceneBridge
  let levelId: AnyNodeId

  const addWall = (start: [number, number], end: [number, number]) =>
    bridge.createNode(
      WallNode.parse({ parentId: levelId, start, end }) as AnyNode,
      levelId,
    ) as string

  const dimension = (id: string) => bridge.getNode(id as AnyNodeId) as ConstructionDimensionNode

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id

    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerAddDimension(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  async function call(args: Record<string, unknown>): Promise<Payload> {
    const result = await client.callTool({ name: 'add_dimension', arguments: args })
    return JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text) as Payload
  }

  // The reason walls are worth a dedicated path: a free point stops matching
  // the wall the moment the wall moves.
  test('a wall dimension anchors to the wall so it follows it', async () => {
    const wallId = addWall([0, 0], [5, 0])
    const payload = await call({ levelId, wallIds: [wallId] })

    const anchors = dimension(payload.dimensionId).anchors
    expect(anchors).toHaveLength(2)
    for (const anchor of anchors) {
      expect(Array.isArray(anchor)).toBe(false)
      expect((anchor as { reference: { nodeId: string } }).reference.nodeId).toBe(wallId)
    }
    expect(
      anchors.map((a) => (a as { reference: { featureId: string } }).reference.featureId),
    ).toEqual(['wall:start', 'wall:end'])
    expect(payload.spanMeters).toBeCloseTo(5)
  })

  // The baseline is an independent line; if it ran through the wall the
  // dimension would be drawn on top of what it measures.
  test('offsets the dimension line perpendicular to the run', async () => {
    const wallId = addWall([0, 0], [5, 0])
    const payload = await call({ levelId, wallIds: [wallId], offset: 1.5 })

    const { origin, direction } = dimension(payload.dimensionId).baseline
    expect(direction).toEqual([1, 0])
    // Run is along +x, so the line sits 1.5 away on z.
    expect(origin[0]).toBeCloseTo(0)
    expect(Math.abs(origin[1])).toBeCloseTo(1.5)
  })

  test('a negative offset puts the line on the other side', async () => {
    const wallId = addWall([0, 0], [5, 0])
    const positive = dimension((await call({ levelId, wallIds: [wallId], offset: 1 })).dimensionId)
    const negative = dimension((await call({ levelId, wallIds: [wallId], offset: -1 })).dimensionId)

    expect(positive.baseline.origin[1]).toBeCloseTo(-negative.baseline.origin[1])
  })

  test('chains connected walls into one continuous string without repeating the corner', async () => {
    const first = addWall([0, 0], [4, 0])
    const second = addWall([4, 0], [9, 0])
    const payload = await call({ levelId, wallIds: [first, second] })

    // Four endpoints, but the shared corner is one witness, not two.
    expect(payload.anchorCount).toBe(3)
    expect(dimension(payload.dimensionId).chainMode).toBe('continuous')
    expect(payload.spanMeters).toBeCloseTo(9)
  })

  test('two anchors stay point-to-point', async () => {
    const payload = await call({
      levelId,
      points: [
        [0, 0],
        [3, 0],
      ],
    })

    expect(dimension(payload.dimensionId).chainMode).toBe('point-to-point')
    expect(dimension(payload.dimensionId).anchors.every((a) => Array.isArray(a))).toBe(true)
  })

  test('derives the direction from a diagonal run rather than assuming an axis', async () => {
    const wallId = addWall([0, 0], [3, 4])
    const payload = await call({ levelId, wallIds: [wallId] })

    expect(dimension(payload.dimensionId).baseline.direction[0]).toBeCloseTo(0.6)
    expect(dimension(payload.dimensionId).baseline.direction[1]).toBeCloseTo(0.8)
    expect(payload.spanMeters).toBeCloseTo(5)
  })

  test('carries document notation through without touching the geometry', async () => {
    const wallId = addWall([0, 0], [5, 0])
    const payload = await call({
      levelId,
      wallIds: [wallId],
      prefix: 'TYP ',
      textOverride: 'VERIFY IN FIELD',
    })

    const node = dimension(payload.dimensionId)
    expect(node.prefix).toBe('TYP ')
    expect(node.textOverride).toBe('VERIFY IN FIELD')
    expect(payload.spanMeters).toBeCloseTo(5)
  })

  test('rejects a mode that needs more anchors than it was given', async () => {
    await expect(
      call({
        levelId,
        mode: 'angular',
        points: [
          [0, 0],
          [3, 0],
        ],
      }),
    ).rejects.toThrow()
  })

  test('rejects a run with no direction', async () => {
    await expect(
      call({
        levelId,
        points: [
          [2, 2],
          [2, 2],
        ],
      }),
    ).rejects.toThrow()
  })

  test('rejects being given both walls and points', async () => {
    const wallId = addWall([0, 0], [5, 0])
    await expect(
      call({
        levelId,
        wallIds: [wallId],
        points: [
          [0, 0],
          [1, 0],
        ],
      }),
    ).rejects.toThrow()
  })

  test('rejects a non-wall in wallIds rather than silently skipping it', async () => {
    await expect(call({ levelId, wallIds: [levelId] })).rejects.toThrow()
  })
})
