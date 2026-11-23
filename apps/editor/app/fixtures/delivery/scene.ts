import {
  type AnyNode,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  LevelNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core/schema'
import type { SceneGraph } from '@pascal-app/editor'

// Geometry copied from core's __fixtures__/dressing-scenes.ts: two 4 x 3 m rooms,
// a shared 8 m wall and a partition. Public schemas only; no fixture/src imports.
const walls: [string, [number, number], [number, number]][] = [
  ['wall_s', [0, 0], [8, 0]],
  ['wall_p', [4, 0], [4, 3]],
  ['wall_an', [4, 3], [0, 3]],
  ['wall_w', [0, 3], [0, 0]],
  ['wall_e', [8, 0], [8, 3]],
  ['wall_bn', [8, 3], [4, 3]],
]

export function deliveryScene(): SceneGraph {
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_main', children: ['level_0'] }),
    LevelNode.parse({
      id: 'level_0',
      parentId: 'building_main',
      children: [...walls.map(([id]) => id), 'zone_salon', 'zone_bath', 'cabinet_a'],
      level: 0,
      name: 'Ground',
      height: 3,
    }),
    ...walls.map(([id, start, end]) =>
      WallNode.parse({
        id,
        parentId: 'level_0',
        start,
        end,
        height: 2.5,
        thickness: 0.1,
      }),
    ),
    ZoneNode.parse({
      id: 'zone_salon',
      parentId: 'level_0',
      name: 'Salon',
      spaceRole: 'room',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      boundaryWallIds: ['wall_s', 'wall_p', 'wall_an', 'wall_w'],
    }),
    ZoneNode.parse({
      id: 'zone_bath',
      parentId: 'level_0',
      name: 'Bath',
      spaceRole: 'room',
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      boundaryWallIds: ['wall_s', 'wall_e', 'wall_bn', 'wall_p'],
    }),
    CabinetNode.parse({
      id: 'cabinet_a',
      parentId: 'level_0',
      children: ['cabinet-module_a', 'cabinet-module_b', 'cabinet-module_c'],
      name: 'Native kitchen run',
      position: [2, 0, 2.65],
      rotation: Math.PI,
      runTier: 'base',
    }),
    ...['a', 'b', 'c'].map((suffix, index) =>
      CabinetModuleNode.parse({
        id: `cabinet-module_${suffix}`,
        parentId: 'cabinet_a',
        position: [(index - 1) * 0.6, 0, 0],
        width: 0.6,
      }),
    ),
  ]
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]))
  return { nodes: byId, rootNodeIds: ['building_main'], installedPlugins: ['pascal:core'] }
}
