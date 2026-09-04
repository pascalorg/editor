import { describe, expect, it } from 'vitest'
import { completions } from '../src/complete/index'
import { parseDate, parseDateRange } from '../src/date/index'
import { defaultRegistry, lingo } from '../src/index'
import { es } from '../src/locales/es'

describe('Registry.aliasCompletions', () => {
  it('returns ranked prefix expansions', () => {
    const hits = defaultRegistry.aliasCompletions('f')
    expect(hits.length).toBeGreaterThan(1)
    const units = new Set(hits.map((h) => `${h.kind}|${h.unit.id}`))
    expect(units.size).toBe(hits.length)
    expect(hits.some((h) => h.unit.id === 'ft')).toBe(true)
  })

  it('respects kind context in sort order', () => {
    const hits = defaultRegistry.aliasCompletions('f', 'length')
    expect(hits[0]?.kind).toBe('length')
  })
})

describe('completions()', () => {
  it('fans out partial unit prefixes', () => {
    const list = completions('2 f')
    expect(list.length).toBeGreaterThan(1)
    const texts = list.map((c) => c.text)
    expect(texts.some((t) => t.includes('ft') || t.includes('′'))).toBe(true)
    expect(texts.some((t) => t.includes('°F') || t.toLowerCase().includes('f'))).toBe(true)
  })

  it('ranks everyday m-prefix units before obscure scientific units', () => {
    const texts = completions('2 m', { limit: 8 }).map((c) => c.text)
    expect(texts).toContain('2 min')
    expect(texts.some((t) => t === '2 mm' || t === '2 mi')).toBe(true)
  })

  it('ranks primary parse first when unambiguous', () => {
    const list = completions('5 kg')
    expect(list[0]?.text).toBe('5 kg')
    expect(list[0]?.source).toBe('parse')
    expect(list[0]?.confidence).toBeGreaterThan(0.9)
  })

  it('includes number ambiguity alternatives', () => {
    const list = completions('1,234 kg')
    const texts = list.map((c) => c.text)
    expect(texts).toContain('1234 kg')
    expect(texts.some((t) => t.startsWith('1.234'))).toBe(true)
    expect(list.some((c) => c.source === 'alternative')).toBe(true)
  })

  it('offers implied units for bare numbers with kind', () => {
    const list = completions('5', { kind: 'length', limit: 6 })
    expect(list.length).toBeGreaterThan(1)
    expect(list.some((c) => c.source === 'implied-unit')).toBe(true)
    expect(list.every((c) => c.text.startsWith('5 '))).toBe(true)
    expect(list.some((c) => c.text.includes('ft'))).toBe(true)
  })

  it('offers everyday duration units for bare numbers with duration kind', () => {
    const texts = completions('5', { kind: 'duration', limit: 8 }).map((c) => c.text)
    expect(texts).toContain('5 h')
    expect(texts).toContain('5 min')
  })

  it('offers everyday currency units for bare numbers with currency kind', () => {
    const texts = completions('5', { kind: 'currency', limit: 8 }).map((c) => c.text)
    expect(texts.some((t) => t.includes('€') || t.includes('EUR'))).toBe(true)
  })

  it('does not rank dyn above everyday d-prefix readings', () => {
    const texts = completions('3 d', { limit: 10 }).map((c) => c.text)
    const dollar = texts.indexOf('$3.00')
    const deciliter = texts.indexOf('3 dL')
    const dyn = texts.indexOf('3 dyn')
    expect(texts[0]).toBe('3 d')
    expect(dollar).toBeGreaterThan(0)
    expect(deciliter).toBeGreaterThan(dollar)
    if (dyn >= 0) {
      expect(dyn).toBeGreaterThan(dollar)
    }
  })

  it('fans out range tails with alternate units', () => {
    const list = completions('10 kg to 16', { kind: 'mass', limit: 8 })
    const texts = list.map((c) => c.text)
    expect(texts).toContain('10–16 kg')
    expect(texts).toContain('10–16 lb')
    expect(list.some((c) => c.source === 'range-implied')).toBe(true)
  })

  it('infers range kind from the left unit when field kind differs', () => {
    const list = completions('10 kg to 16', { kind: 'length', limit: 6 })
    expect(list.some((c) => c.text === '10–16 lb')).toBe(true)
  })

  it('surfaces a cross-kind reading when field kind rejects the parse', () => {
    const list = completions('$10', { kind: 'mass' })
    expect(list.map((c) => c.text)).toEqual(['$10.00'])
    expect(list[0]?.source).toBe('cross-kind')
  })

  it('suggests custom units without kind', () => {
    const list = completions('10', { units: ['kg', 'lb', 'm'], limit: 6 })
    expect(list.map((c) => c.text)).toEqual(['10 kg', '10 lb', '10 m'])
  })

  it('fans out length units for open ranges', () => {
    const list = completions('5 to 10', { kind: 'length', limit: 6 })
    const texts = list.map((c) => c.text)
    expect(texts).toContain('5–10 m')
    expect(texts).toContain('5–10 ft')
  })

  it('dedupes and respects limit', () => {
    const list = completions('2 f', { limit: 3 })
    expect(list.length).toBeLessThanOrEqual(3)
    const texts = list.map((c) => c.text)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('sorts by confidence descending', () => {
    const list = completions('2 f')
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.confidence).toBeGreaterThanOrEqual(list[i]!.confidence)
    }
  })

  it('round-trips every completion text', () => {
    const list = completions('2 f', { limit: 5 })
    for (const item of list) {
      const again = lingo(item.text)
      expect(again.ok).toBe(true)
      if (again.ok && item.result.type === 'quantity' && again.type === 'quantity') {
        expect(again.quantity.base).toBeCloseTo(item.result.quantity.base, 8)
        expect(again.quantity.unit).toBe(item.result.quantity.unit)
      }
    }
  })

  it('adds date completions through an injected parser', () => {
    const now = new Date('2026-07-08T09:00:00')
    const date = (text: string) => parseDate(text, { now })
    const list = completions('noon tomorrow', { date })
    const item = list.find((candidate) => candidate.source === 'date')

    expect(item?.result.type).toBe('date')
    const again = item ? date(item.text) : undefined
    expect(again?.ok).toBe(true)
    if (item?.result.type === 'date' && again?.ok) {
      expect(again.date.getTime()).toBe(item.result.date.getTime())
    }
  })

  it('passes localized date input through a locale-configured injected parser', () => {
    const now = new Date('2026-07-08T09:00:00')
    const date = (text: string) => parseDate(text, { now, locale: 'es', localePacks: [es] })
    const list = completions('mediodía mañana', { date })
    const item = list.find((candidate) => candidate.source === 'date')

    expect(item?.result.type).toBe('date')
    const again = item ? date(item.text) : undefined
    expect(again?.ok).toBe(true)
    if (item?.result.type === 'date' && again?.ok) {
      expect(item.result.date).toEqual(new Date(2026, 6, 9, 12))
      expect(again.date.getTime()).toBe(item.result.date.getTime())
    }
  })

  it('surfaces anchored date ranges when the injected parser falls back to parseDateRange', () => {
    const now = new Date('2026-07-08T09:00:00')
    const date = (text: string) => {
      const single = parseDate(text, { now })
      return single.ok ? single : parseDateRange(text, { now })
    }
    for (const input of ['3 days starting tomorrow', '3days starting tomorrow']) {
      const list = completions(input, { date })
      const item = list.find((candidate) => candidate.source === 'date')
      expect(item?.result.type).toBe('date-range')
      expect(item?.text).toBe('3 days starting 2026-07-09')
      const again = item ? parseDateRange(item.text, { now }) : undefined
      expect(again?.ok).toBe(true)
      if (item?.result.type === 'date-range' && again?.ok) {
        expect(item.result.start?.date).toEqual(new Date(2026, 6, 9))
        expect(item.result.end?.date).toEqual(new Date(2026, 6, 12))
        expect(again.start?.date.getTime()).toBe(item.result.start?.date.getTime())
        expect(again.end?.date.getTime()).toBe(item.result.end?.date.getTime())
      }
    }
  })

  it('does not bundle date completions without an injected parser', () => {
    expect(completions('noon tomorrow')).toEqual([])
  })

  it('returns empty for blank input', () => {
    expect(completions('')).toEqual([])
    expect(completions('   ')).toEqual([])
  })
})

describe('completions unit ambiguity fan-out', () => {
  it('surfaces multiple readings for ambiguous oz', () => {
    const list = completions('8 oz', { limit: 8 })
    const units = list
      .filter((c) => c.result.type === 'quantity')
      .map((c) => c.result.quantity.unit)
    expect(new Set(units).size).toBeGreaterThan(1)
  })
})
