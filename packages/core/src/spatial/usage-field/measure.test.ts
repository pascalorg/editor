import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  LevelNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import { measureUsage } from './measure'
import { usageShapes } from './shapes'
import type { Nodes } from './walls'

function house(extra: AnyNode[]): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] })
  return Object.fromEntries([building, level, ...extra].map((node) => [node.id, node])) as Nodes
}

const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
) => WallNode.parse({ id, parentId: 'level_1', start, end, thickness: 0.1, children })

const zone = (id: string, name: string, polygon: [number, number][]) =>
  ZoneNode.parse({ id, parentId: 'level_1', name, polygon })

// A 6 x 4 m shell: the front door in the south wall opens into the west room (x < 3), a partition
// at x = 3 with a door leads to the east room.
function twoRooms({ partition = 0.9, front = 1, extra = [] as AnyNode[] } = {}) {
  const frontDoor = DoorNode.parse({
    id: 'door_front',
    parentId: 'wall_s',
    wallId: 'wall_s',
    position: [1.5, 1.05, 0],
    width: front,
    height: 2.1,
    frameDepth: 0.07,
  })
  const inner = DoorNode.parse({
    id: 'door_inner',
    parentId: 'wall_p',
    wallId: 'wall_p',
    position: [2, 1.05, 0],
    width: partition,
    height: 2.1,
    frameDepth: 0.07,
  })
  return house([
    SlabNode.parse({
      id: 'slab_1',
      parentId: 'level_1',
      polygon: [
        [-0.3, -0.3],
        [6.3, -0.3],
        [6.3, 4.3],
        [-0.3, 4.3],
      ],
      elevation: 0.05,
    }),
    wall('wall_s', [0, 0], [6, 0], ['door_front']),
    wall('wall_e', [6, 0], [6, 4]),
    wall('wall_n', [6, 4], [0, 4]),
    wall('wall_w', [0, 4], [0, 0]),
    wall('wall_p', [3, 0], [3, 4], ['door_inner']),
    frontDoor,
    inner,
    zone('zone_west', 'West room', [
      [0.05, 0.05],
      [2.95, 0.05],
      [2.95, 3.95],
      [0.05, 3.95],
    ]),
    zone('zone_east', 'East room', [
      [3.05, 0.05],
      [5.95, 0.05],
      [5.95, 3.95],
      [3.05, 3.95],
    ]),
    ...extra,
  ])
}

const measure = (nodes: Nodes, entranceDoorId = 'door_front') => {
  const shapes = usageShapes(nodes)
  return measureUsage(nodes, shapes, { cell: 0.02, entranceDoorId })
}
const room = (m: ReturnType<typeof measure>, id: string) =>
  m.groups[0]!.rooms.find((r) => r.roomId === id)!

describe('measures of a two-room house', () => {
  const m = measure(twoRooms())

  test('the ground floor is measured from the front door', () => {
    expect(m.entranceDoorId).toBe('door_front')
    expect(m.groups[0]!.source).toEqual({ kind: 'door', doorId: 'door_front' })
  })

  test('the passage to the far room is the clear width of the inner door, to the millimetre', () => {
    const east = room(m, 'zone_east')
    expect(east.reached).toBe(true)
    // 0.9 m door, frame members of 0.05 on each side
    expect(east.passage!.width).toBeGreaterThan(0.795)
    expect(east.passage!.width).toBeLessThan(0.805)
    expect(east.passage!.at[0]).toBeCloseTo(3, 1)
    expect(east.passage!.fromDoorId).toBe('door_front')
    expect(east.passage!.by.map((o) => o.kind).sort()).toEqual(['jamb', 'jamb'])
  })

  test('the room next to the door is limited by the front door itself', () => {
    const west = room(m, 'zone_west')
    expect(west.passage!.width).toBeGreaterThan(0.895)
    expect(west.passage!.width).toBeLessThan(0.905)
  })

  test('a room that is empty has a turning circle as large as it is', () => {
    const west = room(m, 'zone_west')
    // 2.9 m between the walls; the circle may bulge a little through the open inner doorway
    expect(west.turning!.diameter).toBeGreaterThan(2.9)
    expect(west.turning!.diameter).toBeLessThan(3.05)
  })

  test('nothing is cut off: no pocket', () => {
    for (const r of m.groups[0]!.rooms) expect(r.pocket.isolatedM2).toBe(0)
  })
})

describe('the entrance a measure walks from', () => {
  const garage = DoorNode.parse({
    id: 'door_garage',
    parentId: 'wall_s',
    wallId: 'wall_s',
    position: [4.5, 1.05, 0],
    width: 2,
    height: 2.1,
    doorCategory: 'garage',
  })
  // The garage door is the first node of the scene, so the first door the graph meets.
  const withGarage = (children: string[]) => {
    const nodes = twoRooms()
    return {
      door_garage: garage,
      ...nodes,
      wall_s: { ...nodes.wall_s, children },
    } as Nodes
  }
  const entrance = (nodes: Nodes) => {
    const shapes = usageShapes(nodes)
    return measureUsage(nodes, shapes, { cell: 0.05 }).entranceDoorId
  }

  test('a street door is the entrance even when a garage door comes first on the wall', () => {
    expect(entrance(withGarage(['door_garage', 'door_front']))).toBe('door_front')
  })

  test('a house whose only way in is a garage door is entered through it', () => {
    const nodes = withGarage(['door_garage'])
    delete nodes.door_front
    expect(entrance(nodes)).toBe('door_garage')
  })
})

describe('what narrows a room', () => {
  test('a narrow inner door narrows the way to the far room and cuts it off from a 0.60 m unit', () => {
    const m = measure(twoRooms({ partition: 0.6 }))
    const east = room(m, 'zone_east')
    expect(east.passage!.width).toBeGreaterThan(0.495)
    expect(east.passage!.width).toBeLessThan(0.505)
    // a unit fits in the east room (clearance 0.30) and cannot get through a 0.50 m doorway
    expect(east.pocket.whole).toBe(true)
    // the floor 0.30 m or more from every wall: (2.9 - 0.6) x (3.9 - 0.6)
    expect(east.pocket.isolatedM2).toBeGreaterThan(7.5)
    expect(east.pocket.isolatedM2).toBeLessThan(7.7)
  })
})
