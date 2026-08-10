import { describe, expect, test } from 'bun:test'
import type { StrikeTarget, StrikingStandardId, StrikingTime } from './design/striking'
import { strikingTime } from './design/striking'
import {
  formworkSchedule,
  formworkScheduleCaveats,
  type SchedulablePour,
  scheduleOccupancyDays,
} from './schedule'

/**
 * The calendar over the periods.
 *
 * `striking.test.ts` checks the periods themselves against the published tables and
 * `hire.test.ts` checks the join onto a bill, so nothing here re-derives a duration.
 * What is left to get wrong is the arithmetic on a date — a strike printed before the
 * code's own period has elapsed, a UTC/local shift that moves every pour by a day, an
 * ACI accumulator added to a calendar as though it were calendar time, and a window
 * quoted over three pours of forty as though it were the job's.
 */

function period(target: StrikeTarget, standard: StrikingStandardId = 'BS_8110'): StrikingTime {
  return strikingTime(standard, { target, temperatureC: 16 })
}

function pour(overrides: Partial<SchedulablePour> = {}): SchedulablePour {
  return {
    id: 'fwasm_a',
    pourAt: '2026-03-02',
    striking: [period('vertical-form')],
    ...overrides,
  }
}

describe('formworkSchedule — a date, or nothing', () => {
  test('an undated pour gets no dates at all rather than dates relative to nothing', () => {
    const schedule = formworkSchedule([pour({ pourAt: undefined })], { erectionLeadDays: 2 })

    const only = schedule.pours[0]
    expect(only?.pourAt).toBeUndefined()
    expect(only?.erectAt).toBeUndefined()
    expect(only?.strikeAt).toBeUndefined()
    expect(only?.releaseAt).toBeUndefined()
    // The period is not lost — it is `hire`'s answer and reported there. Repeating it
    // here as a date relative to nothing would be a weaker second copy of it.
    expect(only?.strikes).toEqual([])
    expect(only?.gaps).toEqual(['no-pour-date'])
    expect(schedule.scheduledCount).toBe(0)
    expect(schedule.unscheduled).toHaveLength(1)
  })

  test('a strike date is the pour date plus the code’s own period', () => {
    // BS 8110's vertical row is 12 h at 16 °C, which is 0.5 d and lands the day after.
    const schedule = formworkSchedule([pour()], {})

    expect(schedule.pours[0]?.pourAt).toBe('2026-03-02')
    expect(schedule.pours[0]?.strikeAt).toBe('2026-03-03')
  })

  test('a part-day period rounds up, because striking early is the error that hurts', () => {
    const vertical = period('vertical-form')
    expect(vertical.days).toBeLessThan(1)

    const schedule = formworkSchedule([pour({ striking: [vertical] })], {})

    // Rounded down this would print the pour date itself — a strike before any of the
    // code's period had elapsed, reported with the same confidence as a right answer.
    expect(schedule.pours[0]?.strikeAt).toBe('2026-03-03')
  })

  test('the erect date is the pour date less the lead, and crosses a month end', () => {
    const schedule = formworkSchedule([pour({ pourAt: '2026-03-02' })], { erectionLeadDays: 4 })

    expect(schedule.pours[0]?.erectAt).toBe('2026-02-26')
  })

  test('a leap day is a real date and 2026 has none', () => {
    // The regex on the schema accepts 2026-02-29 and `Date.UTC` rolls it to 1 March, so
    // without the round-trip check a programme silently moves a pour to a day nobody
    // entered. 2028 is a leap year and the same string is then legitimate.
    const invalid = formworkSchedule([pour({ pourAt: '2026-02-29' })], { erectionLeadDays: 1 })
    expect(invalid.pours[0]?.erectAt).toBeUndefined()
    expect(invalid.pours[0]?.strikeAt).toBeUndefined()

    const valid = formworkSchedule([pour({ pourAt: '2028-02-29' })], { erectionLeadDays: 1 })
    expect(valid.pours[0]?.erectAt).toBe('2028-02-28')
    expect(valid.pours[0]?.strikeAt).toBe('2028-03-01')
  })

  test('a month past twelve is refused as well, not just a day past the month end', () => {
    const schedule = formworkSchedule([pour({ pourAt: '2026-13-01' })], { erectionLeadDays: 1 })

    expect(schedule.pours[0]?.erectAt).toBeUndefined()
    expect(schedule.pours[0]?.strikeAt).toBeUndefined()
  })

  test('a pour nothing strikes carries a date and no release', () => {
    const schedule = formworkSchedule([pour({ striking: [] })], { returnLeadDays: 2 })

    expect(schedule.pours[0]?.pourAt).toBe('2026-03-02')
    expect(schedule.pours[0]?.strikeAt).toBeUndefined()
    expect(schedule.pours[0]?.releaseAt).toBeUndefined()
    expect(schedule.pours[0]?.gaps).toContain('no-strike-period')
  })
})

