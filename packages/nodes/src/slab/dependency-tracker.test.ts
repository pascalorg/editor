import { describe, expect, test } from 'bun:test'
import { SlabNode } from '@pascal-app/core'
import { createSlabDependencyTracker } from './dependency-tracker'

describe('createSlabDependencyTracker', () => {
  test('ignores an incomplete building transform instead of crashing', () => {
    const slab = SlabNode.parse({
      parentId: 'level',
      elevation: 0,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const nodes = {
      building: { id: 'building', type: 'building', children: ['level'] },
      level: { id: 'level', type: 'level', parentId: 'building', children: [slab.id] },
      [slab.id]: slab,
    } as never

    expect(() => createSlabDependencyTracker(nodes)).not.toThrow()
  })
})
