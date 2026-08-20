import { describe, expect, it } from 'vitest'
import type { LocalePack } from '../locale/types'
import { humanizeDate, humanizeDuration, parseDate, parseDuration } from './index'

const NOW = new Date(2026, 6, 3, 14, 30, 0)
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function expectOkDate(
  input: string,
  expected: Date,
  grain?: string,
  opts: Parameters<typeof parseDate>[1] = {},
) {
  const result = parseDate(input, { now: NOW, ...opts })
  if (!result.ok) {
    throw new Error(`parseDate("${input}") failed: ${JSON.stringify(result.issues)}`)
  }
  expect(result.date).toEqual(expected)
  if (grain) {
    expect(result.grain).toBe(grain)
  }
  expect(result.span.end).toBeGreaterThan(result.span.start)
  expect(result.known.length).toBeGreaterThan(0)
  return result
}

function expectDuration(
  input: string,
  seconds: number,
  opts: Parameters<typeof parseDuration>[1] = {},
) {
  const result = parseDuration(input, opts)
  if (!result.ok) {
    throw new Error(`parseDuration("${input}") failed: ${JSON.stringify(result.issues)}`)
  }
  expect(result.duration.base).toBeCloseTo(seconds, 9)
  return result
}

function expectDateRoundTrip(result: ReturnType<typeof expectOkDate>, now: Date) {
  const phrase =
    result.grain === 'month'
      ? `${MONTH_NAMES[result.date.getMonth()]} ${result.date.getFullYear()}`
      : `${MONTH_NAMES[result.date.getMonth()]} ${result.date.getDate()} ${result.date.getFullYear()}`
  const reparsed = parseDate(phrase, { now })
  expect(reparsed.ok).toBe(true)
  if (!reparsed.ok) {
    return
  }
  expect(reparsed.date).toEqual(result.date)
  expect(reparsed.grain).toBe(result.grain)
}

