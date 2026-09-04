import { describe, expect, it } from 'vitest'
import {
  convert,
  convertCurrency,
  convertDelta,
  fromJSON,
  fromMinor,
  lingo,
  parseQuantity,
  parseRange,
  quantity,
} from '../index'
import { allKinds } from './index'

const CROSS_CURRENCY_MESSAGE =
  'lingo: cross-currency conversion needs rates — use convertCurrency(…)'

function expectCurrency(
  input: string,
  unit: string,
  value: number,
  opts?: Parameters<typeof lingo>[1],
) {
  const r = lingo(input, opts)
  if (!r.ok || r.type !== 'quantity') {
    throw new Error(`expected currency quantity for "${input}": ${JSON.stringify(r)}`)
  }
  expect(r.quantity.kind, input).toBe('currency')
  expect(r.quantity.unit, input).toBe(unit)
  expect(r.quantity.value, input).toBeCloseTo(value, 12)
  expect(r.quantity.base, input).toBeCloseTo(value, 12)
  expect(r.quantity.toJSON().baseUnit, input).toBe(unit)
  return r.quantity
}

function expectCurrencyRange(input: string, unit: string, min: number, max: number) {
  const r = lingo(input)
  if (!r.ok || r.type !== 'range') {
    throw new Error(`expected currency range for "${input}": ${JSON.stringify(r)}`)
  }
  expect(r.range.kind, input).toBe('currency')
  expect(r.range.min()?.unit, input).toBe(unit)
  expect(r.range.min()?.value, input).toBeCloseTo(min, 12)
  expect(r.range.max()?.unit, input).toBe(unit)
  expect(r.range.max()?.value, input).toBeCloseTo(max, 12)
  return r.range
}

