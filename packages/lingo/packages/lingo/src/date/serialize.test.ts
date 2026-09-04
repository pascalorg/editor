import { describe, expect, it } from 'vitest'
import { parseDuration } from './duration'
import { parseDate, parseDateRange } from './parse'

// The date module's v3 wire contract: flat, versioned, ISO dates, every span
// self-describing ({ start, end, text }). Mirrors the core guard in
// api-surface.test.ts.

const NOW = new Date('2026-07-03T10:00:00')

describe('date module v3 wire serialization', () => {
  it('parseDate serializes flat with an ISO date and a self-describing span', () => {
    const r = parseDate('tomorrow at 3pm', { now: NOW })
    expect(r.ok).toBe(true)
    expect(JSON.parse(JSON.stringify(r))).toMatchObject({
      schemaVersion: 3,
      ok: true,
      type: 'date',
      date: r.ok ? r.date.toISOString() : '',
      grain: 'hour',
      text: 'tomorrow at 3pm',
      span: { start: 0, end: 15, text: 'tomorrow at 3pm' },
      issues: [],
      confidence: 1,
    })
  })

  it('serializes issue spans with their matched text', () => {
    const r = parseDate('3pm EST', { now: NOW })
    expect(r.ok).toBe(true)
    const wire = JSON.parse(JSON.stringify(r))
    const tz = wire.issues.find((issue: { code: string }) => issue.code === 'TZ_IGNORED')
    expect(tz.span).toEqual({ start: 4, end: 7, text: 'EST' })
  })

  it('parseDate failures serialize as versioned type:failure', () => {
    const r = parseDate('in 2 days') // no now → NOW_REQUIRED
    expect(r.ok).toBe(false)
    expect(JSON.parse(JSON.stringify(r))).toMatchObject({
      schemaVersion: 3,
      ok: false,
      type: 'failure',
      text: 'in 2 days',
      issues: [{ code: 'NOW_REQUIRED', span: { start: 0, end: 9, text: 'in 2 days' } }],
    })
  })

  it('parseDateRange serializes ISO endpoints', () => {
    const r = parseDateRange('2pm to 4pm', { now: NOW })
    expect(r.ok).toBe(true)
    expect(JSON.parse(JSON.stringify(r))).toMatchObject({
      schemaVersion: 3,
      ok: true,
      type: 'date-range',
      span: { start: 0, end: 10, text: '2pm to 4pm' },
      start: { date: r.ok ? r.start?.date.toISOString() : '', grain: 'hour' },
      end: { date: r.ok ? r.end?.date.toISOString() : '', grain: 'hour' },
    })
  })

  it('parseDuration serializes flat quantity fields', () => {
    const r = parseDuration('1h30')
    expect(JSON.parse(JSON.stringify(r))).toMatchObject({
      schemaVersion: 3,
      ok: true,
      type: 'duration',
      kind: 'duration',
      value: 1.5,
      unit: 'h',
      base: 5400,
      baseUnit: 's',
      span: { start: 0, end: 4, text: '1h30' },
    })
  })

  it('keeps toJSON ENUMERABLE so JavaScriptCore/Bun/Safari honor it', () => {
    // Same JSC fast-path hazard as the core results (see api-surface.test.ts).
    const results = [
      parseDate('2026-07-04'),
      parseDate('in 2 days'),
      parseDateRange('2pm to 4pm', { now: NOW }),
      parseDuration('90 min'),
    ]
    for (const r of results) {
      const descriptor = Object.getOwnPropertyDescriptor(r, 'toJSON')
      expect(descriptor?.enumerable, `${r.text}: toJSON must be enumerable`).toBe(true)
    }
  })
})
