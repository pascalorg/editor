import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { resolveRidgeSnap } from './ridge-snap'

describe('resolveRidgeSnap', () => {
  test('clamps dutch top ridges to the hipped shoulder span', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      pitch: 40,
    })

    const right = resolveRidgeSnap(segment, 100, 0)
    const left = resolveRidgeSnap(segment, -100, 0)

    expect(right?.localX).toBeLessThan(segment.width / 2)
    expect(left?.localX).toBeGreaterThan(-segment.width / 2)
    expect(right?.localZ).toBe(0)
    expect(left?.localZ).toBe(0)
    expect(right?.localX).toBeCloseTo(-(left?.localX ?? 0))
  })

  test('clamps mansard top ridges to the upper hip span', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'mansard',
      width: 8,
      depth: 6,
      pitch: 40,
    })

    const right = resolveRidgeSnap(segment, 100, 0)
    const left = resolveRidgeSnap(segment, -100, 0)

    expect(right?.localX).toBeLessThan(segment.width / 2)
    expect(left?.localX).toBeGreaterThan(-segment.width / 2)
    expect(right?.localZ).toBe(0)
    expect(left?.localZ).toBe(0)
    expect(right?.localX).toBeCloseTo(-(left?.localX ?? 0))
  })
})
