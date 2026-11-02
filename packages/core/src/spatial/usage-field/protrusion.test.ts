import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'
import { usageIssues } from './findings'
import { wallProtrusions } from './protrusion'
import { usageShapes } from './shapes'
import type { Nodes } from './walls'

const asset = (over: Record<string, unknown> = {}) => ({
  id: 'thing',
  name: 'Thing',
  category: 'kitchen',
  thumbnail: '/thumb.webp',
  src: '/items/thing/model.glb',
  dimensions: [0.85, 0.6, 0.46],
  ...over,
})

// A 6 x 4 m kitchen; its south wall is along z = 0, the room on the +z side of it.
function kitchen(extra: AnyNode[], wallChildren: string[] = []): Nodes {
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_1', children: ['level_1'] }),
    LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] }),
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
    WallNode.parse({
      id: 'wall_s',
      parentId: 'level_1',
      start: [0, 0],
      end: [6, 0],
      thickness: 0.1,
      children: wallChildren,
    }),
    WallNode.parse({
      id: 'wall_e',
      parentId: 'level_1',
      start: [6, 0],
      end: [6, 4],
      thickness: 0.1,
    }),
    WallNode.parse({
      id: 'wall_n',
      parentId: 'level_1',
      start: [6, 4],
      end: [0, 4],
      thickness: 0.1,
    }),
    WallNode.parse({
      id: 'wall_w',
      parentId: 'level_1',
      start: [0, 4],
      end: [0, 0],
      thickness: 0.1,
    }),
    ZoneNode.parse({
      id: 'zone_k',
      parentId: 'level_1',
      name: 'Kitchen',
      polygon: [
        [0.05, 0.05],
        [5.95, 0.05],
        [5.95, 3.95],
        [0.05, 3.95],
      ],
    }),
    ...extra,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Nodes
}

const found = (nodes: Nodes) => wallProtrusions(nodes, usageShapes(nodes))

describe('wall objects that stand out', () => {
  test('a hung item stands out of the face it is on, from the face, by its depth', () => {
    const screen = ItemNode.parse({
      id: 'item_1',
      parentId: 'wall_s',
      wallId: 'wall_s',
      position: [3, 1.4, 0],
      side: 'front',
      asset: asset({ attachTo: 'wall-side' }),
    })
    const [p] = found(kitchen([screen], ['item_1']))
    expect(p!.nodeId).toBe('item_1')
    expect(p!.face).toBe('a')
    // the library box is centred on its position: half of its 0.46 m is out of the 0.05 face
    expect(p!.depth).toBeCloseTo(0.23 + 0, 1)
    expect(p!.bottom).toBeCloseTo(1.4 - 0.0, 1)
    expect(p!.roomName).toBe('Kitchen')
    expect(usageIssues(kitchen([screen], ['item_1']))).toContainEqual(
      expect.objectContaining({
        type: 'usage_wall_object_protrudes',
        severity: 'warning',
        approximate: true,
      }),
    )
  })

  test('a wall cabinet run set off its wall protrudes from the face, not from its own back', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_1',
      parentId: 'level_1',
      position: [3, 1.4, 0.3],
      runTier: 'wall',
      children: ['cabinet-module_1'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_1',
      parentId: run.id,
      position: [0, 0, 0],
      width: 0.85,
      depth: 0.32,
    })
    const [p] = found(kitchen([run, module]))
    // its back is at 0.14 (0.09 off the 0.05 face) and its front at 0.46: 0.41 from the face
    expect(p!.depth).toBeCloseTo(0.41, 3)
    expect(p!.bottom).toBeCloseTo(1.4, 3)
    expect(p!.approximate).toBe(true)
  })

  test('a base cabinet, whose lower edge is the floor, is not a hazard', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_1',
      parentId: 'level_1',
      position: [3, 0, 0.3],
      children: ['cabinet-module_1'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_1',
      parentId: run.id,
      position: [0, 0, 0],
      width: 0.85,
      depth: 0.6,
    })
    expect(found(kitchen([run, module]))).toHaveLength(0)
  })

  test('an object that stands out by less than 10 cm is not', () => {
    const frame = ItemNode.parse({
      id: 'item_1',
      parentId: 'wall_s',
      wallId: 'wall_s',
      position: [3, 1.4, 0],
      side: 'front',
      asset: asset({ attachTo: 'wall-side', dimensions: [0.6, 0.4, 0.04] }),
    })
    expect(found(kitchen([frame], ['item_1']))).toHaveLength(0)
  })

  test('over furniture it is not in the way of anyone walking', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_1',
      parentId: 'level_1',
      position: [3, 1.4, 0.3],
      runTier: 'wall',
      children: ['cabinet-module_1'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_1',
      parentId: run.id,
      position: [0, 0, 0],
      width: 0.85,
      depth: 0.32,
    })
    const counter = ItemNode.parse({
      id: 'item_2',
      parentId: 'level_1',
      position: [3, 0, 0.45],
      asset: asset({ src: '/items/counter/model.glb', dimensions: [1.2, 0.9, 0.7] }),
    })
    expect(found(kitchen([run, module, counter]))).toHaveLength(0)
  })
})
