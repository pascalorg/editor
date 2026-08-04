import { describe, expect, test } from 'bun:test'
import { ItemNode } from '../schema'
import {
  aabbsOverlapPlan,
  planFootprintAABB,
  planFootprintAABBForItem,
  planFootprintAABBFromCorners,
  planFootprintCorners,
} from './plan-footprint'

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

describe('planFootprintCorners parity with AABB', () => {
  test('AABB from corners matches planFootprintAABB (axis-aligned)', () => {
    const pos: [number, number, number] = [3, 0, 5]
    const dims: [number, number, number] = [2, 1, 4]
    const fromFast = planFootprintAABB(pos, dims, 0)
    const fromCorners = planFootprintAABBFromCorners(pos, dims, 0)
    expect(fromCorners.minX).toBeCloseTo(fromFast.minX, 10)
    expect(fromCorners.maxX).toBeCloseTo(fromFast.maxX, 10)
    expect(fromCorners.minZ).toBeCloseTo(fromFast.minZ, 10)
    expect(fromCorners.maxZ).toBeCloseTo(fromFast.maxZ, 10)
  })

  test('AABB from corners matches planFootprintAABB (rotated)', () => {
    const pos: [number, number, number] = [1, 0, -2]
    const dims: [number, number, number] = [1.5, 1, 3]
    const y = Math.PI / 3
    const fromFast = planFootprintAABB(pos, dims, y)
    const fromCorners = planFootprintAABBFromCorners(pos, dims, y)
    expect(fromCorners.minX).toBeCloseTo(fromFast.minX, 10)
    expect(fromCorners.maxX).toBeCloseTo(fromFast.maxX, 10)
    expect(fromCorners.minZ).toBeCloseTo(fromFast.minZ, 10)
    expect(fromCorners.maxZ).toBeCloseTo(fromFast.maxZ, 10)
  })

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
})

describe('aabbsOverlapPlan gap semantics', () => {
  test('gap 0 only true interpenetration', () => {
    const a = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
    const b = { minX: 1.05, maxX: 2.05, minZ: 0, maxZ: 1 }
    expect(aabbsOverlapPlan(a, b, 0)).toBe(false)
    const c = { minX: 0.9, maxX: 1.9, minZ: 0, maxZ: 1 }
    expect(aabbsOverlapPlan(a, c, 0)).toBe(true)
  })

  test('gap 0.08 collides boxes 0.05 m apart (expand-then-intersect)', () => {
    // half-width 0.5 each, centres 1.05 apart → 0.05 m free gap
    const a = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
    const b = { minX: 1.05, maxX: 2.05, minZ: 0, maxZ: 1 }
    expect(aabbsOverlapPlan(a, b, 0.08)).toBe(true)
    expect(aabbsOverlapPlan(a, b, 0.04)).toBe(false)
  })
})

describe('planFootprintAABBForItem', () => {
  test('uses scaled dimensions', () => {
    const item = ItemNode.parse({
      name: 'Box',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [2, 1, 3],
      asset: {
        id: 'box',
        name: 'Box',
        category: 'furniture',
        thumbnail: '/t.webp',
        src: '/m.glb',
        dimensions: [1, 1, 1],
      },
    })
    const aabb = planFootprintAABBForItem(item)
    expect(aabb).not.toBeNull()
    // width 2, depth 3 unrotated
    expect(aabb!.minX).toBeCloseTo(-1, 10)
    expect(aabb!.maxX).toBeCloseTo(1, 10)
    expect(aabb!.minZ).toBeCloseTo(-1.5, 10)
    expect(aabb!.maxZ).toBeCloseTo(1.5, 10)
  })

  test('returns null for wall-hosted items', () => {
    const item = ItemNode.parse({
      name: 'Shelf',
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      asset: {
        id: 'shelf',
        name: 'Shelf',
        category: 'furniture',
        thumbnail: '/t.webp',
        src: '/m.glb',
        dimensions: [1, 0.2, 0.3],
        attachTo: 'wall',
      },
    })
    expect(planFootprintAABBForItem(item)).toBeNull()
  })

  test('returns null for ceiling-hosted items', () => {
    const item = ItemNode.parse({
      name: 'Light',
      position: [0, 2.5, 0],
      rotation: [0, 0, 0],
      asset: {
        id: 'light',
        name: 'Light',
        category: 'furniture',
        thumbnail: '/t.webp',
        src: '/m.glb',
        dimensions: [0.3, 0.2, 0.3],
        attachTo: 'ceiling',
      },
    })
    expect(planFootprintAABBForItem(item)).toBeNull()
  })
})
