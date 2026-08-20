import { describe, expect, it } from 'vitest'
import {
  canonicalizeValues,
  dateField,
  dateRangeField,
  type LingoField,
  lingoObject,
  quantityField,
  rangeField,
  repairTextWith,
  type StandardJSONSchemaV1,
  type StandardSchemaV1,
} from './index'

type AssertAssignable<T extends StandardSchemaV1<unknown, number>> = T
type _FieldObjectAssignableToStandardSchema = AssertAssignable<LingoField<number>>
type AssertJsonAssignable<T extends StandardJSONSchemaV1<unknown, number>> = T
type _FieldObjectAssignableToStandardJsonSchema = AssertJsonAssignable<LingoField<number>>

const NOW = new Date(2026, 6, 3, 14, 30, 0)

describe('AI Standard Schema fields', () => {
  it('returns Standard Schema success and failure result shapes', () => {
    const field = quantityField({ kind: 'length', unit: 'm' })

    const success = field['~standard'].validate('2 m')
    expect('value' in success ? success.value : Number.NaN).toBe(2)
    expect('issues' in success ? success.issues : undefined).toBeUndefined()

    const failure = field.safeParse('banana')
    if ('value' in failure) {
      throw new Error('expected Standard Schema failure')
    }
    expect(failure.issues[0]?.message).toContain('[NO_VALUE]')
    expect(failure.issues[0]).toMatchObject({
      code: 'NO_VALUE',
      severity: 'error',
      span: { start: 0, end: 6 },
      data: { example: '"5 m"' },
    })
    expect(() => field.parse('banana')).toThrow('[NO_VALUE]')
  })

  it('accepts string and number inputs and surfaces the assumed unit as a warning', () => {
    const field = quantityField({ kind: 'length', unit: 'cm' })

    expect(field.parse('72')).toBe(72)
    expect(field.parse(72)).toBe(72)

    const result = field.safeParse(72)
    if (!('value' in result)) {
      throw new Error('expected success')
    }
    expect(result.warnings?.map((warning) => warning.code)).toContain('UNIT_ASSUMED')
  })

  it('converts quantity output into the requested unit', () => {
    const field = quantityField({ kind: 'mass', unit: 'kg' })

    expect(field.parse('2 lbs')).toBeCloseTo(0.907_184_74, 10)
  })

  it('keeps missing currency rates as structured field issues', () => {
    const field = quantityField({ kind: 'currency', unit: 'EUR' })
    const result = field.safeParse('50p')
    if ('value' in result) {
      throw new Error('expected RATE_REQUIRED failure')
    }
    expect(result.issues[0]).toMatchObject({
      message: expect.stringContaining('[RATE_REQUIRED]'),
      code: 'RATE_REQUIRED',
      severity: 'error',
      span: { start: 0, end: 3 },
      data: { from: 'GBP', to: 'EUR' },
    })

    const range = rangeField({ kind: 'currency', unit: 'EUR' }).safeParse('50p-£1')
    if ('value' in range) {
      throw new Error('expected range RATE_REQUIRED failure')
    }
    expect(range.issues[0]).toMatchObject({
      code: 'RATE_REQUIRED',
      data: { from: 'GBP', to: 'EUR' },
    })
  })

  it('emits float-safe canonical numbers', () => {
    const field = quantityField({ kind: 'mass', unit: 'kg' })

    // 3 × 0.45359237 accumulates float noise (1.3607771100000001) without cleanup.
    expect(field.parse('3 lbs')).toBe(1.360_777_11)
  })

  it('returns Quantity JSON when requested', () => {
    const field = quantityField({ kind: 'length', unit: 'm', output: 'quantity' })

    expect(field.parse(`5'11"`)).toEqual({
      schemaVersion: 3,
      type: 'quantity',
      kind: 'length',
      value: 1.8034,
      unit: 'm',
      base: 1.8034,
      baseUnit: 'm',
    })
  })

  it('fails ambiguous separators by default with a machine-actionable candidate', () => {
    const field = quantityField({ kind: 'mass', unit: 'kg' })
    const result = field.safeParse('1,234 kg')
    if ('value' in result) {
      throw new Error('expected AMBIGUOUS_NUMBER failure')
    }

    expect(result.issues[0]).toMatchObject({
      message: expect.stringContaining('[AMBIGUOUS_NUMBER]'),
      code: 'AMBIGUOUS_NUMBER',
      severity: 'error',
      span: { start: 0, end: 5 },
      data: { text: '1,234', a: '1234', b: '1.234' },
      candidate: '1234 kg',
    })
    expect(result.issues[0]?.message).toContain('Did you mean')
  })

  it('lets callers downgrade the ambiguity default back to a warning', () => {
    const field = quantityField({
      kind: 'mass',
      unit: 'kg',
      escalate: { AMBIGUOUS_NUMBER: 'warning' },
    })
    const result = field.safeParse('1,234 kg')
    if (!('value' in result)) {
      throw new Error('expected success')
    }

    expect(result.value).toBe(1234)
    expect(result.warnings?.map((warning) => warning.code)).toContain('AMBIGUOUS_NUMBER')
  })

  it('surfaces benign forgiveness (typo fixes) as warnings on success', () => {
    const field = quantityField({ kind: 'length', unit: 'm' })
    const result = field.safeParse('5 meterz')
    if (!('value' in result)) {
      throw new Error('expected success')
    }

    expect(result.value).toBe(5)
    expect(result.warnings?.[0]?.code).toBe('TYPO_CORRECTED')
    expect(result.warnings?.[0]?.message).toContain('meterz')
    expect(result.warnings?.[0]).toMatchObject({
      severity: 'warning',
      span: { start: 2, end: 8 },
      data: { unit: 'meterz', corrected: 'm' },
    })
  })

  it('keeps confirm-mode candidates as failures and mentions the suggestion', () => {
    const field = quantityField({ kind: 'length', unit: 'm', strictness: 'confirm' })
    const result = field.safeParse('5 meterz')
    if ('value' in result) {
      throw new Error('expected Standard Schema failure')
    }

    expect(result.issues[0]).toMatchObject({
      code: 'TYPO_CORRECTED',
      severity: 'error',
      span: { start: 2, end: 8 },
      data: { unit: 'meterz', corrected: 'm' },
      candidate: '5 m',
    })
    expect(result.issues[0]?.message).toContain('[TYPO_CORRECTED]')
    expect(result.issues[0]?.message).toContain('Did you mean 5 m?')
  })

  it('enforces min/max bounds in the field unit', () => {
    const field = quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 500 })

    const low = field.safeParse('-5 kg')
    if ('value' in low) {
      throw new Error('expected RANGE_MIN failure')
    }
    expect(low.issues[0]).toMatchObject({
      message: expect.stringContaining('[RANGE_MIN]'),
      code: 'RANGE_MIN',
      severity: 'error',
      data: { min: '0 kg' },
    })

    const high = field.safeParse('2000000 kg')
    if ('value' in high) {
      throw new Error('expected RANGE_MAX failure')
    }
    expect(high.issues[0]).toMatchObject({
      message: expect.stringContaining('[RANGE_MAX]'),
      code: 'RANGE_MAX',
      severity: 'error',
      data: { max: '500 kg' },
    })

    expect(field.parse('80 kg')).toBe(80)
  })

  it('advertises bounds in both JSON Schema halves', () => {
    const field = quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 500 })

    const input = field['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    expect(String(input.description)).toContain('Accepted values: 0 to 500 kg.')

    const output = field['~standard'].jsonSchema.output({ target: 'draft-2020-12' })
    expect(output).toMatchObject({ type: 'number', minimum: 0, maximum: 500 })
  })

  it('uses concentration examples in quantity field descriptions', () => {
    const field = quantityField({ kind: 'concentration', unit: 'μM' })
    const input = field['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    expect(String(input.description)).toContain('"1 M" or "250 μM"')
  })

  it('uses specific examples for advanced scientific quantity fields', () => {
    const cases: Array<[kind: string, unit: string, expected: string]> = [
      ['acceleration', 'm/s2', '"9.8 m/s²" or "2 gees"'],
      ['torque', 'N*m', '"10 Nm" or "80 lb-ft"'],
      ['illuminance', 'lx', '"500 lux" or "50 foot-candles"'],
      ['luminance', 'cd/m2', '"100 nits" or "300 cd/m²"'],
      ['radiation_absorbed_dose', 'Gy', '"2 Gy" or "500 mGy"'],
      ['radiation_equivalent_dose', 'Sv', '"20 mSv" or "2 rem"'],
      ['radioactivity', 'Bq', '"100 Bq" or "5 MBq"'],
    ]

    for (const [kind, unit, expected] of cases) {
      const field = quantityField({ kind, unit })
      const input = field['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
      expect(String(input.description)).toContain(expected)
    }
  })

  it('canonicalizes ranges into min and max in the requested unit', () => {
    const field = rangeField({ kind: 'mass', unit: 'kg' })
    const range = field.parse('2-4 lbs')

    expect(range.min).toBeCloseTo(0.907_184_74, 10)
    expect(range.max).toBeCloseTo(1.814_369_48, 10)
  })

  it('can preserve range semantics as self-describing JSON', () => {
    const field = rangeField({ kind: 'duration', unit: 'min', output: 'range' })
    const range = field.parse('under 10 minutes')

    expect(range).toEqual({
      schemaVersion: 3,
      type: 'range',
      kind: 'duration',
      baseUnit: 's',
      max: { value: 10, unit: 'min', base: 600, exclusive: true },
    })
  })

  it('rejects open-ended input for numeric range output with a structured issue', () => {
    const field = rangeField({ kind: 'duration', unit: 'min' })
    const result = field.safeParse('under 10 minutes')
    if ('value' in result) {
      throw new Error('expected RANGE_OPEN_BOUND_NOT_ALLOWED failure')
    }

    expect(result.issues[0]).toMatchObject({
      message: expect.stringContaining('[RANGE_OPEN_BOUND_NOT_ALLOWED]'),
      code: 'RANGE_OPEN_BOUND_NOT_ALLOWED',
      severity: 'error',
      span: { start: 0, end: 16 },
      data: { missing: 'min' },
    })
  })

  it('applies bounds to both range ends', () => {
    const field = rangeField({ kind: 'mass', unit: 'kg', min: 0, max: 30 })

    const result = field.safeParse('20-45 kg')
    if ('value' in result) {
      throw new Error('expected RANGE_MAX failure')
    }
    expect(result.issues[0]).toMatchObject({
      message: expect.stringContaining('[RANGE_MAX]'),
      code: 'RANGE_MAX',
      severity: 'error',
      data: { max: '30 kg' },
    })
  })

  it('canonicalizes dates to ISO with an injected deterministic now', () => {
    const field = dateField({ now: NOW })

    expect(field.parse('tomorrow')).toBe(new Date(2026, 6, 4).toISOString())
  })

  it('requires an explicit now for reference-dependent dates by default', () => {
    const field = dateField()

    for (const input of ['tomorrow', 'March 5', 'at 3pm']) {
      const result = field.safeParse(input)
      if ('value' in result) {
        throw new Error(`expected NOW_REQUIRED failure for ${input}`)
      }
      expect(result.issues[0]).toMatchObject({
        message: expect.stringContaining('[NOW_REQUIRED]'),
        code: 'NOW_REQUIRED',
        severity: 'error',
        span: { start: 0, end: input.length },
      })
      expect(result.issues[0]).not.toHaveProperty('candidate')
    }

    // Fully absolute dates never need a reference time.
    const absolute = field.safeParse('2026-08-01')
    expect('value' in absolute).toBe(true)

    // Opt out restores wall-clock resolution.
    const optOut = dateField({ requireNow: false }).safeParse('tomorrow')
    expect('value' in optOut).toBe(true)
  })

  it('fails ignored timezones by default and honors downgrades', () => {
    const field = dateField({ now: NOW })
    const result = field.safeParse('3pm EST')
    if ('value' in result) {
      throw new Error('expected TZ_IGNORED failure')
    }
    expect(result.issues[0]).toMatchObject({
      message: expect.stringContaining('[TZ_IGNORED]'),
      code: 'TZ_IGNORED',
      severity: 'error',
      span: { start: 4, end: 7 },
      data: { tz: 'EST' },
    })

    const downgraded = dateField({ now: NOW, escalate: { TZ_IGNORED: 'warning' } }).safeParse(
      '3pm EST',
    )
    if (!('value' in downgraded)) {
      throw new Error('expected success after downgrade')
    }
    expect(downgraded.warnings?.map((warning) => warning.code)).toContain('TZ_IGNORED')
  })

  it('canonicalizes a time slot to ISO start/end endpoints', () => {
    // A morning reference so afternoon slots stay on the same civil day.
    const morning = new Date(2026, 6, 3, 9, 0, 0)
    const slot = dateRangeField({ now: morning })
    expect(slot.parse('2pm to 4pm')).toEqual({
      start: new Date(2026, 6, 3, 14).toISOString(),
      end: new Date(2026, 6, 3, 16).toISOString(),
    })
    // Open-ended slots drop the missing endpoint.
    expect(slot.parse('from 3pm')).toEqual({ start: new Date(2026, 6, 3, 15).toISOString() })
    expect(slot.parse('until 5pm')).toEqual({ end: new Date(2026, 6, 3, 17).toISOString() })
  })

  it('requires an explicit now for a reference-dependent slot', () => {
    const result = dateRangeField().safeParse('2pm to 4pm')
    if ('value' in result) {
      throw new Error('expected NOW_REQUIRED failure')
    }
    expect(result.issues[0]).toMatchObject({ code: 'NOW_REQUIRED', severity: 'error' })
  })

  it('fails an ignored timezone on a slot endpoint by default', () => {
    const morning = new Date(2026, 6, 3, 9, 0, 0)
    const failing = dateRangeField({ now: morning }).safeParse('2pm to 4pm EST')
    if ('value' in failing) {
      throw new Error('expected TZ_IGNORED failure')
    }
    expect(failing.issues.map((i) => i.code)).toContain('TZ_IGNORED')

    // applyZone resolves the real instant; 4pm EST (−05:00) → 21:00Z.
    const applied = dateRangeField({ now: morning, applyZone: true }).safeParse('2pm to 4pm EST')
    if (!('value' in applied)) {
      throw new Error('expected success with applyZone')
    }
    expect(applied.value.end).toBe('2026-07-03T21:00:00.000Z')
  })

  it('enforces date bounds', () => {
    const field = dateField({
      now: NOW,
      min: new Date(2026, 6, 1),
      max: '2026-07-31T23:59:59.000Z',
    })

    expect('value' in field.safeParse('July 15 2026')).toBe(true)

    const early = field.safeParse('June 1 2026')
    if ('value' in early) {
      throw new Error('expected RANGE_MIN failure')
    }
    expect(early.issues[0]).toMatchObject({
      message: expect.stringContaining('[RANGE_MIN]'),
      code: 'RANGE_MIN',
      severity: 'error',
      data: { min: expect.any(String) },
    })

    const late = field.safeParse('December 1 2026')
    if ('value' in late) {
      throw new Error('expected RANGE_MAX failure')
    }
    expect(late.issues[0]).toMatchObject({
      message: expect.stringContaining('[RANGE_MAX]'),
      code: 'RANGE_MAX',
      severity: 'error',
      data: { max: expect.any(String) },
    })
  })

  it('exposes Standard JSON Schema input and output shapes for fields', () => {
    const quantity = quantityField({ kind: 'length', unit: 'm' })
    const quantityInput = quantity['~standard'].jsonSchema.input({ target: 'draft-07' })
    expect(quantityInput).toMatchObject({ type: 'string' })
    expect(quantityInput.description).toEqual(expect.stringContaining('length'))
    expect(quantity['~standard'].jsonSchema.output({ target: 'draft-07' })).toEqual({
      type: 'number',
    })
    const throughput = quantityField({ kind: 'data_rate', unit: 'Mbit/s' })
    const throughputInput = throughput['~standard'].jsonSchema.input({ target: 'draft-07' })
    expect(throughputInput.description).toEqual(expect.stringContaining('5 Mbps'))
    expect(throughputInput.description).toEqual(expect.stringContaining('20 MB/s'))
    const flow = quantityField({ kind: 'flow_rate', unit: 'l/min' })
    const flowInput = flow['~standard'].jsonSchema.input({ target: 'draft-07' })
    expect(flowInput.description).toEqual(expect.stringContaining('5 gpm'))
    expect(flowInput.description).toEqual(expect.stringContaining('250 mL/min'))

    const range = rangeField({ kind: 'mass', unit: 'kg' })
    expect(range['~standard'].jsonSchema.input({ target: 'draft-07' })).toMatchObject({
      type: 'string',
      description: expect.stringContaining('range'),
    })
    expect(range['~standard'].jsonSchema.output({ target: 'draft-07' })).toMatchObject({
      type: 'object',
      properties: {
        min: { type: 'number' },
        max: { type: 'number' },
      },
      required: ['min', 'max'],
    })

    const richRange = rangeField({ kind: 'mass', unit: 'kg', output: 'range' })
    expect(richRange['~standard'].jsonSchema.output({ target: 'draft-07' })).toMatchObject({
      type: 'object',
      properties: {
        schemaVersion: { type: 'number', enum: [3] },
        type: { type: 'string', enum: ['range'] },
        kind: { type: 'string' },
        baseUnit: { type: 'string' },
        min: {
          type: 'object',
          properties: {
            value: { type: 'number' },
            unit: { type: 'string' },
            base: { type: 'number' },
            exclusive: { type: 'boolean' },
          },
          required: ['value', 'unit', 'base'],
          additionalProperties: false,
        },
      },
      required: ['schemaVersion', 'type', 'kind', 'baseUnit'],
      additionalProperties: false,
    })

    const date = dateField({ now: NOW })
    expect(date['~standard'].jsonSchema.input({ target: 'draft-07' })).toMatchObject({
      type: 'string',
      description: expect.stringContaining('date'),
    })
    expect(date['~standard'].jsonSchema.output({ target: 'draft-07' })).toMatchObject({
      type: 'string',
      format: 'date-time',
    })
  })

  it('canonicalizes nested object paths with array wildcards, warnings, and full issue paths', () => {
    const result = canonicalizeValues(
      {
        shipment: {
          total: '2 lbs',
          eta: 'tomorrow',
          items: [
            { name: 'flour', weight: '1 lb' },
            { name: 'sugar', weight: 'banana' },
          ],
        },
      },
      {
        'shipment.total': { kind: 'mass', unit: 'kg' },
        'shipment.eta': dateField({ now: NOW }),
        'shipment.items[].weight': quantityField({ kind: 'mass', unit: 'kg' }),
      },
    )

    const value = result.value as unknown as {
      shipment: {
        total: number
        eta: string
        items: Array<{ weight: number | string }>
      }
    }
    expect(value.shipment.total).toBeCloseTo(0.907_184_74, 10)
    expect(value.shipment.eta).toBe(new Date(2026, 6, 4).toISOString())
    expect(value.shipment.items[0]?.weight).toBeCloseTo(0.453_592_37, 10)
    expect(value.shipment.items[1]?.weight).toBe('banana')
    expect(result.issues).toEqual([
      {
        path: 'shipment.items[1].weight',
        message: expect.stringContaining('[NO_VALUE]'),
        severity: 'error',
        code: 'NO_VALUE',
        span: { start: 0, end: 6 },
        data: { example: '"5 kg"' },
      },
    ])
  })

  it('canonicalizes inline range descriptors to full range JSON when requested', () => {
    const result = canonicalizeValues(
      { window: 'under 10 minutes' },
      { window: { type: 'range', kind: 'duration', unit: 'min', output: 'range' } },
    )

    expect(result.issues).toEqual([])
    expect(result.value).toEqual({
      window: {
        schemaVersion: 3,
        type: 'range',
        kind: 'duration',
        baseUnit: 's',
        max: { value: 10, unit: 'min', base: 600, exclusive: true },
      },
    })
  })

  it('applies a root-path spec and keeps processing later entries', () => {
    const result = canonicalizeValues(
      { weight: '2kg', eta: 'tomorrow' },
      {
        '': lingoObject(
          { weight: quantityField({ kind: 'mass', unit: 'kg' }), eta: 'string' },
          { passthrough: true },
        ),
        eta: dateField({ now: NOW }),
      },
    )

    const value = result.value as unknown as { weight: number; eta: string }
    expect(value.weight).toBe(2)
    expect(value.eta).toBe(new Date(2026, 6, 4).toISOString())
    expect(result.issues).toEqual([])
  })

  it('reports root-path failures without blocking later entries', () => {
    const result = canonicalizeValues(
      { weight: '2 lbs' },
      {
        '': quantityField({ kind: 'mass', unit: 'kg' }),
        weight: quantityField({ kind: 'mass', unit: 'kg' }),
      },
    )

    expect((result.value as unknown as { weight: number }).weight).toBeCloseTo(0.907_184_74, 10)
    expect(result.issues).toEqual([expect.objectContaining({ path: '', severity: 'error' })])
  })

  it('reports warnings through canonicalizeValues while still applying the value', () => {
    const result = canonicalizeValues(
      { weight: '5 kilogramz' },
      { weight: quantityField({ kind: 'mass', unit: 'kg' }) },
    )

    expect((result.value as unknown as { weight: number }).weight).toBe(5)
    expect(result.issues).toEqual([
      expect.objectContaining({
        path: 'weight',
        severity: 'warning',
        code: 'TYPO_CORRECTED',
        span: { start: 2, end: 11 },
        data: { unit: 'kilogramz', corrected: 'kg' },
      }),
    ])
  })

  it('rejects undeclared properties by default (closed tool schemas)', () => {
    const schema = lingoObject({
      weight: quantityField({ kind: 'mass', unit: 'kg' }),
    })

    const result = schema.safeParse({ weight: '2 lbs', note: 'surprise' })
    if ('value' in result) {
      throw new Error('expected closed-schema failure')
    }
    expect(result.issues[0]?.message).toBe('Unexpected property "note".')
    expect(result.issues[0]?.path).toEqual([{ key: 'note' }])

    const input = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    expect(input.additionalProperties).toBe(false)
  })

  it('supports passthrough object schemas when opted in', () => {
    const schema = lingoObject(
      {
        weight: quantityField({ kind: 'mass', unit: 'kg' }),
      },
      { passthrough: true },
    )

    const success = schema.parse({ weight: '2 lbs', note: 'pass through' })
    expect(success.weight).toBeCloseTo(0.907_184_74, 10)
    expect((success as Record<string, unknown>).note).toBe('pass through')

    const input = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    expect(input.additionalProperties).toBe(true)
  })

  it('validates nested lingoObject shapes with issue paths and aggregated warnings', () => {
    const schema = lingoObject({
      shipment: lingoObject({
        total: quantityField({ kind: 'mass', unit: 'kg' }),
        eta: dateField({ now: NOW }),
        items: [
          lingoObject({
            name: 'string',
            weight: quantityField({ kind: 'mass', unit: 'kg' }),
          }),
        ],
      }),
      expedited: 'boolean',
    })

    const failure = schema.safeParse({
      shipment: {
        total: '2 lbs',
        eta: 'tomorrow',
        items: [
          { name: 'flour', weight: '1 lb' },
          { name: 'sugar', weight: 'banana' },
        ],
      },
      expedited: true,
    })

    if ('value' in failure) {
      throw new Error('expected nested object failure')
    }
    expect(failure.issues).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('[NO_VALUE]'),
        code: 'NO_VALUE',
        severity: 'error',
        span: { start: 0, end: 6 },
        data: { example: '"5 kg"' },
        path: [{ key: 'shipment' }, { key: 'items' }, { key: 1 }, { key: 'weight' }],
      }),
    ])

    const success = schema.safeParse({
      shipment: {
        total: '2',
        eta: 'tomorrow',
        items: [{ name: 'flour', weight: '1 lb' }],
      },
      expedited: false,
    })

    if (!('value' in success)) {
      throw new Error('expected nested object success')
    }
    expect(success.value.shipment).toEqual({
      total: 2,
      eta: new Date(2026, 6, 4).toISOString(),
      items: [{ name: 'flour', weight: expect.closeTo(0.453_592_37, 10) }],
    })
    expect(success.value.expedited).toBe(false)
    expect(success.warnings).toEqual([
      expect.objectContaining({
        code: 'UNIT_ASSUMED',
        path: [{ key: 'shipment' }, { key: 'total' }],
      }),
    ])
  })

  it('emits OpenAI-strict-compatible object schemas throughout', () => {
    const schema = lingoObject({
      shipment: lingoObject({
        weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 500 }),
        window: rangeField({ kind: 'mass', unit: 'kg' }),
        eta: dateField({ now: NOW }),
        items: [lingoObject({ name: 'string' })],
      }),
      expedited: 'boolean',
    })

    for (const direction of ['input', 'output'] as const) {
      const root = schema['~standard'].jsonSchema[direction]({ target: 'draft-2020-12' })
      const stack: unknown[] = [root]
      let objects = 0
      while (stack.length) {
        const node = stack.pop()
        if (!node || typeof node !== 'object') {
          continue
        }
        const record = node as Record<string, unknown>
        if (record.type === 'object') {
          objects += 1
          expect(record.additionalProperties).toBe(false)
          const properties = (record.properties ?? {}) as Record<string, unknown>
          const required = [...(record.required as string[])].sort()
          const keys = Object.keys(properties).sort()
          // OpenAI strict mode governs INPUT schemas (what providers are sent
          // for generation): every property must be required. Output schemas
          // describe canonical results, which may include optional fields
          // (approximate/parts) — required must still be a subset of keys.
          if (direction === 'input') {
            expect(required).toEqual(keys)
          } else {
            expect(keys).toEqual(expect.arrayContaining(required))
          }
        }
        for (const child of Object.values(record)) {
          stack.push(child)
        }
      }
      expect(objects).toBeGreaterThan(1)
    }
  })

  it('keeps quantity JSON output float-safe and inside its own schema', () => {
    const field = quantityField({ kind: 'mass', unit: 'kg', output: 'quantity' })

    const result = field.safeParse('about 3 lbs')
    if (!('value' in result)) {
      throw new Error('expected success')
    }
    expect(result.value.base).toBe(1.360_777_11)
    expect(result.value.approximate).toBe(true)

    const output = field['~standard'].jsonSchema.output({ target: 'draft-2020-12' })
    const properties = Object.keys((output.properties ?? {}) as Record<string, unknown>)
    for (const key of Object.keys(result.value)) {
      expect(properties).toContain(key)
    }
  })

  it('passes legitimate high-precision values through untouched', () => {
    const field = quantityField({ kind: 'mass', unit: 'kg' })

    expect(field.parse('1234567890123 kg')).toBe(1_234_567_890_123)
  })

  it('treats date-only bounds as local calendar days (min start, max inclusive end)', () => {
    const field = dateField({ now: NOW, min: '2026-01-01', max: '2026-12-31' })

    expect('value' in field.safeParse('2026-01-01')).toBe(true)
    expect('value' in field.safeParse('Dec 31 2026')).toBe(true)

    const early = field.safeParse('2025-12-31')
    if ('value' in early) {
      throw new Error('expected RANGE_MIN failure')
    }
    expect(early.issues[0]).toMatchObject({
      message: expect.stringContaining('[RANGE_MIN]'),
      code: 'RANGE_MIN',
      severity: 'error',
      data: { min: expect.any(String) },
    })
  })

  it('throws at field creation for invalid date bounds', () => {
    expect(() => dateField({ min: 'not-a-date' })).toThrow('not a valid date')
  })

  it('repairs JSON text by canonicalizing configured paths client-side', async () => {
    const repairText = repairTextWith({
      weight: quantityField({ kind: 'mass', unit: 'kg' }),
      height: quantityField({ kind: 'length', unit: 'm' }),
      range: rangeField({ kind: 'mass', unit: 'kg' }),
    })

    const repaired = await repairText({
      text: JSON.stringify({ weight: '2kg', height: '1,5', range: '5-10' }),
      error: new Error('schema validation failed'),
    })

    expect(repaired).not.toBeNull()
    const value = JSON.parse(repaired ?? '{}') as {
      weight: number
      height: number
      range: { min: number; max: number }
    }
    expect(value.weight).toBe(2)
    expect(value.height).toBe(1.5)
    expect(value.range).toEqual({ min: 5, max: 10 })
  })

  it('refuses to repair genuinely ambiguous values', async () => {
    const repairText = repairTextWith({
      weight: quantityField({ kind: 'mass', unit: 'kg' }),
    })

    const repaired = await repairText({
      text: JSON.stringify({ weight: '1,234 kg' }),
      error: new Error('schema validation failed'),
    })

    expect(repaired).toBeNull()
  })
})
