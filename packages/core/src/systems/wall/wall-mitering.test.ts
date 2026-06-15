import { describe, expect, test } from 'bun:test'
import type { WallNode } from '../../schema'
import { calculateLevelMiters, getWallMiterBoundaryPoints } from './wall-mitering'

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
