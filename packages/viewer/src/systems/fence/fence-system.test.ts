import { describe, expect, test } from 'bun:test'
import { FenceNode } from '@pascal-app/core'
import { generateFenceGeometry, generateFenceSlotGeometries } from './fence-system'

const IN = 0.0254

function fence(over: Partial<FenceNode> = {}): FenceNode {
  return {
    id: 'fence_1',
    type: 'fence',
    start: [0, 0],
    end: [3, 0],
    height: 36 * IN,
    thickness: 1.5 * IN,
    baseHeight: 3.5 * IN,
    postSpacing: 18 * IN,
    postSize: 3.5 * IN,
    topRailHeight: 3.5 * IN,
    groundClearance: 3.5 * IN,
    edgeInset: 0.015,
    slatGap: 3.5 * IN,
    showInfill: true,
    color: '#ffffff',
    style: 'slat',
    baseStyle: 'raised',
    postCap: 'flat',
    ...over,
  } as FenceNode
}

function yRange(geometry: {
  computeBoundingBox: () => void
  boundingBox: { min: { y: number }; max: { y: number } } | null
}) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  return box ? [box.min.y, box.max.y] : [Number.NaN, Number.NaN]
}

describe('a raised fence base (a deck guard)', () => {
  test('the base is a bottom rail held the clearance above the ground, the pickets end on it, the end posts reach the ground', () => {
    const parts = generateFenceSlotGeometries(fence())
    const [baseMin, baseMax] = yRange(parts.base as never)
    expect(baseMin).toBeCloseTo(3.5 * IN, 6)
    expect(baseMax).toBeCloseTo(7 * IN, 6)
    const [infillMin] = yRange(parts.infill as never)
    expect(infillMin).toBeCloseTo(7 * IN, 6)
    const [postMin, postMax] = yRange(parts.posts as never)
    expect(postMin).toBeCloseTo(0, 6)
    expect(postMax).toBeGreaterThan(36 * IN - 1e-6)
  })

  test('a grounded fence keeps its kickboard on the ground', () => {
    const parts = generateFenceSlotGeometries(fence({ baseStyle: 'grounded' }))
    const [baseMin] = yRange(parts.base as never)
    expect(baseMin).toBeCloseTo(0, 6)
  })
})

describe('the guard fence (AWC DCA 6)', () => {
  const guard = (over: Partial<FenceNode> = {}) =>
    fence({
      style: 'guard',
      guardInfill: 'balusters',
      postSpacing: 6 * 0.3048,
      groundClearance: 3.5 * IN,
      slatGap: 3.5 * IN,
      thickness: 0.75 * IN,
      ...over,
    })

  test('a 2x6 cap flat on top, the 2x4 top rail under it, balusters on a bottom rail 3½ in up, posts to the cap', () => {
    const parts = generateFenceSlotGeometries(guard())
    const [, railMax] = yRange(parts.rail as never)
    expect(railMax).toBeCloseTo(36 * IN, 6)
    const [baseMin, baseMax] = yRange(parts.base as never)
    expect(baseMin).toBeCloseTo(3.5 * IN, 6)
    expect(baseMax).toBeCloseTo(7 * IN, 6)
    const [infillMin, infillMax] = yRange(parts.infill as never)
    expect(infillMin).toBeCloseTo(7 * IN, 6)
    expect(infillMax).toBeCloseTo(36 * IN - 1.5 * IN - 3.5 * IN, 6)
    const [postMin, postMax] = yRange(parts.posts as never)
    expect(postMin).toBeCloseTo(0, 6)
    expect(postMax).toBeCloseTo(36 * IN - 1.5 * IN, 6)
  })

  test('an end without its post leaves the rails to die into the post standing there; a post through the cap wears a cap', () => {
    const both = generateFenceSlotGeometries(guard())
    const none = generateFenceSlotGeometries(guard({ startPost: false, endPost: false }))
    const count = (g: { getAttribute: (n: string) => { count: number } | undefined }) =>
      g.getAttribute('position')?.count ?? 0
    expect(count(none.posts as never)).toBeLessThan(count(both.posts as never))
    expect(count(none.rail as never)).toBe(count(both.rail as never))
    const through = generateFenceSlotGeometries(guard({ postThrough: true, postCap: 'flat' }))
    const [, postMax] = yRange(through.posts as never)
    expect(postMax).toBeCloseTo(36 * IN + 3 * IN + 1 * IN, 6)
  })

  test('cable infill: ½ in runs 3 in apart from 3 in up, no bottom rail', () => {
    const parts = generateFenceSlotGeometries(
      guard({ guardInfill: 'cable', slatGap: 3 * IN, groundClearance: 3 * IN }),
    )
    expect(parts.base.getAttribute('position')).toBeUndefined()
    const [infillMin] = yRange(parts.infill as never)
    expect(infillMin).toBeCloseTo(3 * IN, 6)
  })
})

function picketFence(overrides: Partial<FenceNode> = {}) {
  return FenceNode.parse({ start: [0, 0], end: [4, 0], style: 'picket', ...overrides })
}

describe('picket fence geometry', () => {
  for (const picketTop of ['flat', 'pointed', 'rounded', 'dog-ear'] as const) {
    for (const baseStyle of ['grounded', 'floating'] as const) {
      test(`${picketTop} / ${baseStyle} respects its base and ground clearance`, () => {
        const node = picketFence({ picketTop, baseStyle, groundClearance: 0.1 })
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
    const plain = generateFenceSlotGeometries(picketFence({ postCap: 'none', picketRailCount: 2 }))
    const capped = generateFenceSlotGeometries(picketFence({ postCap: 'flat', picketRailCount: 3 }))
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
      const node = picketFence(overrides)
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
    for (const node of [picketFence({ showInfill: false }), picketFence({ end: [0.05, 0] })]) {
      const slots = generateFenceSlotGeometries(node)
      expect(slots.infill.getAttribute('position')).toBeUndefined()
      expect(slots.posts.getAttribute('position').count).toBeGreaterThan(0)
      for (const geometry of Object.values(slots)) geometry.dispose()
    }
  })
})
