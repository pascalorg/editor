import { describe, expect, test } from 'bun:test'
import { healSceneNodes } from './heal-scene-graph'

describe('healSceneNodes', () => {
  test('strips non-string (null) children entries', () => {
    const { nodes, strippedChildRefs } = healSceneNodes({
      wall_a: {
        id: 'wall_a',
        type: 'wall',
        start: [0, 0],
        end: [1, 0],
        children: [null, 'item_x'],
      },
      item_x: { id: 'item_x', type: 'item' },
    })
    expect(strippedChildRefs).toBe(1)
    expect((nodes.wall_a as { children: string[] }).children).toEqual(['item_x'])
  })

  test('drops childless zero-length walls and removes their parent reference', () => {
    const { nodes, droppedWallIds } = healSceneNodes({
      level_0: { id: 'level_0', type: 'level', children: ['wall_zero', 'wall_real'] },
      wall_zero: { id: 'wall_zero', type: 'wall', start: [5, 5], end: [5, 5], children: [] },
      wall_real: { id: 'wall_real', type: 'wall', start: [0, 0], end: [3, 0], children: [] },
    })
    expect(droppedWallIds).toEqual(['wall_zero'])
    expect('wall_zero' in nodes).toBe(false)
    expect((nodes.level_0 as { children: string[] }).children).toEqual(['wall_real'])
  })

  test('keeps a zero-length wall that still hosts a door/window', () => {
    const { nodes, droppedWallIds } = healSceneNodes({
      wall_z: { id: 'wall_z', type: 'wall', start: [1, 1], end: [1, 1], children: ['door_1'] },
      door_1: { id: 'door_1', type: 'door' },
    })
    expect(droppedWallIds).toEqual([])
    expect('wall_z' in nodes).toBe(true)
  })

  test('passes a clean scene through untouched', () => {
    const input = {
      wall_a: { id: 'wall_a', type: 'wall', start: [0, 0], end: [2, 0], children: ['door_1'] },
      door_1: { id: 'door_1', type: 'door' },
    }
    const { nodes, droppedWallIds, strippedChildRefs } = healSceneNodes(input)
    expect(droppedWallIds).toEqual([])
    expect(strippedChildRefs).toBe(0)
    expect(nodes.wall_a).toBe(input.wall_a)
  })

  test('drops a stale child reference left behind by a reparent', () => {
    // window's parentId says wall_b, but wall_a still lists it — the exact
    // corruption that rendered a window twice (duplicate React keys in 2D).
    const { nodes, strippedStaleChildRefs } = healSceneNodes({
      wall_a: { id: 'wall_a', type: 'wall', start: [0, 0], end: [2, 0], children: ['window_1'] },
      wall_b: { id: 'wall_b', type: 'wall', start: [2, 0], end: [4, 0], children: ['window_1'] },
      window_1: { id: 'window_1', type: 'window', parentId: 'wall_b' },
    })
    expect(strippedStaleChildRefs).toBe(1)
    expect((nodes.wall_a as { children: string[] }).children).toEqual([])
    expect((nodes.wall_b as { children: string[] }).children).toEqual(['window_1'])
  })

  test('collapses same-array duplicate child references', () => {
    const { nodes, strippedStaleChildRefs } = healSceneNodes({
      wall_a: {
        id: 'wall_a',
        type: 'wall',
        start: [0, 0],
        end: [2, 0],
        children: ['door_1', 'door_1'],
      },
      door_1: { id: 'door_1', type: 'door', parentId: 'wall_a' },
    })
    expect(strippedStaleChildRefs).toBe(1)
    expect((nodes.wall_a as { children: string[] }).children).toEqual(['door_1'])
  })

  test('keeps children whose parentId matches or is absent', () => {
    const input = {
      wall_a: {
        id: 'wall_a',
        type: 'wall',
        start: [0, 0],
        end: [2, 0],
        children: ['door_1', 'item_legacy'],
      },
      door_1: { id: 'door_1', type: 'door', parentId: 'wall_a' },
      item_legacy: { id: 'item_legacy', type: 'item' },
    }
    const { nodes, strippedStaleChildRefs } = healSceneNodes(input)
    expect(strippedStaleChildRefs).toBe(0)
    expect(nodes.wall_a).toBe(input.wall_a)
  })
})
