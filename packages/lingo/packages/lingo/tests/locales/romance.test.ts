import { describe, expect, it } from 'vitest'
import type { DateGrain } from '../../src/date/index'
import { parseDate } from '../../src/date/index'
import { createLingo } from '../../src/index'
import { es } from '../../src/locales/es'
import { fr } from '../../src/locales/fr'
import { pt } from '../../src/locales/pt'

const NOW = new Date(2026, 6, 8, 12)
const CLOCK_NOW = new Date(2026, 6, 8, 1)

function expectQuantity(input: string, locale: 'es' | 'fr' | 'pt', value: number) {
  const packs = { es, fr, pt }
  const lingo = createLingo({ locales: [packs[locale]] })
  const result = lingo.parseQuantity(input, { locale })
  expect(result.ok, JSON.stringify(result.issues)).toBe(true)
  if (result.ok) {
    expect(result.locale).toBe(locale)
    expect(result.quantity.kind).toBe('mass')
    expect(result.quantity.unit).toBe('kg')
    expect(result.quantity.value).toBe(value)
  }
}

function expectRange(input: string, locale: 'es' | 'fr' | 'pt', min: number, max: number) {
  const packs = { es, fr, pt }
  const lingo = createLingo({ locales: [packs[locale]] })
  const result = lingo.parseRange(input, { locale })
  expect(result.ok, JSON.stringify(result.issues)).toBe(true)
  if (result.ok) {
    expect(result.locale).toBe(locale)
    expect(result.range.min()?.value).toBe(min)
    expect(result.range.max()?.value).toBe(max)
    expect(result.range.min()?.unit).toBe('kg')
  }
}

function expectNumber(input: string, locale: 'es' | 'fr' | 'pt', value: number) {
  const packs = { es, fr, pt }
  const lingo = createLingo({ locales: [packs[locale]] })
  const result = lingo.parse(input, { locale })
  expect(result.ok, JSON.stringify(result.issues)).toBe(true)
  if (result.ok) {
    expect(result.locale).toBe(locale)
    expect(result.type).toBe('number')
    if (result.type === 'number') {
      expect(result.value).toBe(value)
    }
  }
}

function expectDate(input: string, locale: 'es' | 'fr' | 'pt', day: number) {
  const packs = { es, fr, pt }
  const result = parseDate(input, { now: NOW, locale, localePacks: [packs[locale]] })
  expect(result.ok, JSON.stringify(result.issues)).toBe(true)
  if (result.ok) {
    expect(result.date.getFullYear()).toBe(2026)
    expect(result.date.getMonth()).toBe(6)
    expect(result.date.getDate()).toBe(day)
    expect(result.grain).toBe('day')
  }
}

function expectDateTime(
  input: string,
  locale: 'es' | 'fr' | 'pt',
  expected: Date,
  grain: DateGrain = 'day',
  now: Date = NOW,
) {
  const packs = { es, fr, pt }
  const result = parseDate(input, { now, locale, localePacks: [packs[locale]] })
  expect(result.ok, `${input}: ${JSON.stringify(result.issues)}`).toBe(true)
  if (!result.ok) {
    return
  }
  expect(result.date).toEqual(expected)
  expect(result.grain).toBe(grain)
  expect(result.span).toEqual({ start: 0, end: input.length })

  const canonical = parseDate(dayIso(result.date), {
    now,
    locale,
    localePacks: [packs[locale]],
  })
  expect(canonical.ok, `${input} canonical round-trip`).toBe(true)
  if (canonical.ok) {
    expect(canonical.date).toEqual(
      new Date(result.date.getFullYear(), result.date.getMonth(), result.date.getDate()),
    )
  }
}

