import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, ItemNode, LevelNode, SlabNode, WallNode } from '../../schema'
import { catalogueKey } from './catalogue'
import { itemBodies } from './items'
import type { Prism } from './types'
import type { Nodes } from './walls'

const SHA = 'a'.repeat(64)

function scene(extra: AnyNode[]): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] })
  return Object.fromEntries([building, level, ...extra].map((node) => [node.id, node])) as Nodes
}

const asset = (over: Record<string, unknown> = {}) => ({
  id: 'thing',
  name: 'Thing',
  category: 'furniture',
  thumbnail: '/thumb.webp',
  src: `artifact://${SHA}`,
  dimensions: [1.2, 0.75, 0.7],
  ...over,
})

type Manifest = Record<string, unknown>

const manifestOf = (over: Manifest = {}) => ({
  bounds: { min: [-0.6, 0, -0.35], max: [0.6, 0.75, 0.35] },
  triangles: 12,
  ...over,
})

const TABLE_SHAPE = {
  tolerance: 0.009,
  bands: [
    {
      y0: 0,
      y1: 0.7,
      polygons: [
        {
          outer: [
            [-0.6, -0.35],
            [-0.55, -0.35],
            [-0.55, -0.3],
            [-0.6, -0.3],
          ],
        },
        {
          outer: [
            [0.55, -0.35],
            [0.6, -0.35],
            [0.6, -0.3],
            [0.55, -0.3],
          ],
        },
      ],
    },
    {
      y0: 0.7,
      y1: 0.75,
      polygons: [
        {
          outer: [
            [-0.6, -0.35],
            [0.6, -0.35],
            [0.6, 0.35],
            [-0.6, 0.35],
          ],
        },
      ],
    },
  ],
}

function scripted(over: Record<string, unknown> = {}, manifest: Manifest = {}) {
  return ItemNode.parse({
    id: 'item_1',
    parentId: 'level_1',
    position: [3, 0, 2],
    asset: asset(),
    source: { kind: 'script', script: SHA, artifact: SHA, manifest: manifestOf(manifest) },
    ...over,
  })
}

const bounds = (prisms: Prism[]) => {
  const points = prisms.flatMap((p) => p.outer)
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }
}

const prismsOf = (nodes: Nodes, id = 'item_1') =>
  itemBodies(nodes).items.find((i) => i.itemId === id)!.prisms

describe('a scripted item with a stored shape', () => {
  test('stands where it is placed, band by band', () => {
    const prisms = prismsOf(scene([scripted({}, { shape: TABLE_SHAPE })]))
    expect(prisms).toHaveLength(3)
    const top = prisms.find((p) => p.z0 > 0.69)!
    expect([top.z0, top.z1]).toEqual([0.7, 0.75])
    expect(bounds([top])).toEqual({ x0: 2.4, x1: 3.6, z0: 1.65, z1: 2.35 })
    expect(prisms.every((p) => p.shape === 'exact' && p.kind === 'item')).toBe(true)
  })

  test('turns with the item and scales with it', () => {
    const turned = prismsOf(
      scene([scripted({ rotation: [0, Math.PI / 2, 0] }, { shape: TABLE_SHAPE })]),
    )
    const top = turned.find((p) => p.z0 > 0.69)!
    const b = bounds([top])
    expect(b.x1 - b.x0).toBeCloseTo(0.7, 6)
    expect(b.z1 - b.z0).toBeCloseTo(1.2, 6)
    const scaled = prismsOf(scene([scripted({ scale: [2, 1.5, 1] }, { shape: TABLE_SHAPE })]))
    const wide = scaled.find((p) => p.z0 > 1)!
    expect(wide.z1).toBeCloseTo(1.125, 6)
    expect(bounds([wide]).x1 - bounds([wide]).x0).toBeCloseTo(2.4, 6)
  })

  test("a mirrored item keeps each ring's winding", () => {
    const [prism] = prismsOf(
      scene([scripted({ scale: [-1, 1, 1] }, { shape: TABLE_SHAPE })]),
    ).filter((p) => p.z0 > 0.69)
    const area = prism!.outer.reduce((sum, p, i) => {
      const q = prism!.outer[(i + 1) % prism!.outer.length]!
      return sum + p[0] * q[1] - q[0] * p[1]
    }, 0)
    expect(area).toBeGreaterThan(0)
  })

  test('the asset corrective offset and rotation apply before the item scale and pose', () => {
    const prisms = prismsOf(
      scene([
        scripted(
          { asset: asset({ offset: [0.1, 0.05, 0], rotation: [0, Math.PI / 2, 0] }) },
          { shape: TABLE_SHAPE },
        ),
      ]),
    )
    const top = prisms.find((p) => p.z0 > 0.7)!
    expect(top.z0).toBeCloseTo(0.75, 6)
    const b = bounds([top])
    expect(b.x1 - b.x0).toBeCloseTo(0.7, 6)
    expect((b.x0 + b.x1) / 2).toBeCloseTo(3.1, 6)
  })

  test('it stands on the slab under it, at the level above the floor', () => {
    const slab = SlabNode.parse({
      id: 'slab_1',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
      elevation: 0.15,
    })
    const prisms = prismsOf(scene([slab, scripted({}, { shape: TABLE_SHAPE })]))
    expect(Math.min(...prisms.map((p) => p.z0))).toBeCloseTo(0.15, 6)
    const pinned = scripted({ supportSlabId: 'ground' }, { shape: TABLE_SHAPE })
    expect(Math.min(...prismsOf(scene([slab, pinned])).map((p) => p.z0))).toBeCloseTo(0, 6)
  })

  test('a shape simplified to fit its manifest is approximate', () => {
    const coarse = { ...TABLE_SHAPE, tolerance: 0.05 }
    expect(
      prismsOf(scene([scripted({}, { shape: coarse })])).every((p) => p.shape === 'approx'),
    ).toBe(true)
  })
})

