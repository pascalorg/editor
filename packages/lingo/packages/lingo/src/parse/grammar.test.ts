import { describe, expect, it } from 'vitest'
import { Quantity, type QuantityRange } from '../core/quantity'
import { createRegistry } from '../core/registry'
import type { FormatOptions } from '../format/format'
import { registerTemperatureVocabs } from '../fuzzy/temperature'
import { findQuantities, parseQuantity, quantity } from '../index'
import { allKinds } from '../units/index'
import { type ParseOptions, parseExpression, parseQuantityExpr } from './grammar'

const reg = createRegistry(allKinds)
registerTemperatureVocabs(reg)

const opts = (extra: Partial<ParseOptions> = {}): ParseOptions => ({
  registry: reg,
  ...extra,
})

function qty(input: string, extra: Partial<ParseOptions> = {}) {
  const r = parseExpression(input, opts(extra))
  if (!r.ok) {
    throw new Error(`parse failed for "${input}": ${JSON.stringify(r.issues)}`)
  }
  if (r.type !== 'quantity') {
    throw new Error(`expected quantity for "${input}", got ${r.type}`)
  }
  return r
}

function base(input: string, extra: Partial<ParseOptions> = {}): number {
  return qty(input, extra).quantity.base
}

describe('single quantities', () => {
  it('parses plain unit forms', () => {
    expect(base('2 ft')).toBeCloseTo(0.6096, 12)
    expect(base('72 in')).toBeCloseTo(1.8288, 12)
    expect(base('1.5 kg')).toBeCloseTo(1.5, 12)
    expect(base('like 5 kg')).toBeCloseTo(5, 12)
    expect(qty('like 5 kg').quantity.approximate).toBe(true)
    expect(qty('maybe 5 kg').quantity.approximate).toBe(true)
    expect(base('gimme 5 liters')).toBeCloseTo(0.005, 12)
    expect(base('5 kgs')).toBeCloseTo(5, 12)
    expect(base('100km')).toBeCloseTo(100_000, 9)
    expect(base('15 mph')).toBeCloseTo((15 * 1609.344) / 3600, 9)
  })

  it('parses unicode and spelling variants', () => {
    expect(base('5 metres')).toBeCloseTo(5, 12)
    expect(base('3 ℃')).toBeCloseTo(276.15, 10)
    expect(base('20°C')).toBeCloseTo(293.15, 10)
    expect(base('-40°F')).toBeCloseTo(233.15, 10)
    expect(base('5 μm')).toBeCloseTo(5e-6, 15)
    expect(base('5 µm')).toBeCloseTo(5e-6, 15) // micro sign folds to mu
    expect(base('2 m²', { kind: 'area' })).toBeCloseTo(2, 12)
    expect(base('2 sq ft')).toBeCloseTo(2 * 0.092_903_04, 12)
  })

  it('sums mixed-unit additive chains', () => {
    expect(base('20in and 10cm')).toBeCloseTo(20 * 0.0254 + 0.1, 12)
    expect(base('10cm and 20in')).toBeCloseTo(20 * 0.0254 + 0.1, 12) // any order
    expect(base('1 m + 3 ft')).toBeCloseTo(1 + 3 * 0.3048, 12)
    expect(base('2m plus 10cm')).toBeCloseTo(2.1, 12)
    expect(base('2 m minus 10 cm')).toBeCloseTo(1.9, 12)
    expect(base('1 day, 3 hours, 2 minutes')).toBeCloseTo(97_320, 9) // humanize-duration output
    expect(base('5 kg and 10 kg and 300 g')).toBeCloseTo(15.3, 12)
  })

  it("between does not eat 'and' as a sum joiner", () => {
    const r = parseExpression('between 5kg and 10kg', opts())
    if (!r.ok || r.type !== 'range') {
      throw new Error(`expected range, got ${JSON.stringify(r)}`)
    }
    expect(r.range.minBase).toBeCloseTo(5, 12)
    expect(r.range.maxBase).toBeCloseTo(10, 12)
  })

  it('parses a spaced hyphen as a range, not subtraction', () => {
    const r2 = parseExpression('2m - 10cm', opts())
    if (!r2.ok || r2.type !== 'range') {
      throw new Error('expected range')
    }
  })

  it('round-trips mixed-parts formatting', () => {
    const q = qty('20in and 10cm').quantity
    expect(q.format()).toBe('20 in + 10 cm')
    expect(base(q.format())).toBeCloseTo(q.base, 12)
    const m = qty('2 m minus 10 cm').quantity
    expect(base(m.format())).toBeCloseTo(1.9, 12)
  })

  it('averages temperature chains in absolute scale', () => {
    const temp = qty('20°C and 5°F', { kind: 'temperature' }).quantity
    expect(temp.value).toBeCloseTo(22.777_777_777_8, 10)
    expect(temp.base).not.toBeCloseTo(293.15 + 258.15, 6)
    expect(base(temp.format(), { kind: 'temperature' })).toBeCloseTo(temp.base, 10)
    expect(parseExpression('20°C 5°F', opts({ kind: 'temperature' })).ok).toBe(false)
  })

  it('parses compounds', () => {
    expect(base(`5'11"`)).toBeCloseTo(1.8034, 12)
    expect(base('5′11″')).toBeCloseTo(1.8034, 12)
    expect(base('5 ft 11 in')).toBeCloseTo(1.8034, 12)
    expect(base('5-foot-11')).toBeCloseTo(1.8034, 12)
    expect(base('6ft2')).toBeCloseTo(6 * 0.3048 + 2 * 0.0254, 12)
    expect(base('1m80')).toBeCloseTo(1.8, 12)
    expect(base('2 lb 3 oz')).toBeCloseTo(2 * 0.453_592_37 + (3 * 0.453_592_37) / 16, 12)
    expect(base('1h30')).toBeCloseTo(5400, 9)
    expect(base('1 h 30 min')).toBeCloseTo(5400, 9)
  })

  it('warns on bare ounce ambiguity without warning on mass compounds', () => {
    const bare = qty('12 oz')
    expect(bare.quantity.unit).toBe('oz')
    expect(bare.issues.find((issue) => issue.code === 'AMBIGUOUS_UNIT')).toMatchObject({
      data: { assumed: 'ounce (mass)' },
      suggestions: ['fluid ounce (volume)'],
    })

    const volume = qty('12 oz', { kind: 'volume' })
    expect(volume.quantity.unit).toBe('floz')
    expect(volume.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)

    const compound = qty('2 lb 3 oz')
    expect(compound.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)
  })

  it('parses number words', () => {
    expect(base('six feet')).toBeCloseTo(6 * 0.3048, 12)
    expect(base('an hour')).toBeCloseTo(3600, 9)
    expect(base('half an hour')).toBeCloseTo(1800, 9)
    expect(base('an hour and a half')).toBeCloseTo(5400, 9)
    expect(base('two and a half hours')).toBeCloseTo(9000, 9)
    expect(base('twenty-five kg')).toBeCloseTo(25, 12)
    expect(base('a hundred meters')).toBeCloseTo(100, 12)
  })

  it('negates digit literals after minus/negative', () => {
    expect(qty('minus 5 kg').quantity.value).toBeCloseTo(-5, 12)
    expect(qty('negative 5 kg').quantity.value).toBeCloseTo(-5, 12)
    expect(qty('minus 20 celsius').quantity.value).toBeCloseTo(-20, 12)
    expect(base('minus 5 kg')).toBeCloseTo(-5, 12)
    // spelled-number negation still works
    expect(qty('minus five kg').quantity.value).toBeCloseTo(-5, 12)
  })

  it('parses a fraction of a unit', () => {
    expect(qty('a quarter of a mile').quantity.valueIn('mi')).toBeCloseTo(0.25, 12)
    expect(qty('two thirds of a meter').quantity.valueIn('m')).toBeCloseTo(2 / 3, 12)
    expect(qty('a third of an hour').quantity.valueIn('h')).toBeCloseTo(1 / 3, 12)
    expect(qty('three quarters of a mile').quantity.valueIn('mi')).toBeCloseTo(0.75, 12)
    // bare fraction words stay plain numbers
    const bare = parseExpression('a quarter', opts())
    expect(bare.ok && bare.type === 'number' && bare.value).toBe(0.25)
  })

  it('marks mid-value ish approximate before the unit resolves', () => {
    expect(qty('5ish kg').quantity.approximate).toBe(true)
    expect(base('5ish kg')).toBeCloseTo(5, 12)
    expect(qty('5 ish kg').quantity.approximate).toBe(true)
    expect(base('5 ish kg')).toBeCloseTo(5, 12)
    // trailing form still works
    expect(qty('5 kg ish').quantity.approximate).toBe(true)
  })

  it('parses currency minor-unit idioms without inventing cent units', () => {
    const cents = qty('50 cents')
    expect(cents.quantity.kind).toBe('currency')
    expect(cents.quantity.unit).toBe('USD')
    expect(cents.quantity.value).toBeCloseTo(0.5, 12)
    expect(cents.issues.find((issue) => issue.code === 'AMBIGUOUS_UNIT')).toMatchObject({
      data: { unit: 'cents', assumed: 'USD cents' },
      suggestions: [
        'EUR cents',
        'CAD cents',
        'AUD cents',
        'SGD cents',
        'HKD cents',
        'NZD cents',
        'MXN cents',
      ],
    })

    const confirm = parseExpression('50 cents', opts({ strictness: 'confirm' }))
    expect(confirm.ok).toBe(false)
    if (!confirm.ok) {
      expect(confirm.issues.find((issue) => issue.code === 'AMBIGUOUS_UNIT')?.severity).toBe(
        'error',
      )
      expect(confirm.candidate?.type).toBe('quantity')
    }

    const eur = qty('50 cents', { currency: 'EUR' })
    expect(eur.quantity.unit).toBe('EUR')
    expect(eur.quantity.value).toBeCloseTo(0.5, 12)
    expect(eur.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)

    expect(qty('five dollars and fifty cents').quantity.value).toBeCloseTo(5.5, 12)
    expect(qty('5 dollars 50 cents').quantity.value).toBeCloseTo(5.5, 12)
    expect(qty('50¢').quantity.value).toBeCloseTo(0.5, 12)

    const pence = qty('50p')
    expect(pence.quantity.unit).toBe('GBP')
    expect(pence.quantity.value).toBeCloseTo(0.5, 12)
    expect(pence.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)

    expect(qty('50 pence').quantity.value).toBeCloseTo(0.5, 12)
    expect(qty('3 quid 50').quantity.value).toBeCloseTo(3.5, 12)
    expect(qty('3 quid 05').quantity.value).toBeCloseTo(3.05, 12)
    expect(qty('3 quid 99').quantity.value).toBeCloseTo(3.99, 12)
    expect(qty('5 pounds sterling 25').quantity.value).toBeCloseTo(5.25, 12)
    const poundsCurrency = qty('5 pounds 25', { kind: 'currency' })
    expect(poundsCurrency.quantity.unit).toBe('GBP')
    expect(poundsCurrency.quantity.value).toBeCloseTo(5.25, 12)
    expect(poundsCurrency.issues.some((issue) => issue.code === 'SLANG_UNIT')).toBe(true)

    const penceOverEurContext = qty('50p', { currency: 'EUR' })
    expect(penceOverEurContext.quantity.unit).toBe('GBP')
    expect(penceOverEurContext.issues.some((issue) => issue.code === 'AMBIGUOUS_UNIT')).toBe(false)

    const poundsMass = qty('5 pounds 25')
    expect(poundsMass.quantity.kind).toBe('mass')
    expect(poundsMass.quantity.unit).toBe('lb')
    expect(poundsMass.issues.some((issue) => issue.code === 'COMPOUND_OVERFLOW')).toBe(true)

    const overflow = parseExpression('3 quid 100', opts())
    expect(overflow.ok).toBe(false)
    if (!overflow.ok) {
      expect(overflow.issues.some((issue) => issue.code === 'COMPOUND_OVERFLOW')).toBe(true)
      expect(overflow.issues.some((issue) => issue.code === 'TRAILING_INPUT')).toBe(true)
    }
    expect(parseExpression('5 USD 10', opts()).ok).toBe(false)
  })

  it('parses fractions', () => {
    expect(base('1/2 cup')).toBeCloseTo(0.000_236_588_236_5 / 2, 15)
    expect(base('1½ cups')).toBeCloseTo(1.5 * 0.000_236_588_236_5, 15)
    expect(base('½ cup')).toBeCloseTo(0.000_236_588_236_5 / 2, 15)
    expect(base('1 1/2 in')).toBeCloseTo(1.5 * 0.0254, 12)
    expect(base('2-3/4 in')).toBeCloseTo(2.75 * 0.0254, 12)
  })

  it('parses decimal separators per policy', () => {
    expect(base('0,5 kg')).toBeCloseTo(0.5, 12) // grouping impossible → decimal
    expect(base('1.234,56 m')).toBeCloseTo(1234.56, 9)
    expect(base('1,234.56 m')).toBeCloseTo(1234.56, 9)
    expect(base('1 234 567 m')).toBeCloseTo(1_234_567, 6)
    const ambiguous = qty('1,234 kg')
    expect(ambiguous.quantity.base).toBeCloseTo(1234, 9)
    expect(ambiguous.issues.some((i) => i.code === 'AMBIGUOUS_NUMBER')).toBe(true)
    expect(base('1,5 kg', { numberFormat: 'comma-decimal' })).toBeCloseTo(1.5, 12)
  })

  it('parses scientific notation', () => {
    expect(base('1e3 m')).toBeCloseTo(1000, 9)
    expect(base('2.5E-4 m')).toBeCloseTo(2.5e-4, 15)
    expect(base('3×10^5 m')).toBeCloseTo(3e5, 6)
    expect(base('1×10⁻³ kg')).toBeCloseTo(0.001, 15)
    expect(base('2.5×10⁻⁴ m')).toBeCloseTo(2.5e-4, 15)
  })

  it('clears ambiguity alternatives when an exponent disambiguates', () => {
    const r = qty('1.234e5 kg')
    expect(r.quantity.base).toBeCloseTo(123_400, 6)
    expect(r.issues).toEqual([])
    expect(r.alternatives).toBeUndefined()

    const neg = qty('-1.234e5 kg')
    expect(neg.quantity.base).toBeCloseTo(-123_400, 6)
    expect(neg.issues).toEqual([])
    expect(neg.alternatives).toBeUndefined()
  })

  it('parses force, power, and frequency units', () => {
    expect(base('5 N')).toBeCloseTo(5, 12)
    expect(base('10 kW')).toBeCloseTo(10_000, 12)
    expect(base('60 Hz')).toBeCloseTo(60, 12)
    expect(base('3000 rpm')).toBeCloseTo(50, 12)
  })

  it('parses declared amount concentration units without general unit algebra', () => {
    expect(base('1 M')).toBeCloseTo(1000, 12)
    expect(base('5 mM')).toBeCloseTo(5, 12)
    expect(base('5 uM')).toBeCloseTo(0.005, 12)
    expect(base('5 μM')).toBeCloseTo(0.005, 12)
    expect(base('5 µM')).toBeCloseTo(0.005, 12)
    expect(base('1 mol/L')).toBeCloseTo(1000, 12)
    expect(base('1 mol / L')).toBeCloseTo(1000, 12)
    expect(base('1 mol per L')).toBeCloseTo(1000, 12)
    expect(base('1 mol per liter')).toBeCloseTo(1000, 12)
    expect(base('250 mmol/L')).toBeCloseTo(250, 12)
    expect(base('250 mmol per L')).toBeCloseTo(250, 12)
    expect(base('250 mmol per litre')).toBeCloseTo(250, 12)
    expect(base('10 umol per L')).toBeCloseTo(0.01, 12)
    expect(base('1 μmol per liter')).toBeCloseTo(0.001, 12)
    expect(base('1 µmol/L')).toBeCloseTo(0.001, 12)
    expect(base('10 micromolar')).toBeCloseTo(0.01, 12)
  })

  it('parses spoken quotient units and common cubic volumes', () => {
    expect(base('60 miles an hour')).toBeCloseTo(60 * (1609.344 / 3600), 12)
    expect(base('60 miles/hour')).toBeCloseTo(60 * (1609.344 / 3600), 12)
    expect(base('60 mi/hour')).toBeCloseTo(60 * (1609.344 / 3600), 12)
    expect(base('100 kilometers an hour')).toBeCloseTo(100 * (1000 / 3600), 12)
    expect(base('3 meters a second')).toBeCloseTo(3, 12)
    expect(base('3 meters/sec')).toBeCloseTo(3, 12)
    expect(base('3 m/sec')).toBeCloseTo(3, 12)
    expect(base('30 pounds per sq inch')).toBeCloseTo(30 * 6894.757_293_168, 9)
    expect(base('5 cubic feet')).toBeCloseTo(5 * 0.3048 ** 3, 12)
    expect(base('5 uL')).toBeCloseTo(5e-9, 15)
    expect(base('5 µL')).toBeCloseTo(5e-9, 15)
    expect(base('5 μL')).toBeCloseTo(5e-9, 15)
    expect(base('5 cL')).toBeCloseTo(5e-5, 15)
    expect(base('5 dL')).toBeCloseTo(5e-4, 15)
    expect(base('25 sf')).toBeCloseTo(25 * 0.3048 * 0.3048, 12)
  })

  it('accepts conversational qualifier and bound phrasing', () => {
    expect(qty('approx. 5 kg').quantity.approximate).toBe(true)
    expect(qty('please give me 5 kg').quantity.base).toBeCloseTo(5, 12)

    const aroundMark = qty('around the 5 kg mark')
    expect(aroundMark.quantity.approximate).toBe(true)
    expect(aroundMark.quantity.base).toBeCloseTo(5, 12)

    const max = parseExpression('no greater than 5 kg', opts())
    expect(max.type).toBe('range')
    if (max.type !== 'range') {
      throw new Error('expected range')
    }
    expect(max.range.maxBase).toBeCloseTo(5, 12)
    expect(max.range.toJSON().max?.exclusive).toBeUndefined()

    const lte = parseExpression('less than or equal to 5 kg', opts())
    expect(lte.type).toBe('range')
    if (lte.type !== 'range') {
      throw new Error('expected range')
    }
    expect(lte.range.maxBase).toBeCloseTo(5, 12)

    const gte = parseExpression('greater than or equal to 5 kg', opts())
    expect(gte.type).toBe('range')
    if (gte.type !== 'range') {
      throw new Error('expected range')
    }
    expect(gte.range.minBase).toBeCloseTo(5, 12)
  })

  it('handles typo correction with kind context', () => {
    const r = qty('5 meterz', { kind: 'length' })
    expect(r.quantity.base).toBeCloseTo(5, 12)
    expect(r.issues.some((i) => i.code === 'TYPO_CORRECTED')).toBe(true)
    expect(r.confidence).toBeLessThan(1)
  })

  it('applies kind slang', () => {
    const r = qty('5m', { kind: 'duration' })
    expect(r.quantity.base).toBeCloseTo(300, 9)
    expect(r.issues.some((i) => i.code === 'SLANG_UNIT')).toBe(true)
    expect(base('5m')).toBeCloseTo(5, 12) // meters without context
  })

  it('assumes the field unit for bare numbers', () => {
    const r = qty('72', { kind: 'length', unit: 'cm' })
    expect(r.quantity.base).toBeCloseTo(0.72, 12)
    expect(r.issues.some((i) => i.code === 'UNIT_ASSUMED')).toBe(true)
  })

  it('respects data-unit case rules', () => {
    expect(base('5 MB')).toBe(5e6)
    expect(base('5 Mb')).toBe(5e6 / 8)
    expect(base('2 KiB')).toBe(2048)
    expect(base('500 KB')).toBe(500_000)
  })

  it('parses percent', () => {
    expect(base('15%')).toBeCloseTo(15, 12)
  })

  it('parses qualifiers into approximate', () => {
    const r = qty('about 20 kg')
    expect(r.quantity.approximate).toBe(true)
    const r2 = qty('~5 kg')
    expect(r2.quantity.approximate).toBe(true)
    const r3 = qty('5 kg or so')
    expect(r3.quantity.approximate).toBe(true)
  })
})

