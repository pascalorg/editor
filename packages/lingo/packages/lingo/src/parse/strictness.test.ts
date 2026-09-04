import { describe, expect, it } from 'vitest'
import { parseDate, parseDuration } from '../date/index'
import { type LingoResult, lingo, type QuantityResult } from '../index'

const NOW = new Date(2026, 6, 3, 14, 30, 0)

function expectFail(result: LingoResult) {
  if (result.ok) {
    throw new Error(`expected failure, got ${result.type}`)
  }
  return result
}

function expectQuantityCandidate(result: LingoResult): QuantityResult {
  const fail = expectFail(result)
  const candidate = fail.candidate
  if (candidate?.type !== 'quantity') {
    throw new Error(`expected quantity candidate, got ${JSON.stringify(candidate)}`)
  }
  return candidate
}

describe('strictness presets', () => {
  it('handles typo correction by mode', () => {
    const forgiving = lingo('5 meterz', { kind: 'length' })
    expect(forgiving.ok).toBe(true)
    if (forgiving.ok) {
      expect(forgiving.type).toBe('quantity')
      expect(forgiving.issues.find((i) => i.code === 'TYPO_CORRECTED')?.severity).toBe('warning')
    }

    const confirm = expectFail(lingo('5 meterz', { kind: 'length', strictness: 'confirm' }))
    expect(confirm.issues.find((i) => i.code === 'TYPO_CORRECTED')?.severity).toBe('error')
    expect(confirm.candidate?.type).toBe('quantity')
    if (confirm.candidate?.type === 'quantity') {
      expect(confirm.candidate.quantity.format()).toBe('5 m')
    }

    const strict = expectFail(lingo('5 meterz', { kind: 'length', strictness: 'strict' }))
    const unknown = strict.issues.find((i) => i.code === 'UNKNOWN_UNIT')
    expect(unknown?.severity).toBe('error')
    expect(unknown?.suggestions ?? []).toEqual([])
    expect(strict.candidate).toBeUndefined()
  })

  it('turns ambiguous numbers into confirmable failures without changing confidence', () => {
    const forgiving = lingo('1,234 kg')
    if (!forgiving.ok || forgiving.type !== 'quantity') {
      throw new Error('expected forgiving quantity')
    }

    const confirm = expectFail(lingo('1,234 kg', { strictness: 'confirm' }))
    expect(confirm.issues.find((i) => i.code === 'AMBIGUOUS_NUMBER')?.severity).toBe('error')
    expect(confirm.candidate?.type).toBe('quantity')
    if (confirm.candidate?.type === 'quantity') {
      expect(confirm.candidate.quantity.base).toBeCloseTo(1234, 9)
      expect(confirm.candidate.alternatives?.[0]?.type).toBe('quantity')
      expect(confirm.candidate.alternatives?.[0]?.reason).toBe('AMBIGUOUS_NUMBER')
      expect(confirm.candidate.alternatives?.[0]?.quantity?.base).toBeCloseTo(1.234, 9)
      expect(confirm.candidate.confidence).toBe(forgiving.confidence)
    }
  })

  it('escalates assumed units and supports bare-number rejection', () => {
    const confirm = expectFail(lingo('72', { kind: 'length', unit: 'cm', strictness: 'confirm' }))
    expect(confirm.issues.find((i) => i.code === 'UNIT_ASSUMED')?.severity).toBe('error')
    expect(expectQuantityCandidate(confirm).quantity.base).toBeCloseTo(0.72, 12)

    const required = expectFail(
      lingo('72', { kind: 'length', unit: 'cm', accept: { bareNumbers: false } }),
    )
    expect(required.issues[0]?.code).toBe('UNIT_REQUIRED')
    expect(expectQuantityCandidate(required).quantity.base).toBeCloseTo(0.72, 12)
  })

  it('disables number words in strict mode', () => {
    const result = expectFail(lingo('five kg', { strictness: 'strict' }))
    expect(result.issues[0]?.code).toBe('NO_VALUE')
    expect(expectQuantityCandidate(result).quantity.base).toBeCloseTo(5, 12)
  })

  it('lets explicit overrides win over presets', () => {
    const words = lingo('five kg', { strictness: 'strict', accept: { numberWords: true } })
    expect(words.ok && words.type === 'quantity' ? words.quantity.base : Number.NaN).toBeCloseTo(
      5,
      12,
    )

    const ambiguity = lingo('1,234 kg', {
      strictness: 'confirm',
      tolerance: { ambiguity: 'assume' },
    })
    expect(ambiguity.ok).toBe(true)
    if (ambiguity.ok) {
      expect(ambiguity.issues.find((i) => i.code === 'AMBIGUOUS_NUMBER')?.severity).toBe('warning')
    }

    const typo = lingo('5 meterz', {
      kind: 'length',
      strictness: 'strict',
      tolerance: { typos: 'fix', ambiguity: 'assume' },
    })
    expect(typo.ok && typo.type === 'quantity' ? typo.quantity.format() : '').toBe('5 m')
  })
})

