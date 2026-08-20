import { describe, expect, it } from 'vitest'
import { humanizeDateRange } from './humanize'
import { parseDateRange } from './parse'

// A fixed morning reference so time-of-day slots land on the same civil day.
const NOW = new Date(2026, 6, 3, 9, 0, 0) // Fri 2026-07-03 09:00 local

function hm(d: Date): [number, number] {
  return [d.getHours(), d.getMinutes()]
}

describe('parseDateRange', () => {
  it('parses an explicit am/pm pair', () => {
    const r = parseDateRange('2pm to 4pm', { now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(hm(r.start!.date)).toEqual([14, 0])
    expect(hm(r.end!.date)).toEqual([16, 0])
    expect(r.start!.date.getDate()).toBe(3)
    expect(r.end!.date.getDate()).toBe(3)
  })

  it('accepts "between X and Y"', () => {
    const r = parseDateRange('between 9am and 5pm', { now: NOW })
    expect(r.ok && [hm(r.start!.date), hm(r.end!.date)]).toEqual([
      [9, 0],
      [17, 0],
    ])
  })

  it('infers the shared half in "2 to 4pm"', () => {
    const r = parseDateRange('2 to 4pm', { now: NOW })
    expect(r.ok && [hm(r.start!.date), hm(r.end!.date)]).toEqual([
      [14, 0],
      [16, 0],
    ])
  })

  it('reads the "9-5" / "9 to 5" workday shift as 9am–5pm', () => {
    for (const text of ['9-5', '9 to 5', '9am-5']) {
      const r = parseDateRange(text, { now: NOW })
      expect(r.ok && [hm(r.start!.date), hm(r.end!.date)]).toEqual([
        [9, 0],
        [17, 0],
      ])
    }
  })

  it('shifts an equal bare pair to a 12h slot, never a 24h span', () => {
    // "6 to 6" is 6am–6pm, not 6am→6am-next-day.
    const r = parseDateRange('6 to 6', { now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect([hm(r.start!.date), hm(r.end!.date)]).toEqual([
      [6, 0],
      [18, 0],
    ])
    expect(r.start!.date.getDate()).toBe(r.end!.date.getDate())
  })

  it('infers pm for an ambiguous colon end but keeps a 24h pair literal', () => {
    // A colon time without am/pm is ambiguous, so "9 to 5:30" is 9am–5:30pm.
    const inferred = parseDateRange('9 to 5:30', { now: NOW })
    expect(inferred.ok && [hm(inferred.start!.date), hm(inferred.end!.date)]).toEqual([
      [9, 0],
      [17, 30],
    ])
    // A 24h endpoint fixes the whole pair — "05:30 to 17:00" is not re-halved.
    const literal = parseDateRange('05:30 to 17:00', { now: NOW })
    expect(literal.ok && [hm(literal.start!.date), hm(literal.end!.date)]).toEqual([
      [5, 30],
      [17, 0],
    ])
  })

  it('carries minutes and 24h endpoints', () => {
    const r = parseDateRange('from 13:30 to 15:45', { now: NOW })
    expect(r.ok && [hm(r.start!.date), hm(r.end!.date)]).toEqual([
      [13, 30],
      [15, 45],
    ])
  })

  it('rolls a cross-midnight end to the next day', () => {
    const r = parseDateRange('10pm to 2am', { now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(hm(r.start!.date)).toEqual([22, 0])
    expect(hm(r.end!.date)).toEqual([2, 0])
    expect(r.end!.date.getDate()).toBe(4)
  })

  it('supports open-ended starts and ends', () => {
    const from = parseDateRange('from 3pm', { now: NOW })
    expect(from.ok && from.end).toBeUndefined()
    expect(from.ok && hm(from.start!.date)).toEqual([15, 0])

    const until = parseDateRange('until 5pm', { now: NOW })
    expect(until.ok && until.start).toBeUndefined()
    expect(until.ok && hm(until.end!.date)).toEqual([17, 0])
  })

  it('binds a trailing zone to the WHOLE slot, not just the last endpoint', () => {
    const r = parseDateRange('2pm to 4pm EST', { now: NOW, applyZone: true })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    // BOTH endpoints are EST: 2pm EST → 19:00Z, 4pm EST (−05:00) → 21:00Z.
    expect(r.start!.date.toISOString()).toBe('2026-07-03T19:00:00.000Z')
    expect(r.end!.date.toISOString()).toBe('2026-07-03T21:00:00.000Z')
    expect(r.start!.zone?.abbreviation).toBe('EST')
    expect(r.end!.zone?.abbreviation).toBe('EST')
  })

  it('does not let a trailing zone hide an endpoint am/pm (inference stays correct)', () => {
    // "3am EST to 5pm": the "am" must survive the zone strip, so start is 3am.
    const r = parseDateRange('3am EST to 5pm', { now: NOW })
    expect(r.ok && [hm(r.start!.date), hm(r.end!.date)]).toEqual([
      [3, 0],
      [17, 0],
    ])
  })

  it('points TZ issue spans at the zone token, not the whole input', () => {
    const r = parseDateRange('3pm to 5pm EST', { now: NOW })
    if (!r.ok) {
      throw new Error('expected ok')
    }
    // "EST" is at offsets 11–14; issues are emitted once, not per endpoint.
    expect(r.issues.map((i) => i.code)).toEqual(['TZ_IGNORED', 'AMBIGUOUS_TIMEZONE'])
    for (const issue of r.issues) {
      expect(issue.span).toEqual({ start: 11, end: 14 })
    }
  })

  it('requires an explicit now for the reference-dependent slot', () => {
    const r = parseDateRange('2pm to 4pm')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.issues[0]?.code).toBe('NOW_REQUIRED')
  })

  it('parses duration ranges anchored by a starting date', () => {
    const now = new Date(2026, 6, 8, 9, 0, 0)
    for (const text of ['3 days starting tomorrow', '3days starting tomorrow']) {
      const r = parseDateRange(text, { now })
      expect(r.ok).toBe(true)
      if (!r.ok) {
        return
      }
      expect(r.span).toEqual({ start: 0, end: text.length })
      expect(r.start?.date).toEqual(new Date(2026, 6, 9))
      expect(r.end?.date).toEqual(new Date(2026, 6, 12))
      expect(r.start?.grain).toBe('day')
      expect(r.end?.grain).toBe('day')

      const phrase = humanizeDateRange(r)
      expect(phrase).toBe('3 days starting 2026-07-09')
      const reparsed = parseDateRange(phrase, { now })
      expect(reparsed.ok).toBe(true)
      if (!reparsed.ok) {
        return
      }
      expect(reparsed.start?.date).toEqual(r.start?.date)
      expect(reparsed.end?.date).toEqual(r.end?.date)
    }
  })

  it('fails cleanly on non-ranges', () => {
    const r = parseDateRange('the quick brown fox', { now: NOW })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.issues[0]?.code).toBe('UNSUPPORTED_DATE')
  })
})

describe('humanizeDateRange round-trips', () => {
  const clock = (d: Date) => [d.getHours(), d.getMinutes()] as const

  for (const [text, hour12] of [
    ['2pm to 4pm', true],
    ['9-5', true],
    ['from 3pm', true],
    ['until 5:30pm', true],
    ['10pm to 2am', true],
    ['noon to midnight', true],
    ['noon to midnight', false],
    ['between 9am and 5pm', false],
    ['13:15 to 14:45', false],
  ] as const) {
    it(`re-parses "${text}" (hour12=${hour12})`, () => {
      const first = parseDateRange(text, { now: NOW })
      expect(first.ok).toBe(true)
      if (!first.ok) {
        return
      }
      const phrase = humanizeDateRange(first, { hour12 })
      const second = parseDateRange(phrase, { now: NOW })
      expect(second.ok).toBe(true)
      if (!second.ok) {
        return
      }
      expect(Boolean(second.start)).toBe(Boolean(first.start))
      expect(Boolean(second.end)).toBe(Boolean(first.end))
      if (first.start && second.start) {
        expect(clock(second.start.date)).toEqual(clock(first.start.date))
      }
      if (first.end && second.end) {
        expect(clock(second.end.date)).toEqual(clock(first.end.date))
      }
    })
  }
})

describe('parseAnchoredDurationRange offset correctness', () => {
  it('parses correctly when normalization shifts offsets (zero-width space before phrase)', () => {
    const now = new Date(2026, 6, 8, 9, 0, 0)
    const input = '​3 days starting tomorrow'
    const r = parseDateRange(input, { now })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.start?.date).toEqual(new Date(2026, 6, 9))
    expect(r.end?.date).toEqual(new Date(2026, 6, 12))
    expect(r.span).toEqual({ start: 1, end: input.length })
  })

  it('handles multiple invisible chars before the anchor portion', () => {
    const now = new Date(2026, 6, 8, 9, 0, 0)
    const input = '3 days​​ starting tomorrow'
    const r = parseDateRange(input, { now })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.start?.date).toEqual(new Date(2026, 6, 9))
    expect(r.end?.date).toEqual(new Date(2026, 6, 12))
  })

  it('span text matches original input slice for normalization-shifting input', () => {
    const now = new Date(2026, 6, 8, 9, 0, 0)
    const input = '​3 days starting 2026-03-01'
    const r = parseDateRange(input, { now })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(input.slice(r.span.start, r.span.end)).toBe('3 days starting 2026-03-01')
  })
})

describe('anchored duration range NOW_REQUIRED', () => {
  it('fails with NOW_REQUIRED for relative anchor without now', () => {
    const r = parseDateRange('3 days starting tomorrow')
    expect(r.ok).toBe(false)
    if (r.ok) {
      return
    }
    expect(r.issues.some((i) => i.code === 'NOW_REQUIRED')).toBe(true)
  })

  it('succeeds for absolute anchor without now', () => {
    const r = parseDateRange('3 days starting 2026-03-01')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.start?.date).toEqual(new Date(2026, 2, 1))
    expect(r.end?.date).toEqual(new Date(2026, 2, 4))
  })

  it('still works with now provided for absolute anchor', () => {
    const now = new Date(2026, 6, 8, 9, 0, 0)
    const r = parseDateRange('3 days starting 2026-03-01', { now })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.start?.date).toEqual(new Date(2026, 2, 1))
    expect(r.end?.date).toEqual(new Date(2026, 2, 4))
  })
})

