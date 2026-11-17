import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core/schema'

/** Two 4 × 3 m rooms share an 8 m wall and a partition, using public scene schemas. */
export function twoRooms({ walls = {} }: {
  walls?: Record<string, Record<string, unknown>>
} = {}) {
  const edges: [string, [number, number], [number, number]][] = [
    ['wall_s', [0, 0], [8, 0]],
    ['wall_p', [4, 0], [4, 3]],
    ['wall_an', [4, 3], [0, 3]],
    ['wall_w', [0, 3], [0, 0]],
    ['wall_e', [8, 0], [8, 3]],
    ['wall_bn', [8, 3], [4, 3]],
  ]
  const roomWalls = edges.map(([id, start, end]) => WallNode.parse({
    id,
    parentId: 'level_0',
    start,
    end,
    height: 2.5,
    thickness: 0.1,
    ...walls[id],
  }))
  const salon = ZoneNode.parse({
    id: 'zone_salon',
    parentId: 'level_0',
    name: 'Salon',
    spaceRole: 'room',
    polygon: [[0, 0], [4, 0], [4, 3], [0, 3]],
    boundaryWallIds: ['wall_s', 'wall_p', 'wall_an', 'wall_w'],
  })
  const bath = ZoneNode.parse({
    id: 'zone_bath',
    parentId: 'level_0',
    name: 'Bath',
    spaceRole: 'room',
    polygon: [[4, 0], [8, 0], [8, 3], [4, 3]],
    boundaryWallIds: ['wall_s', 'wall_e', 'wall_bn', 'wall_p'],
  })
  const building = BuildingNode.parse({ id: 'building_main', children: ['level_0'] })
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: building.id,
    level: 0,
    height: 3,
    children: [...roomWalls.map(({ id }) => id), salon.id, bath.id],
  })
  return {
    nodes: Object.fromEntries([building, level, ...roomWalls, salon, bath].map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [building.id],
  }
}
