import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core/schema'
import { computeSceneBoundsXZ } from './scene-bounds'

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

  test('skips non-finite coordinates', () => {
    const nodes: AnyNode[] = [makeWall([Number.NaN, 0], [4, 2]), makeWall([0, 0], [1, 1])]
    const bounds = computeSceneBoundsXZ(nodes)
    expect(bounds).not.toBeNull()
    // NaN should be ignored; the usable points are (4,2), (0,0), (1,1).
    expect(bounds!.min).toEqual([0, 0])
    expect(bounds!.max).toEqual([4, 2])
  })
})
