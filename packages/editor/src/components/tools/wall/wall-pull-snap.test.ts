import { describe, expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import { lockWallPullDirection, snapWallPullPoint, type WallPullSnapInput } from './wall-pull-snap'
import type { WallPlanPoint } from './wall-snap-geometry'

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

const deg = (degrees: number) => (degrees * Math.PI) / 180
const polar = (from: WallPlanPoint, degrees: number, length: number): WallPlanPoint => [
  from[0] + Math.cos(deg(degrees)) * length,
  from[1] + Math.sin(deg(degrees)) * length,
]

function expectPoint(actual: WallPlanPoint, expected: WallPlanPoint) {
  expect(actual[0]).toBeCloseTo(expected[0], 6)
  expect(actual[1]).toBeCloseTo(expected[1], 6)
}

// A 4 × 3 m room; the pull starts at the south wall's east end.
const ROOM = [
  makeWall([0, 0], [4, 0], 'south'),
  makeWall([4, 0], [4, 3], 'east'),
  makeWall([4, 3], [0, 3], 'north'),
  makeWall([0, 3], [0, 0], 'west'),
]

function pullFromRoom(point: WallPlanPoint, extra: Partial<WallPullSnapInput> = {}) {
  return snapWallPullPoint({
    point,
    start: [4, 0],
    runStart: [4, 0],
    reference: [1, 0],
    walls: ROOM,
    gridStep: 0.5,
    ...extra,
  })
}

describe('lockWallPullDirection', () => {
  test('holds straight on from the wall it comes from within about 7°', () => {
    expect(lockWallPullDirection(polar([0, 0], 6, 3), [1, 0])).toEqual({
      direction: [1, 0],
      lock: 'straight',
    })
    expect(lockWallPullDirection(polar([0, 0], 8, 3), [1, 0]).lock).toBe('angle')
  })

  test('holds square to the wall it comes from, either side', () => {
    const left = lockWallPullDirection(polar([0, 0], 85, 3), [1, 0])
    expect(left.lock).toBe('square')
    expectPoint(left.direction, [0, 1])
    const right = lockWallPullDirection(polar([0, 0], -96, 3), [1, 0])
    expect(right.lock).toBe('square')
    expectPoint(right.direction, [0, -1])
  })

  test('holds straight on to a skewed wall, and the house axes beside it', () => {
    const skew: WallPlanPoint = [Math.cos(deg(20)), Math.sin(deg(20))]
    const straight = lockWallPullDirection(polar([0, 0], 23, 3), skew)
    expect(straight.lock).toBe('straight')
    expectPoint(straight.direction, skew)
    const axis = lockWallPullDirection(polar([0, 0], 4, 3), skew)
    expect(axis.lock).toBe('axis')
    expectPoint(axis.direction, [1, 0])
  })

  test('past the lock it steps by 15° on the house axes', () => {
    for (const [cursor, expected] of [
      [40, 45],
      [28, 30],
      [52, 45],
      [-118, -120],
    ] as const) {
      const { direction, lock } = lockWallPullDirection(polar([0, 0], cursor, 3), [1, 0])
      expect(lock).toBe('angle')
      expectPoint(direction, polar([0, 0], expected, 1))
    }
  })
})

describe('snapWallPullPoint', () => {
  test('a straight pull steps its length on the grid', () => {
    const result = pullFromRoom([6.6, 0.2])
    expect(result.lock).toBe('straight')
    expect(result.snap).toBe('grid')
    expect(result.label).toBe('Grid')
    expectPoint(result.point, [6.5, 0])
  })

  test('a square pull holds 90° to the pulled wall', () => {
    const result = pullFromRoom([4.25, -2.6])
    expect(result.lock).toBe('square')
    expectPoint(result.point, [4, -2.5])
  })

  test('further round it snaps to 15° steps, with a grid length along them', () => {
    const result = pullFromRoom(polar([4, 0], -40, 3))
    expect(result.lock).toBe('angle')
    // 3 m at 40° is 2.99 m along 45°: 3 m on the 0.5 m grid.
    expectPoint(result.point, polar([4, 0], -45, 3))
  })

  test('Alt is fully free', () => {
    const cursor = polar([4, 0], -40, 3.13)
    const result = pullFromRoom(cursor, { free: true })
    expect(result.lock).toBe('free')
    expect(result.snap).toBeNull()
    expectPoint(result.point, cursor)
  })

  test('the extension of the pulled wall is always drawn', () => {
    const result = pullFromRoom([5.3, -1.9])
    const extension = result.guides.find((guide) => guide.kind === 'extension')
    expect(extension?.from).toEqual([4, 0])
    expect(extension?.to[1]).toBeCloseTo(0, 9)
    expect(extension?.to[0] ?? 0).toBeGreaterThan(5.3)
  })

  test('an existing wall end wins over the held direction', () => {
    const result = snapWallPullPoint({
      point: [4.15, 3.2],
      start: [7, 3],
      runStart: [4, 0],
      reference: [0, 1],
      walls: [...ROOM, makeWall([4, 0], [7, 0], 'p1'), makeWall([7, 0], [7, 3], 'p2')],
      gridStep: 0.5,
    })
    expect(result.snap).toBe('endpoint')
    expect(result.label).toBe('Endpoint')
    expect(result.point).toEqual([4, 3])
    expect(result.targetWallIds.sort()).toEqual(['east', 'north'])
  })

  test('a held direction running into a wall lands on its line, square', () => {
    // From the east of the room, back west at the north wall's height: the
    // wall runs into the east wall at (4, 1.5), square to it.
    const result = snapWallPullPoint({
      point: [4.2, 1.52],
      start: [7, 1.5],
      runStart: [7, -1],
      reference: [0, 1],
      walls: ROOM,
      gridStep: 0.5,
    })
    expect(result.snap).toBe('perpendicular')
    expect(result.label).toBe('Perpendicular')
    expectPoint(result.point, [4, 1.5])
    expect(result.targetWallIds).toEqual(['east'])
  })

  test('a run lines up with its start, then closes on it', () => {
    // Pulled east out of a lone wall's end S = (0, 0): east to (5, 0), north
    // to (5, 4), then west — the run's start guide catches x = 0 …
    const source = makeWall([-4, 0], [0, 0], 'source')
    const walls = [source, makeWall([0, 0], [5, 0], 'r1'), makeWall([5, 0], [5, 4], 'r2')]
    const across = snapWallPullPoint({
      point: [0.1, 4.05],
      start: [5, 4],
      runStart: [0, 0],
      reference: [0, 1],
      walls,
      gridStep: 0,
    })
    expect(across.snap).toBe('alignment')
    expect(across.label).toBe('In line with start')
    expectPoint(across.point, [0, 4])
    const startGuide = across.guides.find((guide) => guide.kind === 'run-start')
    expect(startGuide?.from).toEqual([0, 0])
    expect(startGuide?.to[0]).toBeCloseTo(0, 9)
    expect(startGuide?.to[1] ?? 0).toBeGreaterThan(4)
    // … and the last wall closes square back onto it.
    const close = snapWallPullPoint({
      point: [0.12, 0.2],
      start: [0, 4],
      runStart: [0, 0],
      reference: [-1, 0],
      walls: [...walls, makeWall([5, 4], [0, 4], 'r3')],
      gridStep: 0.5,
    })
    expect(close.snap).toBe('endpoint')
    expect(close.point).toEqual([0, 0])
  })

  test('guides cross near the cursor: the crossing is marked and snaps', () => {
    // The run's start S = (0, 0) and another wall's end P = (2, 6): S's
    // vertical and P's horizontal cross at (0, 6).
    const walls = [
      makeWall([-4, 0], [0, 0], 'source'),
      makeWall([0, 0], [5, 0], 'r1'),
      makeWall([5, 0], [5, 4], 'r2'),
      makeWall([2, 6], [2, 9], 'p'),
    ]
    const near = snapWallPullPoint({
      point: [0.45, 5.6],
      start: [5, 4],
      runStart: [0, 0],
      reference: [0, 1],
      walls,
      gridStep: 0.5,
    })
    expect(near.intersections.some((point) => point[0] === 0 && point[1] === 6)).toBe(true)
    expect(near.snap).not.toBe('intersection')

    const on = snapWallPullPoint({
      point: [0.1, 5.9],
      start: [5, 4],
      runStart: [0, 0],
      reference: [0, 1],
      walls,
      gridStep: 0.5,
    })
    expect(on.snap).toBe('intersection')
    expect(on.label).toBe('Intersection')
    expect(on.point).toEqual([0, 6])
    expect(on.guides.map((guide) => guide.kind).sort()).toEqual([
      'alignment',
      'extension',
      'run-start',
    ])
    const vertical = on.guides.find((guide) => guide.kind === 'run-start')
    expect(vertical?.from).toEqual([0, 0])
    const horizontal = on.guides.find((guide) => guide.kind === 'alignment')
    expect(horizontal?.from).toEqual([2, 6])
  })

  test('a wall middle and a wall crossing snap too', () => {
    const midpoint = pullFromRoom([2.1, 3.15], { start: [4, -2], reference: [0, -1] })
    expect(midpoint.snap).toBe('midpoint')
    expect(midpoint.point).toEqual([2, 3])
  })

  test("on a turned building the lock follows the house's axes, not the world's", () => {
    // The house is turned 30° on its lot. Plan points are in its own frame,
    // as both views hand them to the tools; a world cursor along the house's
    // east side comes in along the house's X, and the held wall goes back out
    // along it.
    const yaw = deg(30)
    const origin: WallPlanPoint = [12, -7]
    const toWorld = ([x, z]: WallPlanPoint): WallPlanPoint => [
      origin[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
      origin[1] - x * Math.sin(yaw) + z * Math.cos(yaw),
    ]
    const toLocal = ([x, z]: WallPlanPoint): WallPlanPoint => {
      const dx = x - origin[0]
      const dz = z - origin[1]
      return [dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)]
    }
    const worldCursor = toWorld([6.6, 0.25])
    const result = pullFromRoom(toLocal(worldCursor))
    expect(result.lock).toBe('straight')
    expectPoint(result.point, [6.5, 0])
    const worldStart = toWorld([4, 0])
    const worldEnd = toWorld(result.point)
    const bearing = Math.atan2(worldEnd[1] - worldStart[1], worldEnd[0] - worldStart[0])
    // Along the house's X, which sits 30° off the world's.
    expect(bearing).toBeCloseTo(-yaw, 9)
  })
})
