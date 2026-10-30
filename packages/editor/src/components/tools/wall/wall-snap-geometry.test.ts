import { describe, expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import {
  chainEndJoinsExistingWall,
  findWallBodySnapTarget,
  findWallSnapTarget,
  findWallSpecialPointSnap,
  type WallPlanPoint,
} from './wall-snap-geometry'

function makeWall(
  start: WallPlanPoint,
  end: WallPlanPoint,
  id?: string,
  overrides: Partial<WallNode> = {},
): WallNode {
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
    ...overrides,
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
    expect(result?.targetWallIds).toEqual(['a', 'b'])
  })

  test('keeps every wall that shares a snapped endpoint as provenance', () => {
    const walls = [makeWall([0, 0], [4, 0], 'a'), makeWall([0, 0], [0, 4], 'b')]
    const result = findWallSpecialPointSnap([0.1, 0.1], walls)
    expect(result?.point).toEqual([0, 0])
    expect(result?.targetWallIds).toEqual(['a', 'b'])
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

describe('findWallBodySnapTarget (a wall end aimed into a wall)', () => {
  // An 8" wall centred on z = 0: its faces sit at z = ±0.1016.
  const host = makeWall([0, 0], [4, 0], 'host', { thickness: 0.2032 })

  test('an end inside the body or within the margin of a face lands on the reference line', () => {
    expect(findWallBodySnapTarget([1.2, 0.05], [host])).toEqual([1.2, 0])
    expect(findWallBodySnapTarget([1.2, 0.14], [host])).toEqual([1.2, 0])
    expect(findWallBodySnapTarget([1.2, -0.14], [host])).toEqual([1.2, 0])
    expect(findWallBodySnapTarget([1.2, 0.16], [host])).toBeNull()
    // Past the wall's ends the corner snap decides, not the body.
    expect(findWallBodySnapTarget([4.05, 0.05], [host])).toBeNull()
  })

  test('the grid placement keeps its station along the wall, and captures on its own', () => {
    // The cursor sits by the face; its lattice point is out of the band.
    expect(findWallBodySnapTarget([1.23, 0.12], [host], { placed: [1.25, 0.25] })).toEqual([
      1.25, 0,
    ])
    // The cursor is out of the band; the lattice point fell into it.
    expect(findWallBodySnapTarget([1.23, 0.3], [host], { placed: [1.25, 0.1] })).toEqual([1.25, 0])
  })

  test('with a start, the end slides along the drafted segment onto the line', () => {
    const start: WallPlanPoint = [1, 3]
    const placed: WallPlanPoint = [1.3, 0.12]
    const target = findWallBodySnapTarget(placed, [host], { start, placed })
    expect(target?.[1]).toBeCloseTo(0, 12)
    // Still on the drafted line start → placed: the segment keeps its direction.
    const cross =
      (placed[0] - start[0]) * (target![1] - start[1]) -
      (placed[1] - start[1]) * (target![0] - start[0])
    expect(cross).toBeCloseTo(0, 12)
  })

  test('a square segment stays square', () => {
    const target = findWallBodySnapTarget([2, 0.13], [host], { start: [2, 3] })
    expect(target?.[0]).toBe(2)
    expect(target?.[1]).toBeCloseTo(0, 12)
  })

  test('walls the segment runs alongside, or starts on, are left alone', () => {
    expect(findWallBodySnapTarget([2, 0.06], [host], { start: [0.5, 0.05] })).toBeNull()
    expect(findWallBodySnapTarget([1.1, 0.12], [host], { start: [1, 0] })).toBeNull()
  })

  test('a justified wall captures across its whole body, measured from its faces', () => {
    // Justified to face a: the body runs from the line (z = 0) to z = 0.2032.
    const justified = makeWall([0, 0], [4, 0], 'justified', {
      thickness: 0.2032,
      justification: 'a',
    })
    expect(findWallBodySnapTarget([1.2, 0.24], [justified])).toEqual([1.2, 0])
    expect(findWallBodySnapTarget([1.2, -0.04], [justified])).toEqual([1.2, 0])
    expect(findWallBodySnapTarget([1.2, -0.08], [justified])).toBeNull()
  })

  test('an end already on the line stays put', () => {
    const onLine: WallPlanPoint = [1.234, 0]
    expect(findWallBodySnapTarget(onLine, [host], { start: [1.5, 3], placed: [1.5, 0.5] })).toEqual(
      onLine,
    )
  })

  test('picks the wall whose body the end is closest to', () => {
    // 0.05 off `near`'s face, 0.018 off the host's.
    const near = makeWall([0, 0.22], [4, 0.22], 'near', { thickness: 0.1 })
    expect(findWallBodySnapTarget([1, 0.12], [near, host])).toEqual([1, 0])
  })

  test('an end in the corner block of an L joins the corner, not an 8 cm stub', () => {
    // Two 0.2 m walls meeting at the origin: the corner block is the 0.2 m
    // square around it.
    const l = [
      makeWall([0, 0], [4, 0], 'south', { thickness: 0.2 }),
      makeWall([0, 4], [0, 0], 'west', { thickness: 0.2 }),
    ]
    expect(findWallBodySnapTarget([0.08, 0.08], l)).toEqual([0, 0])
    // The block's outer quadrant lies in one wall's body only, and joins too.
    expect(findWallBodySnapTarget([0.05, -0.05], l)).toEqual([0, 0])
    // Aimed into the block from across the room.
    expect(findWallBodySnapTarget([0.08, 0.08], l, { start: [2, 3] })).toEqual([0, 0])
    // Past the other wall's face, the end T-joins as before.
    expect(findWallBodySnapTarget([0.3, 0.05], l)).toEqual([0.3, 0])
  })

  test('an end in the corner block of a T joins the junction', () => {
    // The host split at the junction, as the topology leaves a T-join.
    const t = [
      makeWall([0, 0], [2, 0], 'left', { thickness: 0.2 }),
      makeWall([2, 0], [4, 0], 'right', { thickness: 0.2 }),
      makeWall([2, 0], [2, 4], 'stem', { thickness: 0.2 }),
    ]
    expect(findWallBodySnapTarget([2.08, 0.08], t)).toEqual([2, 0])
    expect(findWallBodySnapTarget([1.92, 0.06], t)).toEqual([2, 0])
    // A host left whole, the stem ending on its interior, from either wall's side.
    const whole = makeWall([0, 0], [4, 0], 'whole', { thickness: 0.2 })
    const stem = makeWall([2, 0], [2, 4], 'stem', { thickness: 0.2 })
    expect(findWallBodySnapTarget([2.08, 0.08], [whole, stem])).toEqual([2, 0])
    expect(findWallBodySnapTarget([2.08, 0.08], [stem, whole])).toEqual([2, 0])
    // Clear of the corner block each wall T-joins as before.
    expect(findWallBodySnapTarget([2.4, 0.08], [whole, stem])).toEqual([2.4, 0])
    expect(findWallBodySnapTarget([2.06, 0.3], [whole, stem])).toEqual([2, 0.3])
  })
})
