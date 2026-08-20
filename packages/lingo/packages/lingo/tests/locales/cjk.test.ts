import { describe, expect, it } from 'vitest'
import { parseDate } from '../../src/date/index'
import { createLingo } from '../../src/index'
import { ja } from '../../src/locales/ja'
import { zh } from '../../src/locales/zh'

const NOW = new Date(2026, 6, 8, 12)

describe('CJK locale packs', () => {
  it('does not parse CJK temperature words without a CJK pack', () => {
    const lingo = createLingo()
    const result = lingo.parse('暑い', { kind: 'temperature' })
    expect(result.ok).toBe(false)
  })

  it('parses Chinese compact quantities, dates, and fuzzy temperature', () => {
    const lingo = createLingo({ locales: [zh] })

    const quantity = lingo.parseQuantity('5公斤', { locale: 'zh' })
    expect(quantity.ok, JSON.stringify(quantity.issues)).toBe(true)
    if (quantity.ok) {
      expect(quantity.locale).toBe('zh')
      expect(quantity.quantity.unit).toBe('kg')
      expect(quantity.quantity.value).toBe(5)
    }

    const date = parseDate('三天前', { now: NOW, locale: 'zh', localePacks: [zh] })
    expect(date.ok, JSON.stringify(date.issues)).toBe(true)
    if (date.ok) {
      expect(date.date.getDate()).toBe(5)
      expect(date.grain).toBe('day')
    }

    const noonTomorrow = parseDate('明天中午', { now: NOW, locale: 'zh', localePacks: [zh] })
    expect(noonTomorrow.ok, JSON.stringify(noonTomorrow.issues)).toBe(true)
    if (noonTomorrow.ok) {
      expect(noonTomorrow.date).toEqual(new Date(2026, 6, 9, 12))
      expect(noonTomorrow.grain).toBe('hour')
    }

    const nextMonth = parseDate('下个月', { now: NOW, locale: 'zh', localePacks: [zh] })
    expect(nextMonth.ok, JSON.stringify(nextMonth.issues)).toBe(true)
    if (nextMonth.ok) {
      expect(nextMonth.date).toEqual(new Date(2026, 7, 1))
      expect(nextMonth.grain).toBe('month')
    }

    const fuzzy = lingo.parse('很热', { kind: 'temperature', locale: 'zh' })
    expect(fuzzy.ok, JSON.stringify(fuzzy.issues)).toBe(true)
    if (fuzzy.ok) {
      expect(fuzzy.locale).toBe('zh')
      expect(fuzzy.type).toBe('range')
      if (fuzzy.type === 'range') {
        expect(fuzzy.range.fuzzy?.term).toBe('很热')
      }
    }
  })

  it('sub-segments Chinese CJK number/unit tokens with original spans', () => {
    const lingo = createLingo({ locales: [zh] })
    const cases = [
      ['三公斤', 'kg', 3],
      ['十五公斤', 'kg', 15],
      ['一百五十公斤', 'kg', 150],
      ['一百五十米', 'm', 150],
    ] as const

    for (const [input, unit, value] of cases) {
      const result = lingo.parseQuantity(input, { locale: 'zh' })
      expect(result.ok, `${input}: ${JSON.stringify(result.issues)}`).toBe(true)
      if (!result.ok) {
        continue
      }
      expect(result.locale).toBe('zh')
      expect(result.quantity.unit).toBe(unit)
      expect(result.quantity.value).toBe(value)
      expect(result.span).toEqual({ start: 0, end: input.length })
    }
  })

  it('parses mixed Arabic/CJK Chinese scales without enabling Latin glued multipliers', () => {
    const lingo = createLingo({ locales: [zh] })

    const bare = lingo.parse('3万', { locale: 'zh' })
    expect(bare.ok && bare.type === 'number' ? bare.value : Number.NaN).toBe(30_000)
    if (bare.ok) {
      expect(bare.span).toEqual({ start: 0, end: '3万'.length })
    }

    const quantity = lingo.parseQuantity('3万5千公斤', { locale: 'zh' })
    expect(quantity.ok, JSON.stringify(quantity.issues)).toBe(true)
    if (quantity.ok) {
      expect(quantity.quantity.unit).toBe('kg')
      expect(quantity.quantity.value).toBe(35_000)
      expect(quantity.span).toEqual({ start: 0, end: '3万5千公斤'.length })
    }

    const tenMillion = lingo.parse('千万', { locale: 'zh' })
    expect(tenMillion.ok && tenMillion.type === 'number' ? tenMillion.value : Number.NaN).toBe(
      10_000_000,
    )

    expect(lingo.parse('万万', { locale: 'zh' }).ok).toBe(false)
    expect(lingo.parse('亿万', { locale: 'zh' }).ok).toBe(false)

    const latin = lingo.parseQuantity('1M')
    expect(latin.ok).toBe(false)
  })

  it('parses Chinese adjacent-number ranges and post-unit half', () => {
    const lingo = createLingo({ locales: [zh] })

    const range = lingo.parseRange('七八天', { locale: 'zh' })
    expect(range.ok, JSON.stringify(range.issues)).toBe(true)
    if (range.ok) {
      expect(range.range.min()?.value).toBe(7)
      expect(range.range.max()?.value).toBe(8)
      expect(range.range.min()?.unit).toBe('d')
      expect(range.span).toEqual({ start: 0, end: '七八天'.length })
    }

    const repeated = lingo.parse('三三天', { locale: 'zh' })
    expect(repeated.ok).toBe(false)

    const half = lingo.parseQuantity('两公斤半', { locale: 'zh' })
    expect(half.ok, JSON.stringify(half.issues)).toBe(true)
    if (half.ok) {
      expect(half.quantity.unit).toBe('kg')
      expect(half.quantity.value).toBe(2.5)
      expect(half.span).toEqual({ start: 0, end: '两公斤半'.length })
    }
  })

  it('parses deepened Chinese data-only idioms', () => {
    const lingo = createLingo({ locales: [zh] })

    const fullWidth = lingo.parseQuantity('３５公斤', { locale: 'zh' })
    expect(fullWidth.ok, JSON.stringify(fullWidth.issues)).toBe(true)
    if (fullWidth.ok) {
      expect(fullWidth.quantity.unit).toBe('kg')
      expect(fullWidth.quantity.value).toBe(35)
      expect(fullWidth.span).toEqual({ start: 0, end: '３５公斤'.length })
    }

    const classifierDuration = lingo.parseQuantity('三个小时', { locale: 'zh' })
    expect(classifierDuration.ok, JSON.stringify(classifierDuration.issues)).toBe(true)
    if (classifierDuration.ok) {
      expect(classifierDuration.quantity.unit).toBe('h')
      expect(classifierDuration.quantity.value).toBe(3)
      expect(classifierDuration.span).toEqual({ start: 0, end: '三个小时'.length })
    }

    const approximate = lingo.parseQuantity('差不多5公斤', { locale: 'zh' })
    expect(approximate.ok, JSON.stringify(approximate.issues)).toBe(true)
    if (approximate.ok) {
      expect(approximate.quantity.unit).toBe('kg')
      expect(approximate.quantity.value).toBe(5)
      expect(approximate.quantity.approximate).toBe(true)
    }

    const alternative = lingo.parseRange('三 或 四 公斤', { locale: 'zh' })
    expect(alternative.ok, JSON.stringify(alternative.issues)).toBe(true)
    if (alternative.ok) {
      expect(alternative.range.min()?.value).toBe(3)
      expect(alternative.range.max()?.value).toBe(4)
      expect(alternative.range.min()?.unit).toBe('kg')
    }
  })

  it('parses Chinese day offsets and classifier duration offsets', () => {
    const cases = [
      ['前天', new Date(2026, 6, 6)],
      ['后天', new Date(2026, 6, 10)],
      ['大前天', new Date(2026, 6, 5)],
      ['大后天', new Date(2026, 6, 11)],
      ['三个小时后', new Date(2026, 6, 8, 15)],
      ['三天以后', new Date(2026, 6, 11, 12)],
    ] as const

    for (const [input, expected] of cases) {
      const result = parseDate(input, { now: NOW, locale: 'zh', localePacks: [zh] })
      expect(result.ok, `${input}: ${JSON.stringify(result.issues)}`).toBe(true)
      if (!result.ok) {
        continue
      }
      expect(result.date).toEqual(expected)
    }
  })

  it('parses Japanese compact quantities, dates, and fuzzy temperature', () => {
    const lingo = createLingo({ locales: [ja] })

    const quantity = lingo.parseQuantity('5キロ', { locale: 'ja' })
    expect(quantity.ok, JSON.stringify(quantity.issues)).toBe(true)
    if (quantity.ok) {
      expect(quantity.locale).toBe('ja')
      expect(quantity.quantity.unit).toBe('kg')
      expect(quantity.quantity.value).toBe(5)
    }

    const date = parseDate('3日前', { now: NOW, locale: 'ja', localePacks: [ja] })
    expect(date.ok, JSON.stringify(date.issues)).toBe(true)
    if (date.ok) {
      expect(date.date.getDate()).toBe(5)
      expect(date.grain).toBe('day')
    }

    const noonTomorrow = parseDate('明日の正午', { now: NOW, locale: 'ja', localePacks: [ja] })
    expect(noonTomorrow.ok, JSON.stringify(noonTomorrow.issues)).toBe(true)
    if (noonTomorrow.ok) {
      expect(noonTomorrow.date).toEqual(new Date(2026, 6, 9, 12))
      expect(noonTomorrow.grain).toBe('hour')
    }

    const nextMonth = parseDate('来月', { now: NOW, locale: 'ja', localePacks: [ja] })
    expect(nextMonth.ok, JSON.stringify(nextMonth.issues)).toBe(true)
    if (nextMonth.ok) {
      expect(nextMonth.date).toEqual(new Date(2026, 7, 1))
      expect(nextMonth.grain).toBe('month')
    }

    const fuzzy = lingo.parse('暑い', { kind: 'temperature', locale: 'ja' })
    expect(fuzzy.ok, JSON.stringify(fuzzy.issues)).toBe(true)
    if (fuzzy.ok) {
      expect(fuzzy.locale).toBe('ja')
      expect(fuzzy.type).toBe('range')
      if (fuzzy.type === 'range') {
        expect(fuzzy.range.fuzzy?.term).toBe('暑い')
      }
    }
  })

  it('sub-segments Japanese CJK number/unit tokens with original spans', () => {
    const lingo = createLingo({ locales: [ja] })
    const cases = [
      ['三キロ', 'kg', 3],
      ['三十五キロ', 'kg', 35],
      ['百五十グラム', 'g', 150],
      ['３５キロ', 'kg', 35],
    ] as const

    for (const [input, unit, value] of cases) {
      const result = lingo.parseQuantity(input, { locale: 'ja' })
      expect(result.ok, `${input}: ${JSON.stringify(result.issues)}`).toBe(true)
      if (!result.ok) {
        continue
      }
      expect(result.locale).toBe('ja')
      expect(result.quantity.unit).toBe(unit)
      expect(result.quantity.value).toBe(value)
      expect(result.span).toEqual({ start: 0, end: input.length })
    }
  })

  it('parses Japanese mixed CJK scales, wave-dash ranges, and post-unit half', () => {
    const lingo = createLingo({ locales: [ja] })

    const mixed = lingo.parseQuantity('3万5千キロ', { locale: 'ja' })
    expect(mixed.ok, JSON.stringify(mixed.issues)).toBe(true)
    if (mixed.ok) {
      expect(mixed.quantity.unit).toBe('kg')
      expect(mixed.quantity.value).toBe(35_000)
      expect(mixed.span).toEqual({ start: 0, end: '3万5千キロ'.length })
    }

    const large = lingo.parse('1億2千万', { locale: 'ja' })
    expect(large.ok && large.type === 'number' ? large.value : Number.NaN).toBe(120_000_000)
    if (large.ok) {
      expect(large.span).toEqual({ start: 0, end: '1億2千万'.length })
    }

    const kanjiLarge = lingo.parse('一億二千万', { locale: 'ja' })
    expect(kanjiLarge.ok && kanjiLarge.type === 'number' ? kanjiLarge.value : Number.NaN).toBe(
      120_000_000,
    )

    for (const input of ['5〜10キロ', '5～10キロ'] as const) {
      const range = lingo.parseRange(input, { locale: 'ja' })
      expect(range.ok, `${input}: ${JSON.stringify(range.issues)}`).toBe(true)
      if (!range.ok) {
        continue
      }
      expect(range.range.min()?.value).toBe(5)
      expect(range.range.max()?.value).toBe(10)
      expect(range.range.min()?.unit).toBe('kg')
      expect(range.span).toEqual({ start: 0, end: input.length })
    }

    const dayRange = lingo.parseRange('三〜五日', { locale: 'ja' })
    expect(dayRange.ok, JSON.stringify(dayRange.issues)).toBe(true)
    if (dayRange.ok) {
      expect(dayRange.range.min()?.value).toBe(3)
      expect(dayRange.range.max()?.value).toBe(5)
      expect(dayRange.range.min()?.unit).toBe('d')
      expect(dayRange.span).toEqual({ start: 0, end: '三〜五日'.length })
    }

    const massHalf = lingo.parseQuantity('二キロ半', { locale: 'ja' })
    expect(massHalf.ok, JSON.stringify(massHalf.issues)).toBe(true)
    if (massHalf.ok) {
      expect(massHalf.quantity.unit).toBe('kg')
      expect(massHalf.quantity.value).toBe(2.5)
      expect(massHalf.span).toEqual({ start: 0, end: '二キロ半'.length })
    }

    const durationHalf = lingo.parseQuantity('一時間半', { locale: 'ja' })
    expect(durationHalf.ok, JSON.stringify(durationHalf.issues)).toBe(true)
    if (durationHalf.ok) {
      expect(durationHalf.quantity.unit).toBe('h')
      expect(durationHalf.quantity.value).toBe(1.5)
      expect(durationHalf.span).toEqual({ start: 0, end: '一時間半'.length })
    }
  })

  it('parses deepened Japanese data-only idioms', () => {
    const lingo = createLingo({ locales: [ja] })

    const yen = lingo.parseQuantity('三万五千円', { locale: 'ja' })
    expect(yen.ok, JSON.stringify(yen.issues)).toBe(true)
    if (yen.ok) {
      expect(yen.quantity.kind).toBe('currency')
      expect(yen.quantity.unit).toBe('JPY')
      expect(yen.quantity.value).toBe(35_000)
      expect(yen.span).toEqual({ start: 0, end: '三万五千円'.length })
    }

    const largeYen = lingo.parseQuantity('二億三千万円', { locale: 'ja' })
    expect(largeYen.ok, JSON.stringify(largeYen.issues)).toBe(true)
    if (largeYen.ok) {
      expect(largeYen.quantity.unit).toBe('JPY')
      expect(largeYen.quantity.value).toBe(230_000_000)
      expect(largeYen.span).toEqual({ start: 0, end: '二億三千万円'.length })
    }

    const approximate = lingo.parseQuantity('5キロ ほど', { locale: 'ja' })
    expect(approximate.ok, JSON.stringify(approximate.issues)).toBe(true)
    if (approximate.ok) {
      expect(approximate.quantity.unit).toBe('kg')
      expect(approximate.quantity.value).toBe(5)
      expect(approximate.quantity.approximate).toBe(true)
    }

    const counter = lingo.parse('三個', { locale: 'ja' })
    expect(counter.ok, JSON.stringify(counter.issues)).toBe(true)
    if (counter.ok) {
      expect(counter.type).toBe('number')
      if (counter.type === 'number') {
        expect(counter.value).toBe(3)
      }
    }
  })

  it('parses Japanese day offsets and day-time phrases', () => {
    const cases = [
      ['一昨日', new Date(2026, 6, 6)],
      ['おととい', new Date(2026, 6, 6)],
      ['明後日', new Date(2026, 6, 10)],
      ['あさって', new Date(2026, 6, 10)],
      ['しあさって', new Date(2026, 6, 11)],
      ['今朝', new Date(2026, 6, 8, 8)],
      ['今晩', new Date(2026, 6, 8, 19)],
      ['今夜', new Date(2026, 6, 8, 21)],
    ] as const

    for (const [input, expected] of cases) {
      const result = parseDate(input, { now: NOW, locale: 'ja', localePacks: [ja] })
      expect(result.ok, `${input}: ${JSON.stringify(result.issues)}`).toBe(true)
      if (!result.ok) {
        continue
      }
      expect(result.date).toEqual(expected)
    }
  })

  it('pins bare CJK noon to today like English "noon"', () => {
    // An afternoon `now`: an unpinned noon would forward-roll to tomorrow.
    const afternoon = new Date(2026, 6, 8, 15)
    const zhNoon = parseDate('中午', { now: afternoon, locale: 'zh', localePacks: [zh] })
    expect(zhNoon.ok, JSON.stringify(zhNoon.ok ? '' : zhNoon.issues)).toBe(true)
    if (zhNoon.ok) {
      expect(zhNoon.date).toEqual(new Date(2026, 6, 8, 12))
    }
    const jaNoon = parseDate('正午', { now: afternoon, locale: 'ja', localePacks: [ja] })
    expect(jaNoon.ok, JSON.stringify(jaNoon.ok ? '' : jaNoon.issues)).toBe(true)
    if (jaNoon.ok) {
      expect(jaNoon.date).toEqual(new Date(2026, 6, 8, 12))
    }
  })
})