describe('parseDate deictic and offsets', () => {
  it('requires now for inputs that depend on a reference time', () => {
    for (const input of ['tomorrow', 'March 5', 'at 3pm', 'next Friday']) {
      const result = parseDate(input)
      expect(result.ok, input).toBe(false)
      if (!result.ok) {
        expect(result.issues).toEqual([
          expect.objectContaining({
            code: 'NOW_REQUIRED',
            severity: 'error',
            span: expect.objectContaining({ start: 0 }),
          }),
        ])
        expect(result.candidate, input).toBeUndefined()
      }
    }

    expect(parseDate('2026-07-03').ok).toBe(true)
    expect(parseDate('March 5 2026').ok).toBe(true)
  })

  it('allows fully anchored day offsets without now', () => {
    const anchored = parseDate('3 days after March 3 2026')
    expect(anchored.ok).toBe(true)
    if (anchored.ok) {
      expect(anchored.date).toEqual(new Date(2026, 2, 6))
    }

    const borrowedClock = parseDate('3min after March 3 2026')
    expect(borrowedClock.ok).toBe(false)
    if (!borrowedClock.ok) {
      expect(borrowedClock.issues.some((issue) => issue.code === 'NOW_REQUIRED')).toBe(true)
      expect(borrowedClock.candidate).toBeUndefined()
    }
  })

  it('parses deictic and casual anchors', () => {
    const rows: Array<[string, Date, string]> = [
      ['now', NOW, 'second'],
      ['right now', NOW, 'second'],
      ['just now', NOW, 'second'],
      ['a moment ago', NOW, 'second'],
      ['today', new Date(2026, 6, 3), 'day'],
      ['tonight', new Date(2026, 6, 3, 22), 'hour'],
      ['tonite', new Date(2026, 6, 3, 22), 'hour'],
      ['tomorrow', new Date(2026, 6, 4), 'day'],
      ['tmr', new Date(2026, 6, 4), 'day'],
      ['tmrw', new Date(2026, 6, 4), 'day'],
      ['tmrw.', new Date(2026, 6, 4), 'day'],
      ['yesterday', new Date(2026, 6, 2), 'day'],
      ['yday', new Date(2026, 6, 2), 'day'],
      ["y'day", new Date(2026, 6, 2), 'day'],
      ['day after tomorrow', new Date(2026, 6, 5), 'day'],
      ['overmorrow', new Date(2026, 6, 5), 'day'],
      ['day before yesterday', new Date(2026, 6, 1), 'day'],
      ['this morning', new Date(2026, 6, 3, 9), 'hour'],
      ['this afternoon', new Date(2026, 6, 3, 15), 'hour'],
      ['this evening', new Date(2026, 6, 3, 19), 'hour'],
      ['noon', new Date(2026, 6, 3, 12), 'hour'],
      ['midnight', new Date(2026, 6, 4), 'hour'],
    ]
    for (const [input, expected, grain] of rows) {
      expectOkDate(input, expected, grain)
    }
  })

  it('parses offset phrases and anchored offsets', () => {
    const rows: Array<[string, Date, string]> = [
      ['in 90 minutes', new Date(2026, 6, 3, 16, 0), 'minute'],
      ['in 10m', new Date(2026, 6, 3, 14, 40), 'minute'],
      ['in 5h', new Date(2026, 6, 3, 19, 30), 'hour'],
      ['in 2d', new Date(2026, 6, 5, 14, 30), 'day'],
      ['in 2 d', new Date(2026, 6, 5, 14, 30), 'day'],
      ['90 minutes ago', new Date(2026, 6, 3, 13, 0), 'minute'],
      ['2w ago', new Date(2026, 5, 19, 14, 30), 'day'],
      ['2 hours from now', new Date(2026, 6, 3, 16, 30), 'hour'],
      ['3mo from now', new Date(2026, 9, 3, 14, 30), 'month'],
      ['1y from now', new Date(2027, 6, 3, 14, 30), 'year'],
      ['2 hours and 15 minutes ago', new Date(2026, 6, 3, 12, 15), 'minute'],
      ['half an hour ago', new Date(2026, 6, 3, 14, 0), 'hour'],
      ['an hour ago', new Date(2026, 6, 3, 13, 30), 'hour'],
      ['twenty-five minutes ago', new Date(2026, 6, 3, 14, 5), 'minute'],
      ['in 1h30', new Date(2026, 6, 3, 16, 0), 'minute'],
      ['a week from Friday', new Date(2026, 6, 10), 'day'],
      ['2 days after tomorrow', new Date(2026, 6, 6), 'day'],
      ['a month from today', new Date(2026, 7, 3), 'month'],
      ['3min from tmrw', new Date(2026, 6, 4, 14, 33), 'minute'],
      ['2h after tmr', new Date(2026, 6, 4, 16, 30), 'hour'],
      ['a week from yday', new Date(2026, 6, 9), 'day'],
      ['a week from tmrw', new Date(2026, 6, 11), 'day'],
    ]
    for (const [input, expected, grain] of rows) {
      expectOkDate(input, expected, grain)
    }
  })

  it('clamps month and year offsets once', () => {
    expectOkDate('in 1 month', new Date(2026, 1, 28, 9), 'month', {
      now: new Date(2026, 0, 31, 9),
    })
    expectOkDate('in 1 month', new Date(2028, 1, 29, 9), 'month', {
      now: new Date(2028, 0, 31, 9),
    })
    expectOkDate('in 1 year', new Date(2029, 1, 28, 9), 'year', {
      now: new Date(2028, 1, 29, 9),
    })
    expectOkDate('in 1 month and 1 day', new Date(2026, 2, 1, 9), 'day', {
      now: new Date(2026, 0, 31, 9),
    })
    expectOkDate('in 1 month and 1 month', new Date(2026, 2, 31, 9), 'month', {
      now: new Date(2026, 0, 31, 9),
    })
  })
})

