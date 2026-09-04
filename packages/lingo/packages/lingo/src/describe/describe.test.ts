import { expect, it, describe as suite } from 'vitest'
import type { DateFail } from '../date/index'
import { parseDate, parseDuration } from '../date/index'
import { lingo } from '../index'
import { describeResult } from './index'

const NOW = new Date(2026, 6, 3, 12, 0, 0)

suite('describeResult resource view', () => {
  it('groups quantity values and preserves source text spans', () => {
    const resource = describeResult(lingo('5 meterz', { kind: 'length' }))

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      resourceSchemaVersion: 1,
      status: 'success',
      type: 'quantity',
      input: {
        text: '5 meterz',
        span: { start: 0, end: 8, text: '5 meterz' },
      },
      data: {
        object: 'lingo.quantity',
        kind: 'length',
        value: {
          amount: 5,
          unit: { id: 'm', symbol: 'm', name: 'meter' },
        },
        canonical: {
          amount: 5,
          unit: { id: 'm', symbol: 'm', name: 'meter' },
        },
        formatted: '5 m',
      },
      issues: [
        {
          object: 'lingo.issue',
          code: 'TYPO_CORRECTED',
          severity: 'warning',
          source: { span: { start: 2, end: 8, text: 'meterz' } },
          data: { unit: 'meterz', corrected: 'm' },
        },
      ],
      confidence: 0.85,
    })
  })

  it('describes confirm-mode candidates recursively', () => {
    const resource = describeResult(lingo('5 meterz', { kind: 'length', strictness: 'confirm' }))

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      resourceSchemaVersion: 1,
      status: 'failure',
      type: 'failure',
      input: { text: '5 meterz', span: { start: 0, end: 8, text: '5 meterz' } },
      issues: [
        {
          object: 'lingo.issue',
          code: 'TYPO_CORRECTED',
          severity: 'error',
          source: { span: { start: 2, end: 8, text: 'meterz' } },
        },
      ],
      candidate: {
        object: 'lingo.parse_result',
        status: 'success',
        type: 'quantity',
        data: {
          object: 'lingo.quantity',
          value: { amount: 5, unit: { id: 'm' } },
          canonical: { amount: 5, unit: { id: 'm' } },
        },
      },
    })
  })

  it('describes date results and date alternatives as resources', () => {
    const parsed = parseDate('5/3/2026', { now: NOW })
    const resource = describeResult(parsed)

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      resourceSchemaVersion: 1,
      status: 'success',
      type: 'date',
      input: {
        text: '5/3/2026',
        span: { start: 0, end: 8, text: '5/3/2026' },
      },
      data: {
        object: 'lingo.date',
        grain: 'day',
        known: ['year', 'month', 'day'],
        calendar: {
          year: 2026,
          month: 5,
          day: 3,
        },
        value: {
          iso: parsed.ok ? parsed.date.toISOString() : '',
          epochMilliseconds: parsed.ok ? parsed.date.getTime() : 0,
        },
      },
      alternatives: [
        {
          object: 'lingo.alternative',
          type: 'date',
          reason: 'other-date-order',
          confidence: 0.45,
          data: {
            object: 'lingo.date',
            value: {
              iso:
                parsed.ok && parsed.alternatives?.[0]
                  ? parsed.alternatives[0].date.toISOString()
                  : '',
            },
          },
        },
      ],
    })
  })

  it('ignores unknown failure candidates instead of guessing a resource shape', () => {
    const resource = describeResult({
      ok: false,
      text: 'soon',
      issues: [],
      candidate: {
        ok: true,
        type: 'instantish',
      },
    } as DateFail)

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      status: 'failure',
      type: 'failure',
      input: {
        text: 'soon',
        span: { start: 0, end: 4, text: 'soon' },
      },
    })
    expect(resource).not.toHaveProperty('candidate')
  })

  it('describes date failures with full input spans and recursive candidates', () => {
    const nowRequired = describeResult(parseDate('tomorrow'))

    expect(nowRequired).toMatchObject({
      object: 'lingo.parse_result',
      status: 'failure',
      type: 'failure',
      input: {
        text: 'tomorrow',
        span: { start: 0, end: 8, text: 'tomorrow' },
      },
      issues: [
        {
          object: 'lingo.issue',
          code: 'NOW_REQUIRED',
          source: { span: { start: 0, end: 8, text: 'tomorrow' } },
        },
      ],
    })

    const confirm = describeResult(parseDate('5/3/2026', { now: NOW, strictness: 'confirm' }))

    expect(confirm).toMatchObject({
      status: 'failure',
      type: 'failure',
      input: {
        text: '5/3/2026',
        span: { start: 0, end: 8, text: '5/3/2026' },
      },
      candidate: {
        object: 'lingo.parse_result',
        status: 'success',
        type: 'date',
        data: {
          object: 'lingo.date',
          grain: 'day',
        },
      },
    })
  })

  it('describes duration results and candidate-backed duration failures', () => {
    const parsed = parseDuration('1h30')
    const resource = describeResult(parsed)

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      resourceSchemaVersion: 1,
      status: 'success',
      type: 'duration',
      input: {
        text: '1h30',
        span: { start: 0, end: 4, text: '1h30' },
      },
      data: {
        object: 'lingo.duration',
        kind: 'duration',
        value: { amount: 1.5, unit: { id: 'h', symbol: 'h', name: 'hour' } },
        canonical: { amount: 5400, unit: { id: 's' } },
        formatted: '1 h 30 min',
        parts: [
          { amount: 1, unit: { id: 'h', symbol: 'h', name: 'hour' } },
          { amount: 30, unit: { id: 'min', symbol: 'min', name: 'minute' } },
        ],
      },
    })

    const failure = describeResult(
      parseDuration('1 month', { escalate: { CIVIL_AVERAGE: 'error' } }),
    )

    expect(failure).toMatchObject({
      status: 'failure',
      type: 'failure',
      input: {
        text: '1 month',
        span: { start: 0, end: 7, text: '1 month' },
      },
      candidate: {
        object: 'lingo.parse_result',
        status: 'success',
        type: 'duration',
        data: {
          object: 'lingo.duration',
          canonical: { unit: { id: 's' } },
        },
      },
    })
  })

  it('describes conversion source and converted values as resources', () => {
    const resource = describeResult(lingo('72 in to cm'))

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      status: 'success',
      type: 'conversion',
      data: {
        object: 'lingo.conversion',
        target: { unit: { id: 'cm', symbol: 'cm', name: 'centimeter' } },
        source: {
          object: 'lingo.quantity',
          value: { amount: 72, unit: { id: 'in' } },
          canonical: { amount: 1.8288, unit: { id: 'm' } },
        },
        converted: {
          object: 'lingo.quantity',
          value: { amount: 182.88, unit: { id: 'cm' } },
          canonical: { amount: 1.8288, unit: { id: 'm' } },
        },
      },
    })
  })

  it('describes quantity alternatives as first-class resources', () => {
    const resource = describeResult(lingo('1,234 kg'))

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      status: 'success',
      type: 'quantity',
      alternatives: [
        {
          object: 'lingo.alternative',
          type: 'quantity',
          reason: 'AMBIGUOUS_NUMBER',
          confidence: 0.4,
          data: {
            object: 'lingo.quantity',
            value: { amount: 1.234, unit: { id: 'kg' } },
            canonical: { amount: 1.234, unit: { id: 'kg' } },
          },
        },
      ],
    })
  })

  it('describes compound quantity parts with unit metadata', () => {
    const resource = describeResult(lingo('5 ft 11 in'))

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      status: 'success',
      type: 'quantity',
      data: {
        object: 'lingo.quantity',
        parts: [
          { amount: 5, unit: { id: 'ft', symbol: 'ft', name: 'foot', plural: 'feet' } },
          { amount: 11, unit: { id: 'in', symbol: 'in', name: 'inch', plural: 'inches' } },
        ],
      },
    })
  })

  it('describes ranges with canonical units and bound resources', () => {
    const resource = describeResult(lingo('between 5 and 10 kg'))

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      status: 'success',
      type: 'range',
      data: {
        object: 'lingo.range',
        kind: 'mass',
        canonicalUnit: { id: 'kg', symbol: 'kg', name: 'kilogram' },
        min: {
          value: { amount: 5, unit: { id: 'kg' } },
          canonical: { amount: 5, unit: { id: 'kg' } },
        },
        max: {
          value: { amount: 10, unit: { id: 'kg' } },
          canonical: { amount: 10, unit: { id: 'kg' } },
        },
      },
    })
  })

  it('describes plus-minus and fuzzy ranges', () => {
    const plusMinus = describeResult(lingo('10 ± 0.5 mm'))

    expect(plusMinus).toMatchObject({
      status: 'success',
      type: 'range',
      data: {
        object: 'lingo.range',
        plusMinus: {
          center: {
            value: { amount: 10, unit: { id: 'mm' } },
            canonical: { amount: 0.01, unit: { id: 'm' } },
          },
          delta: {
            value: { amount: 0.5, unit: { id: 'mm' } },
            canonical: { amount: 0.0005, unit: { id: 'm' } },
          },
        },
      },
    })

    const fuzzy = describeResult(lingo("it's hot", { kind: 'temperature' }))

    expect(fuzzy).toMatchObject({
      status: 'success',
      type: 'range',
      data: {
        object: 'lingo.range',
        approximate: true,
        fuzzy: { term: 'hot', profile: 'weather' },
      },
    })
  })

  it('describes bare number results', () => {
    const resource = describeResult(lingo('72'))

    expect(resource).toMatchObject({
      object: 'lingo.parse_result',
      status: 'success',
      type: 'number',
      data: {
        object: 'lingo.number',
        value: 72,
      },
    })
  })
})
