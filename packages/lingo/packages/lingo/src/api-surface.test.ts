import { describe, expect, it } from 'vitest'
import { Quantity, type QuantityJSON, QuantityRange, type QuantityRangeJSON } from './core/quantity'
import { describeResource } from './describe/index'
import {
  defaultRegistry,
  defineFuzzyVocab,
  describeTemperature,
  fromJSON,
  lingo,
  parseRange,
  partialState,
  quantity,
  registerKind,
  registerUnits,
  temperatureVocabs,
} from './index'

// Direct coverage for main-entry exports that were only exercised indirectly
// (through the DOM layer or docs examples). Registry mutations use throwaway
// kind/unit ids so they can't collide with real kinds or each other; vitest
// per-file isolation keeps them out of other suites.

describe('LingoResult JSON envelope', () => {
  it('marks successful parse results with a schema version', () => {
    const r = lingo('72 in')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    // v3 is FLAT (no nested `quantity` wrapper) and the span carries its text.
    expect(JSON.parse(JSON.stringify(r))).toEqual({
      schemaVersion: 3,
      ok: true,
      type: 'quantity',
      kind: 'length',
      value: 72,
      unit: 'in',
      base: 1.8288,
      baseUnit: 'm',
      text: '72 in',
      span: { start: 0, end: 5, text: '72 in' },
      issues: [],
      confidence: 1,
    })
  })

  it('serializes quantity alternatives with a discriminator', () => {
    const r = lingo('1,234 kg')
    expect(r.ok && r.type === 'quantity').toBe(true)
    if (!(r.ok && r.type === 'quantity')) {
      return
    }
    expect(JSON.parse(JSON.stringify(r.alternatives?.[0]))).toMatchObject({
      type: 'quantity',
      reason: 'AMBIGUOUS_NUMBER',
      confidence: 0.4,
      quantity: {
        schemaVersion: 3,
        type: 'quantity',
        kind: 'mass',
        value: 1.234,
        unit: 'kg',
        base: 1.234,
        baseUnit: 'kg',
      },
    })
  })

  it('marks failures and confirm candidates with the same schema version', () => {
    const r = lingo('5 meterz', { kind: 'length', strictness: 'confirm' })
    expect(r.ok).toBe(false)
    if (r.ok) {
      return
    }
    // Failures are flat v3; the candidate is a flat serialized result too.
    expect(JSON.parse(JSON.stringify(r))).toMatchObject({
      schemaVersion: 3,
      ok: false,
      type: 'failure',
      candidate: {
        schemaVersion: 3,
        ok: true,
        type: 'quantity',
        kind: 'length',
        value: 5,
        unit: 'm',
        base: 5,
        baseUnit: 'm',
      },
    })
  })

  it('keeps toJSON ENUMERABLE so JavaScriptCore/Bun/Safari honor it', () => {
    // JSC's JSON.stringify fast path SKIPS a NON-enumerable toJSON on
    // primitive-only objects (number/failure results), silently emitting the raw
    // runtime shape (no span.text, unflattened). Guard against a regression to
    // non-enumerable — this structural check fails on Node too.
    for (const input of ['72', '5 kg', '5 meterz']) {
      const r = lingo(input, { kind: input.includes('meterz') ? 'length' : undefined })
      const descriptor = Object.getOwnPropertyDescriptor(r, 'toJSON')
      expect(descriptor?.enumerable, `${input}: toJSON must be enumerable`).toBe(true)
      // And the serialized form always equals toJSON() (belt and suspenders).
      expect(JSON.stringify(r)).toBe(JSON.stringify(r.toJSON?.()))
    }
  })

  it('preserves ranked alternatives in the wire JSON (no data loss)', () => {
    const wire = JSON.parse(JSON.stringify(lingo('1,234 kg')))
    expect(wire.alternatives).toEqual([
      {
        type: 'quantity',
        reason: 'AMBIGUOUS_NUMBER',
        confidence: 0.4,
        quantity: {
          schemaVersion: 3,
          type: 'quantity',
          kind: 'mass',
          value: 1.234,
          unit: 'kg',
          base: 1.234,
          baseUnit: 'kg',
        },
      },
    ])
  })
})