describe('ranges', () => {
  function range(input: string, extra: Partial<ParseOptions> = {}) {
    const r = parseExpression(input, opts(extra))
    if (!r.ok) {
      throw new Error(`parse failed for "${input}": ${JSON.stringify(r.issues)}`)
    }
    if (r.type !== 'range') {
      throw new Error(`expected range for "${input}", got ${r.type}`)
    }
    return r.range
  }

  it('parses closed ranges with unit distribution', () => {
    const r = range('5-10 kg')
    expect(r.minBase).toBeCloseTo(5, 12)
    expect(r.maxBase).toBeCloseTo(10, 12)
    expect(range('between 5 and 10 kg').maxBase).toBeCloseTo(10, 12)
    expect(range('5 to 10 kg').minBase).toBeCloseTo(5, 12)
    expect(range('5–10kg').maxBase).toBeCloseTo(10, 12)
  })

  it('rejects cross-kind quantity containment', () => {
    const r = range('5-10 kg')
    expect(r.contains(quantity(7, 'kg'))).toBe(true)
    expect(() => r.contains(quantity(7, 'm'))).toThrow(
      'lingo: cannot test length inside mass range',
    )
  })

  it('parses from…to, or, and softened bounds', () => {
    const fromTo = range('from 5 to 10 kg')
    expect(fromTo.minBase).toBeCloseTo(5, 12)
    expect(fromTo.maxBase).toBeCloseTo(10, 12)
    expect(range('from 5 kg to 10 kg').maxBase).toBeCloseTo(10, 12)

    const orRange = range('5 or 6 kg')
    expect(orRange.minBase).toBeCloseTo(5, 12)
    expect(orRange.maxBase).toBeCloseTo(6, 12)

    const justUnder = range('just under 2 hours')
    expect(justUnder.maxBase).toBeCloseTo(7200, 9)
    expect(justUnder.exclusiveMax).toBe(true)
    expect(justUnder.approximate).toBe(true)

    const justOver = range('just over 2 hours')
    expect(justOver.minBase).toBeCloseTo(7200, 9)
    expect(justOver.exclusiveMin).toBe(true)

    const bitOver = range('a bit over 2 hours')
    expect(bitOver.minBase).toBeCloseTo(7200, 9)
    expect(bitOver.approximate).toBe(true)
    expect(range('a little over 2 hours').minBase).toBeCloseTo(7200, 9)
    expect(range('slightly under 2 hours').maxBase).toBeCloseTo(7200, 9)
  })

  it("keeps the 'or so' hedge and bare 'a bit' intact alongside the or-range", () => {
    // "or so" stays an approximate hedge, not a range separator
    expect(qty('5 kg or so').quantity.approximate).toBe(true)
    // "a bit" without a following bound is still 1 bit (data)
    const aBit = qty('a bit')
    expect(aBit.quantity.kind).toBe('data')
    expect(aBit.quantity.unit).toBe('bit')
  })

  it('parses open ranges from qualifiers', () => {
    const r = range('under 10 minutes')
    expect(r.maxBase).toBeCloseTo(600, 9)
    expect(r.minBase).toBeNull()
    expect(r.exclusiveMax).toBe(true)
    const r2 = range('at least 5 kg')
    expect(r2.minBase).toBeCloseTo(5, 12)
    expect(r2.exclusiveMin).toBe(false)
    const r3 = range('> 5 kg')
    expect(r3.exclusiveMin).toBe(true)
  })

  it('parses ± tolerances', () => {
    const r = range('10 ± 0.5 mm')
    expect(r.plusMinus).toBeDefined()
    expect(r.minBase).toBeCloseTo(0.0095, 12)
    expect(r.maxBase).toBeCloseTo(0.0105, 12)
    const r2 = range('10 +/- 0.5 mm')
    expect(r2.maxBase).toBeCloseTo(0.0105, 12)
  })

  it('parses currency minor-unit ranges and explicit pence tolerances', () => {
    const tight = range('50p-£1')
    expect(tight.kind).toBe('currency')
    expect(tight.min()?.unit).toBe('GBP')
    expect(tight.min()?.value).toBeCloseTo(0.5, 12)
    expect(tight.max()?.value).toBeCloseTo(1, 12)

    const spoken = range('between 50p and £1')
    expect(spoken.min()?.value).toBeCloseTo(0.5, 12)
    expect(spoken.max()?.value).toBeCloseTo(1, 12)

    const penceTolerance = range('3 quid ± 50p')
    expect(penceTolerance.min()?.value).toBeCloseTo(2.5, 12)
    expect(penceTolerance.max()?.value).toBeCloseTo(3.5, 12)
    expect(penceTolerance.plusMinus?.deltaBase).toBeCloseTo(0.5, 12)

    const bareTolerance = range('3 quid ± 50')
    expect(bareTolerance.min()?.value).toBeCloseTo(-47, 12)
    expect(bareTolerance.max()?.value).toBeCloseTo(53, 12)
  })

  it('swaps reversed ranges with a warning', () => {
    const r = parseExpression('10-5 kg', opts())
    if (!r.ok || r.type !== 'range') {
      throw new Error('expected range')
    }
    expect(r.range.minBase).toBeCloseTo(5, 12)
    expect(r.issues.some((i) => i.code === 'RANGE_REVERSED')).toBe(true)
  })

  it('parses compound bounds', () => {
    const r = range(`5'10" - 6'2"`)
    expect(r.minBase).toBeCloseTo(5 * 0.3048 + 10 * 0.0254, 12)
    expect(r.maxBase).toBeCloseTo(6 * 0.3048 + 2 * 0.0254, 12)
  })

  it('turns fuzzy amounts into spreads', () => {
    const r = range('a few minutes')
    expect(r.minBase).toBeCloseTo(120, 9)
    expect(r.maxBase).toBeCloseTo(240, 9)
    expect(r.approximate).toBe(true)
  })

  it('parses fuzzy temperature words', () => {
    const r = range("it's hot", { kind: 'temperature' })
    expect(r.fuzzy?.term).toBe('hot')
    expect(r.minBase).toBeCloseTo(273.15 + 27, 9)
    const oven = range('hot', { kind: 'temperature', profile: 'oven' })
    expect(oven.minBase).toBeCloseTo(273.15 + 190, 9)
  })
})

