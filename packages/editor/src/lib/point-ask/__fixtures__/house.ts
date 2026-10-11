import {
  type AnyNode,
  ItemNode,
  LevelNode,
  WallNode,
  WindowNode,
  ZoneNode,
  DoorNode,
} from '@pascal-app/core'

// One 4 × 3 m kitchen on a ground level, as the point-ask tests share it: four walls, the room they
// make, a window in the north wall, a door in the south wall and a sofa on the floor.
export const LEVEL_ID = 'level_0'

const wall = (id: string, start: [number, number], end: [number, number]) =>
  WallNode.parse({ id, parentId: LEVEL_ID, start, end, height: 2.6 })

const walls = [
  wall('wall_north', [0, 0], [4, 0]),
  wall('wall_east', [4, 0], [4, 3]),
  wall('wall_south', [4, 3], [0, 3]),
  wall('wall_west', [0, 3], [0, 0]),
]

const zone = ZoneNode.parse({
  id: 'zone_kitchen',
  parentId: LEVEL_ID,
  name: 'Kitchen',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
  boundaryWallIds: walls.map((w) => w.id),
})

const window = WindowNode.parse({
  id: 'window_north',
  parentId: 'wall_north',
  wallId: 'wall_north',
  position: [2, 1.4, 0],
  width: 1.2,
  height: 1.4,
})

const door = DoorNode.parse({
  id: 'door_front',
  parentId: 'wall_south',
  wallId: 'wall_south',
  position: [2, 1.05, 0],
  width: 0.9,
  height: 2.1,
})

const sofa = ItemNode.parse({
  id: 'item_sofa',
  parentId: LEVEL_ID,
  name: 'Sofa',
  position: [1.5, 0, 1.5],
  asset: {
    id: 'sofa',
    category: 'furniture',
    name: 'Oslo 3-seat',
    thumbnail: '',
    src: 'asset://sofa.glb',
    dimensions: [2.1, 0.85, 0.95],
  },
})

const level = LevelNode.parse({
  id: LEVEL_ID,
  children: [...walls.map((w) => w.id), zone.id, sofa.id],
})

/** The scene as `useScene` holds it: nodes by id. */
export function house(extra: AnyNode[] = []): Record<string, AnyNode> {
  return Object.fromEntries(
    [level, ...walls, zone, window, door, sofa, ...extra].map((node) => [node.id, node as AnyNode]),
  )
}
