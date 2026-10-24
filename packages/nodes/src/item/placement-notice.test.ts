import { describe, expect, test } from 'bun:test'
import { type AnyNode, ItemNode, LevelNode, ZoneNode } from '@pascal-app/core'
import { floorItemMisfitNotice, itemPlacementNotice } from './placement-notice'

const bath = { id: 'zone_bath', name: 'Bath', width: 2.2, depth: 1.9 }
const unnamed = { ...bath, name: '' }

describe('the warning a person reads for a floor item that does not fit', () => {
  test("in a door's way, naming the room", () => {
    expect(
      floorItemMisfitNotice({ code: 'blocks_door', room: bath, doorId: 'door_a' }, [1.6, 0.6, 0.8]),
    ).toEqual({ line: 'Blocks the door to Bath' })
  })

  test('too large for its room, with both sizes', () => {
    expect(
      floorItemMisfitNotice({ code: 'too_large_for_room', room: bath }, [2.34, 0.6, 1.11]),
    ).toEqual({ line: 'Too large for Bath', detail: '2.34 × 1.11 m in a 2.2 × 1.9 m room' })
  })

  test('a room without a name still reads', () => {
    expect(
      floorItemMisfitNotice({ code: 'blocks_door', room: unnamed, doorId: 'door_a' }, [1, 1, 1]),
    ).toEqual({ line: 'Blocks a door' })
    expect(
      floorItemMisfitNotice({ code: 'too_large_for_room', room: unnamed }, [3, 1, 1]).line,
    ).toBe('Too large for its room')
  })
})

describe("the item's placement notice", () => {
  const level = LevelNode.parse({})
  const room = ZoneNode.parse({
    parentId: level.id,
    name: 'Bath',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
  })
  const tub = ItemNode.parse({
    parentId: level.id,
    position: [5, 0, 5],
    asset: {
      id: 'tub',
      name: 'Tub',
      category: 'bathroom',
      thumbnail: '',
      src: '/tub.glb',
      dimensions: [3, 0.6, 1],
    },
  })
  const nodes: Record<string, AnyNode> = { [level.id]: level, [room.id]: room, [tub.id]: tub }

  test('reads the item where it is held, not where it was stored', () => {
    expect(itemPlacementNotice(tub, { nodes })).toBeNull()
    expect(itemPlacementNotice(tub, { nodes, live: { position: [1, 0, 1], rotation: 0 } })).toEqual(
      { line: 'Too large for Bath', detail: '3 × 1 m in a 2 × 2 m room' },
    )
  })

  test('an item on something other than the floor is not checked', () => {
    const onWall = { ...tub, parentId: 'wall_a', position: [1, 0, 1] } as ItemNode
    expect(itemPlacementNotice(onWall, { nodes: { ...nodes, [onWall.id]: onWall } })).toBeNull()
  })
})