describe('conversion requests', () => {
  it('converts explicit requests', () => {
    const r = parseExpression('72 in to cm', opts())
    if (!r.ok || r.type !== 'conversion') {
      throw new Error(`expected conversion, got ${JSON.stringify(r)}`)
    }
    const converted = r.converted as Quantity
    expect(converted.unit).toBe('cm')
    expect(converted.value).toBeCloseTo(182.88, 9)
  })

  it('handles the double-in case', () => {
    const r = parseExpression('2 in in cm', opts())
    if (!r.ok || r.type !== 'conversion') {
      throw new Error('expected conversion')
    }
    expect((r.converted as Quantity).value).toBeCloseTo(5.08, 9)
  })

  it('converts ranges', () => {
    const r = parseExpression('5-10 kg in lb', opts())
    if (!r.ok || r.type !== 'conversion') {
      throw new Error('expected conversion')
    }
    const range = r.converted as QuantityRange
    expect(range.min()!.value).toBeCloseTo(5 / 0.453_592_37, 9)
  })

  it('rejects cross-kind conversions', () => {
    const r = parseExpression('5 kg to cm', opts())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === 'CONVERSION_KIND_MISMATCH')).toBe(true)
    }
  })

  it('rejects rate-based conversions as parse issues, not thrown exceptions', () => {
    const r = parseExpression('5 EUR to USD', opts({ kind: 'currency' }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues[0]).toMatchObject({
        code: 'RATE_REQUIRED',
        data: { from: 'EUR', to: 'USD' },
        span: { start: 0, end: 12 },
      })
    }
  })

  it('parseQuantityExpr returns the converted target', () => {
    const r = parseQuantityExpr('72 in to cm', opts())
    if (!r.ok) {
      throw new Error('expected ok')
    }
    expect(r.quantity.unit).toBe('cm')
  })
})