describe('parseDate weekdays and calendar periods', () => {
  it('parses weekday matrix from Friday', () => {
    const rows: Array<[string, Date]> = [
      ['Friday', new Date(2026, 6, 3)],
      ['Monday', new Date(2026, 6, 6)],
      ['this Monday', new Date(2026, 5, 29)],
      ['this Friday', new Date(2026, 6, 3)],
      ['next Monday', new Date(2026, 6, 6)],
      ['next Friday', new Date(2026, 6, 10)],
      ['last Monday', new Date(2026, 5, 29)],
      ['last Friday', new Date(2026, 5, 26)],
      ['on Wednesday', new Date(2026, 6, 8)],
      ['next tues', new Date(2026, 6, 7)],
      ['this thurs', new Date(2026, 6, 2)],
      ['last sat', new Date(2026, 5, 27)],
      ['on fri', new Date(2026, 6, 3)],
    ]
    for (const [input, expected] of rows) {
      expectOkDate(input, expected, 'day')
    }
    expect(
      expectOkDate('Friday', new Date(2026, 6, 3), 'day').issues.some(
        (i) => i.code === 'WEEKDAY_ASSUMED_NEXT',
      ),
    ).toBe(true)
    expect(expectOkDate('next Friday', new Date(2026, 6, 10), 'day').alternatives?.[0]?.type).toBe(
      'date',
    )
    expect(
      expectOkDate('next Friday', new Date(2026, 6, 10), 'day').alternatives?.[0]?.reason,
    ).toBe('soonest-occurrence')
  })

  it('parses weekday matrix from Sunday', () => {
    const sunday = new Date(2026, 6, 5, 10)
    const rows: Array<[string, Date]> = [
      ['Sunday', new Date(2026, 6, 5)],
      ['Monday', new Date(2026, 6, 6)],
      ['this Sunday', new Date(2026, 6, 5)],
      ['this Monday', new Date(2026, 5, 29)],
      ['next Monday', new Date(2026, 6, 6)],
      ['next Saturday', new Date(2026, 6, 11)],
      ['next Sunday', new Date(2026, 6, 12)],
      ['last Sunday', new Date(2026, 5, 28)],
    ]
    for (const [input, expected] of rows) {
      expectOkDate(input, expected, 'day', { now: sunday })
    }
  })

  it('parses calendar period phrases', () => {
    const rows: Array<[string, Date, string]> = [
      ['this week', new Date(2026, 5, 29), 'week'],
      ['next week', new Date(2026, 6, 6), 'week'],
      ['last week', new Date(2026, 5, 22), 'week'],
      ['this month', new Date(2026, 6, 1), 'month'],
      ['next month', new Date(2026, 7, 1), 'month'],
      ['last month', new Date(2026, 5, 1), 'month'],
      ['this year', new Date(2026, 0, 1), 'year'],
      ['next year', new Date(2027, 0, 1), 'year'],
      ['last year', new Date(2025, 0, 1), 'year'],
      ['this weekend', new Date(2026, 6, 4), 'day'],
      ['beginning of the week', new Date(2026, 5, 29), 'week'],
      ['start of next month', new Date(2026, 7, 1), 'month'],
      ['end of week', new Date(2026, 6, 5), 'day'],
      ['end of month', new Date(2026, 6, 31), 'day'],
      ['end of year', new Date(2026, 11, 31), 'day'],
      ['middle of month', new Date(2026, 6, 15), 'day'],
      ['mid-June', new Date(2027, 5, 15), 'day'],
    ]
    for (const [input, expected, grain] of rows) {
      expectOkDate(input, expected, grain)
    }
  })

  it('parses next/last month names as strict month periods', () => {
    const julyNow = new Date(2026, 6, 8, 12)
    // Like `last month`, named month modifiers are strict period shifts: the
    // current July is neither "last July" nor "next July".
    const last = expectOkDate('last july', new Date(2025, 6, 1), 'month', { now: julyNow })
    const next = expectOkDate('next july', new Date(2027, 6, 1), 'month', { now: julyNow })
    expectDateRoundTrip(last, julyNow)
    expectDateRoundTrip(next, julyNow)
  })

  it('parses day-part compounds from day offsets and weekdays', () => {
    expectOkDate('tomorrow morning', new Date(2026, 6, 4, 9), 'hour')
    expectOkDate('yesterday evening', new Date(2026, 6, 2, 19), 'hour')
    expectOkDate('Friday morning', new Date(2026, 6, 3, 9), 'hour', {
      now: new Date(2026, 6, 2, 12),
    })

    const noNow = parseDate('tomorrow morning')
    expect(noNow.ok).toBe(false)
    expect(!noNow.ok && noNow.issues.some((issue) => issue.code === 'NOW_REQUIRED')).toBe(true)
  })

  it('keeps English humanize output parseable for newly accepted English idioms', () => {
    for (const input of ['tomorrow morning', 'Monday week']) {
      const parsed = parseDate(input, { now: NOW })
      expect(parsed.ok, input).toBe(true)
      if (!parsed.ok) {
        continue
      }
      const phrase = humanizeDate(parsed.date, { now: NOW })
      const reparsed = parseDate(phrase, { now: NOW })
      expect(reparsed.ok, `${input} -> ${phrase}`).toBe(true)
    }
  })

  it('parses weekday-offset phrases from pack data', () => {
    expectOkDate('Monday week', new Date(2026, 6, 13), 'day')
    expectOkDate('a week Monday', new Date(2026, 6, 13), 'day')
    expectOkDate('week on Tuesday', new Date(2026, 6, 14), 'day')
    expectOkDate('Tuesday fortnight', new Date(2026, 6, 21), 'day')
    const noNow = parseDate('Monday week')
    expect(noNow.ok).toBe(false)
    expect(!noNow.ok && noNow.issues.some((issue) => issue.code === 'NOW_REQUIRED')).toBe(true)

    const frWeekdayOffset: LocalePack = {
      locale: 'fr-weekday-offset',
      extends: 'en',
      date: {
        weekdayOffsetPhrases: { 'en huit': 7, 'en quinze': 14 },
        weekdayNames: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
        weekdays: { lundi: 1, mardi: 2 },
      },
    }
    expectOkDate('lundi en huit', new Date(2026, 6, 13), 'day', {
      locale: 'fr-weekday-offset',
      localePacks: [frWeekdayOffset],
    })
    expectOkDate('mardi en quinze', new Date(2026, 6, 21), 'day', {
      locale: 'fr-weekday-offset',
      localePacks: [frWeekdayOffset],
    })
  })

  it('parses after-next and before-last period modifiers from pack data', () => {
    expectOkDate('the week after next', new Date(2026, 6, 13), 'week')
    expectOkDate('the week before last', new Date(2026, 5, 15), 'week')
    const noNow = parseDate('the week after next')
    expect(noNow.ok).toBe(false)
    expect(!noNow.ok && noNow.issues.some((issue) => issue.code === 'NOW_REQUIRED')).toBe(true)

    const jaDoubleStep: LocalePack = {
      locale: 'ja-double-step',
      extends: 'en',
      date: {
        calendarPeriodPhrases: {
          再来週: { modifier: 'afterNext', period: 'week' },
          先々週: { modifier: 'beforeLast', period: 'week' },
          再来月: { modifier: 'afterNext', period: 'month' },
        },
      },
    }
    expectOkDate('再来週', new Date(2026, 6, 20), 'week', {
      now: new Date(2026, 6, 8, 12),
      locale: 'ja-double-step',
      localePacks: [jaDoubleStep],
    })
    expectOkDate('先々週', new Date(2026, 5, 22), 'week', {
      now: new Date(2026, 6, 8, 12),
      locale: 'ja-double-step',
      localePacks: [jaDoubleStep],
    })
    expectOkDate('再来月', new Date(2026, 8, 1), 'month', {
      now: new Date(2026, 6, 8, 12),
      locale: 'ja-double-step',
      localePacks: [jaDoubleStep],
    })
  })

  it('parses localized period-edge phrases and month composition', () => {
    const esEdges: LocalePack = {
      locale: 'es-edges',
      extends: 'en',
      date: {
        fillerWords: ['de'],
        months: { julio: 6 },
        periodEdgePhrases: {
          'a finales': { period: 'month', edge: 'end' },
          'a mediados': { period: 'month', edge: 'mid' },
          'a principios': { period: 'month', edge: 'start' },
        },
        periodWords: { month: ['mes'] },
      },
    }
    expectOkDate('a finales de mes', new Date(2026, 6, 31), 'day', {
      now: new Date(2026, 6, 8, 12),
      locale: 'es-edges',
      localePacks: [esEdges],
    })
    expectOkDate('a principios de mes', new Date(2026, 6, 1), 'day', {
      now: new Date(2026, 6, 8, 12),
      locale: 'es-edges',
      localePacks: [esEdges],
    })
    expectOkDate('a mediados de julio', new Date(2026, 6, 15), 'day', {
      now: new Date(2026, 6, 8, 12),
      locale: 'es-edges',
      localePacks: [esEdges],
    })

    const frEdges: LocalePack = {
      locale: 'fr-edges',
      extends: 'en',
      date: {
        months: { juillet: 6 },
        periodEdgePhrases: {
          debut: { period: 'month', edge: 'start' },
          fin: { period: 'month', edge: 'end' },
          mi: { period: 'month', edge: 'mid' },
        },
      },
    }
    for (const [input, date] of [
      ['début juillet', new Date(2027, 6, 1)],
      ['mi-juillet', new Date(2026, 6, 15)],
      ['fin juillet', new Date(2026, 6, 31)],
    ] as const) {
      expectOkDate(input, date, 'day', {
        now: new Date(2026, 6, 8, 12),
        locale: 'fr-edges',
        localePacks: [frEdges],
      })
    }

    const ptEdges: LocalePack = {
      locale: 'pt-edges',
      extends: 'en',
      date: {
        fillerWords: ['de', 'do'],
        months: { julho: 6 },
        periodEdgePhrases: {
          fim: { period: 'month', edge: 'end' },
          inicio: { period: 'month', edge: 'start' },
          meio: { period: 'month', edge: 'mid' },
          'no comeco': { period: 'month', edge: 'start' },
        },
        periodWords: { month: ['mes'] },
      },
    }
    for (const [input, date] of [
      ['início de julho', new Date(2027, 6, 1)],
      ['fim de julho', new Date(2026, 6, 31)],
      ['meio de julho', new Date(2026, 6, 15)],
      ['no começo do mês', new Date(2026, 6, 1)],
    ] as const) {
      expectOkDate(input, date, 'day', {
        now: new Date(2026, 6, 8, 12),
        locale: 'pt-edges',
        localePacks: [ptEdges],
      })
    }

    const zhEdges: LocalePack = {
      locale: 'zh-edges',
      extends: 'en',
      date: {
        periodEdgePhrases: {
          月初: { period: 'month', edge: 'start' },
          月底: { period: 'month', edge: 'end' },
          年底: { period: 'year', edge: 'end' },
        },
      },
    }
    expectOkDate('月底', new Date(2026, 6, 31), 'day', {
      now: new Date(2026, 6, 8, 12),
      locale: 'zh-edges',
      localePacks: [zhEdges],
    })
    expectOkDate('月初', new Date(2026, 6, 1), 'day', {
      now: new Date(2026, 6, 8, 12),
      locale: 'zh-edges',
      localePacks: [zhEdges],
    })
    expectOkDate('年底', new Date(2026, 11, 31), 'day', {
      now: new Date(2026, 6, 8, 12),
      locale: 'zh-edges',
      localePacks: [zhEdges],
    })
  })
})