describe('currency kind', () => {
  it('ships a compact rate-based currency table', () => {
    const kind = allKinds.find((candidate) => candidate.kind === 'currency')
    expect(kind?.rateBased).toBe(true)
    expect(kind?.baseUnit).toBe('USD')
    expect(kind?.units).toHaveLength(28)
    for (const unit of kind?.units ?? []) {
      expect(unit.id).toMatch(/^[A-Z]{3}$/)
      expect(unit.factor, unit.id).toBe(1)
      expect(unit.offset, unit.id).toBeUndefined()
      expect(unit.minorUnit, unit.id).toEqual(expect.any(Number))
      expect(unit.aliases, unit.id).toContain(unit.id.toLowerCase())
    }
    expect(kind?.units.find((unit) => unit.id === 'JPY')?.minorUnit).toBe(0)
    expect(kind?.units.find((unit) => unit.id === 'KRW')?.minorUnit).toBe(0)
    expect(kind?.units.find((unit) => unit.id === 'KWD')?.minorUnit).toBe(3)
    expect(kind?.units.find((unit) => unit.id === 'BHD')?.minorUnit).toBe(3)
    expect(kind?.units.find((unit) => unit.id === 'OMR')?.minorUnit).toBe(3)
  })

  it('parses suffix codes, prefix codes, names, and prefix symbols', () => {
    expectCurrency('5 USD', 'USD', 5)
    expectCurrency('USD 5', 'USD', 5)
    expectCurrency('5 dollars', 'USD', 5)
    expectCurrency('$5', 'USD', 5)
    expectCurrency('$5.50', 'USD', 5.5)
    expectCurrency('$1,234.50', 'USD', 1234.5)
    expectCurrency('€10', 'EUR', 10)
    expectCurrency('£3.50', 'GBP', 3.5)
    expectCurrency('¥1000', 'JPY', 1000)
  })

  it('surfaces bare symbol ambiguity unless currency context disambiguates it', () => {
    const usd = lingo('$5')
    expect(usd.ok && usd.type === 'quantity').toBe(true)
    if (!(usd.ok && usd.type === 'quantity')) {
      return
    }
    expect(usd.quantity.unit).toBe('USD')
    expect(usd.issues.find((issue) => issue.code === 'AMBIGUOUS_UNIT')).toMatchObject({
      severity: 'warning',
      data: { unit: '$', assumed: 'USD' },
      suggestions: expect.arrayContaining(['CAD', 'AUD']),
    })

    const cad = lingo('$5', { currency: 'CAD' })
    expect(cad.ok && cad.type === 'quantity').toBe(true)
    if (cad.ok && cad.type === 'quantity') {
      expect(cad.quantity.unit).toBe('CAD')
      expect(cad.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)
    }

    const cny = lingo('¥1000', { currency: 'CNY' })
    expect(cny.ok && cny.type === 'quantity').toBe(true)
    if (cny.ok && cny.type === 'quantity') {
      expect(cny.quantity.unit).toBe('CNY')
      expect(cny.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)
    }

    const confirm = lingo('$5', { strictness: 'confirm' })
    expect(confirm.ok).toBe(false)
    if (!confirm.ok) {
      expect(confirm.issues.find((issue) => issue.code === 'AMBIGUOUS_UNIT')?.severity).toBe(
        'error',
      )
      expect(confirm.candidate?.type).toBe('quantity')
    }

    const eur = lingo('€10')
    expect(eur.ok && eur.type === 'quantity').toBe(true)
    if (eur.ok) {
      expect(eur.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)
    }
  })

  it('parses scoped currency slang aliases', () => {
    expectCurrency('5 bucks', 'USD', 5)
    expectCurrency('5 quid', 'GBP', 5)
    expectCurrency('50p', 'GBP', 0.5)
    expectCurrency('50 pence', 'GBP', 0.5)
    expectCurrency('3 quid 50', 'GBP', 3.5)
    expectCurrency('5 pounds sterling 25', 'GBP', 5.25)
    expectCurrency('5 pounds 25', 'GBP', 5.25, { kind: 'currency' })
    expectCurrency('5 euros', 'EUR', 5)
  })

  it('parses currency ranges', () => {
    expectCurrencyRange('between $5 and $10', 'USD', 5, 10)
    expectCurrencyRange('$5-$10', 'USD', 5, 10)
    expectCurrencyRange('$5 to $10', 'USD', 5, 10)
    expectCurrencyRange('5 to 10 USD', 'USD', 5, 10)
    expectCurrencyRange('50p-£1', 'GBP', 0.5, 1)
    expectCurrencyRange('between 50p and £1', 'GBP', 0.5, 1)
    const eur = expectCurrencyRange('€5-€10', 'EUR', 5, 10)
    expect(eur.toJSON().baseUnit).toBe('EUR')
    expect(fromJSON(eur.toJSON()).toJSON()).toEqual(eur.toJSON())
  })

  it('parses explicit pence tolerance deltas without changing bare tolerance policy', () => {
    const pence = parseRange('3 quid ± 50p')
    expect(pence.ok && pence.type === 'range').toBe(true)
    if (pence.ok && pence.type === 'range') {
      expect(pence.range.min()?.value).toBeCloseTo(2.5, 12)
      expect(pence.range.max()?.value).toBeCloseTo(3.5, 12)
      expect(pence.range.plusMinus?.deltaBase).toBeCloseTo(0.5, 12)
    }

    const bare = parseRange('3 quid ± 50')
    expect(bare.ok && bare.type === 'range').toBe(true)
    if (bare.ok && bare.type === 'range') {
      expect(bare.range.min()?.value).toBeCloseTo(-47, 12)
      expect(bare.range.max()?.value).toBeCloseTo(53, 12)
    }
  })

  it('returns issues instead of throwing for currency text that needs rates', () => {
    for (const input of ['5 EUR to USD', '€5-$10', '10 USD ± 2 EUR']) {
      const r = lingo(input, { kind: 'currency' })
      expect(r.ok, input).toBe(false)
      if (!r.ok) {
        const issue = r.issues.find((candidate) => candidate.code === 'RATE_REQUIRED')
        expect(issue).toMatchObject({
          code: 'RATE_REQUIRED',
          severity: 'error',
          span: { start: 0, end: input.length },
        })
        expect(issue?.data).toEqual(
          expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
        )
      }
    }
  })

  it('keeps same-currency conversion identity and blocks cross-currency factor conversion', () => {
    const usd = quantity(5, 'USD')
    expect(convert(5, 'USD', 'USD')).toBe(5)
    expect(convertDelta(5, 'USD', 'USD')).toBe(5)
    expect(usd.to('usd')).toBe(usd)
    expect(usd.valueIn('USD')).toBe(5)
    expect(() => convert(5, 'USD', 'EUR')).toThrow(
      'Currency conversion from USD to EUR needs rates',
    )
    expect(() => convertDelta(5, 'USD', 'EUR')).toThrow(CROSS_CURRENCY_MESSAGE)
    expect(() => usd.to('EUR')).toThrow(CROSS_CURRENCY_MESSAGE)
    expect(() => usd.valueIn('EUR')).toThrow(CROSS_CURRENCY_MESSAGE)
  })

  it('converts currencies only with injected rates', () => {
    expect(
      convertCurrency(100, 'USD', 'EUR', {
        rates: { base: 'USD', rates: { USD: 1, EUR: 0.92 } },
      }),
    ).toBe(92)
    expect(
      convertCurrency(100, 'EUR', 'GBP', {
        rates: { base: 'USD', rates: { USD: 1, EUR: 0.92, GBP: 0.8 } },
      }),
    ).toBeCloseTo(86.956_521_739_130_44, 12)

    const calls: Array<[string, string]> = []
    const value = convertCurrency(100, 'usd', 'eur', {
      rates: (from, to) => {
        calls.push([from, to])
        return 0.92
      },
    })
    expect(value).toBe(92)
    expect(calls).toEqual([['USD', 'EUR']])

    const unknownCurrency: string = 'NOPE'
    expect(() =>
      convertCurrency(100, 'USD', unknownCurrency, {
        rates: { base: 'USD', rates: { USD: 1, EUR: 0.92 } },
      }),
    ).toThrow('lingo: unknown currency "NOPE"')
    expect(() =>
      convertCurrency(100, 'USD', 'EUR', {
        rates: { base: 'USD', rates: { USD: 1 } },
      }),
    ).toThrow('lingo: missing rate for currency "EUR"')
    expect(() =>
      convertCurrency(100, 'USD', 'EUR', {
        rates: () => Number.NaN,
      }),
    ).toThrow('lingo: rate provider returned invalid rate for "USD" to "EUR"')
  })

  it('converts currency quantities to and from minor units', () => {
    expect(quantity(5, 'USD').toMinor()).toBe(500)
    expect(quantity(5.005, 'USD').toMinor()).toBe(501)
    expect(quantity(1000, 'JPY').toMinor()).toBe(1000)
    expect(quantity(1.2345, 'KWD').toMinor()).toBe(1235)
    expect(fromMinor(500, 'USD').value).toBe(5)
    expect(fromMinor(500, 'USD').format()).toBe('$5.00')
    expect(fromMinor(1000, 'JPY').value).toBe(1000)
    expect(fromMinor(1234, 'KWD').value).toBeCloseTo(1.234, 12)
    expect(() => quantity(5, 'kg').toMinor()).toThrow(
      'lingo: toMinor() is for currencies, not mass',
    )
  })

  it('formats with Intl and re-parses to the same amount and code', () => {
    const cases = [
      quantity(5, 'USD'),
      quantity(5.5, 'USD'),
      quantity(10, 'EUR'),
      quantity(1000, 'JPY'),
      quantity(5.5, 'JPY'),
      quantity(1234.5, 'CAD'),
    ]

    expect(quantity(5, 'USD').format()).toBe('$5.00')
    expect(quantity(1234.5, 'USD').format({ grouping: true })).toBe('$1,234.50')
    expect(quantity(5, 'EUR').format({ locale: 'fr-FR' })).toBe('5,00 EUR')

    for (const q of cases) {
      const text = q.format()
      const back = parseQuantity(text)
      if (!back.ok) {
        throw new Error(`currency round-trip failed for "${text}": ${JSON.stringify(back.issues)}`)
      }
      expect(back.quantity.kind, text).toBe('currency')
      expect(back.quantity.unit, text).toBe(q.unit)
      expect(back.quantity.value, text).toBeCloseTo(q.value, 12)
      expect(back.quantity.base, text).toBeCloseTo(q.base, 12)
    }
  })

  it('serializes currency quantities as self-canonical values', () => {
    const eur = quantity(10, 'EUR')
    expect(eur.toJSON()).toMatchObject({
      type: 'quantity',
      kind: 'currency',
      value: 10,
      unit: 'EUR',
      base: 10,
      baseUnit: 'EUR',
    })
    expect(fromJSON(eur.toJSON()).toJSON()).toEqual(eur.toJSON())
  })

  it('rejects malformed mixed-currency range JSON', () => {
    expect(() =>
      fromJSON({
        schemaVersion: 3,
        type: 'range',
        kind: 'currency',
        baseUnit: 'EUR',
        min: { value: 5, unit: 'EUR', base: 5 },
        max: { value: 10, unit: 'USD', base: 10 },
      }),
    ).toThrow('lingo: currency ranges need one currency; convert with rates first')

    const eur = parseRange('€5-€10')
    expect(eur.ok).toBe(true)
    if (eur.ok) {
      expect(() => eur.range.to('USD')).toThrow(CROSS_CURRENCY_MESSAGE)
    }
  })
})