describe('humanizeDateRange round-trips for time-grain anchored ranges', () => {
  it('round-trips an hour-grain anchored range', () => {
    const r = parseDateRange('3 hours starting 2026-03-01 9am')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.anchored).toBe(true)
    expect(r.start?.date).toEqual(new Date(2026, 2, 1, 9))
    expect(r.end?.date).toEqual(new Date(2026, 2, 1, 12))
    const phrase = humanizeDateRange(r)
    expect(phrase).toContain('starting')
    const reparsed = parseDateRange(phrase)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) {
      return
    }
    expect(reparsed.start?.date).toEqual(r.start?.date)
    expect(reparsed.end?.date).toEqual(r.end?.date)
  })

  it('round-trips a minute-grain anchored range', () => {
    const r = parseDateRange('30 minutes starting 2026-03-01 9am')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.anchored).toBe(true)
    expect(r.start?.date).toEqual(new Date(2026, 2, 1, 9))
    expect(r.end?.date).toEqual(new Date(2026, 2, 1, 9, 30))
    const phrase = humanizeDateRange(r)
    expect(phrase).toContain('starting')
    const reparsed = parseDateRange(phrase)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) {
      return
    }
    expect(reparsed.start?.date).toEqual(r.start?.date)
    expect(reparsed.end?.date).toEqual(r.end?.date)
  })

  it('round-trips a non-midnight day anchor with time', () => {
    const r = parseDateRange('2 hours starting 2026-07-08 2pm')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.anchored).toBe(true)
    expect(r.start?.date).toEqual(new Date(2026, 6, 8, 14))
    expect(r.end?.date).toEqual(new Date(2026, 6, 8, 16))
    const phrase = humanizeDateRange(r)
    expect(phrase).toContain('starting')
    const reparsed = parseDateRange(phrase)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) {
      return
    }
    expect(reparsed.start?.date).toEqual(r.start?.date)
    expect(reparsed.end?.date).toEqual(r.end?.date)
  })

  it('preserves existing whole-day rendering', () => {
    const r = parseDateRange('3 days starting 2026-03-01')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    const phrase = humanizeDateRange(r)
    expect(phrase).toBe('3 days starting 2026-03-01')
  })
})

