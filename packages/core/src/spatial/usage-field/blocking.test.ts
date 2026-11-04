import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { usageIssues } from './findings'
import type { Nodes } from './walls'

const SHA = 'c'.repeat(64)

const scene = (extra: AnyNode[]): Nodes =>
  Object.fromEntries(
    [
      BuildingNode.parse({ id: 'building_1', children: ['level_1'] }),
      LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] }),
      ...extra,
    ].map((node) => [node.id, node]),
  ) as Nodes
const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
  extra: Record<string, unknown> = {},
) => WallNode.parse({ id, parentId: 'level_1', start, end, thickness: 0.1, children, ...extra })
const zone = (id: string, name: string, polygon: [number, number][]) =>
  ZoneNode.parse({ id, parentId: 'level_1', name, polygon, spaceRole: 'room' })
const slab = (polygon: [number, number][], holes: [number, number][][] = []) =>
  SlabNode.parse({ id: 'slab_1', parentId: 'level_1', polygon, holes, elevation: 0.05 })
const door = (id: string, wallId: string, along: number, extra: Record<string, unknown> = {}) =>
  DoorNode.parse({
    id,
    parentId: wallId,
    wallId,
    position: [along, 1.05, 0],
    width: 0.9,
    height: 2.1,
    // A frame inside the wall's thickness: one as deep as the wall puts the door, not the wall, at
    // the room's edge, which these figures are drawn without.
    frameDepth: 0.07,
    name: id,
    ...extra,
  })

