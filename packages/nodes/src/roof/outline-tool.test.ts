import { describe, expect, test } from 'bun:test'
import { resolveOutlineRoofPlacement } from './outline-tool'

const rotate = ([x, z]: [number, number], angle: number): [number, number] => [
  x * Math.cos(angle) + z * Math.sin(angle),
  -x * Math.sin(angle) + z * Math.cos(angle),
]

/** An L along +x: 12 m long, 8 m deep, the far corner cut away. */
const L: [number, number][] = [
  [0, 0],
  [12, 0],
  [12, 4],
  [6, 4],
  [6, 8],
  [0, 8],
]

describe('outline roof placement', () => {
  test('the rectangle bounds the outline along its longest side, ridge on the long span', () => {
    const placement = resolveOutlineRoofPlacement(L, false)
    expect(placement.rotation).toBeCloseTo(0, 9)
    expect(placement.segmentRotation).toBe(0)
    expect(placement.width).toBeCloseTo(12, 9)
    expect(placement.depth).toBeCloseTo(8, 9)
    expect(placement.center[0]).toBeCloseTo(6, 9)
    expect(placement.center[1]).toBeCloseTo(4, 9)
    // The footprint is the outline around the segment centre.
    expect(placement.footprint[0]![0]).toBeCloseTo(-6, 9)
    expect(placement.footprint[0]![1]).toBeCloseTo(-4, 9)
  })

  test('R turns the ridge across', () => {
    const placement = resolveOutlineRoofPlacement(L, true)
    expect(placement.segmentRotation).toBeCloseTo(Math.PI / 2, 9)
    expect(placement.width).toBeCloseTo(8, 9)
    expect(placement.depth).toBeCloseTo(12, 9)
  })

  test('a rotated outline gets a rotated roof that maps back onto it', () => {
    const angle = 0.4
    const turned = L.map((point) => rotate(point, angle))
    const placement = resolveOutlineRoofPlacement(turned, false)
    expect(placement.width).toBeCloseTo(12, 6)
    expect(placement.depth).toBeCloseTo(8, 6)
    // segment-local → roof-local → level reproduces the drawn points.
    placement.footprint.forEach((point, index) => {
      const roofLocal = rotate(point, placement.segmentRotation)
      const level = rotate(roofLocal, placement.rotation)
      expect(level[0] + placement.center[0]).toBeCloseTo(turned[index]![0], 6)
      expect(level[1] + placement.center[1]).toBeCloseTo(turned[index]![1], 6)
    })
  })
})