describe('describeResource() value resource view', () => {
  it('describes currency as self-canonical when no rates are involved', () => {
    expect(describeResource(quantity(5, 'EUR'))).toMatchObject({
      object: 'lingo.quantity',
      kind: 'currency',
      value: { amount: 5, unit: { id: 'EUR', symbol: '€', name: 'euro', plural: 'euros' } },
      canonical: { amount: 5, unit: { id: 'EUR', symbol: '€', name: 'euro' } },
      formatted: '€5.00',
    })
  })

  it('describes plus-minus ranges without losing delta semantics', () => {
    const result = parseRange('10 ± 0.5 mm')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(describeResource(result.range)).toMatchObject({
      object: 'lingo.range',
      kind: 'length',
      canonicalUnit: { id: 'm', symbol: 'm', name: 'meter' },
      formatted: '10 ± 0.5 mm',
      plusMinus: {
        center: {
          value: { amount: 10, unit: { id: 'mm', symbol: 'mm', name: 'millimeter' } },
          canonical: { amount: 0.01, unit: { id: 'm', symbol: 'm', name: 'meter' } },
        },
        delta: {
          value: { amount: 0.5, unit: { id: 'mm', symbol: 'mm', name: 'millimeter' } },
          canonical: { amount: 0.0005, unit: { id: 'm', symbol: 'm', name: 'meter' } },
        },
      },
    })
  })

  it('describes a standalone Quantity with resource object names and grouped amounts', () => {
    expect(describeResource(quantity(72, 'in'))).toEqual({
      object: 'lingo.quantity',
      kind: 'length',
      value: {
        amount: 72,
        unit: {
          id: 'in',
          symbol: 'in',
          name: 'inch',
          plural: 'inches',
          system: 'imperial',
        },
      },
      canonical: {
        amount: 1.8288,
        unit: {
          id: 'm',
          symbol: 'm',
          name: 'meter',
          system: 'metric',
        },
      },
      formatted: '72 in',
    })
  })

  it('describes a standalone range with canonicalUnit and grouped bound amounts', () => {
    const under = parseRange('under 10 kg')
    expect(under.ok).toBe(true)
    if (!under.ok) {
      return
    }

    expect(describeResource(under.range)).toMatchObject({
      object: 'lingo.range',
      kind: 'mass',
      canonicalUnit: { id: 'kg', symbol: 'kg', name: 'kilogram' },
      formatted: '< 10 kg',
      max: {
        value: { amount: 10, unit: { id: 'kg', symbol: 'kg', name: 'kilogram' } },
        canonical: { amount: 10, unit: { id: 'kg', symbol: 'kg', name: 'kilogram' } },
        exclusive: true,
      },
    })
  })

  it('throws a clear, pointed error when handed a non-value (e.g. a parse result)', () => {
    // JS callers and LLM tool output bypass the compile-time guard; the runtime
    // must not surface a cryptic `toJSON is not a function`.
    expect(() => describeResource({ type: 'duration', ok: true } as never)).toThrow(
      /use describeResult\(\) instead/,
    )
  })
})

