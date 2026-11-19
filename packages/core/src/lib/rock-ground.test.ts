import { describe, expect, test } from 'bun:test'
import { highestGroundUnder, lowestGroundUnder, ROCK_EMBED, rockSpan } from './rock-ground'
import { createTerrainField, type TerrainField } from './terrain-field'

const around: [number, number][] = [
  [-2, -2],
  [2, -2],
  [2, 2],
  [-2, 2],
]

/** 5 × 5 samples a metre apart over [-2, 2]²: flat at 0 but for one sample. */
function fieldWith(heightAtCentre: number): TerrainField {
  const field = createTerrainField({ origin: [-2, -2], cols: 5, rows: 5, spacing: 1 })
  field.heights[2 * 5 + 2] = Math.round(heightAtCentre / field.step)
  return field
}

describe('the ground under a rock', () => {
  test('a peak inside the outline, with level ground on it, is the highest ground', () => {
    expect(highestGroundUnder(around, fieldWith(5))).toBeCloseTo(5, 6)
  })

  test('a dip inside the outline is the lowest, and the foot goes below it', () => {
    const field = fieldWith(-2)

    expect(lowestGroundUnder(around, field)).toBeCloseTo(-2, 6)
    expect(rockSpan({ polygon: around, height: 3 }, field).footY).toBeCloseTo(-2 - ROCK_EMBED, 6)
  })

  test('flat ground has no extremes to find', () => {
    expect(highestGroundUnder(around, null)).toBe(0)
    expect(lowestGroundUnder(around, null)).toBe(0)
  })

  test('terrain in a concave outline’s empty notch is not ground under the rock', () => {
    const outline: [number, number][] = [
      [0, 0],
      [6, 0],
      [6, 6],
      [4, 6],
      [4, 2],
      [2, 2],
      [2, 6],
      [0, 6],
    ]
    // The centroid is in the notch (x=3,z>2), not under the U. Every sample
    // on/inside the actual footprint remains zero. An exterior peak is equally irrelevant.
    for (const notchHeight of [-5, 5]) {
      const field = createTerrainField({ origin: [0, 0], cols: 7, rows: 7, spacing: 1 })
      for (const row of [3, 4, 5, 6]) field.heights[row * 7 + 3] = notchHeight / field.step
      expect(lowestGroundUnder(outline, field)).toBeCloseTo(0, 8)
      expect(highestGroundUnder(outline, field)).toBeCloseTo(0, 8)
      expect(rockSpan({ polygon: outline, height: 2.4 }, field)).toMatchObject({
        footY: -0.3,
        topY: 2.4,
      })
    }
  })

  test('a rock far larger than the field still reads it within a bounded number of samples', () => {
    const wide: [number, number][] = [
      [-1000, -1000],
      [1000, -1000],
      [1000, 1000],
      [-1000, 1000],
    ]

    expect(highestGroundUnder(wide, fieldWith(5))).toBeCloseTo(5, 6)
  })

  test('an edge a billion metres long is still read in bounded work', () => {
    const long: [number, number][] = [
      [-1e9, -2],
      [1e9, -2],
      [1e9, 2],
      [-1e9, 2],
    ]
    const started = performance.now()

    const highest = highestGroundUnder(long, fieldWith(5))

    expect(highest).toBeGreaterThanOrEqual(0)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