describe('free-text extraction', () => {
  it('finds quantities and conversions with original-source spans', () => {
    const hits = findQuantities('Need 2 ft, 5 kg, and 72 in to cm before Friday.')
    expect(hits.map((hit) => hit.span)).toEqual([
      { start: 5, end: 9 },
      { start: 11, end: 15 },
      { start: 21, end: 32 },
    ])
    expect(hits.map((hit) => hit.result.type)).toEqual(['quantity', 'quantity', 'conversion'])
    expect(hits[2]!.result.text.slice(hits[2]!.span.start, hits[2]!.span.end)).toBe('72 in to cm')
  })
})

describe('errors', () => {
  it('reports empty input', () => {
    const r = parseExpression('   ', opts())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues[0]!.code).toBe('EMPTY')
    }
  })

  it('reports unknown units with suggestions', () => {
    const r = parseExpression('5 flurbs', opts({ kind: 'mass' }))
    expect(r.ok).toBe(false)
  })

  it('reports kind mismatch', () => {
    const r = parseExpression('5 kg', opts({ kind: 'length' }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === 'KIND_MISMATCH')).toBe(true)
    }
  })

  it('reports trailing garbage with span', () => {
    const r = parseExpression('5 kg and stuff', opts())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const t = r.issues.find((i) => i.code === 'TRAILING_INPUT')
      expect(t).toBeDefined()
      expect(t!.span).toBeDefined()
    }
  })

  it('rejects malformed superscript scientific exponents cleanly', () => {
    const r = parseExpression('1×10⁻ kg', opts())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const issue = r.issues.find((i) => i.code === 'NUMBER_FORMAT' || i.code === 'TRAILING_INPUT')
      expect(issue).toBeDefined()
      expect(issue!.span).toBeDefined()
    }
  })

  it('never returns NaN', () => {
    for (const input of ['NaN kg', 'Infinity m', '1e999 m', '- kg', '.', '/', '1/0 in']) {
      const r = parseExpression(input, opts())
      if (r.ok && (r.type === 'quantity' || r.type === 'number')) {
        const v = r.type === 'quantity' ? r.quantity.base : r.value
        expect(Number.isFinite(v), `${input} produced non-finite`).toBe(true)
      }
    }
  })
})

