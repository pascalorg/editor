import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { resolveRidgeSnap } from './ridge-snap'

describe('resolveRidgeSnap', () => {
  test('snaps Dutch width-axis center clicks to the shortened top ridge', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      pitch: 40,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })

    const center = resolveRidgeSnap(segment, 0, 0)

    expect(center?.localX).toBeCloseTo(0)
    expect(center?.localZ).toBeCloseTo(0)
    expect(center?.rotation).toBeCloseTo(0)
  })

  test('snaps Dutch depth-axis center clicks to the shortened top ridge', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 6,
      depth: 8,
      pitch: 40,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })

    const center = resolveRidgeSnap(segment, 0, 0)

    expect(center?.localX).toBeCloseTo(0)
    expect(center?.localZ).toBeCloseTo(0)
    expect(center?.rotation).toBeCloseTo(Math.PI / 2)
  })

  test('snaps Dutch shoulder clicks onto the extended lower hip seam up to the rake end', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      pitch: 40,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })

    const snap = resolveRidgeSnap(segment, 3.8, 2.8)

    expect(snap).not.toBeNull()
    expect(snap?.localX).toBeCloseTo(3.84, 2)
    expect(snap?.localZ).toBeCloseTo(2.77, 2)
    expect(Math.abs(snap?.rotation ?? 0)).toBeGreaterThan(0.1)
    expect(Math.abs(Math.abs(snap?.rotation ?? 0) - Math.PI / 2)).toBeGreaterThan(0.1)
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
