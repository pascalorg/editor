import { describe, expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import {
  chainEndJoinsExistingWall,
  findWallSnapTarget,
  findWallSpecialPointSnap,
  type WallPlanPoint,
} from './wall-snap-geometry'

function makeWall(start: WallPlanPoint, end: WallPlanPoint, id?: string): WallNode {
  return {
    object: 'node',
    id: (id ?? `wall_${start.join('_')}_${end.join('_')}`) as WallNode['id'],
    type: 'wall',
    name: 'Wall',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    thickness: 0.1,
    frontSide: 'unknown',
    backSide: 'unknown',
  } as unknown as WallNode
}

describe('findWallSpecialPointSnap', () => {
  test('snaps to a wall corner (endpoint) when near it', () => {
    const walls = [makeWall([0, 0], [4, 0])]
    const result = findWallSpecialPointSnap([0.1, 0.1], walls)
    expect(result?.snap).toBe('endpoint')
    expect(result?.point).toEqual([0, 0])
  })

  test('snaps to a wall midpoint when near it (not a corner)', () => {
    const walls = [makeWall([0, 0], [4, 0])]
    const result = findWallSpecialPointSnap([2.1, 0.2], walls)
    expect(result?.snap).toBe('midpoint')
    expect(result?.point).toEqual([2, 0])
  })

  test('snaps to the crossing of two walls (intersection)', () => {
    // A runs along z=0; B crosses it at x=1. B's own midpoint is [1,1], far
    // from the crossing, so the snap is the intersection, not a midpoint.
    const walls = [makeWall([0, 0], [4, 0], 'a'), makeWall([1, -1], [1, 3], 'b')]
    const result = findWallSpecialPointSnap([1.1, 0.1], walls)
    expect(result?.snap).toBe('intersection')
    expect(result?.point[0]).toBeCloseTo(1, 6)
    expect(result?.point[1]).toBeCloseTo(0, 6)
  })

  test('corner wins over a midpoint when both are in range', () => {
    const walls = [makeWall([0, 0], [1, 0])]
    const result = findWallSpecialPointSnap([0.9, 0.1], walls)
    expect(result?.snap).toBe('endpoint')
    expect(result?.point).toEqual([1, 0])
  })

  test('returns null when no special point is in range', () => {
    const walls = [makeWall([0, 0], [4, 0])]
    // Near the wall body but far from corner/midpoint — that's an edge snap,
    // handled separately by findWallSnapTarget, not a special point.
    expect(findWallSpecialPointSnap([1.2, 0.1], walls)).toBeNull()
  })

  test('honors tighter per-call radii without changing defaults', () => {
    const walls = [makeWall([0, 0], [4, 0])]

    expect(findWallSpecialPointSnap([0.34, 0], walls)?.snap).toBe('endpoint')
    expect(findWallSpecialPointSnap([0.34, 0], walls, undefined, { endpoint: 0.3 })).toBeNull()
  })
})

describe('chainEndJoinsExistingWall (chain termination)', () => {
  test('true when the end lies on a non-chain wall interior (T junction)', () => {
    const walls = [makeWall([0, 0], [4, 0], 'host'), makeWall([2, 2], [2, 0], 'chain_1')]
    expect(chainEndJoinsExistingWall([2, 0], walls, ['chain_1'])).toBe(true)
  })

  test('true when the end lands on a non-chain wall endpoint', () => {
    const walls = [makeWall([0, 0], [4, 0], 'host'), makeWall([6, 2], [4, 0], 'chain_1')]
    expect(chainEndJoinsExistingWall([4, 0], walls, ['chain_1'])).toBe(true)
  })

  test('false when the end only touches the chain walls themselves', () => {
    // Second segment doubles back onto the first one's midpoint — own-chain
    // geometry is excluded, so the chain keeps going.
    const walls = [makeWall([0, 0], [4, 0], 'chain_1'), makeWall([4, 0], [2, 0], 'chain_2')]
    expect(chainEndJoinsExistingWall([2, 0], walls, ['chain_1', 'chain_2'])).toBe(false)
  })

  test('false for a dead end in free space', () => {
    const walls = [makeWall([0, 0], [4, 0], 'host'), makeWall([0, 2], [2, 2], 'chain_1')]
    expect(chainEndJoinsExistingWall([2, 2], walls, ['chain_1'])).toBe(false)
  })

  test('a near miss beyond the tolerance is not a join', () => {
    const walls = [makeWall([0, 0], [4, 0], 'host')]
    expect(chainEndJoinsExistingWall([2, 0.01], walls, [])).toBe(false)
    expect(chainEndJoinsExistingWall([2, 0.0005], walls, [])).toBe(true)
  })
})

describe('findWallSnapTarget (edge / along-wall)', () => {
  test('projects onto a wall body within range', () => {
    const walls = [makeWall([0, 0], [4, 0])]
    const result = findWallSnapTarget([1.2, 0.1], walls)
    expect(result?.[0]).toBeCloseTo(1.2, 6)
    expect(result?.[1]).toBeCloseTo(0, 6)
  })

  test('returns null when too far from any wall', () => {
    const walls = [makeWall([0, 0], [4, 0])]
    expect(findWallSnapTarget([1.2, 2], walls)).toBeNull()
  })

  test('honors a tighter wall-body radius', () => {
    const walls = [makeWall([0, 0], [4, 0])]

    expect(findWallSnapTarget([1.2, 0.1], walls, { radius: 0.08 })).toBeNull()
  })
})
