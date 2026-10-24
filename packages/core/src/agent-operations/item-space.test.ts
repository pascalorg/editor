import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, ItemNode, LevelNode, WallNode } from '../schema'
import { findBlockedDoors } from './door-clearance'
import { findItemItemCollisions } from './layout-clearance'

// What a converted, furnished flat showed verify_scene getting wrong: a lamp on a nightstand
// reported as overlapping it, a rug and a pendant "blocking" a door, a wall's cap trims
// colliding across the room, a door's keep-out on the side it does not swing to.

const level = LevelNode.parse({
  object: 'node',
  type: 'level',
  id: 'level_t',
  parentId: null,
  visible: true,
  metadata: {},
  name: 'G',
  level: 0,
  children: [],
})
const item = (
  id: string,
  name: string,
  position: [number, number, number],
  dims: [number, number, number],
  parentId = level.id,
  extra: Record<string, unknown> = {},
) =>
  ItemNode.parse({
    object: 'node',
    type: 'item',
    id,
    parentId,
    visible: true,
    metadata: {},
    name,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    asset: {
      id: `asset_${id}`,
      name,
      src: 'https://example.com/x.glb',
      thumbnail: 'https://example.com/x.webp',
      dimensions: dims,
      category: name.toLowerCase(),
    },
    ...extra,
  })
const scene = (...nodes: AnyNode[]) => [level, ...nodes]

describe('verify_scene layout checks on a furnished room', () => {
  test('a lamp hosted on its nightstand is stacked, not colliding, and its footprint is read through the host', () => {
    const nightstand = item('item_ns', 'Nightstand', [1, 0, 1], [0.5, 0.6, 0.4])
    const lamp = item('item_lamp', 'Lamp', [0, 0.6, 0], [0.2, 0.4, 0.2], nightstand.id)
    const chair = item('item_chair', 'Chair', [1.02, 0, 1.45], [0.4, 0.9, 0.4])
    const collisions = findItemItemCollisions({
      nodes: scene(nightstand, lamp, chair),
      levelId: level.id,
    })
    expect(collisions.map((c) => [c.aId, c.bId].sort().join('+'))).toEqual(['item_chair+item_ns'])
  })

  test('a lamp standing on a table top is above it, not inside it', () => {
    const table = item('item_table', 'Table', [0, 0, 0], [1.2, 0.75, 0.8])
    const lamp = item('item_lamp2', 'Lamp', [0.2, 0.75, 0.1], [0.2, 0.4, 0.2])
    expect(findItemItemCollisions({ nodes: scene(table, lamp), levelId: level.id })).toEqual([])
  })

  test('a wall-hosted cap trim never joins the floor collisions', () => {
    const wall = WallNode.parse({
      object: 'node',
      type: 'wall',
      id: 'wall_t',
      parentId: level.id,
      visible: true,
      metadata: {},
      children: ['item_cap'],
      start: [-2, 0],
      end: [2, 0],
      height: 2.6,
      thickness: 0.12,
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const cap = item('item_cap', 'Cap', [2, 2.6, 0], [4, 0.012, 0.13], wall.id, {
      asset: {
        id: 'asset_cap',
        name: 'Cap',
        src: 'https://example.com/x.glb',
        thumbnail: 'https://example.com/x.webp',
        dimensions: [4, 0.012, 0.13],
        category: 'trim',
        attachTo: 'wall',
      },
    })
    const bed = item('item_bed', 'Bed', [0, 0, 1.2], [1.6, 0.5, 2])
    expect(findItemItemCollisions({ nodes: scene(wall, cap, bed), levelId: level.id })).toEqual([])
  })

  test('a rug under the door and a pendant above it do not block it; a chest on the swing side does, one past the walkway on the other side does not', () => {
    const wall = WallNode.parse({
      object: 'node',
      type: 'wall',
      id: 'wall_d',
      parentId: level.id,
      visible: true,
      metadata: {},
      children: ['door_t'],
      start: [-2, 0],
      end: [2, 0],
      height: 2.6,
      thickness: 0.12,
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const door = DoorNode.parse({
      object: 'node',
      type: 'door',
      id: 'door_t',
      parentId: wall.id,
      visible: true,
      metadata: {},
      wallId: wall.id,
      width: 0.9,
      height: 2.1,
      position: [2, 1.05, 0],
      rotation: [0, 0, 0],
      swingDirection: 'inward',
    })
    const rug = item('item_rug', 'Doormat rug', [0, 0, 0.4], [0.8, 0.01, 0.5])
    const pendant = item('item_pendant', 'Pendant', [0, 2.3, 0.3], [0.3, 0.25, 0.3])
    const chestSwingSide = item('item_chest', 'Chest', [0, 0, 0.45], [0.8, 0.5, 0.4])
    const chestOtherSide = item('item_chest2', 'Chest', [0, 0, -0.65], [0.8, 0.5, 0.4])
    const blocked = findBlockedDoors({
      nodes: scene(wall, door, rug, pendant, chestSwingSide, chestOtherSide),
      levelId: level.id,
    })
    expect(blocked.map((b) => b.itemId)).toEqual(['item_chest'])
  })
})
