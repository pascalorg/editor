import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { resolveRidgeSnap } from './ridge-snap'

describe('resolveRidgeSnap', () => {
  test('does not snap Dutch ridges until the Dutch ridge model is rebuilt', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      pitch: 40,
    })

    const right = resolveRidgeSnap(segment, 3, 0)
    const left = resolveRidgeSnap(segment, -3, 0)

    expect(right).toBeNull()
    expect(left).toBeNull()
  })

  test('does not snap Dutch ridges when the depth exceeds the width', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 6,
      depth: 8,
      pitch: 40,
    })

    const front = resolveRidgeSnap(segment, 0, 2)
    const back = resolveRidgeSnap(segment, 0, -2)

    expect(front).toBeNull()
    expect(back).toBeNull()
  })

  test('snaps mansard center clicks to the upper top ridge', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'mansard',
      width: 8,
      depth: 6,
      pitch: 40,
    })

    const center = resolveRidgeSnap(segment, 0, 0)

    expect(center?.localX).toBeCloseTo(0)
    expect(center?.localZ).toBe(0)
    expect(center?.rotation).toBeCloseTo(0)
  })

  test('snaps mansard lower-slope clicks to the nearest lower-slope vent line', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'mansard',
      width: 8,
      depth: 6,
      pitch: 40,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })

    const frontRight = resolveRidgeSnap(segment, 3.5, 2.5)
    const frontLeft = resolveRidgeSnap(segment, -3.5, 2.5)

    expect(frontRight?.localX).toBeGreaterThan(0)
    expect(frontRight?.localZ).toBeGreaterThan(0)
    expect(frontLeft?.localX).toBeLessThan(0)
    expect(frontLeft?.localZ).toBeGreaterThan(0)
    expect(Math.abs(frontRight?.rotation ?? 0)).toBeGreaterThan(0.1)
    expect(Math.abs(frontRight?.rotation ?? 0)).toBeLessThan(Math.PI / 2 - 0.1)
  })
})