describe('anchored duration range trailing zone (F3)', () => {
  it('applies zone to endpoints with applyZone:true', () => {
    const r = parseDateRange('3 hours starting 2026-03-01 9am EST', { applyZone: true })
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.start?.zone?.abbreviation).toBe('EST')
    expect(r.end?.zone?.abbreviation).toBe('EST')
    expect(r.start?.date.toISOString()).toBe('2026-03-01T14:00:00.000Z')
    expect(r.end?.date.toISOString()).toBe('2026-03-01T17:00:00.000Z')
  })

  it('emits TZ_IGNORED when zone detected but not applied', () => {
    const r = parseDateRange('3 hours starting 2026-03-01 9am EST')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.issues.some((i) => i.code === 'TZ_IGNORED')).toBe(true)
    expect(r.start?.zone?.abbreviation).toBe('EST')
  })

  it('emits AMBIGUOUS_TIMEZONE for ambiguous abbreviation', () => {
    const r = parseDateRange('3 hours starting 2026-03-01 9am EST')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.issues.some((i) => i.code === 'AMBIGUOUS_TIMEZONE')).toBe(true)
  })

  it('no-zone paths remain unchanged', () => {
    const r = parseDateRange('3 hours starting 2026-03-01 9am')
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.start?.zone).toBeUndefined()
    expect(r.end?.zone).toBeUndefined()
    expect(r.issues.filter((i) => i.code === 'TZ_IGNORED')).toEqual([])
  })
})

