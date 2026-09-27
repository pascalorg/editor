import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { shelfRecipe } from '@pascal-app/core/procedural-items'
import * as schema from '@pascal-app/core/schema'
import {
  AnyNode,
  type AnyNodeId,
  BlockNode,
  CabinetModuleNode,
  CabinetNode,
  FenceNode,
  LevelNode,
  nodeKindOf,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
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
  approximate?: Array<{ id: string; reason: string }>
  fromPoint?: [number, number, number]
  toPoint?: [number, number, number]
}

/** Fields a kind needs beyond its schema defaults (mirrors core's node fixtures). */
const REQUIRED_FIELDS: Record<string, Record<string, unknown>> = {
  'procedural-item': { recipe: shelfRecipe },
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

const ROOF_ACCESSORIES = [
  'box-vent',
  'chimney',
  'cupola',
  'dormer',
  'downspout',
  'eyebrow-vent',
  'gutter',
  'ridge-vent',
  'skylight',
  'solar-panel',
  'turbine-vent',
]

/** Kinds the viewer lifts onto the slab under them when they sit on a level. */
const FLOOR_PLACED = new Set([
  'block',
  'cabinet',
  'column',
  'duct-terminal',
  'hvac-equipment',
  'item',
  'procedural-item',
  'shelf',
  'spawn',
  'stair',
])

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

  test('a floor-placed block stands on the elevated slab under it', async () => {
    seedRef()
    const deck = SlabNode.parse({
      elevation: 1,
      polygon: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
    })
    const block = BlockNode.parse({ position: [0, 0, 0] })
    bridge.applyPatch([
      { op: 'create', node: deck, parentId: level.id as AnyNodeId },
      { op: 'create', node: block, parentId: level.id as AnyNodeId },
    ])
    // Rendered: the 1 m deck plus the 1.2 m half-height of the default block.
    expectPoint(await pointOf(block.id), [0, 2.2, 0])
  })

  test('a curved railing on a deck is measured on its arc at the deck height', async () => {
    seedRef()
    const deck = SlabNode.parse({
      elevation: 1,
      polygon: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
    })
    const railing = FenceNode.parse({
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
      supportSlabId: deck.id,
    })
    bridge.applyPatch([
      { op: 'create', node: deck, parentId: level.id as AnyNodeId },
      { op: 'create', node: railing, parentId: level.id as AnyNodeId },
    ])
    const point = await pointOf(railing.id)
    expect(point![0]).toBeCloseTo(2, 6)
    expect(point![1]).toBeCloseTo(1, 6)
    expect(Math.abs(point![2]!)).toBeCloseTo(1, 6)
  })

  test('polygons are measured at their area centroid', async () => {
    seedRef()
    // An L whose vertex average (1.667, 1.667) falls outside the shape.
    const zone = ZoneNode.parse({
      name: 'L',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 1],
        [1, 1],
        [1, 4],
        [0, 4],
      ],
    })
    bridge.applyPatch([{ op: 'create', node: zone, parentId: level.id as AnyNodeId }])
    expectPoint(await pointOf(zone.id), [1.357142857, 0, 1.357142857])
  })

  test('every kind resolves on its real host, with renderer-derived poses flagged', async () => {
    const ref = seedRef()
    const deck = SlabNode.parse({
      elevation: 1,
      polygon: [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
      ],
    })
    const wall = WallNode.parse({ start: [0, 0], end: [8, 0] })
    const segment = RoofSegmentNode.parse({ position: [2, 0, 0], wallHeight: 3 })
    const roof = RoofNode.parse({ position: [0, 3, 10], children: [segment.id] })
    const cabinet = CabinetNode.parse({ position: [5, 0, 5] })
    const stair = StairNode.parse({ position: [-5, 0, -5] })
    const hosts: Record<string, AnyNode> = { wall, 'roof-segment': segment, cabinet, stair }
    const hostOf: Record<string, string> = {
      door: 'wall',
      window: 'wall',
      'cabinet-module': 'cabinet',
      'stair-segment': 'stair',
    }
    for (const kind of ROOF_ACCESSORIES) hostOf[kind] = 'roof-segment'

    const patches: Parameters<SceneBridge['applyPatch']>[0] = [
      { op: 'create', node: deck, parentId: level.id as AnyNodeId },
      { op: 'create', node: wall, parentId: level.id as AnyNodeId },
      { op: 'create', node: roof, parentId: level.id as AnyNodeId },
      { op: 'create', node: segment, parentId: roof.id as AnyNodeId },
      { op: 'create', node: cabinet, parentId: level.id as AnyNodeId },
      { op: 'create', node: stair, parentId: level.id as AnyNodeId },
    ]
    const covered = new Set(['site', 'building', 'level', 'zone', 'slab', 'wall', 'roof'])
    for (const node of minimalNodes()) {
      if (covered.has(node.type) || hosts[node.type]) continue
      covered.add(node.type)
      const host = hosts[hostOf[node.type] ?? ''] ?? level
      const data = node as Record<string, unknown>
      if (host.type === 'wall') data.wallId = host.id
      if (host.type === 'roof-segment') data.roofSegmentId = host.id
      patches.push({ op: 'create', node, parentId: host.id as AnyNodeId })
    }
    for (const kind of Object.keys(hosts)) covered.add(kind)
    bridge.applyPatch(patches)
    // Every kind of the node union is in the scene, none skipped.
    expect([...covered].sort()).toEqual(AnyNode.options.map(nodeKindOf).sort())

    const failures: string[] = []
    const approximate: string[] = []
    const floorPlacedBelowDeck: string[] = []
    for (const node of Object.values(bridge.getNodes())) {
      if (node.id === ref.id) continue
      const { isError, text, payload } = await measure(node.id, ref.id)
      if (isError || !Number.isFinite(payload?.distanceMeters)) {
        failures.push(`${node.type}: ${text}`)
        continue
      }
      if (payload?.approximate?.some((entry) => entry.id === node.id)) approximate.push(node.type)
      if (FLOOR_PLACED.has(node.type) && node.parentId === level.id) {
        if ((payload?.fromPoint?.[1] ?? 0) < 1 - 1e-6) floorPlacedBelowDeck.push(node.type)
      }
    }
    expect(failures).toEqual([])
    expect(floorPlacedBelowDeck).toEqual([])
    expect(approximate.sort()).toEqual(['downspout', 'gutter', 'ridge-vent'])
  })
})