describe('Romance locale packs', () => {
  it('parses Spanish quantities, ranges, bounds, and relative dates', () => {
    expectQuantity('dos kg', 'es', 2)
    expectRange('entre 5 y 10 kg', 'es', 5, 10)

    const lingo = createLingo({ locales: [es] })
    const bounded = lingo.parseRange('al menos 2 m', { locale: 'es' })
    expect(bounded.ok, JSON.stringify(bounded.issues)).toBe(true)
    if (bounded.ok) {
      expect(bounded.range.min()?.value).toBe(2)
      expect(bounded.range.min()?.unit).toBe('m')
    }

    expectDate('hace tres dias', 'es', 5)
    expectDate('mañana', 'es', 9)
  })

  it('parses Spanish date/time phrases with an explicit mañana policy', () => {
    expectDateTime('en la mañana', 'es', new Date(2026, 6, 9, 9), 'hour')
    expectDateTime('por la mañana', 'es', new Date(2026, 6, 9, 9), 'hour')
    expectDateTime('mañana', 'es', new Date(2026, 6, 9), 'day')
    expectDateTime('mañana por la mañana', 'es', new Date(2026, 6, 9, 9), 'hour')
    expectDateTime('mediodía mañana', 'es', new Date(2026, 6, 9, 12), 'hour')
    expectDateTime('las dos y media', 'es', new Date(2026, 6, 8, 2, 30), 'minute', CLOCK_NOW)
    expectDateTime('las tres menos cuarto', 'es', new Date(2026, 6, 8, 2, 45), 'minute', CLOCK_NOW)
    expectDateTime('a principios de mes', 'es', new Date(2026, 6, 1), 'day')
    expectDateTime('a mediados de julio', 'es', new Date(2026, 6, 15), 'day')
    expectDateTime('a finales de mes', 'es', new Date(2026, 6, 31), 'day')
    expectDateTime('el mes que viene', 'es', new Date(2026, 7, 1), 'month')
    expectDateTime('el próximo mes', 'es', new Date(2026, 7, 1), 'month')
    expectDateTime('12 de julio de 2026', 'es', new Date(2026, 6, 12), 'day')
    expectDateTime('hace 3 días', 'es', new Date(2026, 6, 5, 12), 'day')
    expectRange('entre 5 y 10 kg', 'es', 5, 10)
    expectNumber('treinta y cinco', 'es', 35)
  })

  it('parses French quantities, ranges, and relative dates', () => {
    expectQuantity('deux kg', 'fr', 2)
    expectRange('entre 5 et 10 kg', 'fr', 5, 10)
    expectDate('il y a trois jours', 'fr', 5)
    expectDate('demain', 'fr', 9)
  })

  it('parses French date/time phrases', () => {
    expectDateTime('midi demain', 'fr', new Date(2026, 6, 9, 12), 'hour')
    expectDateTime('demain matin', 'fr', new Date(2026, 6, 9, 9), 'hour')
    expectDateTime('demain', 'fr', new Date(2026, 6, 9), 'day')
    expectDateTime('deux heures et quart', 'fr', new Date(2026, 6, 8, 2, 15), 'minute', CLOCK_NOW)
    expectDateTime(
      'trois heures moins le quart',
      'fr',
      new Date(2026, 6, 8, 2, 45),
      'minute',
      CLOCK_NOW,
    )
    expectDateTime('le mois prochain', 'fr', new Date(2026, 7, 1), 'month')
    expectDateTime('dans 3 jours', 'fr', new Date(2026, 6, 11, 12), 'day')
    expectDateTime('12 juillet 2026', 'fr', new Date(2026, 6, 12), 'day')
    expectDateTime('juillet dernier', 'fr', new Date(2025, 6, 1), 'month')
    expectDateTime('mi-juillet', 'fr', new Date(2026, 6, 15), 'day')
    expectDateTime('fin juillet', 'fr', new Date(2026, 6, 31), 'day')
    expectDateTime('lundi en huit', 'fr', new Date(2026, 6, 20), 'day')
  })

  it('parses Portuguese quantities, ranges, and relative dates', () => {
    expectQuantity('dois kg', 'pt', 2)
    expectRange('entre 5 e 10 kg', 'pt', 5, 10)
    expectDate('há três dias', 'pt', 5)
    expectDate('amanhã', 'pt', 9)
  })

  it('parses Portuguese date/time phrases', () => {
    expectDateTime('amanhã de manhã', 'pt', new Date(2026, 6, 9, 9), 'hour')
    expectDateTime('meio-dia amanhã', 'pt', new Date(2026, 6, 9, 12), 'hour')
    expectDateTime('duas e meia', 'pt', new Date(2026, 6, 8, 2, 30), 'minute', CLOCK_NOW)
    expectDateTime('quinze para as tres', 'pt', new Date(2026, 6, 8, 2, 45), 'minute', CLOCK_NOW)
    expectDateTime('mês que vem', 'pt', new Date(2026, 7, 1), 'month')
    expectDateTime('12 de julho', 'pt', new Date(2026, 6, 12), 'day')
    expectDateTime('meio de julho', 'pt', new Date(2026, 6, 15), 'day')
    expectDateTime('fim de julho', 'pt', new Date(2026, 6, 31), 'day')
    expectDateTime('no começo do mês', 'pt', new Date(2026, 6, 1), 'day')
  })

  it('pins bare midday to today like English "noon"; midnight still rolls forward', () => {
    // An afternoon `now`: an unpinned midday would forward-roll to tomorrow.
    const afternoon = new Date(2026, 6, 8, 15)
    const packs = { es, fr, pt }
    const at = (input: string, locale: 'es' | 'fr' | 'pt') => {
      const r = parseDate(input, { now: afternoon, locale, localePacks: [packs[locale]] })
      expect(r.ok, `${input}: ${r.ok ? '' : JSON.stringify(r.issues)}`).toBe(true)
      return r.ok ? r.date : undefined
    }
    // Noon carries dayOffset: 0, matching English `noon` — stays on today.
    expect(at('mediodía', 'es')).toEqual(new Date(2026, 6, 8, 12))
    expect(at('midi', 'fr')).toEqual(new Date(2026, 6, 8, 12))
    expect(at('meio-dia', 'pt')).toEqual(new Date(2026, 6, 8, 12))
    expect(at('meio dia', 'pt')).toEqual(new Date(2026, 6, 8, 12))
    // Midnight has no pin — like English `midnight`, it rolls to the next 00:00.
    expect(at('minuit', 'fr')).toEqual(new Date(2026, 6, 9, 0))
  })
})

