import { describe, expect, test } from 'bun:test'
import { bendLocalPoint, bendRotationYAtLocalX, isCurvedLeanTo, leanToArcRadius } from './arc'

// Distance of a bent point from the stored arc center O = (0, spanArcCenterZ).
function radiusFromCenter(node: { spanArcCenterZ: number }, x: number, y: number): number {
  return Math.hypot(x - 0, y - node.spanArcCenterZ)
}

describe('lean-to local span arc', () => {
  test('straight span degenerates to the identity', () => {
    const node = { spanArcCenterZ: undefined, spanArcRadius: undefined }
    expect(isCurvedLeanTo(node)).toBe(false)
    expect(leanToArcRadius(node)).toBe(Number.POSITIVE_INFINITY)
    expect(bendLocalPoint(node, 1.5, 0.8)).toEqual({ x: 1.5, y: 0.8 })
    expect(bendLocalPoint(node, -2, -0.5)).toEqual({ x: -2, y: -0.5 })
    expect(bendRotationYAtLocalX(node, 1.5)).toBe(0)
  })

  test('reports the stored wall radius', () => {
    const node = { spanArcCenterZ: 5, spanArcRadius: 4.25 }
    expect(isCurvedLeanTo(node)).toBe(true)
    expect(leanToArcRadius(node)).toBeCloseTo(4.25, 6)
  })

  test('uses the true wall radius for angular travel on an offset wall face', () => {
    const node = { spanArcCenterZ: 4.9, spanArcRadius: 5 }
    const point = bendLocalPoint(node, 1, 0)

    expect(point.x).toBeCloseTo(4.9 * Math.sin(1 / 5), 6)
    expect(point.y).toBeCloseTo(4.9 - 4.9 * Math.cos(1 / 5), 6)
    expect(bendRotationYAtLocalX(node, 1)).toBeCloseTo(-1 / 5, 6)
  })

  test('pins the crown high edge at the local origin', () => {
    const node = { spanArcCenterZ: 5, spanArcRadius: 5 }
    const mid = bendLocalPoint(node, 0, 0)
    expect(mid.x).toBeCloseTo(0, 6)
    expect(mid.y).toBeCloseTo(0, 6)
  })

  test('the back edge is a concentric arc at radius |spanArcCenterZ|', () => {
    const node = { spanArcCenterZ: 5, spanArcRadius: 5 }
    // localZ = 0 is the high/back edge; every point along it is equidistant
    // from the stored center, i.e. a circular arc.
    for (const localX of [-2, -1, 0, 1, 2]) {
      const p = bendLocalPoint(node, localX, 0)
      expect(radiusFromCenter(node, p.x, p.y)).toBeCloseTo(5, 6)
    }
  })

  test('the front edge is concentric at radius |spanArcCenterZ| - depth (no balloon)', () => {
    const node = { spanArcCenterZ: 5, spanArcRadius: 5 }
    const depth = 1.5
    // The front/low edge stays a concentric arc one depth inward — it must
    // never fan out to or across the center (the old sagitta balloon bug).
    for (const localX of [-2, 0, 2]) {
      const p = bendLocalPoint(node, localX, depth)
      expect(radiusFromCenter(node, p.x, p.y)).toBeCloseTo(5 - depth, 6)
    }
  })

  test('outward localZ pushes one unit along the crown normal', () => {
    const node = { spanArcCenterZ: 5, spanArcRadius: 5 }
    // At the crown the normal is axis-aligned (+Y), so a unit of localZ
    // moves the point exactly one unit along +Y from the bent high edge.
    const base = bendLocalPoint(node, 0, 0)
    const out = bendLocalPoint(node, 0, 1)
    expect(out.x).toBeCloseTo(0, 6)
    expect(out.y - base.y).toBeCloseTo(1, 6)
  })

  test('member yaw is flat at the crown and tilts toward the ends', () => {
    const node = { spanArcCenterZ: 5, spanArcRadius: 5 }
    expect(bendRotationYAtLocalX(node, 0)).toBeCloseTo(0, 6)
    const leftYaw = bendRotationYAtLocalX(node, -2)
    const rightYaw = bendRotationYAtLocalX(node, 2)
    expect(Math.abs(leftYaw)).toBeGreaterThan(1e-3)
    expect(leftYaw).toBeCloseTo(-rightYaw, 6)
  })
})