describe('formatting round-trips', () => {
  it('formats compounds with primes', () => {
    const q = qty(`5'11"`).quantity
    expect(q.format()).toBe('5′11″')
    expect(q.format({ style: 'long' })).toBe('5 feet 11 inches')
  })

  it('carries rounding in compounds', () => {
    const q = new Quantity(reg, 'length', 1.9999, 'ft')
    expect(q.format({ compound: true })).toBe('6′7″')
  })

  it('re-parses everything it formats', () => {
    const samples = [
      '2 ft',
      '1.5 kg',
      '20°C',
      '5-10 kg',
      'under 10 minutes',
      '10 ± 0.5 mm',
      `5'11"`,
      'minus 5 kg',
      'a quarter of a mile',
      'from 5 to 10 kg',
      '5 or 6 kg',
      'just under 2 hours',
      '5ish kg',
    ]
    for (const s of samples) {
      const r = parseExpression(s, opts())
      if (!r.ok) {
        throw new Error(`seed parse failed: ${s}`)
      }
      let text: string
      let baseValue: number
      if (r.type === 'quantity') {
        text = r.quantity.format()
        baseValue = r.quantity.base
      } else if (r.type === 'range') {
        text = r.range.format()
        baseValue = r.range.minBase ?? r.range.maxBase ?? 0
      } else {
        continue
      }
      const back = parseExpression(text, opts())
      if (!back.ok) {
        throw new Error(
          `round-trip parse failed: "${s}" → "${text}" → ${JSON.stringify(back.issues)}`,
        )
      }
      const backBase =
        back.type === 'quantity'
          ? back.quantity.base
          : back.type === 'range'
            ? (back.range.minBase ?? back.range.maxBase ?? 0)
            : Number.NaN
      expect(backBase, `"${s}" → "${text}"`).toBeCloseTo(baseValue, 6)
    }
  })

  it('re-parses every default quantity format path across locales', () => {
    const samples = [
      quantity(1, 'm'),
      quantity(2.5, 'kg'),
      quantity(20, 'C'),
      quantity(6.5, 'ft'),
      quantity(1.5, 'h'),
      quantity(5, 'Mbps'),
      quantity(5, 'gpm'),
      quantity(500, 'mV'),
      quantity(500, 'mA'),
      quantity(4.7, 'kΩ'),
      quantity(500, 'mAh'),
      quantity(250, 'mmol'),
    ]
    const styles = ['symbol', 'long', 'narrow'] as const
    const locales = [undefined, 'fr-FR', 'de-DE'] as const
    const compounds = [false, true] as const

    for (const q of samples) {
      for (const style of styles) {
        for (const locale of locales) {
          for (const compound of compounds) {
            const formatOpts: FormatOptions = { compound, style }
            if (locale) {
              formatOpts.locale = locale
            }
            const text = q.format(formatOpts)
            const back = parseQuantity(text)
            if (!back.ok) {
              throw new Error(
                `round-trip parse failed: ${JSON.stringify(formatOpts)} formatted "${text}" with ${JSON.stringify(back.issues)}`,
              )
            }
            expect(back.quantity.base, `"${text}" from ${JSON.stringify(formatOpts)}`).toBeCloseTo(
              q.base,
              6,
            )
          }
        }
      }
    }
  })

  it('keeps non-English long unit names parseable by default', () => {
    const text = quantity(1, 'm').format({ locale: 'fr-FR', style: 'long' })
    expect(text).toBe('1 meter')
    const back = parseQuantity(text)
    if (!back.ok) {
      throw new Error(`round-trip parse failed: "${text}" → ${JSON.stringify(back.issues)}`)
    }
    expect(back.quantity.base).toBeCloseTo(1, 12)
  })

  it('round-trips scientific and engineering notation formats', () => {
    const samples = [quantity(300_000, 'm'), quantity(0.000_25, 'm'), quantity(-0.000_25, 'm')]
    const notations = ['scientific', 'engineering'] as const
    const exponentStyles = ['e', 'times', 'superscript'] as const

    for (const q of samples) {
      for (const notation of notations) {
        for (const exponentStyle of exponentStyles) {
          const text = q.format({ notation, exponentStyle })
          const back = parseQuantity(text)
          if (!back.ok) {
            throw new Error(
              `round-trip parse failed: ${JSON.stringify({ notation, exponentStyle })} formatted "${text}" with ${JSON.stringify(back.issues)}`,
            )
          }
          expect(back.quantity.base, `"${text}"`).toBeCloseTo(q.base, 12)
        }
      }
    }

    expect(quantity(300_000, 'm').format({ notation: 'scientific' })).toBe('3e5 m')
    expect(quantity(300_000, 'm').format({ notation: 'engineering', exponentStyle: 'times' })).toBe(
      '300×10^3 m',
    )
    expect(
      quantity(0.000_003, 'm').format({
        notation: 'scientific',
        exponentStyle: 'superscript',
      }),
    ).toBe('3×10⁻⁶ m')
  })

  it('formats bare range bounds with scientific notation', () => {
    const r = parseExpression('300000-400000 m', opts())
    if (!r.ok || r.type !== 'range') {
      throw new Error(`expected range, got ${JSON.stringify(r)}`)
    }
    const text = r.range.format({ notation: 'scientific' })
    expect(text).toBe('3e5–4e5 m')
    const back = parseExpression(text, opts())
    if (!back.ok || back.type !== 'range') {
      throw new Error(`round-trip parse failed: "${text}"`)
    }
    expect(back.range.minBase).toBeCloseTo(r.range.minBase!, 6)
    expect(back.range.maxBase).toBeCloseTo(r.range.maxBase!, 6)
  })

  it('can opt into display-only localized unit words', () => {
    expect(quantity(1, 'm').format({ locale: 'fr-FR', localizedUnits: true, style: 'long' })).toBe(
      '1 mètre',
    )
  })

  it('picks best units', () => {
    const q = new Quantity(reg, 'length', 1500, 'm')
    expect(q.toBest().unit).toBe('km')
    expect(q.toBest().value).toBeCloseTo(1.5, 12)
    const small = new Quantity(reg, 'length', 0.002, 'm')
    expect(small.toBest().unit).toBe('mm')
  })
})