// ─── Plan 033: locale idiom coverage ──────────────────────────────────────────

function expectApprox(input: string, locale: 'es' | 'fr' | 'pt', value: number) {
  const packs = { es, fr, pt }
  const lingo = createLingo({ locales: [packs[locale]] })
  const result = lingo.parseQuantity(input, { locale })
  expect(result.ok, `${input}: ${JSON.stringify(result.issues)}`).toBe(true)
  if (result.ok) {
    expect(result.quantity.value).toBe(value)
    expect(result.quantity.approximate).toBe(true)
  }
}

function expectFuzzy(input: string, locale: 'es' | 'fr' | 'pt', value: number) {
  const packs = { es, fr, pt }
  const lingo = createLingo({ locales: [packs[locale]] })
  const result = lingo.parse(input, { locale })
  expect(result.ok, `${input}: ${JSON.stringify(result.issues)}`).toBe(true)
  if (result.ok) {
    expect(result.type, `${input}: expected range for fuzzy`).toBe('range')
    if (result.type === 'range') {
      expect(result.range.min()?.value, `${input}: min`).toBeLessThanOrEqual(value)
      expect(result.range.max()?.value, `${input}: max`).toBeGreaterThanOrEqual(value)
      expect(result.range.approximate).toBe(true)
    }
  }
}

describe('Plan 033 — ES idioms', () => {
  it('composed: veintiuno-veintinueve fused forms', () => {
    expectQuantity('veintiuno kg', 'es', 21)
    expectQuantity('veintiún kg', 'es', 21)
    expectQuantity('veinticinco kg', 'es', 25)
    expectQuantity('veintinueve kg', 'es', 29)
  })

  it('composed: compound hundreds (doscientos-novecientos)', () => {
    expectQuantity('doscientos kg', 'es', 200)
    expectQuantity('quinientos kg', 'es', 500)
    expectQuantity('novecientos kg', 'es', 900)
    expectQuantity('doscientas kg', 'es', 200)
    expectQuantity('quinientas kg', 'es', 500)
  })

  it('bareScales: cien/mil without preceding multiplier', () => {
    const lingo = createLingo({ locales: [es] })
    const r = lingo.parseQuantity('cien kg', { locale: 'es' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quantity.value).toBe(100)
    }

    const r2 = lingo.parseQuantity('mil kg', { locale: 'es' })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.quantity.value).toBe(1000)
    }
  })

  it('bareScale + composed: mil quinientos = 1500', () => {
    expectQuantity('mil quinientos kg', 'es', 1500)
  })

  it('decimalWords: dos coma cinco = 2.5', () => {
    const lingo = createLingo({ locales: [es] })
    const r = lingo.parseQuantity('dos coma cinco kg', { locale: 'es' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quantity.value).toBe(2.5)
    }
  })

  it('approximatePhrases: mas o menos 5 kilos', () => {
    expectApprox('mas o menos 5 kilos', 'es', 5)
    expectApprox('cosa de 5 kilos', 'es', 5)
  })

  it('approximateWords: unos/unas', () => {
    expectApprox('unos 5 kilos', 'es', 5)
    expectApprox('unas 3 kilos', 'es', 3)
  })

  it('trailingApproxPhrases: y pico, y tantos, y algo', () => {
    expectApprox('5 kilos y pico', 'es', 5)
    expectApprox('5 kilos y tantos', 'es', 5)
  })

  it('rangeAlternativeWords: o', () => {
    expectRange('5 o 6 kg', 'es', 5, 6)
  })

  it('rangeFromWords: de 5 a 10 kg', () => {
    expectRange('de 5 a 10 kg', 'es', 5, 10)
  })

  it('fuzzyAmounts: un par de kilos', () => {
    expectFuzzy('un par de kilos', 'es', 2)
  })

  it('dayOffsets: pasado manana (+2), anteayer/antier (-2)', () => {
    const r1 = parseDate('pasado mañana', { now: NOW, locale: 'es', localePacks: [es] })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.date.getDate()).toBe(10)
    }

    const r2 = parseDate('anteayer', { now: NOW, locale: 'es', localePacks: [es] })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.date.getDate()).toBe(6)
    }

    const r3 = parseDate('antier', { now: NOW, locale: 'es', localePacks: [es] })
    expect(r3.ok).toBe(true)
    if (r3.ok) {
      expect(r3.date.getDate()).toBe(6)
    }
  })
})

