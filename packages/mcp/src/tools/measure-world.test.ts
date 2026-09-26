import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as schema from '@pascal-app/core/schema'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  CabinetModuleNode,
  CabinetNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerMeasure } from './measure'

type Vec3 = [number, number, number]

type MeasurePayload = {
  distanceMeters: number
  fromPoint?: [number, number, number]
  toPoint?: [number, number, number]
}

/** Fields a kind needs beyond its schema defaults (mirrors core's node fixtures). */
const REQUIRED_FIELDS: Record<string, Record<string, unknown>> = {
  ceiling: {
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
  },
  'duct-segment': {
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  fence: { start: [0, 0], end: [4, 0] },
  guide: { url: 'asset://guide.png' },
  item: {
    asset: {
      id: 'asset-1',
      category: 'furniture',
      name: 'Chair',
      thumbnail: 'asset://chair.png',
      src: 'asset://chair.glb',
    },
  },
  lineset: {
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  'liquid-line': {
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  measurement: {
    measurement: {
      kind: 'distance',
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    },
  },
  'pipe-segment': {
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  slab: {
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
  },
  wall: { start: [0, 0], end: [4, 0] },
  zone: {
    name: 'Kitchen',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
  },
}

/** One minimal node per kind the per-kind schemas can build from defaults. */
function minimalNodes(): AnyNode[] {
  const out: AnyNode[] = []
  for (const exported of Object.values(schema)) {
    const shape = (exported as { shape?: Record<string, unknown> })?.shape
    const discriminator = shape?.type as { unwrap?: () => { value?: unknown } } | undefined
    const kind = discriminator?.unwrap?.().value
    if (typeof kind !== 'string') continue
    const parsed = (
      exported as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
    ).safeParse({ ...REQUIRED_FIELDS[kind] })
    if (parsed.success) out.push(parsed.data as AnyNode)
  }
  return out
}

describe('measure in world space', () => {
  let client: Client
  let bridge: SceneBridge
  let level: AnyNode

  async function measure(fromId: string, toId: string) {
    const result = await client.callTool({ name: 'measure', arguments: { fromId, toId } })
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text
    return {
      isError: result.isError === true,
      text,
      payload: result.isError ? null : (JSON.parse(text) as MeasurePayload),
    }
  }

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerMeasure(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
  })

  function expectPoint(actual: number[] | undefined, expected: Vec3) {
    expect(actual).toHaveLength(3)
    for (let i = 0; i < 3; i++) expect(actual![i]!).toBeCloseTo(expected[i]!, 6)
  }

  async function pointOf(id: string): Promise<number[] | undefined> {
    const zone = Object.values(bridge.getNodes()).find((n) => n.type === 'zone' && n.name === 'Ref')
    const { payload } = await measure(id, zone!.id)
    return payload?.fromPoint
  }

  function seedRef() {
    const zone = ZoneNode.parse({
      name: 'Ref',
      polygon: [
        [12, 3],
        [14, 3],
        [14, 5],
        [12, 5],
      ],
    })
    bridge.applyPatch([{ op: 'create', node: zone, parentId: level.id as AnyNodeId }])
    return zone
  }

  test('a window is measured where its wall hosts it', async () => {
    const zone = seedRef()
    const wall = WallNode.parse({ start: [10, 0], end: [16, 0] })
    const window = WindowNode.parse({ wallId: wall.id, position: [3, 1.2, 0] })
    bridge.applyPatch([
      { op: 'create', node: wall, parentId: level.id as AnyNodeId },
      { op: 'create', node: window, parentId: wall.id as AnyNodeId },
    ])

    const own = await measure(wall.id, window.id)
    expect(own.isError).toBe(false)
    // Before: the window's wall-local [3, 1.2, 0] was read as a level point (10.07 m).
    expect(own.payload!.distanceMeters).toBeCloseTo(1.2, 6)
    expectPoint(own.payload!.fromPoint, [13, 0, 0])
    expectPoint(own.payload!.toPoint, [13, 1.2, 0])

    const toZone = await measure(window.id, zone.id)
    expect(toZone.payload!.distanceMeters).toBeCloseTo(Math.hypot(1.2, 4), 6)
  })

  test('a window follows its wall direction', async () => {
    seedRef()
    const wall = WallNode.parse({ start: [0, 0], end: [0, 6] })
    const window = WindowNode.parse({ wallId: wall.id, position: [2, 1.2, 0] })
    bridge.applyPatch([
      { op: 'create', node: wall, parentId: level.id as AnyNodeId },
      { op: 'create', node: window, parentId: wall.id as AnyNodeId },
    ])
    expectPoint(await pointOf(window.id), [0, 1.2, 2])
  })

  test('upper levels add their stacked base and the building transform', async () => {
    const building = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!
    bridge.applyPatch([
      { op: 'update', id: building.id as AnyNodeId, data: { position: [100, 0, 0] } },
      { op: 'update', id: level.id as AnyNodeId, data: { height: 3 } },
    ])
    seedRef()
    const upper = LevelNode.parse({ level: 1, height: 3 })
    const wall = WallNode.parse({ start: [10, 0], end: [16, 0], height: 2.5 })
    const window = WindowNode.parse({ wallId: wall.id, position: [3, 1.2, 0] })
    bridge.applyPatch([
      { op: 'create', node: upper, parentId: building.id as AnyNodeId },
      { op: 'create', node: wall, parentId: upper.id as AnyNodeId },
      { op: 'create', node: window, parentId: wall.id as AnyNodeId },
    ])
    expectPoint(await pointOf(window.id), [113, 4.2, 0])
    // A level: the plan centre of its content (one wall) on its base plane.
    expectPoint(await pointOf(upper.id), [113, 3, 0])
  })

  test('roof segments, cabinet modules and stair segments compose their host frames', async () => {
    seedRef()
    const segment = RoofSegmentNode.parse({ position: [2, 0, 0] })
    const roof = RoofNode.parse({
      position: [5, 0, 5],
      rotation: Math.PI / 2,
      children: [segment.id],
    })
    const cabinet = CabinetNode.parse({ position: [1, 0, 1], rotation: Math.PI })
    const module = CabinetModuleNode.parse({ position: [0.5, 0.1, 0] })
    const first = StairSegmentNode.parse({ length: 3, height: 1.5 })
    const second = StairSegmentNode.parse({ length: 2, height: 1, attachmentSide: 'front' })
    const stair = StairNode.parse({ position: [20, 0, 0], children: [first.id, second.id] })
    bridge.applyPatch([
      { op: 'create', node: roof, parentId: level.id as AnyNodeId },
      { op: 'create', node: segment, parentId: roof.id as AnyNodeId },
      { op: 'create', node: cabinet, parentId: level.id as AnyNodeId },
      { op: 'create', node: module, parentId: cabinet.id as AnyNodeId },
      { op: 'create', node: stair, parentId: level.id as AnyNodeId },
      { op: 'create', node: first, parentId: stair.id as AnyNodeId },
      { op: 'create', node: second, parentId: stair.id as AnyNodeId },
    ])
    expectPoint(await pointOf(segment.id), [5, 0, 3])
    expectPoint(await pointOf(module.id), [0.5, 0.1, 1])
    expectPoint(await pointOf(second.id), [20, 1.5, 3])
  })

  test('a block is measured at the centre of its vertices', async () => {
    seedRef()
    // Default topology: x and z in [-1, 1], y in [0, 2.4].
    const block = BlockNode.parse({ position: [4, 0, 4], rotation: Math.PI / 2 })
    bridge.applyPatch([{ op: 'create', node: block, parentId: level.id as AnyNodeId }])
    expectPoint(await pointOf(block.id), [4, 1.2, 4])
  })

  test('derives a finite point for every node kind', async () => {
    const zone = ZoneNode.parse({
      name: 'Ref',
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
    })
    const nodes = minimalNodes()
    bridge.applyPatch([
      { op: 'create', node: zone, parentId: level.id as AnyNodeId },
      ...nodes
        .filter((n) => !['site', 'building', 'level'].includes(n.type))
        .map((n) => ({ op: 'create' as const, node: n, parentId: level.id as AnyNodeId })),
    ])
    const failures: string[] = []
    for (const node of Object.values(bridge.getNodes())) {
      if (node.id === zone.id) continue
      const { isError, text, payload } = await measure(node.id, zone.id)
      if (isError || !Number.isFinite(payload?.distanceMeters))
        failures.push(`${node.type}: ${text}`)
    }
    expect(failures).toEqual([])
  })
})
