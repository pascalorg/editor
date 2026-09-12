import { describe, expect, test } from 'bun:test'
import { offsetRunPointFromSurface, type RunSurfaceTarget } from './distribution-run-contract'

const wall = (hostId = 'wall-1', side: 'front' | 'back' = 'front'): RunSurfaceTarget => ({
  kind: 'wall',
  levelId: 'level-1',
  hostId,
  side,
  frame: {
    origin: [2, 1, 0],
    normal: [0, 0, 1],
    tangent: [1, 0, 0],
    bitangent: [0, 1, 0],
  },
  bounds: { minU: 0, maxU: 4, minV: 0, maxV: 2.5 },
})

describe('distribution run interaction contract', () => {
  test('offsets wall geometry along the face normal', () => {
    const target = wall()
    expect(offsetRunPointFromSurface([3, 1, 0], target, 0.1)).toEqual([3, 1, 0.1])
  })
})
