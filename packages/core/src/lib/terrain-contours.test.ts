import { describe, expect, test } from 'bun:test'
import { createTerrainField, type TerrainField, terrainContours } from '@pascal-app/core'

describe('terrain contour sampling', () => {
  test('a huge virtual plane keeps analytic contours with bounded authority reads', () => {
    let reads = 0
    const field: TerrainField = {
      origin: [0, 0],
      cols: 20_001,
      rows: 20_001,
      spacing: 0.5,
      step: 0.01,
      heights: new Int16Array(0),
      heightBounds: [0, 1],
      readHeightAt: (x) => {
        reads++
        // A safe failure instead of letting the former full-union scan run 400M times.
        if (reads > 1_000_000) throw new Error('Unbounded virtual contour sampling')
        return x / 10_000
      },
    }
    const contours = terrainContours(field, 0.5, [
      [0, 0],
      [10_000, 0],
      [10_000, 10_000],
      [0, 10_000],
    ])
    // Three elevation levels on at most 256² cells, plus the range scan, fit
    // below 1M reads; a flat/empty shortcut cannot pass the analytical line check.
    expect(reads).toBeLessThanOrEqual(1_000_000)
    const middle = contours.filter((line) => line.levelM === 0.5)
    expect(middle.length).toBeGreaterThan(0)
    for (const line of middle) {
      expect(line.points.length).toBeGreaterThanOrEqual(2)
      for (const [x, z] of line.points) {
        expect(x).toBeCloseTo(5000, 6)
        expect(Number.isFinite(z)).toBe(true)
      }
    }
  })

  test('small dense fields retain their known one-metre contours', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 5; col++) field.heights[row * 5 + col] = col * 100
    const contours = terrainContours(field, 1, [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ])
    for (const level of [1, 2, 3]) {
      const lines = contours.filter((line) => line.levelM === level)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) for (const [x] of line.points) expect(x).toBe(level)
    }
  })
})
