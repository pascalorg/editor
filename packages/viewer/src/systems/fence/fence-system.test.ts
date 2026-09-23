import { describe, expect, test } from 'bun:test'
import { FenceNode } from '@pascal-app/core'
import { generateFenceGeometry, generateFenceSlotGeometries } from './fence-system'

function fence(overrides: Partial<FenceNode> = {}) {
  return FenceNode.parse({ start: [0, 0], end: [4, 0], style: 'picket', ...overrides })
}

describe('picket fence geometry', () => {
  for (const picketTop of ['flat', 'pointed', 'rounded', 'dog-ear'] as const) {
    for (const baseStyle of ['grounded', 'floating'] as const) {
      test(`${picketTop} / ${baseStyle} respects its base and ground clearance`, () => {
        const node = fence({ picketTop, baseStyle, groundClearance: 0.1 })
        const slots = generateFenceSlotGeometries(node)
        expect(Boolean(slots.base.getAttribute('position'))).toBe(baseStyle === 'grounded')
        slots.posts.computeBoundingBox()
        slots.infill.computeBoundingBox()
        expect(slots.posts.boundingBox!.min.y).toBeCloseTo(0)
        expect(slots.infill.boundingBox!.min.y).toBeCloseTo(baseStyle === 'grounded' ? 0.32 : 0.1)
        expect(slots.infill.boundingBox!.max.y).toBeCloseTo(node.height - node.picketTopClearance)
        for (const geometry of Object.values(slots)) geometry.dispose()
      })
    }
  }

  test('rail count and post caps change the generated structure', () => {
    const plain = generateFenceSlotGeometries(fence({ postCap: 'none', picketRailCount: 2 }))
    const capped = generateFenceSlotGeometries(fence({ postCap: 'flat', picketRailCount: 3 }))
    plain.posts.computeBoundingBox()
    capped.posts.computeBoundingBox()
    expect(capped.posts.boundingBox!.max.y).toBeGreaterThan(plain.posts.boundingBox!.max.y)
    expect(capped.rail.getAttribute('position').count).toBe(
      plain.rail.getAttribute('position').count * 1.5,
    )
    for (const geometry of [...Object.values(plain), ...Object.values(capped)]) geometry.dispose()
  })

  test('picket rails overlap end posts and projection stays narrower than a post', () => {
    const node = fence({
      postCap: 'none',
      postSize: 0.08,
      thickness: 0.08,
      edgeInset: 0.15,
      picketRailProjection: 0.5,
    })
    const slots = generateFenceSlotGeometries(node)
    slots.rail.computeBoundingBox()
    const bounds = slots.rail.boundingBox!
    expect(bounds.min.x).toBeLessThan(node.postSize / 2)
    expect(bounds.max.x).toBeGreaterThan(4 - node.postSize / 2)
    expect(bounds.max.z - bounds.min.z).toBeLessThan(node.thickness + 2 * node.postSize)
    for (const geometry of Object.values(slots)) geometry.dispose()
  })

  test('combined geometry includes all slots on straight, arc and spline fences', () => {
    for (const overrides of [
      {},
      { curveOffset: 0.8 },
      {
        path: [
          [0, 0],
          [2, 1],
          [4, 0],
        ] as [number, number][],
      },
    ]) {
      const node = fence(overrides)
      const slots = generateFenceSlotGeometries(node)
      const combined = generateFenceGeometry(node)
      const expectedCount = Object.values(slots).reduce(
        (sum, geometry) => sum + (geometry.getAttribute('position')?.count ?? 0),
        0,
      )
      expect(combined.getAttribute('position').count).toBe(expectedCount)
      expect(Array.from(combined.getAttribute('position').array).every(Number.isFinite)).toBe(true)
      combined.dispose()
      for (const geometry of Object.values(slots)) geometry.dispose()
    }
  })

  test('hidden infill and very short spans omit boards', () => {
    for (const node of [fence({ showInfill: false }), fence({ end: [0.05, 0] })]) {
      const slots = generateFenceSlotGeometries(node)
      expect(slots.infill.getAttribute('position')).toBeUndefined()
      expect(slots.posts.getAttribute('position').count).toBeGreaterThan(0)
      for (const geometry of Object.values(slots)) geometry.dispose()
    }
  })
})
