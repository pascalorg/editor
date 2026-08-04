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

  test('preserves legacy embedded site children for the scene migration', () => {
    const building = {
      id: 'building_legacy',
      type: 'building',
      parentId: null,
      children: ['level_legacy'],
    }
    const { nodes, strippedChildRefs } = healSceneNodes({
      site_legacy: {
        id: 'site_legacy',
        type: 'site',
        parentId: null,
        children: [building, null],
      },
      building_legacy: building,
      level_legacy: { id: 'level_legacy', type: 'level', parentId: null, children: [] },
    })

    expect(strippedChildRefs).toBe(1)
    expect((nodes.site_legacy as { children: unknown[] }).children).toEqual([building])
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

  test('repairs null parent links down a site → building → level chain', () => {
    // The exact stored-production corruption behind "Live collaboration is
    // unavailable": children arrays link the chain but building/level carry
    // parentId null, so the authority's symmetry validation rejected the scene.
    const { nodes, repairedParentLinkNodeIds } = healSceneNodes({
      site_a: { id: 'site_a', type: 'site', parentId: null, children: ['building_a'] },
      building_a: { id: 'building_a', type: 'building', parentId: null, children: ['level_a'] },
      level_a: { id: 'level_a', type: 'level', parentId: null, children: ['wall_a'] },
      wall_a: { id: 'wall_a', type: 'wall', parentId: 'level_a', start: [0, 0], end: [2, 0] },
    })
    expect(repairedParentLinkNodeIds.sort()).toEqual(['building_a', 'level_a'])
    expect((nodes.building_a as { parentId: string }).parentId).toBe('site_a')
    expect((nodes.level_a as { parentId: string }).parentId).toBe('building_a')
    expect((nodes.site_a as { parentId: null }).parentId).toBeNull()
  })

  test('repairs a null parent link claimed through an embedded legacy site child', () => {
    const embeddedBuilding = {
      id: 'building_legacy',
      type: 'building',
      parentId: null,
      children: [],
    }
    const { nodes, repairedParentLinkNodeIds } = healSceneNodes({
      site_legacy: {
        id: 'site_legacy',
        type: 'site',
        parentId: null,
        children: [embeddedBuilding],
      },
      building_legacy: embeddedBuilding,
    })
    expect(repairedParentLinkNodeIds).toEqual(['building_legacy'])
    expect((nodes.building_legacy as { parentId: string }).parentId).toBe('site_legacy')
  })

  test('leaves a null parent link alone when multiple parents claim the node', () => {
    const { nodes, repairedParentLinkNodeIds } = healSceneNodes({
      level_a: { id: 'level_a', type: 'level', parentId: null, children: ['item_x'] },
      level_b: { id: 'level_b', type: 'level', parentId: null, children: ['item_x'] },
      item_x: { id: 'item_x', type: 'item', parentId: null },
    })
    expect(repairedParentLinkNodeIds).toEqual([])
    expect((nodes.item_x as { parentId: null }).parentId).toBeNull()
  })

  test('leaves an unclaimed root and an existing string parentId alone', () => {
    const { nodes, repairedParentLinkNodeIds } = healSceneNodes({
      site_root: { id: 'site_root', type: 'site', parentId: null, children: ['building_a'] },
      building_a: {
        id: 'building_a',
        type: 'building',
        parentId: 'site_root',
        children: ['level_gone'],
      },
      level_gone: { id: 'level_gone', type: 'level', parentId: 'building_missing', children: [] },
    })
    expect(repairedParentLinkNodeIds).toEqual([])
    expect((nodes.site_root as { parentId: null }).parentId).toBeNull()
    expect((nodes.level_gone as { parentId: string }).parentId).toBe('building_missing')
  })
})
