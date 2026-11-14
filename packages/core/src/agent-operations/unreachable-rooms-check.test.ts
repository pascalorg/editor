import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  LevelNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import './index'
import type { SceneNodes } from './types'
import { unreachableRoomIssues } from './unreachable-rooms-check'
import { verifyScene } from './verify-scene'

type Pt = [number, number]

const wall = (id: string, start: Pt, end: Pt, children: string[] = []) =>
  WallNode.parse({ id, parentId: 'level_1', start, end, thickness: 0.1, children })

const door = (id: string, wallId: string, x: number) =>
  DoorNode.parse({
    id,
    parentId: wallId,
    wallId,
    position: [x, 1.05, 0],
    width: 0.9,
    height: 2.1,
    frameDepth: 0.07,
  })

const room = (id: string, name: string, x0: number, x1: number) =>
  ZoneNode.parse({
    id,
    parentId: 'level_1',
    name,
    polygon: [
      [x0, 0],
      [x1, 0],
      [x1, 4],
      [x0, 4],
    ],
  })

// A 6 x 4 m shell with the street door in the west room; a partition at x = 3, with or without a
// door, makes the east room reachable or not.
function house({ partitionDoor }: { partitionDoor: boolean }): SceneNodes {
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_1', children: ['level_1'] }),
    LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] }),
    SlabNode.parse({
      id: 'slab_1',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
    }),
    wall('wall_s', [0, 0], [6, 0], ['door_front']),
    wall('wall_e', [6, 0], [6, 4]),
    wall('wall_n', [6, 4], [0, 4]),
    wall('wall_w', [0, 4], [0, 0]),
    wall('wall_p', [3, 0], [3, 4], partitionDoor ? ['door_inner'] : []),
    door('door_front', 'wall_s', 1.5),
    ...(partitionDoor ? [door('door_inner', 'wall_p', 2)] : []),
    room('zone_west', 'West room', 0, 3),
    room('zone_east', 'East room', 3, 6),
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as SceneNodes
}

describe('a room no walk from outside reaches', () => {
  test('a room behind a partition with no door is named, with its level', () => {
    const issues = unreachableRoomIssues(house({ partitionDoor: false }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'room_unreachable',
      severity: 'warning',
      levelIds: ['level_1'],
    })
    expect(issues[0]?.message).toContain('East room')
    expect(issues[0]?.message).toContain('cannot be reached from outside')
  })

  test('a door in the partition makes it reachable: nothing is named', () => {
    expect(unreachableRoomIssues(house({ partitionDoor: true }))).toEqual([])
  })

  test('verify_scene carries it as a warning, and not when the room is reachable', () => {
    const issuesOf = (nodes: SceneNodes) =>
      (
        verifyScene(nodes, {} as never, { activeLevelId: 'level_1' }).result as {
          issues: { type: string }[]
        }
      ).issues.filter((issue) => issue.type === 'room_unreachable')
    expect(issuesOf(house({ partitionDoor: false }))).toHaveLength(1)
    expect(issuesOf(house({ partitionDoor: true }))).toHaveLength(0)
  })
})