describe('Plan 033 — FR idioms', () => {
  it('composed: vigesimal soixante-dix = 70', () => {
    expectQuantity('soixante-dix kg', 'fr', 70)
  })

  it('composed: vigesimal soixante-quinze = 75', () => {
    expectQuantity('soixante-quinze kg', 'fr', 75)
  })

  it('composed: quatre-vingts = 80', () => {
    expectQuantity('quatre-vingts kg', 'fr', 80)
  })

  it('composed: quatre-vingt-dix = 90', () => {
    expectQuantity('quatre-vingt-dix kg', 'fr', 90)
  })

  it('composed: quatre-vingt-dix-neuf = 99', () => {
    expectQuantity('quatre-vingt-dix-neuf kg', 'fr', 99)
  })

  it('bareScales: cent/mille without preceding multiplier', () => {
    const lingo = createLingo({ locales: [fr] })
    const r = lingo.parseQuantity('cent kg', { locale: 'fr' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quantity.value).toBe(100)
    }

    const r2 = lingo.parseQuantity('mille kg', { locale: 'fr' })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.quantity.value).toBe(1000)
    }
  })

  it('decimalWords: deux virgule cinq = 2.5', () => {
    const lingo = createLingo({ locales: [fr] })
    const r = lingo.parseQuantity('deux virgule cinq kg', { locale: 'fr' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quantity.value).toBe(2.5)
    }
  })

  it('approximatePhrases: a peu pres 5 kilos', () => {
    expectApprox('a peu pres 5 kilos', 'fr', 5)
    expectApprox('grosso modo 5 kilos', 'fr', 5)
  })

  it('trailingApproxWords: environ (trailing)', () => {
    expectApprox('5 kilos environ', 'fr', 5)
  })

  it('trailingApproxPhrases: a peu pres / et quelques', () => {
    expectApprox('5 kilos a peu pres', 'fr', 5)
    expectApprox('5 kg et quelques', 'fr', 5)
  })

  it('rangeAlternativeWords: ou', () => {
    expectRange('5 ou 6 kg', 'fr', 5, 6)
  })

  it('fuzzyAmounts: une dizaine de kilos', () => {
    expectFuzzy('une dizaine de kilos', 'fr', 10)
    expectFuzzy('une vingtaine de kilos', 'fr', 20)
    expectFuzzy('une trentaine de kilos', 'fr', 30)
    expectFuzzy('une centaine de kilos', 'fr', 100)
    expectFuzzy('un millier de kilos', 'fr', 1000)
    expectFuzzy('quelques kilos', 'fr', 3)
  })

  it('dayOffsets: apres-demain (+2), avant-hier (-2)', () => {
    const r1 = parseDate('après-demain', { now: NOW, locale: 'fr', localePacks: [fr] })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.date.getDate()).toBe(10)
    }

    const r2 = parseDate('avant-hier', { now: NOW, locale: 'fr', localePacks: [fr] })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.date.getDate()).toBe(6)
    }
  })
})

