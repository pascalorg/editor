import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  LevelNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { findWallOpeningConflicts, wallOpeningClearances } from '../wall-opening-clearance'

describe('wall opening clearance', () => {
  test('reports cabinet overlap with a door and a low window', () => {
    const level = LevelNode.parse({ id: 'level_opening-clearance' })
    const door = DoorNode.parse({
      id: 'door_opening-clearance',
      parentId: 'wall_opening-clearance',
      position: [1, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    const window = WindowNode.parse({
      id: 'window_opening-clearance',
      parentId: 'wall_opening-clearance',
      position: [3, 1.05, 0],
      width: 1,
      height: 0.8,
    })
    const wall = WallNode.parse({
      id: 'wall_opening-clearance',
      parentId: level.id,
      children: [door.id, window.id],
      start: [0, 0],
      end: [5, 0],
    })
    const nodes = {
      [level.id]: level,
      [wall.id]: wall,
      [door.id]: door,
      [window.id]: window,
    } as Record<AnyNodeId, AnyNode>

    expect(
      findWallOpeningConflicts({
        bottom: 0,
        height: 0.92,
        localX: 1,
        nodes,
        wall,
        width: 0.6,
      }),
    ).toEqual([door.id])
    expect(
      findWallOpeningConflicts({
        bottom: 0,
        height: 0.92,
        localX: 3,
        nodes,
        wall,
        width: 0.6,
      }),
    ).toEqual([window.id])
  })

  test('allows a cabinet below a high window and allows edge contact', () => {
    const level = LevelNode.parse({ id: 'level_opening-clearance-high' })
    const window = WindowNode.parse({
      id: 'window_opening-clearance-high',
      parentId: 'wall_opening-clearance-high',
      position: [2, 1.45, 0],
      width: 1,
      height: 0.8,
    })
    const wall = WallNode.parse({
      id: 'wall_opening-clearance-high',
      parentId: level.id,
      children: [window.id],
      start: [0, 0],
      end: [4, 0],
    })
    const nodes = {
      [level.id]: level,
      [wall.id]: wall,
      [window.id]: window,
    } as Record<AnyNodeId, AnyNode>

    expect(
      findWallOpeningConflicts({
        bottom: 0,
        height: 0.92,
        localX: 2,
        nodes,
        wall,
        width: 0.6,
      }),
    ).toEqual([])
    expect(
      findWallOpeningConflicts({
        bottom: 0,
        height: 0.92,
        localX: 1.2,
        nodes,
        wall,
        width: 0.6,
      }),
    ).toEqual([])
    expect(wallOpeningClearances(wall, nodes)).toHaveLength(1)
  })
})
