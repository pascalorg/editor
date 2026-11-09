import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  FenceNode,
  ItemNode,
  LevelNode,
  SlabNode,
  StairNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { usageIssues } from './findings'
import type { Nodes } from './walls'

/**
 * The defects the 26 October audit found and the counter-check on the rendered meshes confirmed,
 * as small scenes: each is a rule the check must keep, not a stored house.
 */
const SHA = 'b'.repeat(64)

const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
  level = 'level_1',
) => WallNode.parse({ id, parentId: level, start, end, thickness: 0.1, children })
const zone = (id: string, name: string, polygon: [number, number][], level = 'level_1') =>
  ZoneNode.parse({ id, parentId: level, name, polygon })
const slab = (
  id: string,
  level: string,
  polygon: [number, number][],
  extra: Record<string, unknown> = {},
) => SlabNode.parse({ id, parentId: level, polygon, elevation: 0.05, ...extra })
const door = (id: string, wallId: string, at: number, width: number, name?: string) =>
  DoorNode.parse({
    id,
    parentId: wallId,
    wallId,
    position: [at, 1.05, 0],
    width,
    height: 2.1,
    ...(name ? { name } : {}),
  })

function scene(levels: number, extra: AnyNode[]): Nodes {
  const ids = Array.from({ length: levels }, (_, i) => `level_${i + 1}`)
  return Object.fromEntries(
    [
      BuildingNode.parse({ id: 'building_1', children: ids }),
      ...ids.map((id, i) =>
        LevelNode.parse({ id, parentId: 'building_1', level: i, children: [] }),
      ),
      ...extra,
    ].map((node) => [node.id, node]),
  ) as Nodes
}

