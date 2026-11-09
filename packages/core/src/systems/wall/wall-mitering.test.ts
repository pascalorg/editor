import { describe, expect, test } from 'bun:test'
import type { WallNode } from '../../schema'
import { getWallPlanFootprint } from './wall-footprint'
import { calculateLevelMiters, getWallMiterBoundaryPoints, pointToKey } from './wall-mitering'

function wall(id: string, start: [number, number], end: [number, number]): WallNode {
  return {
    id,
    type: 'wall',
    object: 'node',
    visible: true,
    parentId: 'level_test',
    children: [],
    start,
    end,
    thickness: 0.1,
    height: 2.5,
    frontSide: 'interior',
    backSide: 'exterior',
    metadata: {},
  } as WallNode
}

function maxBoundaryCoord(walls: WallNode[]): number {
  const miter = calculateLevelMiters(walls)
  let max = 0
  for (const w of walls) {
    const bp = getWallMiterBoundaryPoints(w, miter)
    expect(bp).not.toBeNull()
    if (!bp) continue
    for (const p of [bp.startLeft, bp.startRight, bp.endLeft, bp.endRight]) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      max = Math.max(max, Math.abs(p.x), Math.abs(p.y))
    }
  }
  return max
}

describe('wall mitering miter limit', () => {
  // Two 3 m walls sharing the origin, meeting at decreasing angles. Without a
  // miter limit the joint point runs to infinity as the angle → 0 (∝ 1/sin θ),
  // which is the "infinite wall" seen when a room-preset preview lands on top of
  // an existing wall. The boundary must stay bounded near the wall length.
  test.each([90, 30, 10, 5, 1, 0.1, 0.01])('stays bounded at a %s° junction', (deg) => {
    const rad = (deg * Math.PI) / 180
    const walls = [
      wall('A', [0, 0], [3, 0]),
      wall('B', [0, 0], [3 * Math.cos(rad), 3 * Math.sin(rad)]),
    ]
    // 3 m walls + a few cm of joint: anything past ~4 m is a runaway spike.
    expect(maxBoundaryCoord(walls)).toBeLessThan(4)
  })

  test('still miters a normal 90° corner', () => {
    const walls = [wall('A', [0, 0], [3, 0]), wall('B', [0, 0], [0, 3])]
    const miter = calculateLevelMiters(walls)
    const bpA = getWallMiterBoundaryPoints(walls[0]!, miter)
    expect(bpA).not.toBeNull()
    if (!bpA) throw new Error('expected miter boundary points')
    // The shared corner is pulled to the mitred intersection, offset from the
    // raw butt position (halfThickness 0.05) by the diagonal of the joint.
    const startSideX = Math.min(bpA.startLeft.x, bpA.startRight.x)
    expect(startSideX).toBeLessThan(-0.001)
    expect(startSideX).toBeGreaterThan(-0.5)
  })
})

describe('wall miter boundary sides', () => {
  test('keeps left and right on the same physical face at both free endpoints', () => {
    const node = wall('A', [0, 0], [3, 0])
    const boundary = getWallMiterBoundaryPoints(node, calculateLevelMiters([node]))
    expect(boundary).not.toBeNull()
    if (!boundary) throw new Error('expected miter boundary points')

    expect(boundary.startLeft.y).toBeCloseTo(0.05)
    expect(boundary.endLeft.y).toBeCloseTo(0.05)
    expect(boundary.startRight.y).toBeCloseTo(-0.05)
    expect(boundary.endRight.y).toBeCloseTo(-0.05)
  })
})

describe('deterministic junction ordering', () => {
  test('same wall set produces the same miter data regardless of input order', () => {
    const thickWall = (id: string, thickness: number, end: [number, number]) =>
      ({ ...wall(id, [0, 0], end), thickness }) as WallNode
    const wide = thickWall('wide', 0.6, [4, 0])
    const narrow = thickWall('narrow', 0.2, [4, 0])
    const branch = thickWall('branch', 0.4, [0, 4])

    const forward = calculateLevelMiters([wide, narrow, branch]).junctionData.get('0,0')
    const reversed = calculateLevelMiters([narrow, wide, branch]).junctionData.get('0,0')

    expect(forward).toEqual(reversed)
  })
})