describe('an item without a stored shape', () => {
  test("a script compiled before reads as its parts' boxes, approximate", () => {
    const parts = [
      { id: 'legs', bounds: { min: [-0.6, 0, -0.35], max: [0.6, 0.7, 0.35] } },
      { id: 'top', bounds: { min: [-0.6, 0.7, -0.35], max: [0.6, 0.75, 0.35] } },
    ]
    const prisms = prismsOf(scene([scripted({}, { parts })]))
    expect(prisms).toHaveLength(2)
    expect(prisms.every((p) => p.shape === 'approx' && p.why?.includes('parts'))).toBe(true)
  })

  test('with no parts it is its bounds box', () => {
    const prisms = prismsOf(scene([scripted()]))
    expect(prisms).toHaveLength(1)
    expect(prisms[0]!.why).toContain('bounds box')
  })

  test('a catalogue model is its box, centred on its position', () => {
    const chair = ItemNode.parse({
      id: 'item_2',
      parentId: 'level_1',
      position: [1, 0, 1],
      asset: asset({ src: '/items/chair/model.glb', dimensions: [0.5, 0.9, 0.5] }),
    })
    const [prism] = prismsOf(scene([chair]), 'item_2')
    expect(bounds([prism!])).toEqual({ x0: 0.75, x1: 1.25, z0: 0.75, z1: 1.25 })
    expect([prism!.z0, prism!.z1]).toEqual([0, 0.9])
    expect(prism!.shape).toBe('approx')
  })

  test('a library model has the outline baked from its GLB, under its own corrective transform', () => {
    const src = 'https://host.example/storage/v1/object/public/items/system/fridge/model.glb'
    expect(catalogueKey(src)).toBe('system/fridge')
    expect(catalogueKey('artifact://abc')).toBeNull()
    const fridge = ItemNode.parse({
      id: 'item_5',
      parentId: 'level_1',
      position: [2, 0, 2],
      asset: asset({ src, dimensions: [0.7, 1.8, 0.7] }),
    })
    const prisms = prismsOf(scene([fridge]), 'item_5')
    expect(prisms.length).toBeGreaterThan(0)
    expect(prisms.every((p) => p.shape === 'exact')).toBe(true)
    expect(Math.max(...prisms.map((p) => p.z1))).toBeGreaterThan(1.5)
  })

  test('an item tilted about a horizontal axis is its box, approximate', () => {
    const prisms = prismsOf(scene([scripted({ rotation: [0.4, 0, 0] }, { shape: TABLE_SHAPE })]))
    expect(prisms).toHaveLength(1)
    expect(prisms[0]!.why).toContain('horizontal axis')
  })
})

describe('items hosted elsewhere', () => {
  test('an item on another item stands on it and turns with it', () => {
    const table = scripted({ rotation: [0, Math.PI / 2, 0] }, { shape: TABLE_SHAPE })
    const lamp = ItemNode.parse({
      id: 'item_2',
      parentId: table.id,
      position: [0.5, 0.75, 0],
      asset: asset({ src: '/items/lamp/model.glb', dimensions: [0.2, 0.4, 0.2] }),
    })
    const [prism] = prismsOf(scene([table, lamp]), 'item_2')
    expect(prism!.z0).toBeCloseTo(0.75, 6)
    expect(prism!.z1).toBeCloseTo(1.15, 6)
    // 0.5 m along the table's x, which a quarter turn lays along -z
    const b = bounds([prism!])
    expect((b.x0 + b.x1) / 2).toBeCloseTo(3, 6)
    expect((b.z0 + b.z1) / 2).toBeCloseTo(1.5, 6)
  })

  test('a wall-mounted item stands out of the wall face it is on', () => {
    const wall = WallNode.parse({
      id: 'wall_1',
      parentId: 'level_1',
      start: [0, 0],
      end: [6, 0],
      thickness: 0.1,
      children: ['item_3'],
    })
    const cabinet = ItemNode.parse({
      id: 'item_3',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.4, 0],
      asset: asset({
        attachTo: 'wall-side',
        src: '/items/cabinet/model.glb',
        dimensions: [0.85, 0.6, 0.46],
      }),
      side: 'front',
    })
    const [prism] = prismsOf(scene([wall, cabinet]), 'item_3')
    expect(prism!.host).toEqual({ wallId: 'wall_1', face: 'a' })
    // the catalogue box is centred on its position, so half of it is in the wall: the face-side z is 0.05
    expect([prism!.z0, prism!.z1]).toEqual([1.4, 2.0])
  })

  test('a ceiling item is counted, not shaped', () => {
    const lamp = ItemNode.parse({
      id: 'item_4',
      parentId: 'level_1',
      asset: asset({ attachTo: 'ceiling' }),
    })
    const result = itemBodies(scene([lamp]))
    expect(result.items).toHaveLength(0)
    expect(result.unshaped).toEqual({ 'ceiling item': 1 })
  })

  test('a hidden item, or one in a hidden level, is left out', () => {
    expect(itemBodies(scene([scripted({ visible: false })])).items).toHaveLength(0)
  })
})