/** Local calendar day as `YYYY-MM-DD`, so assertions read host-independently. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function span(text: string, now: Date = NOW): [string, string] {
  const r = parseDateRange(text, { now })
  if (!(r.ok && r.start && r.end)) {
    throw new Error(`expected a closed range for ${text}`)
  }
  return [ymd(r.start.date), ymd(r.end.date)]
}

describe('parseDateRange date-to-date', () => {
  it('parses date endpoints across every word separator', () => {
    expect(span('Aug 3 to Aug 9')).toEqual(['2026-08-03', '2026-08-09'])
    expect(span('Aug 3 - Aug 9')).toEqual(['2026-08-03', '2026-08-09'])
    expect(span('between Aug 3 and Aug 9')).toEqual(['2026-08-03', '2026-08-09'])
    expect(span('from Aug 3 to Aug 9')).toEqual(['2026-08-03', '2026-08-09'])
    expect(span('Aug 3 through Aug 9')).toEqual(['2026-08-03', '2026-08-09'])
  })

  it('anchors the end to the start so the pair never reads backwards', () => {
    // Each endpoint rolling forward off `now` independently would give
    // 2027-07-01 → 2026-07-05, because July 1 is already past on July 3.
    expect(span('July 1 to July 5')).toEqual(['2027-07-01', '2027-07-05'])
  })

  it('splits ISO endpoints on a spaced dash and refuses an unspaced one', () => {
    expect(span('2026-08-01 to 2026-08-05')).toEqual(['2026-08-01', '2026-08-05'])
    expect(span('2026-08-01 - 2026-08-05')).toEqual(['2026-08-01', '2026-08-05'])
    // Genuinely ambiguous — four dashes, no way to know which one splits.
    expect(parseDateRange('2026-08-01-2026-08-05', { now: NOW }).ok).toBe(false)
  })

  it('keeps open ends open', () => {
    const from = parseDateRange('from monday', { now: NOW })
    expect(from.ok && [ymd(from.start!.date), from.end]).toEqual(['2026-07-06', undefined])
    const until = parseDateRange('until august 9', { now: NOW })
    expect(until.ok && [until.start, ymd(until.end!.date)]).toEqual([undefined, '2026-08-09'])
  })

  it('needs an explicit now only for reference-dependent endpoints', () => {
    expect(parseDateRange('2026-08-01 to 2026-08-05').ok).toBe(true)
    const relative = parseDateRange('tomorrow to friday')
    expect(relative.ok).toBe(false)
    expect(relative.issues.some((i) => i.code === 'NOW_REQUIRED')).toBe(true)
  })

  it('leaves clock slots to the clock grammar', () => {
    const clock = parseDateRange('2pm to 4pm', { now: NOW })
    expect(clock.ok && clock.dated).toBeUndefined()
    // A lone date is not a range; only a period is.
    expect(parseDateRange('tomorrow', { now: NOW }).ok).toBe(false)
    expect(parseDateRange('2pm', { now: NOW }).ok).toBe(false)
  })
})

describe('parseDateRange calendar periods', () => {
  it('spans the period a coarse-grained date names', () => {
    expect(span('next week')).toEqual(['2026-07-06', '2026-07-12'])
    expect(span('this month')).toEqual(['2026-07-01', '2026-07-31'])
    expect(span('next month')).toEqual(['2026-08-01', '2026-08-31'])
    expect(span('this year')).toEqual(['2026-01-01', '2026-12-31'])
    expect(span('August')).toEqual(['2026-08-01', '2026-08-31'])
    expect(span('2027')).toEqual(['2027-01-01', '2027-12-31'])
  })

  it('spans a weekend Saturday through Sunday', () => {
    expect(span('this weekend')).toEqual(['2026-07-04', '2026-07-05'])
    expect(span('next weekend')).toEqual(['2026-07-11', '2026-07-12'])
    expect(span('last weekend')).toEqual(['2026-06-27', '2026-06-28'])
  })

  // Sunday is the case that breaks a naive "round forward to Saturday": the
  // weekend in progress is behind you, so "this weekend" has to look back.
  it.each([
    ['Sunday', new Date(2026, 5, 28), ['2026-06-27', '2026-06-28']],
    ['Monday', new Date(2026, 5, 29), ['2026-07-04', '2026-07-05']],
    ['Tuesday', new Date(2026, 5, 30), ['2026-07-04', '2026-07-05']],
    ['Wednesday', new Date(2026, 6, 1), ['2026-07-04', '2026-07-05']],
    ['Thursday', new Date(2026, 6, 2), ['2026-07-04', '2026-07-05']],
    ['Friday', new Date(2026, 6, 3), ['2026-07-04', '2026-07-05']],
    ['Saturday', new Date(2026, 6, 4), ['2026-07-04', '2026-07-05']],
  ])('reads "this weekend" from a %s as the weekend that contains it', (_day, now, expected) => {
    expect(span('this weekend', now)).toEqual(expected)
  })

  it('keeps next and last a clean week either side on a weekend day', () => {
    for (const now of [new Date(2026, 6, 4), new Date(2026, 6, 5)]) {
      expect(span('this weekend', now)).toEqual(['2026-07-04', '2026-07-05'])
      expect(span('next weekend', now)).toEqual(['2026-07-11', '2026-07-12'])
      expect(span('last weekend', now)).toEqual(['2026-06-27', '2026-06-28'])
    }
  })

  it('widens a coarse endpoint that closes a span', () => {
    // The end of "July to August" is the end of August, not its first morning.
    expect(span('July to August')).toEqual(['2027-07-01', '2027-08-31'])
    expect(span('2026 to 2027')).toEqual(['2026-01-01', '2027-12-31'])
    expect(span('this weekend to next weekend')).toEqual(['2026-07-04', '2026-07-12'])
    expect(span('next week to next month')).toEqual(['2026-07-06', '2026-08-31'])
  })

  it('widens only the closing side of an open range', () => {
    const until = parseDateRange('until August', { now: NOW })
    expect(until.ok && ymd(until.end!.date)).toBe('2026-08-31')
    const from = parseDateRange('from August', { now: NOW })
    expect(from.ok && ymd(from.start!.date)).toBe('2026-08-01')
  })

  it('swaps a descending pair and says so', () => {
    const r = parseDateRange('2026-08-09 to 2026-08-03', { now: NOW })
    expect(r.ok && [ymd(r.start!.date), ymd(r.end!.date)]).toEqual(['2026-08-03', '2026-08-09'])
    expect(r.issues.some((i) => i.code === 'RANGE_REVERSED')).toBe(true)
  })

  it('leaves an overnight clock slot alone', () => {
    // 9pm to 5am is a real slot, not a reversal — only dated pairs swap.
    const r = parseDateRange('9pm to 5am', { now: NOW })
    expect(r.ok && r.issues.some((i) => i.code === 'RANGE_REVERSED')).toBe(false)
  })

  it.each([
    ['leap February', new Date(2028, 0, 15), 'February', ['2028-02-01', '2028-02-29']],
    ['common February', new Date(2027, 0, 15), 'February', ['2027-02-01', '2027-02-28']],
    ['30-day April', new Date(2026, 0, 15), 'April', ['2026-04-01', '2026-04-30']],
    ['December rollover', new Date(2026, 0, 15), 'December', ['2026-12-01', '2026-12-31']],
    ['week over new year', new Date(2026, 11, 30), 'next week', ['2027-01-04', '2027-01-10']],
  ])('gets the last day right for %s', (_name, now, text, expected) => {
    expect(span(text, now)).toEqual(expected)
  })
})

describe('humanizeDateRange round-trips calendar ranges', () => {
  // Every reference here is deliberate: SUNDAY catches weekend phrasing that
  // only holds mid-week, and YEAR_END catches periods that cross into January.
  const SUNDAY = new Date(2026, 5, 28, 9, 0, 0)
  const YEAR_END = new Date(2026, 11, 30, 9, 0, 0)

  const cases: [string, Date][] = [
    ['July 1 to July 5', NOW],
    ['next week', NOW],
    ['this weekend', NOW],
    ['next month', NOW],
    ['August', NOW],
    ['from monday', NOW],
    ['until august 9', NOW],
    ['2026-08-01 to 2026-08-05', NOW],
    ['July 1 3pm to July 2 5pm', NOW],
    ['this weekend', SUNDAY],
    ['next weekend', SUNDAY],
    ['last weekend', SUNDAY],
    ['this weekend', new Date(2026, 6, 4, 9, 0, 0)],
    ['July to August', NOW],
    ['until August', NOW],
    ['from August', NOW],
    ['2026 to 2027', NOW],
    ['this weekend to next weekend', NOW],
    ['next week', YEAR_END],
    ['next month', YEAR_END],
    ['Dec 28 to Jan 3', NOW],
    ['2026-08-09 to 2026-08-03', NOW],
    ['February', new Date(2028, 0, 15, 9, 0, 0)],
    ['3 days starting monday', NOW],
  ]

  it.each(cases)('%s', (text, now) => {
    const first = parseDateRange(text, { now })
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    const again = parseDateRange(humanizeDateRange(first), { now })
    expect(again.ok).toBe(true)
    if (!again.ok) {
      return
    }
    expect([again.start?.date.getTime(), again.end?.date.getTime()]).toEqual([
      first.start?.date.getTime(),
      first.end?.date.getTime(),
    ])
  })
})