describe('junction grid prefilter', () => {
  function thickWall(
    id: string,
    start: [number, number],
    end: [number, number],
    thickness: number,
  ): WallNode {
    return { ...wall(id, start, end), thickness } as WallNode
  }

  // A wall covering more than JUNCTION_GRID_MAX_CELLS_PER_WALL grid cells is held
  // in the fallback bucket, which is scanned after the per-cell bucket. When such
  // a wall and a shorter collinear one both pass through a junction they tie on
  // angle, so the order they were appended in decides which thickness the miter
  // uses — the prefilter must not reorder them relative to the input.
  test('an oversized wall keeps its input position among collinear passthroughs', () => {
    const long = thickWall('long', [0, 0], [20, 20], 0.6)
    const infill = thickWall('infill', [4, 4], [12, 12], 0.15)
    const spur = thickWall('spur', [8, 8], [8, 14], 0.3)

    const junction = calculateLevelMiters([long, infill, spur]).junctions.get(
      pointToKey({ x: 8, y: 8 }),
    )
    expect(junction).toBeDefined()
    expect(junction?.connectedWalls.map((cw) => cw.wall.id)).toEqual(['spur', 'long', 'infill'])
  })

  test('a junction on a long wall is still found through the fallback bucket', () => {
    const long = thickWall('long', [0, 0], [140, 0], 0.2)
    const spur = thickWall('spur', [60, 0], [60, 6], 0.2)

    const junction = calculateLevelMiters([long, spur]).junctions.get(pointToKey({ x: 60, y: 0 }))
    expect(junction?.connectedWalls.map((cw) => cw.wall.id)).toEqual(['spur', 'long'])
  })
})

describe('outside corner with a partition in line', () => {
  // Two outside walls 0.18 thick turn a corner at the origin: one runs off to
  // -x, the other to +z, outdoors between them. A 0.11 partition carries the
  // first one's line on to +x.
  const outsideLeft = {
    ...wall('wall_left', [-3, 0], [0, 0]),
    thickness: 0.18,
    frontSide: 'exterior',
    backSide: 'interior',
  } as WallNode
  const outsideDown = {
    ...wall('wall_down', [0, 0], [0, 3]),
    thickness: 0.18,
    frontSide: 'exterior',
    backSide: 'interior',
  } as WallNode
  const partition = {
    ...wall('wall_part', [0, 0], [3, 0]),
    thickness: 0.11,
    frontSide: 'interior',
    backSide: 'interior',
  } as WallNode
  const walls = [outsideLeft, outsideDown, partition]
  const near = (p: { x: number; y: number } | undefined, x: number, y: number) =>
    !!p && Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9
  const inside = (polygon: { x: number; y: number }[], x: number, y: number) => {
    let hit = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!
      const b = polygon[j]!
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit
    }
    return hit
  }
  const corner = () => calculateLevelMiters(walls).junctionData.get(pointToKey({ x: 0, y: 0 }))!

  test('the outside faces miter to the corner', () => {
    for (const id of ['wall_left', 'wall_down']) {
      const ends = corner().get(id)!
      expect(near(ends.left, -0.09, 0.09) || near(ends.right, -0.09, 0.09)).toBe(true)
    }
  })

  test('the partition stops square at the inside face of the corner', () => {
    const miter = calculateLevelMiters(walls)
    const ends = miter.junctionData.get(pointToKey({ x: 0, y: 0 }))!.get('wall_part')!
    expect(near(ends.left, 0.09, 0.055)).toBe(true)
    expect(near(ends.right, 0.09, -0.055)).toBe(true)
    const footprint = getWallPlanFootprint(partition, miter)
    expect(Math.min(...footprint.map((p) => p.x))).toBeCloseTo(0.09, 9)
  })

  test("each room's own walls cover its side of the corner", () => {
    const miter = calculateLevelMiters(walls)
    const left = getWallPlanFootprint(outsideLeft, miter)
    const down = getWallPlanFootprint(outsideDown, miter)
    // The room beyond the line (z < 0) is walled by the left wall and the
    // partition: the corner's half on its side is the left wall's.
    for (const [x, y] of [
      [0.05, -0.05],
      [0.08, -0.01],
      [-0.05, -0.08],
    ] as const) {
      expect(inside(left, x, y)).toBe(true)
      expect(inside(down, x, y)).toBe(false)
    }
    // The room between the partition and the down wall (x, z > 0) is theirs.
    expect(inside(down, 0.05, 0.05)).toBe(true)
    expect(inside(left, 0.05, 0.05)).toBe(false)
  })

  test('a corner of walls that are not outside walls keeps the shared miter', () => {
    const indoors = walls.map(
      (w) => ({ ...w, frontSide: 'interior', backSide: 'interior' }) as WallNode,
    )
    const ends = calculateLevelMiters(indoors)
      .junctionData.get(pointToKey({ x: 0, y: 0 }))!
      .get('wall_part')
    expect(ends?.closing).toBeUndefined()
  })
})

describe('a wall T-joined into a wall body', () => {
  test('ends square on the host face, not in a wedge to its middle', () => {
    const host = wall('wall_host', [-3, 0], [3, 0])
    const stem = { ...wall('wall_stem', [0, 0], [0, 2]), thickness: 0.1 } as WallNode
    const miter = calculateLevelMiters([host, stem])
    const ends = miter.junctionData.get(pointToKey({ x: 0, y: 0 }))!.get('wall_stem')!
    expect(ends.closing?.y).toBeCloseTo(0.05, 9)
    const footprint = getWallPlanFootprint(stem, miter)
    expect(Math.min(...footprint.map((p) => p.y))).toBeCloseTo(0.05, 9)
  })
})