// ─── Suffix-delimited dates and clocks ──────────────────────────────────────

describe('CJK suffix dates and clocks', () => {
  const dates = [
    ['zh', '2026年3月5日', new Date(2026, 2, 5)],
    ['zh', '3月5日', new Date(2026, 2, 5)],
    ['zh', '二〇二六年三月五日', new Date(2026, 2, 5)],
    ['ja', '2026年3月5日', new Date(2026, 2, 5)],
    ['ja', '3月5日', new Date(2026, 2, 5)],
  ] as const

  it.each(dates)('%s %s reads the 年/月/日 suffixes', (locale, input, expected) => {
    const result = parseDate(input, { now: NOW, locale, localePacks: [zh, ja] })
    expect(result.ok, `${input}: ${JSON.stringify(result.ok ? '' : result.issues)}`).toBe(true)
    if (result.ok) {
      expect(result.date).toEqual(expected)
      expect(result.grain).toBe('day')
    }
  })

  const clocks = [
    ['zh', '下午3点', new Date(2026, 6, 8, 15)],
    ['zh', '上午9点半', new Date(2026, 6, 9, 9, 30)],
    ['zh', '3点一刻', new Date(2026, 6, 9, 3, 15)],
    ['zh', '晚上8点30分', new Date(2026, 6, 8, 20, 30)],
    ['ja', '午後3時', new Date(2026, 6, 8, 15)],
    ['ja', '午前9時半', new Date(2026, 6, 9, 9, 30)],
    ['ja', '3時15分', new Date(2026, 6, 9, 3, 15)],
  ] as const

  it.each(clocks)('%s %s reads the day period and clock suffix', (locale, input, expected) => {
    const result = parseDate(input, { now: NOW, locale, localePacks: [zh, ja] })
    expect(result.ok, `${input}: ${JSON.stringify(result.ok ? '' : result.issues)}`).toBe(true)
    if (result.ok) {
      expect(result.date).toEqual(expected)
    }
  })

  // Date and time run together with no separating space.
  const unspaced = [
    ['zh', '明天下午3点', new Date(2026, 6, 9, 15)],
    ['zh', '昨天上午9点', new Date(2026, 6, 7, 9)],
    ['ja', '明日午後3時', new Date(2026, 6, 9, 15)],
  ] as const

  it.each(unspaced)('%s %s splits date from time without a space', (locale, input, expected) => {
    const result = parseDate(input, { now: NOW, locale, localePacks: [zh, ja] })
    expect(result.ok, `${input}: ${JSON.stringify(result.ok ? '' : result.issues)}`).toBe(true)
    if (result.ok) {
      expect(result.date).toEqual(expected)
    }
  })

  const weekdays = [
    ['zh', '星期三', new Date(2026, 6, 8)],
    ['zh', '周三', new Date(2026, 6, 8)],
    ['ja', '水曜日', new Date(2026, 6, 8)],
    ['ja', '水曜', new Date(2026, 6, 8)],
  ] as const

  it.each(weekdays)('%s %s resolves the weekday', (locale, input, expected) => {
    const result = parseDate(input, { now: NOW, locale, localePacks: [zh, ja] })
    expect(result.ok, `${input}: ${JSON.stringify(result.ok ? '' : result.issues)}`).toBe(true)
    if (result.ok) {
      expect(result.date).toEqual(expected)
    }
  })
})

