import { describe, expect, it } from 'vitest'
import { humanizeDate, humanizeDuration, parseDate, parseDuration } from './index'

const NOW = new Date(2026, 6, 3, 14, 30, 0)

function parseBack(text: string) {
  const result = parseDate(text, { now: NOW })
  if (!result.ok) {
    throw new Error(`parseDate("${text}") failed: ${JSON.stringify(result.issues)}`)
  }
  return result.date
}

function toleranceFor(text: string): number {
  if (text === 'just now') {
    return 10_000
  }
  if (/\bsecond/.test(text)) {
    return 1000
  }
  if (/\bminute\b|minutes/.test(text)) {
    return 60_000
  }
  if (/\bhour\b|hours/.test(text)) {
    return 3_600_000
  }
  if (/\bweek\b|weeks/.test(text)) {
    return 7 * 86_400_000
  }
  if (/\bmonth\b|months/.test(text)) {
    return 31 * 86_400_000
  }
  if (/\byear\b|years/.test(text)) {
    return 366 * 86_400_000
  }
  return 86_400_000
}

describe('humanizeDate thresholds', () => {
  it('requires an explicit now option', () => {
    expect(() => humanizeDate(new Date(2026, 6, 3, 15), undefined as never)).toThrowError()
  })

  it('uses the binding threshold table', () => {
    const rows: Array<[Date, string]> = [
      [new Date(2026, 6, 3, 14, 30, 9), 'just now'],
      [new Date(2026, 6, 3, 14, 30, 10), 'in 10 seconds'],
      [new Date(2026, 6, 3, 14, 29, 1), '59 seconds ago'],
      [new Date(2026, 6, 3, 14, 29, 0), 'a minute ago'],
      [new Date(2026, 6, 3, 13, 46), '44 minutes ago'],
      [new Date(2026, 6, 3, 13, 45), 'an hour ago'],
      [new Date(2026, 6, 3, 13, 1), 'an hour ago'],
      [new Date(2026, 6, 3, 13, 0), '2 hours ago'],
      [new Date(2026, 6, 2, 15, 30), '23 hours ago'],
      [new Date(2026, 6, 2, 14, 30), 'yesterday'],
      [new Date(2026, 6, 4, 14, 30), 'tomorrow'],
      [new Date(2026, 6, 1, 14, 30), 'last Wednesday'],
      [new Date(2026, 6, 8, 14, 30), 'on Wednesday'],
      [new Date(2026, 5, 26, 14, 30), '1 week ago'],
      [new Date(2026, 5, 3, 14, 30), '1 month ago'],
      [new Date(2025, 7, 17, 14, 30), '1 year ago'],
    ]
    for (const [date, expected] of rows) {
      expect(humanizeDate(date, { now: NOW })).toBe(expected)
    }
    expect(humanizeDate(new Date(2026, 6, 2, 14, 30), { now: NOW, numeric: 'always' })).toBe(
      '1 day ago',
    )
  })

  it('clamps units and honors rounding', () => {
    expect(humanizeDate(new Date(2026, 6, 3, 15, 59), { now: NOW, maxUnit: 'minute' })).toBe(
      'in 89 minutes',
    )
    expect(
      humanizeDate(new Date(2026, 6, 3, 15, 20), { now: NOW, minUnit: 'hour', rounding: 'floor' }),
    ).toBe('in an hour')
  })

  it('round-trips random dates within the emitted grain', () => {
    let seed = 0x5e_ed_12_34
    const next = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return seed / 0x1_00_00_00_00
    }
    const twoYearsSeconds = Math.floor(2 * 365.25 * 86_400)
    for (let i = 0; i < 300; i++) {
      const offsetSeconds = Math.floor((next() * 2 - 1) * twoYearsSeconds)
      const date = new Date(NOW.getTime() + offsetSeconds * 1000)
      const text = humanizeDate(date, { now: NOW })
      const parsed = parseBack(text)
      expect(Math.abs(parsed.getTime() - date.getTime())).toBeLessThanOrEqual(toleranceFor(text))
    }
  })
})

describe('humanizeDuration', () => {
  it('renders styles and parses each result', () => {
    const rows = [
      ['narrow', '1h 30m'],
      ['short', '1 h 30 min'],
      ['long', '1 hour 30 minutes'],
      ['natural', 'an hour and a half'],
    ] as const
    for (const [style, expected] of rows) {
      const text = humanizeDuration(5400, { style })
      expect(text).toBe(expected)
      const result = parseDuration(text)
      if (!result.ok) {
        throw new Error(`parseDuration("${text}") failed: ${JSON.stringify(result.issues)}`)
      }
      expect(result.duration.base).toBeCloseTo(5400, 9)
    }
  })

  it('handles natural halves and regular natural joins', () => {
    expect(humanizeDuration(1800, { style: 'natural' })).toBe('half an hour')
    expect(humanizeDuration(8100, { style: 'natural' })).toBe('2 hours and 15 minutes')
    const result = parseDuration(humanizeDuration(8100, { style: 'natural' }))
    if (!result.ok) {
      throw new Error('duration did not parse')
    }
    expect(result.duration.base).toBeCloseTo(8100, 9)
  })
})
