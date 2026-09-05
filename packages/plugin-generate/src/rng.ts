/**
 * Seeded RNG — mulberry32, the same generator PlanCrafters rolls with. The
 * same seed reproduces a design byte-for-byte; "reroll" is a new seed with
 * the same options.
 */
export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A fresh seed for "roll again" — 31 bits so it prints as a plain integer. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

/** Pick one of `items` uniformly. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))] as T
}