describe('toJSON / fromJSON round-trips (api-design rule 6)', () => {
  const massQuantityJSON = {
    schemaVersion: 3,
    type: 'quantity',
    kind: 'mass',
    value: 5,
    unit: 'kg',
    base: 5,
    baseUnit: 'kg',
  } satisfies QuantityJSON

  const massRangeJSON = {
    schemaVersion: 3,
    type: 'range',
    kind: 'mass',
    baseUnit: 'kg',
    min: { value: 5, unit: 'kg', base: 5 },
    max: { value: 10, unit: 'kg', base: 10 },
  } satisfies QuantityRangeJSON

  const lengthPlusMinusJSON = {
    schemaVersion: 3,
    type: 'range',
    kind: 'length',
    baseUnit: 'm',
    plusMinus: {
      center: { value: 10, unit: 'mm', base: 0.01 },
      delta: { value: 0.5, unit: 'mm', base: 0.0005 },
    },
  } satisfies QuantityRangeJSON

  it('serializes Quantity JSON with display and base units', () => {
    expect(quantity(72, 'in').toJSON()).toEqual({
      schemaVersion: 3,
      type: 'quantity',
      kind: 'length',
      value: 72,
      unit: 'in',
      base: 1.8288,
      baseUnit: 'm',
    })
  })

  it('rehydrates a Quantity to the same base, unit, and kind', () => {
    const q = quantity(1500, 'm')
    const back = fromJSON(q.toJSON())
    expect(back.base).toBe(q.base)
    expect(back.unit).toBe(q.unit)
    expect(back.kind).toBe(q.kind)
    expect(back.to('km').value).toBe(1.5)
  })

  it('rehydrates Quantity from base even when value is stale', () => {
    const back = Quantity.fromJSON(defaultRegistry, { ...massQuantityJSON, value: 999 })
    expect(back.base).toBe(5)
    expect(back.value).toBe(5)
  })

  it('rejects unsupported Quantity schema versions', () => {
    expect(() =>
      Quantity.fromJSON(defaultRegistry, {
        ...massQuantityJSON,
        schemaVersion: 1,
      } as unknown as QuantityJSON),
    ).toThrow('lingo: unsupported schemaVersion 1')
  })

  it('rejects Quantity JSON with the wrong baseUnit', () => {
    expect(() =>
      Quantity.fromJSON(defaultRegistry, { ...massQuantityJSON, baseUnit: 'g' }),
    ).toThrow('lingo: baseUnit "g" is not the base unit of kind "mass"')
  })

  it('rejects non-finite Quantity base values on rehydration', () => {
    expect(() =>
      Quantity.fromJSON(defaultRegistry, {
        ...massQuantityJSON,
        base: Number.POSITIVE_INFINITY,
      }),
    ).toThrow('lingo: base must be a finite number')

    expect(() =>
      Quantity.fromJSON(defaultRegistry, {
        ...massQuantityJSON,
        value: Number.NaN,
      }),
    ).toThrow('lingo: value must be a finite number')

    expect(
      Quantity.fromJSON(defaultRegistry, {
        ...massQuantityJSON,
      }).base,
    ).toBe(5)
  })

  it('rehydrates a QuantityRange to the same bounds', () => {
    const r = lingo('between 5 and 10 kg')
    expect(r.ok && r.type === 'range').toBe(true)
    if (!(r.ok && r.type === 'range')) {
      return
    }
    const back = fromJSON(r.range.toJSON())
    expect(back.minBase).toBe(r.range.minBase)
    expect(back.maxBase).toBe(r.range.maxBase)
  })

  it('serializes plus-minus ranges with display values and canonical bases', () => {
    const r = parseRange('10 ± 0.5 mm')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    const json = r.range.toJSON()
    expect(json.baseUnit).toBe('m')
    expect(json.plusMinus?.center.value).toBe(10)
    expect(json.plusMinus?.center.base).toBe(0.01)
    expect(json.plusMinus?.delta.value).toBe(0.5)
    expect(json.plusMinus?.delta.base).toBe(0.0005)
  })

  it('rehydrates QuantityRange from base even when bound values are stale', () => {
    const back = QuantityRange.fromJSON(defaultRegistry, {
      ...massRangeJSON,
      min: { ...massRangeJSON.min, value: 999 },
      max: { ...massRangeJSON.max, value: -1 },
    })
    expect(back.minBase).toBe(5)
    expect(back.maxBase).toBe(10)
    expect(back.min()?.value).toBe(5)
  })

  it('rejects unsupported QuantityRange schema versions', () => {
    expect(() =>
      QuantityRange.fromJSON(defaultRegistry, {
        ...massRangeJSON,
        schemaVersion: 1,
      } as unknown as QuantityRangeJSON),
    ).toThrow('lingo: unsupported schemaVersion 1')
  })

  it('rejects QuantityRange JSON with the wrong baseUnit', () => {
    expect(() =>
      QuantityRange.fromJSON(defaultRegistry, { ...massRangeJSON, baseUnit: 'g' }),
    ).toThrow('lingo: baseUnit "g" is not the base unit of kind "mass"')
  })

  it('rejects reversed QuantityRange bounds on rehydration', () => {
    expect(() =>
      QuantityRange.fromJSON(defaultRegistry, {
        ...massRangeJSON,
        min: { value: 10, unit: 'kg', base: 10 },
        max: { value: 5, unit: 'kg', base: 5 },
      }),
    ).toThrow('lingo: range min exceeds max')
  })

  it('rejects non-finite QuantityRange base values on rehydration', () => {
    expect(() =>
      QuantityRange.fromJSON(defaultRegistry, {
        ...massRangeJSON,
        max: { ...massRangeJSON.max, base: Number.POSITIVE_INFINITY },
      }),
    ).toThrow('lingo: max.base must be a finite number')

    expect(() =>
      QuantityRange.fromJSON(defaultRegistry, {
        ...massRangeJSON,
        min: { ...massRangeJSON.min, value: Number.NaN },
      }),
    ).toThrow('lingo: min.value must be a finite number')

    expect(() =>
      QuantityRange.fromJSON(defaultRegistry, {
        ...lengthPlusMinusJSON,
        plusMinus: {
          ...lengthPlusMinusJSON.plusMinus,
          center: { ...lengthPlusMinusJSON.plusMinus.center, value: Number.POSITIVE_INFINITY },
        },
      }),
    ).toThrow('lingo: plusMinus.center.value must be a finite number')

    expect(() =>
      QuantityRange.fromJSON(defaultRegistry, {
        ...lengthPlusMinusJSON,
        plusMinus: {
          ...lengthPlusMinusJSON.plusMinus,
          delta: { ...lengthPlusMinusJSON.plusMinus.delta, base: Number.NaN },
        },
      }),
    ).toThrow('lingo: plusMinus.delta.base must be a finite number')
  })
})

