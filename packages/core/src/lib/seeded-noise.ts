/**
 * Seeded noise for forms stored as parameters and a seed (a hedge, later a planting): the same
 * numbers in, the same numbers out. Only `+ − × ÷`, `Math.imul`, `Math.floor` and `Math.sqrt` are
 * used, which every engine computes to the same bits; no `Math.sin`, `pow` or `hypot`, whose last
 * bit is the engine's own.
 */

/** A repeatable number in [0, 1) for a seed and three lattice integers. */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(z | 0, 0x9e3779b1) ^
    Math.imul(seed | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** A 32-bit seed for a generator, from a seed and three integers. */
export function hashSeed(seed: number, x: number, y: number, z: number): number {
  return Math.floor(hash3(seed, x, y, z) * 4294967296) >>> 0
}

const fade = (t: number) => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Value noise in [-1, 1], smooth, one feature a lattice unit. */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const w = fade(z - zi)
  const at = (i: number, j: number, k: number) => hash3(seed, xi + i, yi + j, zi + k)
  const x00 = mix(at(0, 0, 0), at(1, 0, 0), u)
  const x10 = mix(at(0, 1, 0), at(1, 1, 0), u)
  const x01 = mix(at(0, 0, 1), at(1, 0, 1), u)
  const x11 = mix(at(0, 1, 1), at(1, 1, 1), u)
  return mix(mix(x00, x10, v), mix(x01, x11, v), w) * 2 - 1
}

/** A sum of `octaves` value noises, each half the size and half the strength of the last, in [-1, 1]. */
export function fractalNoise3(
  seed: number,
  x: number,
  y: number,
  z: number,
  octaves: number,
): number {
  let amplitude = 0.5
  let frequency = 1
  let sum = 0
  let total = 0
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * valueNoise3(seed + octave * 17, x * frequency, y * frequency, z * frequency)
    total += amplitude
    amplitude *= 0.5
    frequency *= 2.03
  }
  return sum / total
}

/** A stream of repeatable numbers in [0, 1) from a 32-bit seed (mulberry32, as `seededRandom`). */
export function randomStream(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
