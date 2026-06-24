import { describe, expect, test } from 'bun:test'
import { getRidgeVentLinesForSegment, RoofSegmentNode } from '@pascal-app/core'
import { resolveRidgeSnap } from './ridge-snap'

describe('resolveRidgeSnap', () => {
  test('clamps dutch top ridges to the hipped shoulder span', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      pitch: 40,
    })

    const right = resolveRidgeSnap(segment, 3, 0)
    const left = resolveRidgeSnap(segment, -3, 0)
    const topRidge = getRidgeVentLinesForSegment(segment).find((line) => line.name === 'Ridge Vent')

    expect(right?.localX).toBeCloseTo(topRidge?.end[0] ?? 0)
    expect(left?.localX).toBeCloseTo(topRidge?.start[0] ?? 0)
    expect(right?.localZ).toBe(0)
    expect(left?.localZ).toBe(0)
    expect(right?.localX).toBeCloseTo(-(left?.localX ?? 0))
  })

  test('snaps dutch depth-axis ridges without switching back to width', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      pitch: 40,
      dutchRidgeAxis: 'z',
    })

    const front = resolveRidgeSnap(segment, 0, 2)
    const back = resolveRidgeSnap(segment, 0, -2)

    expect(front?.localX).toBeCloseTo(0)
    expect(back?.localX).toBeCloseTo(0)
    expect(front?.localZ).toBeGreaterThan(0)
    expect(back?.localZ).toBeLessThan(0)
    expect(front?.rotation).toBeCloseTo(Math.PI / 2)
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