describe('formworkSchedule — the lead times, and their absence', () => {
  test('no erection lead means no delivery date, said rather than assumed as zero', () => {
    const schedule = formworkSchedule([pour()], {})

    // Zero would claim the shutter appears on the morning of the pour, which is the one
    // answer that is certainly wrong.
    expect(schedule.pours[0]?.erectAt).toBeUndefined()
    expect(schedule.gaps).toContain('no-erection-lead')
  })

  test('no return lead shows the set free the day it is struck, and names what is missing', () => {
    const schedule = formworkSchedule([pour()], { erectionLeadDays: 1 })

    // Unlike the pour date, this one has a floor: the set is certainly not free before it
    // comes off. So the date stands and the gap says what is not in it.
    expect(schedule.pours[0]?.releaseAt).toBe(schedule.pours[0]?.strikeAt)
    expect(schedule.pours[0]?.gaps).toContain('no-return-lead')
  })

  test('a return lead pushes the release past the strike', () => {
    const schedule = formworkSchedule([pour()], { erectionLeadDays: 2, returnLeadDays: 3 })

    expect(schedule.pours[0]?.erectAt).toBe('2026-02-28')
    expect(schedule.pours[0]?.strikeAt).toBe('2026-03-03')
    expect(schedule.pours[0]?.releaseAt).toBe('2026-03-06')
    expect(schedule.pours[0]?.gaps).toEqual([])
    expect(schedule.complete).toBe(true)
  })
})

describe('formworkSchedule — the last of it, not the first', () => {
  test('a slab’s strike date is its props, not its deck', () => {
    const deck = period('slab-soffit-form')
    const props = period('slab-props')
    expect(props.days).toBeGreaterThan(deck.days)

    const schedule = formworkSchedule([pour({ striking: [props, deck] })], {})

    const only = schedule.pours[0]
    // Earliest first in `strikes` so a programme can print the sequence, and the *last*
    // is `strikeAt`: it is the day the set comes free, and the deck's date would show
    // plant available while it is still holding a floor up.
    expect(only?.strikes.map((strike) => strike.target)).toEqual(['slab-soffit-form', 'slab-props'])
    expect(only?.strikeAt).toBe(only?.strikes[1]?.date)
    expect(only?.strikes[0]?.date).not.toBe(only?.strikeAt)
  })

  test('the window spans every pour: earliest erect to latest release', () => {
    const schedule = formworkSchedule(
      [
        pour({ id: 'a', pourAt: '2026-03-02' }),
        pour({ id: 'b', pourAt: '2026-03-20' }),
        pour({ id: 'c', pourAt: '2026-03-09' }),
      ],
      { erectionLeadDays: 2, returnLeadDays: 1 },
    )

    expect(schedule.firstErectAt).toBe('2026-02-28')
    expect(schedule.firstPourAt).toBe('2026-03-02')
    expect(schedule.lastPourAt).toBe('2026-03-20')
    expect(schedule.lastReleaseAt).toBe('2026-03-22')
    expect(schedule.scheduledCount).toBe(3)
  })

  test('an undated pour does not shorten the window it is not in', () => {
    const schedule = formworkSchedule(
      [pour({ id: 'a', pourAt: '2026-03-02' }), pour({ id: 'b', pourAt: undefined })],
      { erectionLeadDays: 2 },
    )

    expect(schedule.firstErectAt).toBe('2026-02-28')
    expect(schedule.scheduledCount).toBe(1)
    expect(schedule.complete).toBe(false)
  })
})

