import { expect, test } from 'bun:test'
import { fractalNoise3, perlin3 } from './hole-noise'

// The CPU twin of the ground's edge noise (three's MaterialX perlin): deterministic, bounded and
// smooth, as the walls ride the very threshold the shader cuts.

test('the noise is deterministic, zero on the lattice and bounded', () => {
  expect(perlin3(1.7, 2.3, 0.31)).toBe(perlin3(1.7, 2.3, 0.31))
  expect(perlin3(3, 5, 7)).toBe(0)
  let low = 0
  let high = 0
  for (let i = 0; i < 20000; i += 1) {
    const value = fractalNoise3(i * 0.173, i * 0.0917, 0.31, 3, 2.1, 0.4)
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  expect(low).toBeGreaterThan(-1.56)
  expect(high).toBeLessThan(1.56)
  expect(high - low).toBeGreaterThan(1.2)
})

test('the noise is continuous, over lattice lines too', () => {
  for (const [x, y] of [
    [0.9999, 0.5],
    [4.9999, 3.2],
    [-2.0001, -7.5],
  ] as const) {
    const left = perlin3(x, y, 0.31)
    const right = perlin3(x + 0.0002, y, 0.31)
    expect(Math.abs(left - right)).toBeLessThan(0.01)
  }
})