describe('parseDate absolute dates and times', () => {
  it('parses ISO, numeric, and named dates', () => {
    const rows: Array<[string, Date, string]> = [
      ['2026-07-03', new Date(2026, 6, 3), 'day'],
      ['2026-07-03T14:30', new Date(2026, 6, 3, 14, 30), 'minute'],
      ['2026-07-03T14:30:05', new Date(2026, 6, 3, 14, 30, 5), 'second'],
      ['7/3/2026', new Date(2026, 6, 3), 'day'],
      ['7.3.2026', new Date(2026, 6, 3), 'day'],
      ['March 5', new Date(2027, 2, 5), 'day'],
      ['March 5th', new Date(2027, 2, 5), 'day'],
      ['March 5th, 2026', new Date(2026, 2, 5), 'day'],
      ['5 March', new Date(2027, 2, 5), 'day'],
      ['5th of March', new Date(2027, 2, 5), 'day'],
      ["Mar 5 '26", new Date(2026, 2, 5), 'day'],
      ['July', new Date(2027, 6, 1), 'month'],
      ['Jan 2020', new Date(2020, 0, 1), 'month'],
      ['2024', new Date(2024, 0, 1), 'year'],
    ]
    for (const [input, expected, grain] of rows) {
      expectOkDate(input, expected, grain)
    }
    const ambiguous = expectOkDate('5/3/2026', new Date(2026, 4, 3), 'day')
    expect(ambiguous.issues.some((i) => i.code === 'AMBIGUOUS_DATE')).toBe(true)
    expectOkDate('5/3/2026', new Date(2026, 2, 5), 'day', { dayFirst: true })
    expectOkDate('5/3/2026', new Date(2026, 2, 5), 'day', { locale: 'en-GB' })
  })

  it('keeps yearless month-day dates future-biased after the stated day passes', () => {
    const afterJuly12 = new Date(2026, 6, 20, 9)
    // Plan 005's binding refinements make `forwardDates: true` the default for
    // UI input, so a yearless month+day rolls forward once this year's date is past.
    const result = expectOkDate('july 12th', new Date(2027, 6, 12), 'day', { now: afterJuly12 })
    expectDateRoundTrip(result, afterJuly12)
  })

  it('parses time-only and date-time phrases', () => {
    const rows: Array<[string, Date, string]> = [
      ['at 3pm', new Date(2026, 6, 3, 15), 'hour'],
      ['@ 3pm', new Date(2026, 6, 3, 15), 'hour'],
      ['3 pm', new Date(2026, 6, 3, 15), 'hour'],
      ['3:05 pm', new Date(2026, 6, 3, 15, 5), 'minute'],
      ['15:30', new Date(2026, 6, 3, 15, 30), 'minute'],
      ['17h30', new Date(2026, 6, 3, 17, 30), 'minute'],
      ['at noon', new Date(2026, 6, 4, 12), 'hour'],
      ['7 in the morning', new Date(2026, 6, 4, 7), 'hour'],
      ['7 in the evening', new Date(2026, 6, 3, 19), 'hour'],
      ['tomorrow at 3pm', new Date(2026, 6, 4, 15), 'hour'],
      ['3pm tomorrow', new Date(2026, 6, 4, 15), 'hour'],
      ['2026-07-03 14:30', new Date(2026, 6, 3, 14, 30), 'minute'],
    ]
    for (const [input, expected, grain] of rows) {
      expectOkDate(input, expected, grain)
    }
    const zoned = expectOkDate('3pm EST', new Date(2026, 6, 3, 15), 'hour')
    expect(zoned.issues.some((i) => i.code === 'TZ_IGNORED')).toBe(true)
  })

  it('parses expanded time-of-day forms (17h, o’clock, quarter/half past/to, dot, midi/minuit, military)', () => {
    const rows: Array<[string, Date, string]> = [
      ['17h', new Date(2026, 6, 3, 17), 'hour'],
      ['5 o’clock pm', new Date(2026, 6, 3, 17), 'hour'],
      ['5.30pm', new Date(2026, 6, 3, 17, 30), 'minute'],
      ['17.30', new Date(2026, 6, 3, 17, 30), 'minute'],
      ['quarter past 5', new Date(2026, 6, 4, 5, 15), 'minute'],
      ['half past 3', new Date(2026, 6, 4, 3, 30), 'minute'],
      ['quarter to 6', new Date(2026, 6, 4, 5, 45), 'minute'],
      ['twenty past 4', new Date(2026, 6, 4, 4, 20), 'minute'],
      ['ten to 6', new Date(2026, 6, 4, 5, 50), 'minute'],
      ['half 5', new Date(2026, 6, 4, 5, 30), 'minute'],
      ['midi', new Date(2026, 6, 4, 12), 'hour'],
      ['minuit', new Date(2026, 6, 4, 0), 'hour'],
      ['midday', new Date(2026, 6, 4, 12), 'hour'],
      ['0900 hours', new Date(2026, 6, 4, 9), 'minute'],
      ['1730 hrs', new Date(2026, 6, 3, 17, 30), 'minute'],
    ]
    for (const [input, expected, grain] of rows) {
      expectOkDate(input, expected, grain)
    }
  })

  it('parses localized spoken-clock forms from DateVocabPack clock tables', () => {
    expectOkDate('quarter of five', new Date(2026, 6, 4, 4, 45), 'minute')
    expectOkDate('half seven', new Date(2026, 6, 4, 7, 30), 'minute')
    expectOkDate("five o'clock", new Date(2026, 6, 4, 5), 'hour')

    const esClock: LocalePack = {
      locale: 'es-clock',
      extends: 'en',
      numberWords: { ones: { dos: 2, tres: 3, quince: 15 } },
      date: {
        clockMinuteWords: { cuarto: 15, media: 30 },
        clockPastWords: ['y'],
        clockToWords: ['menos'],
        fillerWords: ['las'],
      },
    }
    expectOkDate('las tres menos cuarto', new Date(2026, 6, 4, 2, 45), 'minute', {
      locale: 'es-clock',
      localePacks: [esClock],
    })

    const frClock: LocalePack = {
      locale: 'fr-clock',
      extends: 'en',
      numberWords: { ones: { deux: 2, trois: 3 } },
      date: {
        clockMinuteWords: { demi: 30, demie: 30, quart: 15 },
        clockPastWords: ['et'],
        clockToWords: ['moins'],
        fillerWords: ['le'],
        unitWords: { heure: 'hour', heures: 'hour' },
      },
    }
    expectOkDate('deux heures et quart', new Date(2026, 6, 4, 2, 15), 'minute', {
      locale: 'fr-clock',
      localePacks: [frClock],
    })
    expectOkDate('trois heures moins le quart', new Date(2026, 6, 4, 2, 45), 'minute', {
      locale: 'fr-clock',
      localePacks: [frClock],
    })

    const ptClock: LocalePack = {
      locale: 'pt-clock',
      extends: 'en',
      numberWords: { ones: { duas: 2, tres: 3, quinze: 15 } },
      date: {
        clockMinuteWords: { meia: 30 },
        clockPastWords: ['e'],
        clockToWords: ['para as', 'para'],
        fillerWords: ['as'],
      },
    }
    expectOkDate('duas e meia', new Date(2026, 6, 4, 2, 30), 'minute', {
      locale: 'pt-clock',
      localePacks: [ptClock],
    })
    expectOkDate('quinze para as três', new Date(2026, 6, 4, 2, 45), 'minute', {
      locale: 'pt-clock',
      localePacks: [ptClock],
    })
  })

  it('does not misread bare "N to M" as a relative-minute time (that is a range)', () => {
    // "5 to 6" is 5:55 grammatically but almost always a time SLOT — leave it to
    // parseDateRange rather than misreading it. Bare 4-digit and decimals too.
    for (const input of ['5 to 6', '9 to 5', '2 to 4', '0900', '1700', '5.30']) {
      const r = parseDate(input, { now: NOW })
      // Either fails or is NOT a relative-minute time reading.
      if (r.ok) {
        expect(r.grain === 'minute' && r.date.getMinutes() % 5 !== 0).toBe(false)
      }
    }
  })

  it('detects and exposes timezones; applyZone resolves the real UTC instant', () => {
    // Default: zone exposed, civil time kept, flagged not-applied + ambiguous.
    const exposed = parseDate('3pm EST', { now: NOW })
    expect(exposed.ok).toBe(true)
    if (!exposed.ok) {
      return
    }
    expect(exposed.zone).toMatchObject({
      source: 'abbrev',
      offsetMinutes: -300,
      ambiguous: true,
      applied: false,
    })
    expect(exposed.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['TZ_IGNORED', 'AMBIGUOUS_TIMEZONE']),
    )

    // applyZone: the real instant (3pm EST = 20:00 UTC), no TZ_IGNORED.
    const applied = parseDate('3pm EST', { now: NOW, applyZone: true })
    expect(applied.ok && applied.date.toISOString()).toBe('2026-07-03T20:00:00.000Z')
    expect(applied.ok && applied.zone?.applied).toBe(true)
    expect(applied.ok && applied.issues.some((i) => i.code === 'TZ_IGNORED')).toBe(false)

    // Explicit offset (exact) and IANA (DST-correct via Intl).
    const offset = parseDate('15:00 +05:30', { now: NOW, applyZone: true })
    expect(offset.ok && offset.date.toISOString()).toBe('2026-07-03T09:30:00.000Z')
    const paris = parseDate('9am Europe/Paris', { now: NOW, applyZone: true })
    expect(paris.ok && paris.zone?.source).toBe('iana')
    expect(paris.ok && paris.date.toISOString()).toBe('2026-07-04T07:00:00.000Z')
  })

  it('rejects unlikely bare numeric free text', () => {
    expect(parseDate('1', { now: NOW }).ok).toBe(false)
    expect(parseDate('invoice 2024', { now: NOW }).ok).toBe(false)
  })
})

