import { describe, expect, test } from 'bun:test'
import { normalizeUnitPrices, unitPriceKey } from './unit-prices'

describe('unitPriceKey', () => {
  test('distinguishes a group from no group, and a key from a kind', () => {
    expect(unitPriceKey('wall', 'length')).not.toBe(unitPriceKey('wall', 'area'))
    expect(unitPriceKey('wall', 'length', 'Brick')).not.toBe(unitPriceKey('wall', 'length'))
  })
})

describe('normalizeUnitPrices', () => {
  test('keeps valid entries and uppercases the currency', () => {
    const normalized = normalizeUnitPrices({
      a: { amount: 12.5, currency: 'try' },
    })
    expect(normalized).toEqual({ a: { amount: 12.5, currency: 'TRY' } })
  })

  test('defaults a missing or blank currency to TRY', () => {
    expect(normalizeUnitPrices({ a: { amount: 3 } }).a).toEqual({ amount: 3, currency: 'TRY' })
    expect(normalizeUnitPrices({ a: { amount: 3, currency: '  ' } }).a?.currency).toBe('TRY')
  })

  test('drops non-finite, negative and non-numeric amounts', () => {
    const normalized = normalizeUnitPrices({
      nan: { amount: Number.NaN },
      neg: { amount: -1 },
      text: { amount: '4' },
      ok: { amount: 4 },
    })
    expect(Object.keys(normalized)).toEqual(['ok'])
  })

  test('drops entries that are not records', () => {
    expect(normalizeUnitPrices({ a: 'nope', b: null, c: 4 })).toEqual({})
  })

  test('non-object input normalises to an empty map', () => {
    expect(normalizeUnitPrices(null)).toEqual({})
    expect(normalizeUnitPrices([{ amount: 1 }])).toEqual({})
    expect(normalizeUnitPrices('x')).toEqual({})
  })
})
