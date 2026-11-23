import { describe, expect, test } from 'bun:test'
import { computeSceneBoundsXZ } from '@pascal-app/core'
import type { AnyNode } from '@pascal-app/core/schema'

function makeWall(start: [number, number], end: [number, number]): AnyNode {
  return {
    object: 'node',
    id: `wall_${start.join('_')}_${end.join('_')}`,
    type: 'wall',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    frontSide: 'unknown',
    backSide: 'unknown',
  } as unknown as AnyNode
}

function makeZone(polygon: [number, number][]): AnyNode {
  return {
    object: 'node',
    id: `zone_${polygon.length}_${polygon[0]?.[0] ?? 0}`,
    type: 'zone',
    parentId: null,
    visible: true,
    metadata: {},
    name: 'Zone',
    polygon,
    color: '#000000',
  } as unknown as AnyNode
}

function makeSite(points: [number, number][]): AnyNode {
  return {
    object: 'node',
    id: 'site_test',
    type: 'site',
    parentId: null,
    visible: true,
    metadata: {},
    polygon: { type: 'polygon', points },
    children: [],
  } as unknown as AnyNode
}

describe('computeSceneBoundsXZ', () => {
  test('returns null when given an empty array', () => {
    expect(computeSceneBoundsXZ([])).toBeNull()
  })

  test('returns null when no geometry is found on any node', () => {
    const barren = [
      {
        object: 'node',
        id: 'building_1',
        type: 'building',
        parentId: null,
        visible: true,
        metadata: {},
        children: [],
      } as unknown as AnyNode,
    ]
    expect(computeSceneBoundsXZ(barren)).toBeNull()
  })

  test('computes bounds from wall endpoints', () => {
    const nodes: AnyNode[] = [makeWall([0, 0], [4, 0]), makeWall([4, 0], [4, 3])]
    const bounds = computeSceneBoundsXZ(nodes)
    expect(bounds).not.toBeNull()
    expect(bounds!.min).toEqual([0, 0])
    expect(bounds!.max).toEqual([4, 3])
    expect(bounds!.size).toEqual([4, 3])
    expect(bounds!.center).toEqual([2, 1.5])
  })

  test('includes zone polygons', () => {
    const nodes: AnyNode[] = [
      makeZone([
        [-10, -5],
        [10, -5],
        [10, 5],
        [-10, 5],
      ]),
    ]
    const bounds = computeSceneBoundsXZ(nodes)
    expect(bounds).not.toBeNull()
    expect(bounds!.min).toEqual([-10, -5])
    expect(bounds!.max).toEqual([10, 5])
    expect(bounds!.size).toEqual([20, 10])
  })

  test('ignores the default 30×30 site bootstrap polygon', () => {
    const nodes: AnyNode[] = [
      makeSite([
        [-15, -15],
        [15, -15],
        [15, 15],
        [-15, 15],
      ]),
      makeWall([1, 1], [2, 2]),
    ]
    const bounds = computeSceneBoundsXZ(nodes)
    expect(bounds).not.toBeNull()
    // Only the wall should count — the default site polygon is skipped.
    expect(bounds!.min).toEqual([1, 1])
    expect(bounds!.max).toEqual([2, 2])
  })

  test('honours a non-default site polygon', () => {
    const nodes: AnyNode[] = [
      makeSite([
        [-25, -20],
        [25, -20],
        [25, 20],
        [-25, 20],
      ]),
    ]
    const bounds = computeSceneBoundsXZ(nodes)
    expect(bounds).not.toBeNull()
    expect(bounds!.min).toEqual([-25, -20])
    expect(bounds!.max).toEqual([25, 20])
  })

  test('combines walls, zones and positions across the flat dict', () => {
    const nodes: Record<string, AnyNode> = {
      wallA: makeWall([-8, -3], [4, -3]),
      wallB: makeWall([4, -3], [4, 6]),
      zoneA: makeZone([
        [-8, -3],
        [4, -3],
        [4, 6],
        [-8, 6],
      ]),
      item1: {
        object: 'node',
        id: 'item_1',
        type: 'item',
        parentId: null,
        visible: true,
        metadata: {},
        position: [7, 0, 8],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        children: [],
        asset: {
          id: 'a',
          category: 'furniture',
          name: 'Chair',
          thumbnail: '',
          src: '',
          dimensions: [1, 1, 1],
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      } as unknown as AnyNode,
    }
    const bounds = computeSceneBoundsXZ(nodes)
    expect(bounds).not.toBeNull()
    expect(bounds!.min).toEqual([-8, -3])
    expect(bounds!.max).toEqual([7, 8])
  })

  test('handles a single degenerate point with a minimum extent', () => {
    const nodes: AnyNode[] = [makeWall([2, 2], [2, 2])]
    const bounds = computeSceneBoundsXZ(nodes)
    expect(bounds).not.toBeNull()
    expect(bounds!.size[0]).toBeGreaterThan(0)
    expect(bounds!.size[1]).toBeGreaterThan(0)
    expect(bounds!.center).toEqual([2, 2])
  })

  describe('ancestor transforms', () => {
    function makeBuilding(
      id: string,
      position: [number, number, number],
      rotationY = 0,
      parentId: string | null = null,
    ): AnyNode {
      return {
        object: 'node',
        id,
        type: 'building',
        parentId,
        visible: true,
        metadata: {},
        children: [],
        position,
        rotation: [0, rotationY, 0],
      } as unknown as AnyNode
    }

    function makeLevel(id: string, parentId: string): AnyNode {
      return {
        object: 'node',
        id,
        type: 'level',
        parentId,
        visible: true,
        metadata: {},
        children: [],
        level: 0,
      } as unknown as AnyNode
    }

    function child(node: AnyNode, parentId: string): AnyNode {
      return { ...node, parentId } as AnyNode
    }

    function expectClose(actual: [number, number], expected: [number, number]) {
      expect(actual[0]).toBeCloseTo(expected[0], 9)
      expect(actual[1]).toBeCloseTo(expected[1], 9)
    }

    test('carries building-local walls and zones through a translated building', () => {
      const nodes = [
        makeBuilding('building_a', [100, 0, 100]),
        makeLevel('level_a', 'building_a'),
        child(makeWall([-5, -4], [5, -4]), 'level_a'),
        child(
          makeZone([
            [-5, -4],
            [5, -4],
            [5, 4],
            [-5, 4],
          ]),
          'level_a',
        ),
      ]
      const bounds = computeSceneBoundsXZ(nodes)!
      expectClose(bounds.min, [95, 96])
      expectClose(bounds.max, [105, 104])
      expectClose(bounds.center, [100, 100])
    })

    test('turns building-local geometry by the building yaw', () => {
      // three.js Y rotation by +90°: local (x, z) → (z, −x).
      const nodes = [
        makeBuilding('building_r', [10, 0, 0], Math.PI / 2),
        makeLevel('level_r', 'building_r'),
        child(makeWall([0, 0], [8, 0]), 'level_r'),
        child(makeWall([8, 0], [8, 2]), 'level_r'),
      ]
      const bounds = computeSceneBoundsXZ(nodes)!
      expectClose(bounds.min, [10, -8])
      expectClose(bounds.max, [12, 0])
      expectClose(bounds.size, [2, 8])
    })

    test('composes nested positioned and rotated ancestors', () => {
      const item = {
        object: 'node',
        id: 'item_host',
        type: 'item',
        parentId: 'level_n',
        visible: true,
        metadata: {},
        children: [],
        position: [2, 0, 0],
        rotation: [0, Math.PI / 2, 0],
      } as unknown as AnyNode
      const hosted = {
        object: 'node',
        id: 'item_hosted',
        type: 'item',
        parentId: 'item_host',
        visible: true,
        metadata: {},
        children: [],
        position: [1, 0, 0],
        rotation: [0, 0, 0],
      } as unknown as AnyNode
      // Building at (50, 50) turned 90°: the host lands at (50, 48), and the
      // hosted item (1, 0) under a total 180° yaw lands one metre further −x.
      const nodes = [
        makeBuilding('building_n', [50, 0, 50], Math.PI / 2),
        makeLevel('level_n', 'building_n'),
        item,
        hosted,
      ]
      const bounds = computeSceneBoundsXZ(nodes)!
      expectClose(bounds.min, [49, 48])
      expectClose(bounds.max, [50, 50])
    })

    test('leaves geometry under an untransformed building unchanged', () => {
      const nodes = [
        makeBuilding('building_0', [0, 0, 0]),
        makeLevel('level_0', 'building_0'),
        child(makeWall([0, 0], [4, 0]), 'level_0'),
        child(makeWall([4, 0], [4, 3]), 'level_0'),
      ]
      const bounds = computeSceneBoundsXZ(nodes)!
      expect(bounds.min).toEqual([0, 0])
      expect(bounds.max).toEqual([4, 3])
    })
  })

  test('a door on a wall is bounded by the wall, not its wall-local position', () => {
    const wall = makeWall([50, 50], [60, 50])
    const door = {
      object: 'node',
      id: 'door_1',
      type: 'door',
      parentId: wall.id,
      visible: true,
      metadata: {},
      position: [2, 1, 0],
    } as unknown as AnyNode
    const bounds = computeSceneBoundsXZ([wall, door])
    expect(bounds).not.toBeNull()
    expect(bounds!.min[0]).toBe(50)
    expect(bounds!.max[0]).toBe(60)
    expect(bounds!.center).toEqual([55, 50])
  })

  test('skips non-finite coordinates', () => {
    const nodes: AnyNode[] = [makeWall([Number.NaN, 0], [4, 2]), makeWall([0, 0], [1, 1])]
    const bounds = computeSceneBoundsXZ(nodes)
    expect(bounds).not.toBeNull()
    // NaN should be ignored; the usable points are (4,2), (0,0), (1,1).
    expect(bounds!.min).toEqual([0, 0])
    expect(bounds!.max).toEqual([4, 2])
  })
})
