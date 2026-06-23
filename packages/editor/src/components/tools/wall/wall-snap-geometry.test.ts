import { describe, expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import {
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
