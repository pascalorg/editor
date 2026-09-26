import { describe, expect, test } from 'bun:test'
import { createTerrainField, quantize, terrainContours } from '@pascal-app/core'

/** A 20 × 20 m field at 1 m spacing rising 2 m from x = −10 to x = +10 (a plane). */
function ramp() {
  const field = createTerrainField({ origin: [-10, -10], spacing: 1, cols: 21, rows: 21 })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < 21; row++) for (let col = 0; col < 21; col++) heights[row * 21 + col] = quantize(field, (col / 20) * 2)
  return { ...field, heights }
}

const LOT: [number, number][] = [
  [-8, -8],
  [8, -8],
  [8, 8],
  [-8, 8],
]

describe('terrainContours', () => {
  test('a plane rising along x: straight north–south lines at every interval, clipped to the lot, every fifth an index', () => {
    const contours = terrainContours(ramp(), 0.3048, LOT) // 1 ft interval on a 2 m rise → levels 0.30 … 1.83
    expect(contours.length).toBeGreaterThanOrEqual(5)
    for (const c of contours) {
      // a level line of a plane rising in x is a vertical line x = const
      const xs = c.points.map((p) => p[0])
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-6)
      expect(Math.abs(xs[0]! - (-10 + (c.levelM / 2) * 20))).toBeLessThan(1e-6)
      // clipped to the lot: no point outside z ∈ [−8, 8] by more than a cell
      for (const p of c.points) expect(Math.abs(p[1])).toBeLessThanOrEqual(9)
    }
    expect(contours.some((c) => c.index)).toBe(true)
    // one polyline per level: the chaining joined the cell segments
    const levels = new Set(contours.map((c) => c.levelM.toFixed(4)))
    expect(levels.size).toBe(contours.length)
  })

  test('no interval, or flat ground, gives no lines', () => {
    expect(terrainContours(ramp(), 0, LOT)).toEqual([])
    const flat = createTerrainField({ origin: [-10, -10], spacing: 1, cols: 21, rows: 21 })
    expect(terrainContours(flat, 0.3048, LOT)).toEqual([])
  })
})
