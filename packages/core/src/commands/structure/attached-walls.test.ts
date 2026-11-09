import { describe, expect, test } from 'bun:test'
import { extractRooms } from '../../lib/room-graph'
import { type AnyNode, DoorNode, LevelNode, WallNode } from '../../schema'
import { planAttachedWallUpdates } from '../../systems/wall/wall-move'
import { planAttachedWallChanges } from './attached-walls'
import { setWallGeometry } from './set-wall-geometry'
import { applyToScratch, structureChangeBatch } from './shared'

const LEVEL = 'level_attached'
const wall = (id: string, start: [number, number], end: [number, number]) =>
  WallNode.parse({ id: `wall_${id}`, parentId: LEVEL, start, end })

// A 10 × 6 box whose top wall is one wall, a partition T'd into its middle
// from below and running down to the bottom wall.
function house(): Record<string, AnyNode> {
  const nodes: AnyNode[] = [
    LevelNode.parse({ id: LEVEL }),
    wall('top', [0, 0], [10, 0]),
    wall('right', [10, 0], [10, 6]),
    wall('bottom', [10, 6], [0, 6]),
    wall('left', [0, 6], [0, 0]),
    wall('part', [4, 0], [4, 6]),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

describe('walls T-joined into a moving wall', () => {
  test('stretch along their own line to stay on it', () => {
    const nodes = house()
    const updates = planAttachedWallUpdates(
      [nodes.wall_part as WallNode],
      [0, 0],
      [10, 0],
      [0, -1],
      [10, -1],
    )
    expect(updates).toEqual([{ id: 'wall_part', start: [4, -1], end: [4, 6] }])
  })

  test('let go when the move carries the join past the wall ends', () => {
    const updates = planAttachedWallUpdates(
      [wall('part', [4, 0], [4, 6])],
      [0, 0],
      [10, 0],
      [5, -1],
      [10, -1],
    )
    expect(updates).toEqual([])
  })

  test('a push of the whole wall takes them along, their doors staying put', () => {
    const nodes = house()
    // A door 1 m down the partition from the top wall.
    const door = DoorNode.parse({
      id: 'door_part',
      parentId: 'wall_part',
      wallId: 'wall_part',
      position: [1, 1.05, 0],
    })
    nodes[door.id] = door
    nodes.wall_part = { ...nodes.wall_part, children: [door.id] } as AnyNode
    const plan = setWallGeometry(nodes, {
      wallId: 'wall_top',
      start: [0, -1],
      end: [10, -1],
      mintId: (kind) => `${kind}_new`,
    })
    const after = applyToScratch(nodes, structureChangeBatch(plan.changes))
    const part = after.wall_part as WallNode
    expect([part.start, part.end]).toEqual([
      [4, -1],
      [4, 6],
    ])
    // Still 1 m below the old top line, now 2 m from the moved one.
    expect((after.door_part as DoorNode).position[0]).toBeCloseTo(2, 9)
  })

  test('a wall whose door the stretch would leave off its end lets go', () => {
    const nodes = house()
    const door = DoorNode.parse({
      id: 'door_part',
      parentId: 'wall_part',
      wallId: 'wall_part',
      position: [0.5, 1.05, 0],
    })
    nodes[door.id] = door
    // Pushing the top wall down 1 m would put the door above the partition's start.
    expect(planAttachedWallChanges(nodes, 'wall_top', [0, 0], [10, 0], [0, 1], [10, 1])).toEqual([])
  })
})

test('rooms close on a partition T-joined into a wall left whole', () => {
  const walls = Object.values(house()).filter((node): node is WallNode => node.type === 'wall')
  expect(extractRooms(walls)).toHaveLength(2)
})
