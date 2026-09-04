import { describe, expect, it } from 'vitest'
import { lingo } from '../index'
import { allKinds } from '../units/index'
import {
  currencyForCountry,
  getCurrency,
  getUnit,
  kindInfo,
  kindOf,
  listCurrencies,
  listKinds,
  listUnits,
  relatedUnits,
} from './index'

describe('catalog: kinds and units', () => {
  it('lists every built-in kind in registration order', () => {
    expect(listKinds()).toEqual(allKinds.map((k) => k.kind))
  })

  it('lists units with resolved plural, aliases, base flag, and factor', () => {
    const kg = listUnits('mass').find((u) => u.id === 'kg')
    expect(kg).toMatchObject({
      kind: 'mass',
      id: 'kg',
      name: 'kilogram',
      plural: 'kilograms',
      isBase: true,
      toBase: 1,
    })
    expect(kg?.aliases).toContain('kilos')
    // hertz has an irregular plural; the catalog resolves it, not `hertzs`.
    expect(listUnits('frequency').find((u) => u.id === 'Hz')?.plural).toBe('hertz')
  })

  it('kindInfo exposes the base unit; unknown kinds return undefined', () => {
    expect(kindInfo('length')?.baseUnit).toBe('m')
    expect(kindInfo('nope' as never)).toBeUndefined()
  })

  it('every listed unit id and alias is actually parseable (catalog matches the parser)', () => {
    for (const kind of listKinds()) {
      for (const unit of listUnits(kind)) {
        for (const alias of unit.aliases) {
          const r = lingo(`5 ${alias}`, { kind })
          expect(r.ok, `catalog ${kind}:${unit.id} alias "${alias}" should parse`).toBe(true)
        }
      }
    }
  })
})

describe('catalog: ref resolution', () => {
  it('resolves ids, symbols, names, and aliases', () => {
    expect(getUnit('kilos')?.id).toBe('kg')
    expect(getUnit('meters')?.id).toBe('m')
    expect(getUnit('bucks')?.id).toBe('USD')
    expect(getUnit('nope')).toBeUndefined()
  })

  it('disambiguates cross-kind refs with an explicit kind', () => {
    expect(getUnit('C')?.kind).toBe('temperature')
    expect(getUnit('C', 'charge')?.name).toBe('coulomb')
  })

  it('kindOf and relatedUnits work off any ref', () => {
    expect(kindOf('mph')).toBe('speed')
    expect(kindOf('quid')).toBe('currency')
    const related = relatedUnits('ft')
    expect(related.some((u) => u.id === 'm')).toBe(true)
    expect(related.some((u) => u.id === 'ft')).toBe(false) // excludes itself
  })
})

describe('catalog: currency + ISO country data', () => {
  it('lists currencies with ISO minor-unit and country codes', () => {
    const currencies = listCurrencies()
    expect(currencies.length).toBeGreaterThan(20)
    const jpy = currencies.find((c) => c.code === 'JPY')
    expect(jpy).toMatchObject({ code: 'JPY', symbol: '¥', minorUnit: 0 })
    expect(jpy?.countries).toEqual(['JP'])
    expect(currencies.find((c) => c.code === 'USD')?.minorUnit).toBe(2)
  })

  it('looks up currency by code, symbol, or alias', () => {
    expect(getCurrency('USD')?.countries).toContain('US')
    expect(getCurrency('£')?.code).toBe('GBP')
    expect(getCurrency('euros')?.code).toBe('EUR')
    expect(getCurrency('nope')).toBeUndefined()
  })

  it('maps ISO country codes to their currency (case-insensitive)', () => {
    expect(currencyForCountry('FR')?.code).toBe('EUR')
    expect(currencyForCountry('jp')?.code).toBe('JPY')
    expect(currencyForCountry('GB')?.code).toBe('GBP')
    expect(currencyForCountry('ZZ')).toBeUndefined()
  })

  it('country codes are 2-letter uppercase and unique per currency', () => {
    for (const c of listCurrencies()) {
      const seen = new Set<string>()
      for (const country of c.countries) {
        expect(country, `${c.code} country ${country}`).toMatch(/^[A-Z]{2}$/)
        expect(seen.has(country), `${c.code} duplicate ${country}`).toBe(false)
        seen.add(country)
      }
    }
  })
})
