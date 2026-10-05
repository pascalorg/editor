import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, DoorNode, LevelNode, WallNode } from '../schema'
import { achievedChanges } from './achieved'

// classcad-ai's delta check, on a scene graph: a tool says what it asked for; the scene says what
// happened. Victor run 8 reported a facade "applied" on 432 walls that placed no window.
function scene(): Record<string, AnyNode> {
  const building = BuildingNode.parse({ id: 'building_main' })
  const level = LevelNode.parse({ id: 'level_0', parentId: building.id, level: 0 })
  const door = DoorNode.parse({ id: 'door_a', parentId: 'wall_a', wallId: 'wall_a' })
  const wall = WallNode.parse({
    id: 'wall_a',
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    children: [door.id],
  })
  const nodes = [
    { ...building, children: [level.id] },
    { ...level, children: [wall.id] },
    wall,
    door,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, AnyNode>
}

describe('what a call achieved', () => {
  test('counts what was created, by type', () => {
    const before = scene()
    const wall = WallNode.parse({ id: 'wall_b', parentId: 'level_0', start: [4, 0], end: [4, 3] })
    expect(achievedChanges(before, { create: [{ node: wall, parentId: 'level_0' }] })).toEqual({
      created: { wall: 1 },
      updated: 0,
      deleted: {},
    })
  })

  test('counts what a delete took with it', () => {
    expect(achievedChanges(scene(), { delete: ['wall_a'] })).toEqual({
      created: {},
      updated: 0,
      deleted: { wall: 1, door: 1 },
    })
  })

  test('says when a call changed nothing', () => {
    expect(achievedChanges(scene(), { update: [{ id: 'wall_missing', data: {} }] })).toEqual({
      created: {},
      updated: 0,
      deleted: {},
      unchanged: true,
    })
  })
})
