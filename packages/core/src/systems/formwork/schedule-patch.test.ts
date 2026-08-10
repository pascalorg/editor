import { describe, expect, test } from 'bun:test'
import { applyPourDatePatch, unknownAssembly } from './schedule-patch'

describe('applyPourDatePatch', () => {
  test('a stated date is written as given', () => {
    const result = applyPourDatePatch({ pourAt: '2026-03-02' })
    expect(result.error).toBeUndefined()
    expect(result.writes).toEqual({ pourAt: '2026-03-02' })
    expect(result.recorded).toContain('2026-03-02')
  })

  test('null clears the date as an explicit undefined, not as a stored null', () => {
    // Both write paths delete a key holding an explicit `undefined`, which is what
    // unprogramming a pour has to do — a stored null would be a date-shaped absence.
    const result = applyPourDatePatch({ pourAt: null })
    expect(result.writes).toEqual({ pourAt: undefined })
    expect('pourAt' in (result.writes ?? {})).toBe(true)
    expect(result.recorded).toBe('pour date cleared')
  })

  test('a day the calendar does not have is refused rather than rolled forward', () => {
    // The check the regex cannot do. Stored, `Date.UTC` reads this as 1 March and every
    // date derived from it is a day out while reading back as the date the user gave.
    const result = applyPourDatePatch({ pourAt: '2026-02-30' })
    expect(result.writes).toBeUndefined()
    expect(result.error).toContain('no such day as 2026-02-30')
  })

  test('a leap day is a real date in a leap year and not in a common one', () => {
    expect(applyPourDatePatch({ pourAt: '2028-02-29' }).error).toBeUndefined()
    expect(applyPourDatePatch({ pourAt: '2027-02-29' }).error).toContain('no such day')
  })

  test('a thirteenth month is refused', () => {
    expect(applyPourDatePatch({ pourAt: '2026-13-01' }).error).toContain('no such day')
  })

  test('a timestamp or a loose date is refused for its shape, with the reason', () => {
    const stamp = applyPourDatePatch({ pourAt: '2026-03-02T09' })
    expect(stamp.error).toContain('YYYY-MM-DD')
    expect(applyPourDatePatch({ pourAt: '2/3/2026' }).error).toContain('YYYY-MM-DD')
  })

  test('the unknown-assembly refusal sends the caller to the read that lists pours', () => {
    const message = unknownAssembly('wall_1')
    expect(message).toContain('wall_1')
    expect(message).toContain('schedule.pours')
  })
})
