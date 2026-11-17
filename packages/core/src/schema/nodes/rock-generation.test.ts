import { describe, expect, test } from 'bun:test'
import { RockNode } from './rock'

const polygon = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
]
const types = ['boulder', 'fjord', 'granite', 'volcanic', 'river', 'stacked', 'stepping'] as const

// Persisted contract from the rock brief and approved generation/type/look domains. Missing gen
// means the legacy appearance, not whichever generator happens to be current when loading.
describe('saved rock generation and looks', () => {
  test('loads an old document as generation 1 without losing its old appearance fields', () => {
    const saved = { polygon, height: 2.4, seed: -7, form: 'weathered', strata: true, lichen: 0.6 }
    expect(RockNode.parse(saved)).toMatchObject({
      ...saved,
      gen: 1,
      rockType: 'boulder',
      weathering: 0.35,
      moss: 0,
    })
  })

  for (const rockType of types) {
    test(`round trips ${rockType} and both closed look endpoints`, () => {
      for (const amount of [0, 1]) {
        const saved = RockNode.parse({
          polygon,
          gen: 2,
          rockType,
          weathering: amount,
          moss: amount,
        })
        expect(RockNode.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
        expect(saved).toMatchObject({ gen: 2, rockType, weathering: amount, moss: amount })
      }
    })
  }

  test('only known generations and types are accepted', () => {
    for (const gen of [0, -1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2']) {
      expect(RockNode.safeParse({ polygon, gen }).success).toBe(false)
    }
    for (const rockType of ['', 'unknown', 'Boulder', 1]) {
      expect(RockNode.safeParse({ polygon, rockType }).success).toBe(false)
    }
    expect(RockNode.safeParse({ polygon, gen: 1 }).success).toBe(true)
    expect(RockNode.safeParse({ polygon, gen: 2 }).success).toBe(true)
  })

  test('weathering and moss reject out-of-domain and nonfinite saved numbers', () => {
    for (const field of ['weathering', 'moss']) {
      for (const value of [
        -0.001,
        1.001,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        '0.5',
      ]) {
        expect(RockNode.safeParse({ polygon, gen: 2, [field]: value }).success).toBe(false)
      }
    }
  })
})
