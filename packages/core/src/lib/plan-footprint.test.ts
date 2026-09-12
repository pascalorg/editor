import { describe, expect, test } from 'bun:test'
import { planFootprintAABB, planFootprintCorners } from './plan-footprint'

describe('planFootprintAABB', () => {
  test('unrotated box is centred at position', () => {
    const aabb = planFootprintAABB([10, 0, 20], [2, 1, 4], 0)
    expect(aabb).toEqual({ minX: 9, maxX: 11, minZ: 18, maxZ: 22 })
  })

  test('90° rotation swaps width and depth extents', () => {
    const aabb = planFootprintAABB([0, 0, 0], [2, 1, 4], Math.PI / 2)
    expect(aabb.minX).toBeCloseTo(-2, 10)
    expect(aabb.maxX).toBeCloseTo(2, 10)
    expect(aabb.minZ).toBeCloseTo(-1, 10)
    expect(aabb.maxZ).toBeCloseTo(1, 10)
  })

  test('45° rotation expands AABB (rotation-aware extents)', () => {
    const aabb = planFootprintAABB([0, 0, 0], [2, 1, 2], Math.PI / 4)
    // rotated half-extent = (2*(√2/2) + 2*(√2/2))/2 = √2 ≈ 1.414
    expect(aabb.maxX).toBeCloseTo(Math.SQRT2, 10)
    expect(aabb.minX).toBeCloseTo(-Math.SQRT2, 10)
    expect(aabb.maxZ).toBeCloseTo(Math.SQRT2, 10)
    expect(aabb.minZ).toBeCloseTo(-Math.SQRT2, 10)
  })
})

describe('planFootprintCorners', () => {
  test('four corners form a rectangle of expected half-extents when unrotated', () => {
    const corners = planFootprintCorners([0, 0, 0], [4, 1, 2], 0)
    expect(corners).toHaveLength(4)
    const xs = corners.map((c) => c[0]).sort((a, b) => a - b)
    const zs = corners.map((c) => c[1]).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-2, 10)
    expect(xs[3]).toBeCloseTo(2, 10)
    expect(zs[0]).toBeCloseTo(-1, 10)
    expect(zs[3]).toBeCloseTo(1, 10)
  })

  test('AABB of corners matches planFootprintAABB (axis-aligned)', () => {
    const pos: [number, number, number] = [3, 0, 5]
    const dims: [number, number, number] = [2, 1, 4]
    const fromFast = planFootprintAABB(pos, dims, 0)
    const corners = planFootprintCorners(pos, dims, 0)
    const xs = corners.map((c) => c[0])
    const zs = corners.map((c) => c[1])
    expect(Math.min(...xs)).toBeCloseTo(fromFast.minX, 10)
    expect(Math.max(...xs)).toBeCloseTo(fromFast.maxX, 10)
    expect(Math.min(...zs)).toBeCloseTo(fromFast.minZ, 10)
    expect(Math.max(...zs)).toBeCloseTo(fromFast.maxZ, 10)
  })

  test('AABB of corners matches planFootprintAABB (rotated)', () => {
    const pos: [number, number, number] = [1, 0, -2]
    const dims: [number, number, number] = [1.5, 1, 3]
    const y = Math.PI / 3
    const fromFast = planFootprintAABB(pos, dims, y)
    const corners = planFootprintCorners(pos, dims, y)
    const xs = corners.map((c) => c[0])
    const zs = corners.map((c) => c[1])
    expect(Math.min(...xs)).toBeCloseTo(fromFast.minX, 10)
    expect(Math.max(...xs)).toBeCloseTo(fromFast.maxX, 10)
    expect(Math.min(...zs)).toBeCloseTo(fromFast.minZ, 10)
    expect(Math.max(...zs)).toBeCloseTo(fromFast.maxZ, 10)
  })
})
