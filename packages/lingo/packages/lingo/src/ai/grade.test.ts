import { describe, expect, it } from 'vitest'
import { dateMatch, quantityMatch } from './index'

describe('AI eval graders', () => {
  it('matches quantities after canonicalizing both sides through the same field', () => {
    const result = quantityMatch('2 lbs', '0.90718474 kg', { kind: 'mass', unit: 'kg' })

    expect(result).toMatchObject({ pass: true, score: 1 })
    expect(result.reason).toContain('relative tolerance')
  })

  it('scores quantity misses by relative error', () => {
    const result = quantityMatch('1 kg', '2 kg', { kind: 'mass', unit: 'kg' })

    expect(result.pass).toBe(false)
    expect(result.score).toBe(0.5)
    expect(result.reason).toContain('relative error')
  })

  it('returns the field issue message when quantity parsing fails', () => {
    const result = quantityMatch('banana', '2 kg', { kind: 'mass', unit: 'kg' })

    expect(result).toEqual({
      pass: false,
      score: 0,
      reason: expect.stringContaining('[NO_VALUE]'),
    })
  })

  it('matches dates at the requested grain and time zone', () => {
    const result = dateMatch('July 4 2026', '2026-07-04', {
      grain: 'day',
      timeZone: 'Europe/Paris',
    })

    expect(result).toEqual({
      pass: true,
      score: 1,
      reason: 'Dates match at day grain.',
    })
  })

  it('matches equal ISO datetime instants directly', () => {
    const result = dateMatch('2026-07-03T14:00:00.000Z', '2026-07-03T14:00:00.000Z', {
      grain: 'second',
      timeZone: 'UTC',
    })

    expect(result).toMatchObject({ pass: true, score: 1 })
  })

  it('compares ISO datetime instants at different grains', () => {
    const hour = dateMatch('2026-07-03T14:15:00.000Z', '2026-07-03T14:45:00.000Z', {
      grain: 'hour',
      timeZone: 'UTC',
    })
    const minute = dateMatch('2026-07-03T14:15:00.000Z', '2026-07-03T14:45:00.000Z', {
      grain: 'minute',
      timeZone: 'UTC',
    })

    expect(hour.pass).toBe(true)
    expect(minute.pass).toBe(false)
  })

  it('matches ISO datetime instants against natural-language dates with explicit now', () => {
    const result = dateMatch('2026-07-04T12:00:00.000Z', 'tomorrow', {
      now: new Date(2026, 6, 3, 14),
      grain: 'day',
      timeZone: 'Europe/Paris',
    })

    expect(result).toMatchObject({ pass: true, score: 1 })
  })

  it('keeps date-only inputs on the dateField fallback path', () => {
    const result = dateMatch('2026-07-04', 'July 4 2026', {
      grain: 'day',
      timeZone: 'Europe/Paris',
    })

    expect(result.pass).toBe(true)
  })

  it('honors calendar grain boundaries in the requested time zone', () => {
    const result = dateMatch('2026-07-04T06:30:00.000Z', '2026-07-03T23:45:00.000-07:00', {
      grain: 'day',
      timeZone: 'America/Los_Angeles',
    })

    expect(result.pass).toBe(true)
  })

  it('accepts Date instances directly', () => {
    const result = dateMatch(new Date('2026-07-03T14:00:00.000Z'), '2026-07-03T14:00:00.000Z', {
      grain: 'second',
      timeZone: 'UTC',
    })

    expect(result.pass).toBe(true)
  })

  it('fails date comparisons when truncated instants differ', () => {
    const result = dateMatch('July 3 2026', '2026-07-04', {
      grain: 'day',
      timeZone: 'UTC',
    })

    expect(result.pass).toBe(false)
    expect(result.score).toBe(0)
    expect(result.reason).toContain('Expected')
  })

  it('returns the field issue message when date parsing fails', () => {
    const result = dateMatch('tomorrow', '2026-07-04')

    expect(result).toEqual({
      pass: false,
      score: 0,
      reason: expect.stringContaining('[NOW_REQUIRED]'),
    })
  })
})
