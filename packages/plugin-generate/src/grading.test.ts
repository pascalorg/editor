import { describe, expect, test } from 'bun:test'
import { createTerrainField, heightAt, quantize } from '@pascal-app/core'
import { fillPad } from './grading'

/** A 40 × 40 m field at 1 m spacing sloping down toward +z: 0 at z = 0, −1 m at z = 40. */
function sloping() {
  const field = createTerrainField({ origin: [-20, -20], spacing: 1, cols: 41, rows: 41 })
  const heights = new Int16Array(field.heights)
  for (let row = 0; row < 41; row++) {
    for (let col = 0; col < 41; col++) {
      const z = -20 + row
      heights[row * 41 + col] = quantize(field, -((z + 20) / 40))
    }
  }
  return { ...field, heights }
}

describe('fillPad', () => {
  test('fills the low side under the footprint to the pad level, never cuts the high side, blends the apron', () => {
    const field = sloping()
    const polygon: [number, number][] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ]
    // the high side of the footprint (z = −5) sits at −0.375 m; the pad is the slab top (8 in over it) less 8 in
    const highSide = heightAt(field, 0, -5)
    const padY = highSide
    const { field: graded, filledSamples, maxFillM } = fillPad(field, { polygon, padY, apronM: 2, note: '' })
    expect(filledSamples).toBeGreaterThan(0)
    // inside: everything at or above the pad; the high edge untouched
    expect(heightAt(graded, 0, 4)).toBeCloseTo(padY, 2)
    expect(heightAt(graded, 0, -5)).toBeCloseTo(highSide, 2)
    // the low edge was raised by the fall across the footprint (10 m at 1:40 = 0.25 m)
    expect(maxFillM).toBeCloseTo(0.25, 1)
    // the apron blends: 1 m outside the low edge sits between the pad and the old ground
    const old = heightAt(field, 0, 6)
    const now = heightAt(graded, 0, 6)
    expect(now).toBeGreaterThan(old)
    expect(now).toBeLessThan(padY)
    // far away nothing moved
    expect(heightAt(graded, 0, 15)).toBeCloseTo(heightAt(field, 0, 15), 6)
    expect(heightAt(graded, -15, 0)).toBeCloseTo(heightAt(field, -15, 0), 6)
  })

  test('a pad below the ground everywhere changes nothing (fill only)', () => {
    const field = sloping()
    const polygon: [number, number][] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ]
    const out = fillPad(field, { polygon, padY: -5, apronM: 2, note: '' })
    expect(out.filledSamples).toBe(0)
    expect(out.field).toBe(field)
  })
})
