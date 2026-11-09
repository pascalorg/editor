import { describe, expect, it } from 'bun:test'
import {
  clampSlabElevationForWalls,
  computeWallSlabSupport,
  getSlabElevationUpperBound,
  LevelNode,
  MIN_WALL_HEIGHT,
  SlabNode,
  WallNode,
} from '../../index'

// 4×3 room slab drawn on the wall centerlines, like an auto-slab.
const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

const STOREY_HEIGHT = 2.7
const BOUND = STOREY_HEIGHT - MIN_WALL_HEIGHT

function roomSlab(elevation: number) {
  return SlabNode.parse({ polygon: SQUARE, elevation, autoFromWalls: true })
}

function roomWalls(height?: number) {
  return [
    WallNode.parse({ start: [0, 0], end: [4, 0], height }),
    WallNode.parse({ start: [4, 0], end: [4, 3], height }),
    WallNode.parse({ start: [4, 3], end: [0, 3], height }),
    WallNode.parse({ start: [0, 3], end: [0, 0], height }),
  ]
}

describe('clampSlabElevationForWalls', () => {
  it('clamps a slab under plane-bound walls at the plane minus MIN_WALL_HEIGHT', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(2.5, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(true)
    expect(result.elevation).toBeCloseTo(BOUND)
  })

  it('bounds authored storey-height walls but not taller or ground-hosted walls', () => {
    const slab = roomSlab(0.05)
    for (const { height, supportSlabId, follows } of [
      { height: STOREY_HEIGHT, follows: true },
      { height: STOREY_HEIGHT + 0.3, follows: false },
      { height: STOREY_HEIGHT, supportSlabId: 'ground' as const, follows: false },
    ]) {
      const walls = roomWalls(height).map((wall) => ({ ...wall, supportSlabId }))
      const result = clampSlabElevationForWalls(2.5, slab, walls, [slab], STOREY_HEIGHT)

      expect(result.clamped).toBe(follows)
      expect(result.elevation).toBeCloseTo(follows ? BOUND : 2.5)
      expect(getSlabElevationUpperBound(slab, walls, [slab], STOREY_HEIGHT)).toBe(
        follows ? BOUND : Number.POSITIVE_INFINITY,
      )
    }
  })

  it('leaves proposals at or below the bound untouched', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(BOUND, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(BOUND)
  })

  it('passes negative (recessed-committing) proposals through untouched', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(-0.6, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(-0.6)
  })

  it('does not clamp when the walls all carry explicit heights', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(2.5, slab, roomWalls(2.5), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(2.5)
  })

  it('does not clamp a slab covering no walls', () => {
    const island = SlabNode.parse({
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
      elevation: 0.05,
    })
    const result = clampSlabElevationForWalls(2.5, island, roomWalls(), [island], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(2.5)
  })
})

describe('getSlabElevationUpperBound', () => {
  it('bounds a slab electable by plane-bound walls', () => {
    const slab = roomSlab(0.05)
    expect(getSlabElevationUpperBound(slab, roomWalls(), [slab], STOREY_HEIGHT)).toBeCloseTo(BOUND)
  })

  it('is unbounded under explicit-height walls', () => {
    const slab = roomSlab(0.05)
    expect(getSlabElevationUpperBound(slab, roomWalls(2.5), [slab], STOREY_HEIGHT)).toBe(
      Number.POSITIVE_INFINITY,
    )
  })
})

describe('computeWallSlabSupport preferred host', () => {
  const wallLike = { start: [0, 1.5] as [number, number], end: [4, 1.5] as [number, number] }
  const low = SlabNode.parse({
    id: 'slab_low',
    polygon: SQUARE,
    elevation: 0.1,
    autoFromWalls: true,
  })
  const high = SlabNode.parse({
    id: 'slab_high',
    polygon: SQUARE,
    elevation: 0.6,
    autoFromWalls: true,
  })

  it('elects the highest supporting elevation without a preference', () => {
    const support = computeWallSlabSupport(wallLike, [low, high], [])
    expect(support.elevation).toBeCloseTo(0.6)
  })

  it('pins the elected elevation to a still-supporting preferred slab', () => {
    const support = computeWallSlabSupport(wallLike, [low, high], [], 'slab_low')
    expect(support.elevation).toBeCloseTo(0.1)
    // Fill-down machinery still derives from ALL supporting slabs.
    expect(support.baseSegments).toHaveLength(1)
    expect(support.baseSegments[0]!.elevation).toBeCloseTo(0.6)
  })

  it('ignores a preferred slab that no longer supports the wall', () => {
    const island = SlabNode.parse({
      id: 'slab_island',
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
      elevation: 0.9,
    })
    const support = computeWallSlabSupport(wallLike, [low, high, island], [], 'slab_island')
    expect(support.elevation).toBeCloseTo(0.6)
  })
})

describe('computeWallSlabSupport covering slabs', () => {
  const wall = WallNode.parse({
    id: 'wall_capped',
    start: [0, 1.5],
    end: [4, 1.5],
    thickness: 0.2,
    height: 2.6,
  })
  const floor = SlabNode.parse({ id: 'slab_floor', polygon: SQUARE, elevation: 0 })
  // A 12 mm cap written exactly over the wall's top, covering its whole footprint.
  const cap = SlabNode.parse({
    id: 'slab_cap',
    polygon: [
      [0, 1.4],
      [4, 1.4],
      [4, 1.6],
      [0, 1.6],
    ],
    elevation: 2.662,
    thickness: 0.012,
  })

  it('a slab at or above the wall top rests on the wall and never lifts it', () => {
    const support = computeWallSlabSupport(wall, [floor, cap], [wall])
    expect(support.elevation).toBe(0)
    expect(support.electedSlabId).toBe('slab_floor')
  })

  it('a plane-bound wall measures its top at the storey plane', () => {
    const { height: _height, ...storeyWall } = wall
    const level = LevelNode.parse({ id: 'level_capped', height: 2.6, children: [wall.id] })
    const onLevel = WallNode.parse({ ...storeyWall, parentId: level.id })
    const nodes = { [level.id]: level, [onLevel.id]: onLevel }
    expect(
      computeWallSlabSupport(onLevel, [floor, cap], [onLevel], undefined, undefined, 0, nodes)
        .elevation,
    ).toBe(0)
  })

  it('a raised floor reaching past the wall carries it, however short the wall', () => {
    const raised = SlabNode.parse({ id: 'slab_raised', polygon: SQUARE, elevation: 0.6 })
    const half = WallNode.parse({ ...wall, id: 'wall_half', height: 0.3 })
    expect(computeWallSlabSupport(half, [floor, raised], [half]).elevation).toBeCloseTo(0.6)
  })

  it("the wall's explicit host wins even above its top", () => {
    expect(computeWallSlabSupport(wall, [floor, cap], [wall], 'slab_cap').elevation).toBeCloseTo(
      2.662,
    )
  })
})