/** A script-made object with a stored outline: a solid box, or a foliage cloud, in the artifact's frame. */
const shaped = (
  id: string,
  name: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
) =>
  ItemNode.parse({
    id,
    parentId: 'level_1',
    position: [x, 0, z],
    name,
    asset: {
      id,
      name,
      category: 'decor',
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
  })

const find = (nodes: Nodes, type: string, room?: string, entranceDoorId = 'door_front') =>
  usageIssues(nodes, { cell: 0.02, entranceDoorId }).filter(
    (i) => i.type === type && (!room || i.place.room === room),
  )

// A 6 m wide, 3.5 m deep hall entered from the south, with a room behind its north wall.
function hall(extra: AnyNode[], backDoor = 0.9) {
  return scene(1, [
    slab('slab_1', 'level_1', [
      [-0.3, -0.3],
      [6.3, -0.3],
      [6.3, 7.3],
      [-0.3, 7.3],
    ]),
    wall('wall_s', [0, 0], [6, 0], ['door_front']),
    door('door_front', 'wall_s', 5, 1, 'Front door'),
    wall('wall_e', [6, 0], [6, 7]),
    wall('wall_w', [0, 7], [0, 0]),
    wall('wall_top', [6, 7], [0, 7]),
    wall('wall_n', [0, 3.5], [6, 3.5], ['door_back']),
    door('door_back', 'wall_n', 1.2, backDoor, 'Laundry door'),
    zone('zone_hall', 'Hall', [
      [0.05, 0.05],
      [5.95, 0.05],
      [5.95, 3.45],
      [0.05, 3.45],
    ]),
    zone('zone_laundry', 'Laundry', [
      [0.05, 3.55],
      [5.95, 3.55],
      [5.95, 6.95],
      [0.05, 6.95],
    ]),
    ...extra,
  ])
}

describe('the audit’s defects, as small scenes', () => {
  test('a stair set against a wall leaves a strip the laundry door opens onto', () => {
    // the stair body fills the hall but a 0.45 m strip along the north wall, where the laundry door is
    const stair = StairNode.parse({
      id: 'stair_1',
      parentId: 'level_1',
      name: 'Staircase',
      position: [2.5, 0, 0],
      width: 4,
      totalRise: 2.7,
      stepCount: 15,
      fillToFloor: true,
    })
    const found = find(hall([stair], 0.9), 'usage_passage_narrow', 'Laundry')
    expect(found).toHaveLength(1)
    expect(found[0]!.valueM).toBeGreaterThan(0.2)
    expect(found[0]!.valueM).toBeLessThan(0.6)
    // the disc that makes the 0.45 m touches the stair alone (the nearest wall is 0.55 m from that spot), so the finding names the stair, not a wall 1.45 m from it
    expect(found[0]!.obstacles.map((o) => o.kind)).toEqual(['stair'])
    expect(found[0]!.severity).toBe('warning')
  })

  test('a door is passed between its jambs: 0.85 m in the wall is 0.75 m to walk through', () => {
    const found = find(hall([], 0.85), 'usage_passage_narrow', 'Laundry')
    expect(found).toHaveLength(1)
    expect(found[0]!.valueM).toBeCloseTo(0.75, 2)
    expect(found[0]!.thresholdM).toBe(0.8)
    expect(found[0]!.obstacles.map((o) => o.kind)).toEqual(['jamb', 'jamb'])
  })

  test('foliage that fills the foot of a stair closes the way to it', () => {
    const stair = StairNode.parse({
      id: 'stair_1',
      parentId: 'level_1',
      name: 'Staircase',
      position: [1.2, 0, 1.0],
      width: 1.0,
      totalRise: 2.7,
      stepCount: 15,
      fillToFloor: true,
      toLevelId: 'level_2',
      fromLevelId: 'level_1',
    })
    // a tree in a pot 0.9 m across, set in front of the first step, 0.15 m from the east wall
    const plant = shaped('item_plant', 'Olive tree', 1.2, 0.5, 0.9, 0.9, 1.6)
    const bare = find(hall([stair]), 'usage_passage_narrow', 'Foot of Staircase')
    const blocked = find(hall([stair, plant]), 'usage_passage_narrow', 'Foot of Staircase')
    expect(bare).toHaveLength(0)
    expect(blocked).toHaveLength(1)
    expect(blocked[0]!.valueM).toBeLessThan(0.3)
    expect(blocked[0]!.obstacles.map((o) => o.name)).toContain('Olive tree')
    expect(blocked[0]!.message).toContain('the foot of “Staircase”')
  })

  test('a window sill that juts into a corridor narrows the way to the room behind', () => {
    const nodes = scene(1, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [8.3, -0.3],
        [8.3, 4.3],
        [-0.3, 4.3],
      ]),
      wall('wall_s', [0, 0], [8, 0], ['door_front']),
      door('door_front', 'wall_s', 0.8, 1, 'Front door'),
      // the corridor's north wall carries a window with a deep sill facing the corridor, and the door to the study
      wall('wall_c', [0, 2], [8, 2], ['window_1', 'door_study']),
      WindowNode.parse({
        id: 'window_1',
        parentId: 'wall_c',
        wallId: 'wall_c',
        position: [4, 1.2, 0],
        width: 1.2,
        height: 1.2,
        sillDepth: 0.3,
        rotation: [0, Math.PI, 0],
      }),
      door('door_study', 'wall_c', 7, 0.9, 'Study door'),
      wall('wall_e', [8, 0], [8, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      wall('wall_top', [8, 4], [0, 4]),
      zone('zone_corridor', 'Corridor', [
        [0.05, 0.05],
        [7.95, 0.05],
        [7.95, 1.95],
        [0.05, 1.95],
      ]),
      zone('zone_study', 'Study', [
        [0.05, 2.05],
        [7.95, 2.05],
        [7.95, 3.95],
        [0.05, 3.95],
      ]),
      // a chest along the south wall: 0.6 m is left between its face and the sill
      shaped('item_1', 'Chest', 4, 0.55, 3, 1.0, 1.4),
    ])
    const found = find(nodes, 'usage_passage_narrow', 'Study')
    expect(found).toHaveLength(1)
    expect(found[0]!.valueM).toBeCloseTo(0.6, 1)
    expect(found[0]!.obstacles.map((o) => o.kind).sort()).toEqual(['item', 'sill'])
  })

  // Guards are read part by part; other fence styles use an approximate strip along the centreline.
  const cagedStair = (fenceStyle: 'guard' | 'privacy') => {
    // level 2: a stairwell with a guard on every side but a short one that the stair’s own rail closes
    const stair = StairNode.parse({
      id: 'stair_1',
      parentId: 'level_1',
      name: 'Staircase',
      position: [1.5, 0, 0.3],
      width: 1.0,
      totalRise: 2.7,
      stepCount: 15,
      fillToFloor: false,
      fromLevelId: 'level_1',
      toLevelId: 'level_2',
      railingMode: 'both',
      railingStyle: 'metal',
    })
    const upper = [
      slab(
        'slab_2',
        'level_2',
        [
          [-0.3, -0.3],
          [6.3, -0.3],
          [6.3, 4.3],
          [-0.3, 4.3],
        ],
        {
          holes: [
            [
              [1.0, 0.25],
              [2.0, 0.25],
              [2.0, 3.6],
              [1.0, 3.6],
            ],
          ],
        },
      ),
      wall('wall_s2', [0, 0], [6, 0], [], 'level_2'),
      wall('wall_e2', [6, 0], [6, 4], [], 'level_2'),
      wall('wall_n2', [6, 4], [0, 4], [], 'level_2'),
      wall('wall_w2', [0, 4], [0, 0], [], 'level_2'),
      zone(
        'zone_up',
        'Landing',
        [
          [0.05, 0.05],
          [5.95, 0.05],
          [5.95, 3.95],
          [0.05, 3.95],
        ],
        'level_2',
      ),
      // guards round the opening, closing the end of the flight
      FenceNode.parse({
        id: 'fence_a',
        parentId: 'level_2',
        start: [1.0, 3.6],
        end: [2.0, 3.6],
        style: fenceStyle,
        height: 1.05,
      }),
      FenceNode.parse({
        id: 'fence_b',
        parentId: 'level_2',
        start: [1.0, 0.25],
        end: [1.0, 3.6],
        style: fenceStyle,
        height: 1.05,
      }),
      FenceNode.parse({
        id: 'fence_c',
        parentId: 'level_2',
        start: [2.0, 0.25],
        end: [2.0, 3.6],
        style: fenceStyle,
        height: 1.05,
      }),
      FenceNode.parse({
        id: 'fence_d',
        parentId: 'level_2',
        start: [1.0, 3.6],
        end: [2.0, 3.6],
        style: fenceStyle,
        height: 1.05,
      }),
    ]
    const nodes = scene(2, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [6.3, -0.3],
        [6.3, 4.3],
        [-0.3, 4.3],
      ]),
      wall('wall_s', [0, 0], [6, 0], ['door_front']),
      door('door_front', 'wall_s', 4, 1, 'Front door'),
      wall('wall_e', [6, 0], [6, 4]),
      wall('wall_n', [6, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      zone('zone_hall', 'Hall', [
        [0.05, 0.05],
        [5.95, 0.05],
        [5.95, 3.95],
        [0.05, 3.95],
      ]),
      stair,
      ...upper,
    ])
    const issues = usageIssues(nodes, { cell: 0.02, entranceDoorId: 'door_front' })
    return issues.filter((i) => i.type === 'usage_pocket')
  }

  test('a floor whose stair arrival is caged by its own guard has no way out, a warning', () => {
    const pocket = cagedStair('guard')
    expect(pocket).toHaveLength(1)
    expect(pocket[0]!.message).toContain('no 0.60 m way out from the stair arrival')
    expect(pocket[0]!.place.room).toBe('Landing')
    expect(pocket[0]!.severity).toBe('warning')
  })

  test('the same cage drawn by approximate fence strips still warns that there is no way out', () => {
    const pocket = cagedStair('privacy')
    expect(pocket).toHaveLength(1)
    expect(pocket[0]).toMatchObject({ severity: 'warning', approximate: true })
  })

  test('a well kept house says nothing', () => {
    const quiet = scene(1, [
      slab('slab_1', 'level_1', [
        [-0.3, -0.3],
        [6.3, -0.3],
        [6.3, 4.3],
        [-0.3, 4.3],
      ]),
      wall('wall_s', [0, 0], [6, 0], ['door_front']),
      door('door_front', 'wall_s', 3, 1.2, 'Front door'),
      wall('wall_e', [6, 0], [6, 4]),
      wall('wall_n', [6, 4], [0, 4]),
      wall('wall_w', [0, 4], [0, 0]),
      zone('zone_room', 'Living room', [
        [0.05, 0.05],
        [5.95, 0.05],
        [5.95, 3.95],
        [0.05, 3.95],
      ]),
      shaped('item_1', 'Sofa', 1.5, 3.4, 2.0, 0.9, 0.8),
    ])
    expect(usageIssues(quiet, { cell: 0.02, entranceDoorId: 'door_front' })).toEqual([])
  })
})