describe('partialState — the as-you-type quad-state (never yells mid-typing)', () => {
  it('classifies the empty / incomplete / valid / invalid quartet', () => {
    expect(partialState('')).toBe('empty')
    // A valid prefix mid-typing is incomplete, never invalid.
    expect(partialState('2 f', { kind: 'length' })).toBe('incomplete')
    expect(partialState('2 ft', { kind: 'length' })).toBe('valid')
    expect(partialState('banana', { kind: 'length' })).toBe('invalid')
  })
})

describe('extension points (mutate the default registry)', () => {
  it('registerKind adds a custom kind that converts and formats', () => {
    registerKind({
      kind: 'test-score',
      baseUnit: 'point',
      units: [{ id: 'point', symbol: 'pt', name: 'point', factor: 1, system: 'shared' }],
    })
    const r = lingo('5 pt', { kind: 'test-score' })
    expect(r.ok && r.type === 'quantity' && r.quantity.base).toBe(5)
  })

  it('registerUnits extends an existing custom kind', () => {
    registerUnits('test-score', [
      { id: 'kpoint', symbol: 'kpt', name: 'kilopoint', factor: 1000, system: 'shared' },
    ])
    const r = lingo('2 kpt', { kind: 'test-score' })
    expect(r.ok && r.type === 'quantity' && r.quantity.base).toBe(2000)
  })

  it('defineFuzzyVocab registers domain fuzzy bands', () => {
    registerKind({
      kind: 'test-parcel',
      baseUnit: 'kilogram',
      units: [{ id: 'kilogram', symbol: 'kg', name: 'kilogram', factor: 1, system: 'metric' }],
    })
    defineFuzzyVocab('test-parcel', {
      profile: 'parcels',
      unit: 'kilogram',
      terms: { light: [0, 5], heavy: [20, 70] },
    })
    const r = lingo('heavy', { kind: 'test-parcel', profile: 'parcels' })
    expect(r.ok && r.type === 'range').toBe(true)
    if (r.ok && r.type === 'range') {
      expect(r.range.minBase).toBe(20)
      expect(r.range.maxBase).toBe(70)
    }
  })
})

describe('temperature fuzzy vocabulary (reverse of parse)', () => {
  it('describeTemperature names a band on a profile', () => {
    expect(describeTemperature(quantity(303.15, 'K'), { profile: 'weather' })).toBe('hot')
  })

  it('ships the three built-in profiles', () => {
    expect(temperatureVocabs.map((v) => v.profile).sort()).toEqual(['oven', 'water', 'weather'])
  })
})