// ─── Postpositional bounds ──────────────────────────────────────────────────

describe('CJK postpositional bounds', () => {
  const lingo = createLingo({ locales: [zh, ja] })

  const bounds = [
    ['zh', '5公斤以上', 5, null],
    ['zh', '5公斤以下', null, 5],
    ['zh', '5公斤以内', null, 5],
    ['zh', '大于5公斤', 5, null],
    ['zh', '小于5公斤', null, 5],
    ['zh', '不超过5公斤', null, 5],
    ['zh', '至少5公斤', 5, null],
    ['ja', '5キロ未満', null, 5],
    ['ja', '5キロ以上', 5, null],
    ['ja', '5キロ以下', null, 5],
    ['ja', '5キロ以内', null, 5],
    ['ja', '5キロ超', 5, null],
    ['ja', '最低5キロ', 5, null],
  ] as const

  it.each(bounds)('%s %s bounds the range', (locale, input, min, max) => {
    const result = lingo.parseRange(input, { locale })
    expect(result.ok, `${input}: ${JSON.stringify(result.ok ? '' : result.issues)}`).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.range.min()?.value ?? null).toBe(min)
    expect(result.range.max()?.value ?? null).toBe(max)
  })

  // GUARD: 間 is a range word but 時間 is a unit — the unit must stay whole.
  it('keeps 一時間半 as 1.5 hours, not a range across 間', () => {
    const result = lingo.parseQuantity('一時間半', { locale: 'ja' })
    expect(result.ok, JSON.stringify(result.ok ? '' : result.issues)).toBe(true)
    if (result.ok) {
      expect(result.quantity.unit).toBe('h')
      expect(result.quantity.value).toBe(1.5)
    }
  })
})

// ─── Currency defaults ──────────────────────────────────────────────────────

describe('CJK currency', () => {
  const lingo = createLingo({ locales: [zh, ja] })

  const money = [
    ['zh', '100元', 100, 'CNY'],
    ['zh', '一百元', 100, 'CNY'],
    ['zh', '50块', 50, 'CNY'],
    // ￥ is shared between the two currencies; the pack default decides.
    ['zh', '￥100', 100, 'CNY'],
    ['ja', '1000円', 1000, 'JPY'],
    ['ja', '￥1000', 1000, 'JPY'],
  ] as const

  it.each(money)('%s %s reads as %d %s', (locale, input, value, unit) => {
    const result = lingo.parseQuantity(input, { locale })
    expect(result.ok, `${input}: ${JSON.stringify(result.ok ? '' : result.issues)}`).toBe(true)
    if (result.ok) {
      expect(result.quantity.value).toBe(value)
      expect(result.quantity.unit).toBe(unit)
    }
  })
})