describe('acceptance and tolerance switches', () => {
  it('rejects approximations with a candidate', () => {
    const result = expectFail(lingo('about 5 kg', { accept: { approximations: false } }))
    expect(result.issues.find((i) => i.code === 'APPROX_NOT_ALLOWED')).toBeDefined()
    const candidate = expectQuantityCandidate(result)
    expect(candidate.quantity.approximate).toBe(true)
    expect(candidate.quantity.base).toBeCloseTo(5, 12)
  })

  it('rejects ranges and conversions with candidates', () => {
    const range = expectFail(lingo('5-10 kg', { accept: { ranges: false } }))
    expect(range.issues.find((i) => i.code === 'SINGLE_VALUE_EXPECTED')).toBeDefined()
    expect(range.candidate?.type).toBe('range')
    if (range.candidate?.type === 'range') {
      expect(range.candidate.range.minBase).toBeCloseTo(5, 12)
      expect(range.candidate.range.maxBase).toBeCloseTo(10, 12)
    }

    const conversion = expectFail(lingo('72 in to cm', { accept: { conversions: false } }))
    expect(conversion.issues.find((i) => i.code === 'CONVERSION_NOT_ALLOWED')).toBeDefined()
    expect(conversion.candidate?.type).toBe('conversion')
    if (conversion.candidate?.type === 'conversion') {
      const converted = conversion.candidate.converted
      if (!('base' in converted)) {
        throw new Error('expected quantity conversion')
      }
      expect(converted.value).toBeCloseTo(182.88, 9)
    }
  })

  it('turns typo fixing into suggestions with a candidate when requested', () => {
    const forgiving = lingo('5 meterz', { kind: 'length' })
    if (!forgiving.ok) {
      throw new Error('expected forgiving typo parse')
    }
    const result = expectFail(
      lingo('5 meterz', { kind: 'length', tolerance: { typos: 'suggest' } }),
    )
    const unknown = result.issues.find((i) => i.code === 'UNKNOWN_UNIT')
    expect(unknown?.suggestions).toContain('m')
    const candidate = expectQuantityCandidate(result)
    expect(result.candidate?.type === 'quantity' ? result.candidate.quantity.format() : '').toBe(
      '5 m',
    )
    expect(candidate.issues.find((i) => i.code === 'TYPO_CORRECTED')?.severity).toBe('warning')
    expect(candidate.confidence).toBe(forgiving.confidence)
  })

  it('can disable fuzzy vocabulary and compound tails', () => {
    const fuzzy = expectFail(lingo("it's hot", { kind: 'temperature', accept: { fuzzy: false } }))
    expect(fuzzy.issues.find((i) => i.code === 'APPROX_NOT_ALLOWED')).toBeDefined()
    expect(fuzzy.candidate?.type).toBe('range')

    const compound = expectFail(lingo('5 ft 11 in', { accept: { compounds: false } }))
    expect(compound.issues.find((i) => i.code === 'SINGLE_VALUE_EXPECTED')).toBeDefined()
    expect(expectQuantityCandidate(compound).quantity.base).toBeCloseTo(1.8034, 12)

    const typo = expectFail(
      lingo('5 meterz', {
        kind: 'length',
        accept: { compounds: false },
        tolerance: { typos: 'suggest' },
      }),
    )
    expect(typo.issues[0]?.code).toBe('UNKNOWN_UNIT')
    expect(expectQuantityCandidate(typo).quantity.format()).toBe('5 m')

    const words = expectFail(lingo('five kg', { accept: { numberWords: false } }))
    expect(words.issues[0]?.code).toBe('NO_VALUE')
    expect(expectQuantityCandidate(words).quantity.base).toBeCloseTo(5, 12)
  })

  it('supports surgical escalation and message overrides', () => {
    const civil = parseDuration('1 month', { escalate: { CIVIL_AVERAGE: 'error' } })
    expect(civil.ok).toBe(false)
    if (!civil.ok) {
      expect(civil.issues.find((i) => i.code === 'CIVIL_AVERAGE')?.severity).toBe('error')
      expect(civil.candidate).toBeDefined()
    }

    const custom = expectFail(
      lingo('72', {
        kind: 'length',
        unit: 'cm',
        strictness: 'confirm',
        messages: { UNIT_ASSUMED: 'Confirm the unit.' },
      }),
    )
    expect(custom.issues.find((i) => i.code === 'UNIT_ASSUMED')?.message).toBe('Confirm the unit.')
  })

  it('de-escalates deterministic failures only when a candidate carries the value', () => {
    const noValue = expectFail(
      lingo('5 blorks', { kind: 'mass', escalate: { UNKNOWN_UNIT: 'warning' } }),
    )
    expect(noValue.issues.find((i) => i.code === 'UNKNOWN_UNIT')?.severity).toBe('warning')
    expect(noValue.candidate).toBeUndefined()

    const promoted = lingo('5 meterz', {
      kind: 'length',
      tolerance: { typos: 'suggest' },
      escalate: { UNKNOWN_UNIT: 'warning' },
    })
    expect(promoted.ok && promoted.type === 'quantity' ? promoted.quantity.format() : '').toBe(
      '5 m',
    )
    if (promoted.ok) {
      expect(promoted.issues.find((i) => i.code === 'UNKNOWN_UNIT')?.severity).toBe('warning')
    }
  })

  it('does not attach a candidate when nothing is parseable', () => {
    const result = expectFail(lingo('banana', { strictness: 'confirm' }))
    expect(result.candidate).toBeUndefined()
  })
})

