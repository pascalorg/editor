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