describe('Plan 033 — PT idioms', () => {
  it('composed: compound hundreds duzentos-novecentos', () => {
    expectQuantity('duzentos kg', 'pt', 200)
    expectQuantity('quatrocentas kg', 'pt', 400)
    expectQuantity('quinhentos kg', 'pt', 500)
    expectQuantity('seiscentas kg', 'pt', 600)
    expectQuantity('setecentas kg', 'pt', 700)
    expectQuantity('oitocentas kg', 'pt', 800)
    expectQuantity('novecentos kg', 'pt', 900)
    expectQuantity('duzentas kg', 'pt', 200)
    expectQuantity('quinhentas kg', 'pt', 500)
  })

  it('bareScales: cem/mil without preceding multiplier', () => {
    const lingo = createLingo({ locales: [pt] })
    const r = lingo.parseQuantity('cem kg', { locale: 'pt' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quantity.value).toBe(100)
    }

    const r2 = lingo.parseQuantity('mil kg', { locale: 'pt' })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.quantity.value).toBe(1000)
    }
  })

  it('decimalWords: dois virgula cinco = 2.5', () => {
    const lingo = createLingo({ locales: [pt] })
    const r = lingo.parseQuantity('dois virgula cinco kg', { locale: 'pt' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quantity.value).toBe(2.5)
    }
  })

  it('approximatePhrases: mais ou menos 5 quilos', () => {
    expectApprox('mais ou menos 5 quilos', 'pt', 5)
    expectApprox('por volta de 5 quilos', 'pt', 5)
    expectApprox('la pelas 5 quilos', 'pt', 5)
  })

  it('approximateWords: uns/umas', () => {
    expectApprox('uns 5 quilos', 'pt', 5)
    expectApprox('umas 3 quilos', 'pt', 3)
  })

  it('trailingApproxPhrases: e pouco/e poucos/e tanto', () => {
    expectApprox('5 quilos e pouco', 'pt', 5)
    expectApprox('5 quilos e poucos', 'pt', 5)
    expectApprox('5 quilos e tanto', 'pt', 5)
  })

  it('rangeAlternativeWords: ou', () => {
    expectRange('5 ou 6 kg', 'pt', 5, 6)
  })

  it('rangeFromWords: de 5 a 10 kg', () => {
    expectRange('de 5 a 10 kg', 'pt', 5, 10)
  })

  it('fuzzyAmounts: um par de quilos', () => {
    expectFuzzy('um par de quilos', 'pt', 2)
  })

  it('regional variants: dezessete (BR) and dezassete (PT)', () => {
    expectQuantity('dezessete kg', 'pt', 17)
    expectQuantity('dezassete kg', 'pt', 17)
    expectQuantity('dezanove kg', 'pt', 19)
  })

  it('dayOffsets: anteontem (-2), depois de amanha (+2)', () => {
    const r1 = parseDate('anteontem', { now: NOW, locale: 'pt', localePacks: [pt] })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.date.getDate()).toBe(6)
    }

    const r2 = parseDate('depois de amanhã', { now: NOW, locale: 'pt', localePacks: [pt] })
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.date.getDate()).toBe(10)
    }
  })

  it('dayTimePhrases: de madrugada', () => {
    expectDateTime('de madrugada', 'pt', new Date(2026, 6, 9, 4), 'hour')
  })
})

// ─── F3: auto-detection scores composed/bareScales/decimalWords ─────────────

describe('F3: auto-detection with composed/bareScale words', () => {
  it('"quinientos kg" auto-detects as es', () => {
    const lingo = createLingo({ locales: [es, fr, pt] })
    const r = lingo.parseQuantity('quinientos kg')
    expect(r.ok, JSON.stringify(r.issues)).toBe(true)
    if (r.ok) {
      expect(r.locale).toBe('es')
      expect(r.quantity.value).toBe(500)
    }
  })

  it('"quatre-vingt-dix kg" auto-detects as fr', () => {
    const lingo = createLingo({ locales: [es, fr, pt] })
    const r = lingo.parseQuantity('quatre-vingt-dix kg')
    expect(r.ok, JSON.stringify(r.issues)).toBe(true)
    if (r.ok) {
      expect(r.locale).toBe('fr')
      expect(r.quantity.value).toBe(90)
    }
  })

  it('"duzentos kg" auto-detects as pt', () => {
    const lingo = createLingo({ locales: [es, fr, pt] })
    const r = lingo.parseQuantity('duzentos kg')
    expect(r.ok, JSON.stringify(r.issues)).toBe(true)
    if (r.ok) {
      expect(r.locale).toBe('pt')
      expect(r.quantity.value).toBe(200)
    }
  })
})

function dayIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