describe('parseDuration', () => {
  it('parses ISO-8601 and colon durations', () => {
    expectDuration('PT1H30M', 5400)
    expectDuration('P2DT3H', 183_600)
    expectDuration('P4W', 2_419_200)
    expectDuration(
      'P1Y2M3DT4H5M6S',
      31_557_600 + 2 * 2_629_800 + 3 * 86_400 + 4 * 3600 + 5 * 60 + 6,
    )
    expectDuration('PT0.5S', 0.5)
    expectDuration('PT0,5S', 0.5)
    const colon = expectDuration('1:30', 5400)
    expect(colon.issues.some((i) => i.code === 'AMBIGUOUS_DATE')).toBe(true)
    expectDuration('1:30:05', 5405)
  })

  it('rejects invalid ISO durations', () => {
    expect(parseDuration('P').ok).toBe(false)
    expect(parseDuration('PT1.5H30M').ok).toBe(false)
  })

  it('delegates natural duration quantities and warns on civil averages', () => {
    expectDuration('an hour and a half', 5400)
    expectDuration('2 hours 15 minutes', 8100)
    const primeMinutes = expectDuration("90'", 5400)
    expect(primeMinutes.issues.some((i) => i.code === 'SLANG_UNIT')).toBe(true)
    const primeSeconds = expectDuration("45''", 45)
    expect(primeSeconds.issues.some((i) => i.code === 'SLANG_UNIT')).toBe(true)
    const month = expectDuration('1 month', 2_629_800)
    expect(month.issues.some((i) => i.code === 'CIVIL_AVERAGE')).toBe(true)
  })

  it('parses localized duration unit words from DateVocabPack tables', () => {
    const esDuration: LocalePack = {
      locale: 'es-duration',
      extends: 'en',
      numberWords: {
        andWords: ['y'],
        fractionWords: { cuarto: 1 / 4, media: 1 / 2, medio: 1 / 2 },
        ofWords: ['de'],
        ones: { dos: 2, un: 1, una: 1 },
      },
      date: {
        fillerWords: ['de'],
        unitWords: { hora: 'hour', horas: 'hour' },
      },
    }
    const esOpts = { locale: 'es-duration', localePacks: [esDuration] }
    expectDuration('2 horas', 7200, esOpts)
    expectDuration('dos horas', 7200, esOpts)
    expectDuration('media hora', 1800, esOpts)
    expectDuration('un cuarto de hora', 900, esOpts)

    const ptDuration: LocalePack = {
      locale: 'pt-duration',
      extends: 'en',
      numberWords: {
        andWords: ['e'],
        fractionWords: { meia: 1 / 2, meio: 1 / 2 },
        ones: { duas: 2, uma: 1, um: 1 },
      },
      date: {
        unitWords: { hora: 'hour', horas: 'hour' },
      },
    }
    const ptOpts = { locale: 'pt-duration', localePacks: [ptDuration] }
    expectDuration('duas horas', 7200, ptOpts)
    expectDuration('meia hora', 1800, ptOpts)
  })

  it('humanized duration output parses back', () => {
    for (const style of ['narrow', 'short', 'long', 'natural'] as const) {
      const text = humanizeDuration(5400, { style })
      expectDuration(text, 5400)
    }
  })
})
