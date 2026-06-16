import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, SlabNode } from '@pascal-app/core'
import { collectRecessedSlabGroundHolePolygons } from '../ground-holes'

describe('collectRecessedSlabGroundHolePolygons', () => {
  test('includes recessed slabs on the lowest level so site ground does not cover pools', () => {
    const lowerLevel = LevelNode.parse({ id: 'level_lower', level: 0 })
    const upperLevel = LevelNode.parse({ id: 'level_upper', level: 1 })
    const lowerPool = SlabNode.parse({
      id: 'slab_lower',
      parentId: lowerLevel.id,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      elevation: -0.15,
    })
    const upperPool = SlabNode.parse({
      id: 'slab_upper',
      parentId: upperLevel.id,
      polygon: [
        [3, 3],
        [5, 3],
        [5, 5],
      ],
      elevation: -0.15,
    })

    expect(
      collectRecessedSlabGroundHolePolygons({
        [lowerLevel.id]: lowerLevel,
        [upperLevel.id]: upperLevel,
        [lowerPool.id]: lowerPool,
        [upperPool.id]: upperPool,
      } as Record<string, AnyNode>),
    ).toEqual([lowerPool.polygon])
  })

  test('excludes raised, hidden, and invalid slabs', () => {
    const recessed = SlabNode.parse({
      id: 'slab_recessed',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      elevation: -0.15,
    })
    const raised = SlabNode.parse({
      id: 'slab_raised',
      polygon: [
        [3, 3],
        [5, 3],
        [5, 5],
      ],
      elevation: 0.05,
    })
    const hidden = SlabNode.parse({
      id: 'slab_hidden',
      visible: false,
      polygon: [
        [6, 6],
        [8, 6],
        [8, 8],
      ],
      elevation: -0.15,
    })
    const invalid = SlabNode.parse({
      id: 'slab_invalid',
      polygon: [
        [9, 9],
        [10, 9],
      ],
      elevation: -0.15,
    })

    expect(
      collectRecessedSlabGroundHolePolygons([recessed, raised, hidden, invalid] as AnyNode[]),
    ).toEqual([recessed.polygon])
  })

  test('uses the raw triangle footprint so the site hole matches the edited boundary', () => {
    const trianglePool = SlabNode.parse({
      id: 'slab_triangle',
      polygon: [
        [0, 0],
        [3, 0],
        [1.5, 2.5],
      ],
      elevation: -0.15,
    })

    const [hole] = collectRecessedSlabGroundHolePolygons([trianglePool] as AnyNode[])

    expect(hole).toBe(trianglePool.polygon)
  })

  test('uses the raw square footprint so the site hole matches the edited boundary', () => {
    const squarePool = SlabNode.parse({
      id: 'slab_square',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      elevation: -0.15,
    })

    const [hole] = collectRecessedSlabGroundHolePolygons([squarePool] as AnyNode[])

    expect(hole).toBe(squarePool.polygon)
  })
})
