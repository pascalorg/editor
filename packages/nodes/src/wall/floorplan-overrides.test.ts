import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, ItemNode, WallNode } from '@pascal-app/core'
import { wallFloorplanSiblingOverrides } from './floorplan-overrides'

describe('wallFloorplanSiblingOverrides', () => {
  test('projects live wall and opening positions without changing unrelated nodes', () => {
    const wall = WallNode.parse({
      id: 'wall_main',
      parentId: 'level_main',
      start: [0, 0],
      end: [10, 0],
    })
    const door = DoorNode.parse({
      id: 'door_main',
      parentId: wall.id,
      position: [2, 1, 0],
    })
    const item = ItemNode.parse({
      id: 'item_main',
      parentId: 'level_main',
      position: [0, 0, 0],
      asset: {
        id: 'asset_item',
        category: 'test',
        name: 'Test item',
        thumbnail: '/test.png',
        src: '/test.glb',
      },
    })
    const nodes = { [wall.id]: wall, [door.id]: door, [item.id]: item } as Record<string, AnyNode>

    const result = wallFloorplanSiblingOverrides({
      nodeId: wall.id,
      nodes,
      liveTransforms: new Map([[door.id, { position: [6, 1, 0], rotation: 0 }]]),
      liveOverrides: new Map([
        [wall.id, { end: [12, 0] }],
        [door.id, { position: [5, 1, 0] }],
        [item.id, { position: [3, 0, 0] }],
      ]),
    })

    expect(result).not.toBe(nodes)
    expect(result[wall.id]).toMatchObject({ end: [12, 0] })
    expect(result[door.id]).toMatchObject({ position: [6, 1, 0] })
    expect(result[item.id]).toBe(item)
  })
})
