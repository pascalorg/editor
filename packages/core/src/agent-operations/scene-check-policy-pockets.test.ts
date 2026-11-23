import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { usageIssues } from '../spatial/usage-field/findings'
import { setSdfChecks } from '../spatial/usage-field/flag'
import './index'
import { withoutDuplicatePockets } from './scene-check-policy'
import type { SceneNodes } from './types'
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

/** A stored piece centred on (x, z), its solid outline exact. */
const piece = (id: string, x: number, z: number, width: number, depth: number) =>
  ItemNode.parse({
    id,
    parentId: 'level_1',
    position: [x, 0, z],
    name: id,
    asset: {
      id,
      name: id,
      category: 'storage',
      thumbnail: '/t.webp',
      src: `/items/${id}/model.glb`,
      dimensions: [width, 1.0, depth],
    },
  })

// A 6 x 4 m shell with the street door in the west room; a partition at x = 3, with or without a
// door, makes the east room reachable or not. The extra pieces stand in the west room.
function house({ partitionDoor }: { partitionDoor: boolean }, extra: AnyNode[] = []): SceneNodes {
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
    ...extra,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as SceneNodes
}

const pocket = (roomId: string, over: Record<string, unknown> = {}) => ({
  type: 'usage_pocket',
  message: 'a pocket',
  nodeIds: [roomId],
  place: { room: roomId, roomId, at: [1, 2] as Pt },
  ...over,
})

const unreachable = (...nodeIds: string[]) => ({
  type: 'room_unreachable',
  message: 'a room no walk reaches',
  nodeIds,
})

describe('a whole-room pocket a room_unreachable finding already says', () => {
  test('is dropped when its room is named', () => {
    const named = unreachable('zone_a')
    const found = pocket('zone_a', { wholeRoom: true, nodeIds: ['zone_a', 'item_x'] })
    expect(withoutDuplicatePockets([named, found])).toEqual([named])
  })

  test('is kept when no finding names its room', () => {
    const named = unreachable('zone_a')
    const found = pocket('zone_b', { wholeRoom: true })
    expect(withoutDuplicatePockets([named, found])).toEqual([named, found])
  })

  test('a pocket beside objects stays, even in a room a finding names', () => {
    const named = unreachable('zone_a')
    const found = pocket('zone_a', { nodeIds: ['zone_a', 'item_x', 'item_y'] })
    expect(withoutDuplicatePockets([named, found])).toEqual([named, found])
  })

  test('a whole-floor pocket goes only when every room it names is named', () => {
    const both = unreachable('zone_a', 'zone_b')
    const floor = pocket('level_1', {
      wholeRoom: true,
      nodeIds: ['level_1', 'zone_a', 'zone_b'],
    })
    expect(withoutDuplicatePockets([both, floor])).toEqual([both])
    const one = unreachable('zone_a')
    expect(withoutDuplicatePockets([one, floor])).toEqual([one, floor])
    const noZones = pocket('level_1', { wholeRoom: true, nodeIds: ['level_1'] })
    expect(withoutDuplicatePockets([one, noZones])).toEqual([one, noZones])
  })

  test('other types are untouched', () => {
    const named = unreachable('zone_a')
    const other = { type: 'empty_levels', message: 'nothing here' }
    expect(withoutDuplicatePockets([named, other])).toEqual([named, other])
  })
})

describe('verify_scene and a closed room', () => {
  test('room_unreachable is reported and the room has no whole-room pocket of its own', () => {
    const nodes = house({ partitionDoor: false }, [
      piece('item_a', 1.2, 1.0, 0.4, 1.4),
      piece('item_b', 2.0, 1.4, 0.6, 0.4),
    ])
    expect(
      usageIssues(nodes).some(
        (issue) =>
          issue.type === 'usage_pocket' && issue.place.roomId === 'zone_east' && issue.wholeRoom,
      ),
    ).toBe(true)
    setSdfChecks(true)
    try {
      const issues = (
        verifyScene(nodes, {}, { activeLevelId: 'level_1' }).result as {
          issues: {
            type: string
            place?: { roomId: string }
            wholeRoom?: boolean
            nodeIds?: string[]
          }[]
        }
      ).issues
      expect(
        issues.some(
          (issue) => issue.type === 'room_unreachable' && issue.nodeIds?.includes('zone_east'),
        ),
      ).toBe(true)
      expect(
        issues.filter(
          (issue) => issue.type === 'usage_pocket' && issue.place?.roomId === 'zone_east',
        ),
      ).toEqual([])
      const west = issues.filter(
        (issue) => issue.type === 'usage_pocket' && issue.place?.roomId === 'zone_west',
      )
      expect(west).toHaveLength(1)
      expect(west[0]?.wholeRoom).toBeUndefined()
      expect(west[0]?.nodeIds).toEqual(['zone_west', 'item_a', 'item_b'])
    } finally {
      setSdfChecks(false)
    }
  })
})