describe('scheduleOccupancyDays', () => {
  test('counts arrival to release across every pour, not one pour’s hold', () => {
    const schedule = formworkSchedule(
      [pour({ id: 'a', pourAt: '2026-03-02' }), pour({ id: 'b', pourAt: '2026-03-09' })],
      { erectionLeadDays: 1, returnLeadDays: 1 },
    )

    // 1 March (erect) to 11 March (release of the second) inclusive. The figure a hire
    // negotiation turns on, and deliberately not `bomHire.longestHours`: each set is held
    // about a day, and the plant is on site for eleven.
    expect(schedule.firstErectAt).toBe('2026-03-01')
    expect(schedule.lastReleaseAt).toBe('2026-03-11')
    expect(scheduleOccupancyDays(schedule)).toBe(11)
  })

  test('a pour erected and struck on one day occupies that day rather than none', () => {
    const schedule = formworkSchedule([pour({ striking: [] })], { erectionLeadDays: 0 })

    expect(scheduleOccupancyDays(schedule)).toBe(1)
  })

  test('nothing dated has no occupancy, rather than zero days', () => {
    const schedule = formworkSchedule([pour({ pourAt: undefined })], { erectionLeadDays: 1 })

    expect(scheduleOccupancyDays(schedule)).toBeUndefined()
  })
})

describe('formworkSchedule — ACI counts a different clock', () => {
  test('a qualifying-time period makes the date the earliest, not the date', () => {
    const aci = period('slab-props', 'ACI_347')
    expect(aci.basis).toBe('qualifying-time')

    const schedule = formworkSchedule([pour({ striking: [aci] })], {})

    // The date is still produced — it is the earliest the form could come off, which is a
    // useful bound. What must not happen is presenting it as *the* date: a cold spell
    // pushes it later and nothing here knows the weather.
    expect(schedule.pours[0]?.strikeAt).toBeDefined()
    expect(schedule.pours[0]?.earliestOnly).toBe(true)
    expect(schedule.earliestOnly).toBe(true)
    expect(formworkScheduleCaveats(schedule).some((line) => line.includes('earliest'))).toBe(true)
  })

  test('a calendar period is not flagged, so the flag means something', () => {
    const schedule = formworkSchedule([pour()], {})

    expect(schedule.pours[0]?.earliestOnly).toBeUndefined()
    expect(schedule.earliestOnly).toBe(false)
    expect(formworkScheduleCaveats(schedule).some((line) => line.includes('earliest'))).toBe(false)
  })
})

describe('formworkScheduleCaveats', () => {
  test('leads with how much of the job the programme does not cover', () => {
    const schedule = formworkSchedule(
      [
        pour({ id: 'a', pourAt: '2026-03-02' }),
        pour({ id: 'b', pourAt: undefined }),
        pour({ id: 'c', pourAt: undefined }),
      ],
      { erectionLeadDays: 1, returnLeadDays: 1 },
    )

    const caveats = formworkScheduleCaveats(schedule)
    expect(caveats[0]).toContain('2 of 3')
    expect(caveats[0]).toContain('1 of them')
  })

  test('an empty scope says nothing rather than warning about a programme with no pours', () => {
    expect(formworkScheduleCaveats(formworkSchedule([], {}))).toEqual([])
  })

  test('a two-period pour is named, because the strike date is not when the shutter comes off', () => {
    const schedule = formworkSchedule(
      [pour({ striking: [period('slab-props'), period('slab-soffit-form')] })],
      { erectionLeadDays: 1, returnLeadDays: 1 },
    )

    const caveats = formworkScheduleCaveats(schedule)
    expect(caveats.some((line) => line.includes('struck at different times'))).toBe(true)
    expect(caveats.some((line) => line.includes('soffit form to a slab before props'))).toBe(true)
  })

  test('the missing leads are each named, so a reader knows which field to fill in', () => {
    const caveats = formworkScheduleCaveats(formworkSchedule([pour()], {}))

    expect(caveats.some((line) => line.includes('No erection lead time'))).toBe(true)
    expect(caveats.some((line) => line.includes('No return lead time'))).toBe(true)
  })
})
