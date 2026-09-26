import { describe, expect, test } from 'bun:test'
import { FenceNode } from '@pascal-app/core'
import { generateFenceGeometry, generateFenceSlotGeometries } from './geometry-parts'

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

describe('matched fence infill', () => {
  test('privacy fills the bays but leaves an open passage clear', () => {
    const host = fence({ style: 'privacy', baseStyle: 'floating' })
    const whole = generateFenceSlotGeometries(host)
    const cut = generateFenceSlotGeometries(
      {
        ...host,
        features: [{ id: 'passage', kind: 'opening', center: 2, width: 1 }],
      },
      undefined,
      'body',
    )
    const wholeX = whole.infill.getAttribute('position')
    const cutX = cut.infill.getAttribute('position')
    expect(
      Array.from({ length: wholeX.count }, (_, i) => wholeX.getX(i)).some(
        (x) => x > 1.5 && x < 2.5,
      ),
    ).toBe(true)
    expect(
      Array.from({ length: cutX.count }, (_, i) => cutX.getX(i)).some((x) => x > 1.5 && x < 2.5),
    ).toBe(false)
    for (const slots of [whole, cut])
      for (const geometry of Object.values(slots)) geometry.dispose()
  })

  test('matched rail gate has an open middle between its two rails', () => {
    const host = fence({ style: 'rail', baseStyle: 'floating' })
    const slots = generateFenceSlotGeometries(
      {
        ...host,
        features: [
          {
            id: 'gate',
            kind: 'gate',
            center: 2,
            width: 1.1,
            matchFenceStyle: true,
            showHardware: false,
          },
        ],
      },
      undefined,
      'features',
    )
    const positions = slots.infill.getAttribute('position')
    const heights = Array.from({ length: positions.count }, (_, i) => positions.getY(i))
    expect(heights.length).toBeGreaterThan(0)
    expect(heights.some((y) => y > 0.7 && y < 1.2)).toBe(false)
    for (const geometry of Object.values(slots)) geometry.dispose()
  })
})

describe('fence feature post heights', () => {
  for (const style of ['picket', 'horizontal', 'slat', 'rail', 'privacy'] as const) {
    for (const baseStyle of ['floating', 'grounded'] as const) {
      for (const postCap of ['none', 'flat', 'pyramid'] as const) {
        test(`${style} / ${baseStyle} / ${postCap}: gate and opening posts match the host`, () => {
          const host = fence({ style, baseStyle, postCap, groundClearance: 0.23 })
          const body = generateFenceSlotGeometries(host)
          body.posts.computeBoundingBox()
          for (const kind of ['gate', 'opening'] as const) {
            const feature = { id: 'feature', kind, center: 2, width: 1.1, matchFenceStyle: true }
            const slots = generateFenceSlotGeometries(
              { ...host, features: [feature] },
              undefined,
              'features',
            )
            slots.posts.computeBoundingBox()
            expect(slots.posts.boundingBox!.min.y).toBeCloseTo(body.posts.boundingBox!.min.y)
            expect(slots.posts.boundingBox!.max.y).toBeCloseTo(body.posts.boundingBox!.max.y)
            for (const geometry of Object.values(slots)) geometry.dispose()
          }
          for (const geometry of Object.values(body)) geometry.dispose()
        })
      }
    }
  }

  test('manual height resizes only the gate leaf; its posts remain matched to the fence', () => {
    const host = fence({ style: 'horizontal', groundClearance: 0.23 })
    const feature = {
      id: 'gate',
      kind: 'gate' as const,
      center: 2,
      width: 1.1,
      matchFenceStyle: true,
    }
    const original = generateFenceSlotGeometries(
      { ...host, features: [feature] },
      undefined,
      'features',
    )
    original.infill.computeBoundingBox()
    const height = original.infill.boundingBox!.max.y - original.infill.boundingBox!.min.y
    const resized = generateFenceSlotGeometries(
      { ...host, features: [{ ...feature, height: height + 0.5, matchFenceHeight: false }] },
      undefined,
      'features',
    )
    const restored = generateFenceSlotGeometries(
      { ...host, features: [{ ...feature, height: height + 0.5, matchFenceHeight: true }] },
      undefined,
      'features',
    )
    for (const slot of ['infill', 'posts'] as const) {
      original[slot].computeBoundingBox()
      resized[slot].computeBoundingBox()
      restored[slot].computeBoundingBox()
      expect(resized[slot].boundingBox!.max.y).toBeCloseTo(
        original[slot].boundingBox!.max.y + (slot === 'infill' ? 0.5 : 0),
      )
      expect(resized[slot].boundingBox!.min.y).toBeCloseTo(original[slot].boundingBox!.min.y)
      expect(restored[slot].boundingBox!.max.y).toBeCloseTo(original[slot].boundingBox!.max.y)
    }
    for (const slots of [original, resized, restored])
      for (const geometry of Object.values(slots)) geometry.dispose()
  })
  test('opening post height can be overridden and follows later fence changes when matched', () => {
    const feature = {
      id: 'opening',
      kind: 'opening' as const,
      center: 2,
      width: 1.1,
      matchFenceStyle: true,
      height: 1.1,
    }
    for (const hostHeight of [1.8, 2.4]) {
      const host = fence({ style: 'slat', height: hostHeight, groundClearance: 0.23 })
      const matched = generateFenceSlotGeometries(
        { ...host, features: [feature] },
        undefined,
        'features',
      )
      const manual = generateFenceSlotGeometries(
        { ...host, features: [{ ...feature, matchFenceHeight: false }] },
        undefined,
        'features',
      )
      matched.posts.computeBoundingBox()
      manual.posts.computeBoundingBox()
      expect(matched.posts.boundingBox!.max.y).toBeCloseTo(hostHeight + 0.23)
      expect(manual.posts.boundingBox!.max.y).toBeCloseTo(1.1)
      for (const slots of [matched, manual])
        for (const geometry of Object.values(slots)) geometry.dispose()
    }
  })
})