describe('date strictness', () => {
  it('escalates ambiguous dates with a date candidate', () => {
    const result = parseDate('5/3/2026', { now: NOW, strictness: 'confirm' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.find((i) => i.code === 'AMBIGUOUS_DATE')?.severity).toBe('error')
      expect(result.candidate?.date).toEqual(new Date(2026, 4, 3))
    }
  })

  it('escalates assumed bare weekdays with a date candidate', () => {
    const result = parseDate('Friday', { now: NOW, strictness: 'strict' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.find((i) => i.code === 'WEEKDAY_ASSUMED_NEXT')?.severity).toBe('error')
      expect(result.candidate?.date).toEqual(new Date(2026, 6, 3))
    }
  })

  it('requires explicit now for reference-dependent dates', () => {
    for (const input of ['in 2d', 'tomorrow', '3min from tmrw', 'March 3', 'at 5pm']) {
      const result = parseDate(input)
      expect(result.ok, input).toBe(false)
      if (!result.ok) {
        expect(
          result.issues.some((i) => i.code === 'NOW_REQUIRED'),
          input,
        ).toBe(true)
        expect(result.candidate, input).toBeUndefined()
      }
    }

    expect(parseDate('tomorrow', { now: NOW }).ok).toBe(true)
    expect(parseDate('tomorrow', { now: NOW, strictness: 'confirm' }).ok).toBe(true)
  })

  it('does not require now for fully absolute dates in strict mode', () => {
    for (const input of ['March 3 2026', '2026-07-03', '2026-07-03T14:30']) {
      const result = parseDate(input, { strictness: 'strict' })
      expect(result.ok, input).toBe(true)
      if (result.ok) {
        expect(
          result.issues.some((i) => i.code === 'NOW_REQUIRED'),
          input,
        ).toBe(false)
      }
    }
  })
})