/** A script-made piece with a stored solid outline (tolerance 9 mm: exact), centred on (x, z). */
const piece = (
  id: string,
  name: string,
  category: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  extra: Record<string, unknown> = {},
) =>
  ItemNode.parse({
    id,
    parentId: 'level_1',
    position: [x, 0, z],
    name,
    asset: {
      id,
      name,
      category,
      thumbnail: '/t.webp',
      src: `artifact://${SHA}`,
      dimensions: [width, height, depth],
    },
    source: {
      kind: 'script',
      script: SHA,
      artifact: SHA,
      manifest: {
        bounds: { min: [-width / 2, 0, -depth / 2], max: [width / 2, height, depth / 2] },
        triangles: 12,
        shape: {
          tolerance: 0.009,
          bands: [
            {
              y0: 0,
              y1: height,
              polygons: [
                {
                  outer: [
                    [-width / 2, -depth / 2],
                    [width / 2, -depth / 2],
                    [width / 2, depth / 2],
                    [-width / 2, depth / 2],
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    ...extra,
  })

const run = (nodes: Nodes, type: string) =>
  usageIssues(nodes, { cell: 0.05, entranceDoorId: 'door_1' }).filter(
    (issue) => issue.type === type,
  )

describe('a slit in the floor is stepped over', () => {
  /** A 6 x 4 floor entered by a door in its south wall, the Study at its north end; the slab has `holes`. */
  const floor = (holes: [number, number][][]) =>
    scene([
      slab(
        [
          [-0.3, -0.3],
          [6.3, -0.3],
          [6.3, 4.3],
          [-0.3, 4.3],
        ],
        holes,
      ),
      wall('wall_s', [0, 0], [6, 0], ['door_1']),
      wall('wall_e', [6, 0], [6, 4]),
      wall('wall_n', [6, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      door('door_1', 'wall_s', 3),
      zone('zone_1', 'Entry', [
        [0, 0],
        [6, 0],
        [6, 1.5],
        [0, 1.5],
      ]),
      zone('zone_2', 'Study', [
        [0, 2.5],
        [6, 2.5],
        [6, 4],
        [0, 4],
      ]),
    ])
  const across = (z0: number, z1: number, x0 = 0.05, x1 = 5.95): [number, number][] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]

  /** What the floor's passage findings say bounds them. */
  const bounds = (holes: [number, number][][]) =>
    run(floor(holes), 'usage_passage_narrow').flatMap((f) => f.obstacles.map((o) => o.kind))

  test('a hole 0.8 m wide that leaves 0.45 m at each end of the floor is an obstacle that bounds a passage', () => {
    expect(bounds([across(1.6, 2.4, 0.5, 5.5)])).toContain('void')
  })

  test('a slit 3 mm wide across the room is no obstacle, a 5 m one at 3 degrees neither', () => {
    expect(bounds([across(1.9985, 2.0015)])).not.toContain('void')
    const slope = Math.tan((3 * Math.PI) / 180) * 5.9
    const slanted: [number, number][] = [
      [0.05, 1.5],
      [5.95, 1.5 + slope],
      [5.95, 1.503 + slope],
      [0.05, 1.503],
    ]
    expect(bounds([slanted])).not.toContain('void')
  })

  test('a triangle 1 m long and 0.3 mm wide, as a room boundary leaves in a floor plate, is no obstacle', () => {
    const sliver: [number, number][] = [
      [1, 2],
      [2.05, 1.95],
      [2.05, 1.9497],
    ]
    expect(bounds([sliver])).not.toContain('void')
  })
})

describe('usage_entry_narrow: what closes off part of a room', () => {
  const entry = (nodes: Nodes) => run(nodes, 'usage_entry_narrow')

  /** A `w` x 3 room, `Kitchen`, with a doorway 0.9 m wide in its south wall at x = 1.5. */
  const kitchen = (extra: AnyNode[], w = 3) =>
    scene([
      slab([
        [-0.3, -0.3],
        [w + 0.3, -0.3],
        [w + 0.3, 3.3],
        [-0.3, 3.3],
      ]),
      wall('wall_s', [0, 0], [w, 0], ['door_1']),
      wall('wall_e', [w, 0], [w, 3]),
      wall('wall_n', [w, 3], [0, 3]),
      wall('wall_w', [0, 3], [0, 0]),
      door('door_1', 'wall_s', Math.min(1.5, w / 2)),
      zone('zone_1', 'Kitchen', [
        [0, 0],
        [w, 0],
        [w, 3],
        [0, 3],
      ]),
      ...extra,
    ])
  /** 0.7 x 0.7 m, its front 0.25 m from the south wall's face in front of the doorway: 0.22 m left to go in, at the corner by the jamb. */
  const fridge = (extra: Record<string, unknown> = {}, name = 'Fridge', category = 'fridge') =>
    piece('item_fridge', name, category, 1.5, 0.6, 0.7, 0.7, 1.8, extra)

  test('a free piece in front of the doorway that leaves about 0.2 m is a warning naming it, the room and what is on the other side of the pinch', () => {
    const found = entry(kitchen([fridge()]))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      type: 'usage_entry_narrow',
      severity: 'warning',
      thresholdM: 0.9,
      approximate: false,
    })
    expect(found[0]!.valueM).toBeGreaterThan(0.15)
    expect(found[0]!.valueM).toBeLessThan(0.25)
    expect(found[0]!.message).toBe(
      '“Fridge” leaves 0.22 m to enter “Kitchen”, between it and “Wall s” (below 0.90 m).',
    )
    expect(found[0]!.nodeIds).toEqual(['zone_1', 'item_fridge', 'wall_s', 'door_1'])
    expect(found[0]!.place.room).toBe('Kitchen')
  })

  test('a piece that leaves a passage and more says nothing', () => {
    expect(
      entry(kitchen([piece('item_f', 'Fridge', 'fridge', 1.5, 1.4, 0.7, 0.7, 1.8)])),
    ).toHaveLength(0)
  })

  test('what is built to stand there stays quiet: a fixture, built-in joinery, a piece on a wall, foliage, a piece on another piece', () => {
    expect(entry(kitchen([fridge({}, 'Vanity', 'cabinet-base')]))).toHaveLength(0)
    expect(entry(kitchen([fridge({}, 'Toilet', 'sanitary')]))).toHaveLength(0)
    expect(entry(kitchen([fridge({}, 'Built-in robe', 'wardrobe')]))).toHaveLength(0)
    expect(entry(kitchen([fridge({}, 'Potted fern', 'decor')]))).toHaveLength(0)
    const onWall = fridge()
    onWall.asset = { ...onWall.asset, attachTo: 'wall' }
    expect(entry(kitchen([onWall]))).toHaveLength(0)
    const onTable = fridge({ parentId: 'item_table' })
    expect(
      entry(kitchen([piece('item_table', 'Table', 'table', 4, 4, 0.1, 0.1, 0.1), onTable])),
    ).toHaveLength(0)
  })

  test('a room narrower than a passage is judged on its doorway only', () => {
    expect(entry(kitchen([fridge()], 0.85))).toHaveLength(0)
  })

  test('an open edge between two rooms is an entrance: the way into the second room past a piece 0.2 m from the end of the wall', () => {
    const open = scene([
      slab([
        [-0.3, -0.3],
        [6.3, -0.3],
        [6.3, 3.3],
        [-0.3, 3.3],
      ]),
      wall('wall_s', [0, 0], [6, 0]),
      wall('wall_e', [6, 0], [6, 3]),
      wall('wall_n', [6, 3], [0, 3]),
      wall('wall_w', [0, 3], [0, 0]),
      wall('wall_mid_a', [3, 0], [3, 1]),
      wall('wall_mid_b', [3, 3], [3, 2.2]),
      zone('zone_a', 'Hall', [
        [0, 0],
        [3, 0],
        [3, 3],
        [0, 3],
      ]),
      zone('zone_b', 'Study', [
        [3, 0],
        [6, 0],
        [6, 3],
        [3, 3],
      ]),
      piece('item_desk', 'Desk', 'desk', 3.5, 1.6, 0.8, 0.8, 0.75),
    ])
    const found = entry(open)
    expect(found.map((f) => f.place.room)).toEqual(['Study'])
    expect(found[0]!.message).toContain('“Desk” leaves')
    expect(found[0]!.severity).toBe('warning')
  })

  test('an approximate fridge closing the way in is a warning with its uncertainty preserved', () => {
    const rough = ItemNode.parse({
      id: 'item_fridge',
      parentId: 'level_1',
      position: [1.5, 0, 0.6],
      name: 'Fridge',
      asset: {
        id: 'fridge',
        name: 'Fridge',
        category: 'fridge',
        thumbnail: '/t.webp',
        src: 'asset://fridge',
        dimensions: [0.7, 1.8, 0.7],
      },
    })
    const found = entry(kitchen([rough]))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warning', approximate: true })
    const roomDefects = run(kitchen([rough]), 'usage_pocket')
    expect(roomDefects.length).toBeGreaterThan(0)
    expect(roomDefects.every((issue) => issue.severity === 'warning')).toBe(true)
  })

  test('approximate cupboards leaving a 1.3 m turning space inform: a turning circle measures the room', () => {
    const cupboards = [
      [0.45, 1.5, 0.8, 2.8],
      [2.55, 1.5, 0.8, 2.8],
      [1.5, 0.45, 2.8, 0.8],
      [1.5, 2.55, 2.8, 0.8],
    ].map(([x, z, width, depth], index) =>
      ItemNode.parse({
        ...fridge(),
        id: `item_cupboard${index}`,
        source: undefined,
        position: [x, 0, z],
        asset: { ...fridge().asset, dimensions: [width, 1.8, depth] },
      }),
    )
    expect(run(kitchen(cupboards), 'usage_turning_narrow')).toContainEqual(
      expect.objectContaining({ severity: 'info', approximate: true }),
    )
  })
})

describe('usage_opening_blocked: a free piece in front of a window', () => {
  const blocked = (nodes: Nodes) => run(nodes, 'usage_opening_blocked')

  /** A 4 x 4 bedroom whose south wall (room face at z = 0.05) carries a window 1.6 m wide, sill at 0.9 m. */
  const bedroom = (extra: AnyNode[], hosted: string[] = []) =>
    scene([
      slab([
        [-0.3, -0.3],
        [4.3, -0.3],
        [4.3, 4.3],
        [-0.3, 4.3],
      ]),
      wall('wall_s', [0, 0], [4, 0], ['window_1', ...hosted]),
      wall('wall_e', [4, 0], [4, 4]),
      wall('wall_n', [4, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      WindowNode.parse({
        id: 'window_1',
        parentId: 'wall_s',
        wallId: 'wall_s',
        position: [2, 1.5, 0],
        width: 1.6,
        height: 1.2,
        name: 'Bed 3 window',
      }),
      zone('zone_1', 'Bed 3', [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
      ...extra,
    ])
  /** Its front face 0.17 m from the glass, as the curtains of the run were. */
  const curtains = (width: number, name = 'Bed 3 curtains') =>
    piece('item_c', name, 'curtain', 2, 0.05 + 0.17 + 0.05, width, 0.1, 1.28)

  test('curtains standing free 0.17 m from the glass over all of it are a warning that names them and the window', () => {
    const found = blocked(bedroom([curtains(1.64)]))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warning', thresholdM: 0.3, approximate: false })
    expect(found[0]!.message).toBe(
      '“Bed 3 curtains” stands 17 cm from the glass of “Bed 3 window” in “Bed 3”, 38 cm above its sill, over 100 % of its width, and is not hosted on the window.',
    )
    expect(found[0]!.nodeIds).toEqual(['zone_1', 'window_1', 'item_c'])
  })

  test('a free curtain over a part of the glass is a warning too, and a wardrobe across all of it and up past its head', () => {
    expect(blocked(bedroom([curtains(0.5)]))).toMatchObject([{ severity: 'warning' }])
    const wardrobe = piece('item_w', 'Wardrobe', 'wardrobe', 2, 0.05 + 0.2 + 0.3, 1.6, 0.6, 2.2)
    expect(blocked(bedroom([wardrobe]))).toMatchObject([{ severity: 'warning' }])
  })

  test('an approximate free curtain covering the window is still a warning', () => {
    const curtain = curtains(1.64)
    delete curtain.source
    expect(blocked(bedroom([curtain]))).toMatchObject([
      { severity: 'warning', approximate: true, nodeIds: ['zone_1', 'window_1', 'item_c'] },
    ])
  })

  test('a piece that covers part of the glass, a sofa back stays information, a bed head and a low piece are nothing', () => {
    const narrow = piece('item_n', 'Wardrobe', 'wardrobe', 2, 0.05 + 0.2 + 0.3, 0.8, 0.6, 2)
    expect(blocked(bedroom([narrow]))).toMatchObject([{ severity: 'info' }])
    // a sofa's back across all of the glass, 0.4 m above the sill, is a design choice
    const sofa = piece('item_f', 'Sofa', 'sofa', 2, 0.05 + 0.2 + 0.3, 1.8, 0.6, 1.3)
    expect(blocked(bedroom([sofa]))).toMatchObject([{ severity: 'info' }])
    const bed = piece('item_b', 'Bed', 'bed', 2, 0.05 + 0.2 + 0.3, 1.6, 0.6, 1.2)
    expect(blocked(bedroom([bed]))).toHaveLength(0)
    const sideboard = piece('item_s', 'Sideboard', 'sideboard', 2, 0.05 + 0.2 + 0.25, 1.6, 0.5, 0.8)
    expect(blocked(bedroom([sideboard]))).toHaveLength(0)
  })

  test('curtains hosted on the window wall say nothing', () => {
    const hosted = ItemNode.parse({
      id: 'item_h',
      parentId: 'wall_s',
      wallId: 'wall_s',
      position: [2, 1.5, 0],
      side: 'front',
      name: 'Bed 3 curtains',
      asset: {
        id: 'curtain',
        name: 'Bed 3 curtains',
        category: 'curtain',
        thumbnail: '/t.webp',
        src: 'asset://curtain',
        dimensions: [1.64, 1.28, 0.1],
        attachTo: 'wall-side',
      },
    })
    expect(blocked(bedroom([hosted], ['item_h']))).toHaveLength(0)
  })
})
