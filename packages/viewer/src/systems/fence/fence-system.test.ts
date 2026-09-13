import { describe, expect, test } from 'bun:test'
import type { FenceNode } from '@pascal-app/core'
import { generateFenceSlotGeometries } from './fence-system'

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

function yRange(geometry: { computeBoundingBox: () => void; boundingBox: { min: { y: number }; max: { y: number } } | null }) {
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
    const parts = generateFenceSlotGeometries(guard({ guardInfill: 'cable', slatGap: 3 * IN, groundClearance: 3 * IN }))
    expect(parts.base.getAttribute('position')).toBeUndefined()
    const [infillMin] = yRange(parts.infill as never)
    expect(infillMin).toBeCloseTo(3 * IN, 6)
  })
})
