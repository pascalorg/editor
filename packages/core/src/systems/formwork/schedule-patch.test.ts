import { describe, expect, test } from 'bun:test'
import { applyCommitPourPatch, applyPourDatePatch, unknownAssembly } from './schedule-patch'

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

describe('applyCommitPourPatch', () => {
  test('the day committed to comes off the pour, so it cannot be typed', () => {
    // The reason the input is a boolean where the storage is a date: a caller that restated
    // the day could commit a pour to a day the programme does not have.
    const result = applyCommitPourPatch({ committed: true }, '2026-03-02', 'fwasm_1')

    expect(result.error).toBeUndefined()
    expect(result.writes).toEqual({ committedPourAt: '2026-03-02' })
    expect(result.recorded).toContain('2026-03-02')
  })

  test('committing an undated pour is refused, and the refusal names the write to make first', () => {
    const result = applyCommitPourPatch({ committed: true }, undefined, 'fwasm_1')

    expect(result.writes).toBeUndefined()
    expect(result.error).toContain('no pour date')
    expect(result.error).toContain('set_pour_date')
  })

  test('releasing clears as an explicit undefined, and needs no date to do it', () => {
    // A pour whose date was cleared out from under a booking has to be releasable, or the
    // commitment is stuck on a pour nothing can ever agree with.
    const result = applyCommitPourPatch({ committed: false }, undefined, 'fwasm_1')

    expect(result.writes).toEqual({ committedPourAt: undefined })
    expect('committedPourAt' in (result.writes ?? {})).toBe(true)
    expect(result.recorded).toBe('commitment released')
  })

  test('committing writes only the commitment, never the pour date', () => {
    // The one combination worth making impossible: a single call that both moves a pour and
    // carries its booking along would be a booking made against a day nobody agreed.
    const result = applyCommitPourPatch({ committed: true }, '2026-03-02', 'fwasm_1')

    expect(Object.keys(result.writes ?? {})).toEqual(['committedPourAt'])
  })
})
