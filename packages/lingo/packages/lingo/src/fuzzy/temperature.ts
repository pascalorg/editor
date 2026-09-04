import type { Quantity } from '../core/quantity'
import type { FuzzyVocab, Registry } from '../core/registry'

/**
 * Fuzzy temperature vocabulary (plan 006). Bands are [min, max) in °C,
 * profiled by context — "hot" weather ≠ hot bathwater ≠ a hot oven.
 * Two-way: parse("it's hot") → range; describeTemperature(q) → "hot".
 */

const WEATHER: FuzzyVocab = {
  profile: 'weather',
  unit: 'C',
  terms: {
    freezing: [-90, 0],
    'ice cold': [-90, 4],
    cold: [0, 10],
    chilly: [3, 12],
    cool: [10, 17],
    mild: [15, 22],
    warm: [20, 28],
    hot: [27, 35],
    'very hot': [33, 42],
    scorching: [40, 55],
    boiling: [40, 55],
  },
}

const WATER: FuzzyVocab = {
  profile: 'water',
  unit: 'C',
  terms: {
    freezing: [0, 4],
    'ice cold': [0, 8],
    cold: [8, 18],
    cool: [18, 24],
    lukewarm: [30, 37],
    warm: [37, 42],
    hot: [42, 50],
    'very hot': [50, 60],
    scalding: [60, 100],
    boiling: [95, 100],
  },
}

const OVEN: FuzzyVocab = {
  profile: 'oven',
  unit: 'C',
  terms: {
    cool: [90, 140],
    slow: [90, 150],
    warm: [140, 170],
    moderate: [170, 190],
    hot: [190, 230],
    'very hot': [230, 260],
  },
}

/**
 * The three built-in temperature vocabularies (registered by default on the
 * main entry's `defaultRegistry`). Pass a `profile` name ('weather' | 'water'
 * | 'oven') to `lingo()`/`parseQuantity()` to pick one when ambiguous.
 * @example
 * ```ts
 * import { temperatureVocabs } from '@pascal-app/lingo'
 * temperatureVocabs.map((v) => v.profile) // ['weather', 'water', 'oven']
 * ```
 */
export const temperatureVocabs: FuzzyVocab[] = [WEATHER, WATER, OVEN]

export function registerTemperatureVocabs(reg: Registry): void {
  for (const vocab of temperatureVocabs) {
    reg.defineFuzzyVocab('temperature', vocab)
  }
}

export interface DescribeOptions {
  profile?: 'weather' | 'water' | 'oven' | (string & {})
}

/**
 * Map a temperature back to the nearest vocabulary word (narrowest band
 * containing the value wins; outside all bands → nearest band edge). The
 * two-way counterpart to `lingo("it's hot", { kind: 'temperature' })`.
 * @example
 * ```ts
 * import { quantity, describeTemperature } from '@pascal-app/lingo'
 * describeTemperature(quantity(30, 'C')) // "hot" (default 'weather' profile)
 * ```
 */
export function describeTemperature(q: Quantity, opts: DescribeOptions = {}): string {
  if (q.kind !== 'temperature') {
    throw new Error(`lingo: describeTemperature needs a temperature, got ${q.kind}`)
  }
  const profile = opts.profile ?? 'weather'
  const vocab = temperatureVocabs.find((v) => v.profile === profile) ?? WEATHER
  // Value in the vocab's unit (°C): base kelvin → C.
  const c = q.base - 273.15
  let best: string | null = null
  let bestWidth = Number.POSITIVE_INFINITY
  let nearest: string | null = null
  let nearestDist = Number.POSITIVE_INFINITY
  for (const [term, [lo, hi]] of Object.entries(vocab.terms)) {
    if (c >= lo && c < hi) {
      const width = hi - lo
      if (width < bestWidth) {
        best = term
        bestWidth = width
      }
    }
    const dist = c < lo ? lo - c : c >= hi ? c - hi : 0
    if (dist < nearestDist) {
      nearest = term
      nearestDist = dist
    }
  }
  return best ?? nearest ?? 'moderate'
}
