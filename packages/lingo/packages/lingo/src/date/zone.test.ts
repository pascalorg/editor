import { describe, expect, it } from 'vitest'
import { applyZoneToCivil, detectZone, ianaOffsetMinutes, stripTrailingZone } from './zone'

const JULY = new Date(Date.UTC(2026, 6, 7, 15, 0, 0))
const JAN = new Date(Date.UTC(2026, 0, 15, 15, 0, 0))

describe('zone detection', () => {
  it('parses explicit offsets exactly', () => {
    for (const [text, off] of [
      ['+05:30', 330],
      ['-0800', -480],
      ['UTC+2', 120],
      ['GMT-5', -300],
      ['Z', 0],
      ['UTC', 0],
      ['GMT', 0],
    ] as const) {
      expect(detectZone(text, JULY)).toMatchObject({ source: 'offset', offsetMinutes: off })
    }
  })

  it('parses abbreviations and flags them ambiguous', () => {
    expect(detectZone('EST', JULY)).toMatchObject({
      source: 'abbrev',
      offsetMinutes: -300,
      ambiguous: true,
    })
    expect(detectZone('PST', JULY)).toMatchObject({ offsetMinutes: -480, ambiguous: true })
    expect(detectZone('CET', JULY)).toMatchObject({ offsetMinutes: 60, ambiguous: true })
    expect(detectZone('IST', JULY)).toMatchObject({ offsetMinutes: 330, ambiguous: true })
  })

  it('resolves IANA names DST-correctly via Intl', () => {
    // Paris: CEST (+120) in July, CET (+60) in January.
    expect(ianaOffsetMinutes('Europe/Paris', JULY)).toBe(120)
    expect(ianaOffsetMinutes('Europe/Paris', JAN)).toBe(60)
    // New York: EDT (−240) in July, EST (−300) in January.
    expect(ianaOffsetMinutes('America/New_York', JULY)).toBe(-240)
    expect(ianaOffsetMinutes('America/New_York', JAN)).toBe(-300)
    expect(detectZone('Europe/Paris', JULY)).toMatchObject({ source: 'iana', offsetMinutes: 120 })
    expect(ianaOffsetMinutes('Not/AZone', JULY)).toBeNull()
  })

  it('maps common named zones to an IANA offset', () => {
    expect(detectZone('Eastern', JULY)).toMatchObject({ source: 'named', iana: 'America/New_York' })
    expect(detectZone('Pacific Time', JULY)).toMatchObject({ source: 'named', offsetMinutes: -420 })
  })

  it('returns null for non-zones', () => {
    expect(detectZone('xyz', JULY)).toBeNull()
    expect(detectZone('March', JULY)).toBeNull()
  })
})

describe('applyZoneToCivil', () => {
  it('reinterprets civil fields in the zone to a UTC instant', () => {
    const civil = new Date(2026, 6, 7, 15, 0, 0) // 3pm (host-local fields read directly)
    const est = detectZone('EST', civil)!
    expect(applyZoneToCivil(civil, est).toISOString()).toBe('2026-07-07T20:00:00.000Z')
    const paris = detectZone('Europe/Paris', civil)!
    expect(applyZoneToCivil(civil, paris).toISOString()).toBe('2026-07-07T13:00:00.000Z') // CEST +2
  })
})

describe('stripTrailingZone', () => {
  it('peels a trailing zone and leaves the time', () => {
    expect(stripTrailingZone('3pm EST', JULY)?.source).toBe('3pm')
    expect(stripTrailingZone('15:00 +05:30', JULY)?.source).toBe('15:00')
    expect(stripTrailingZone('9am Europe/Paris', JULY)?.source).toBe('9am')
    expect(stripTrailingZone('3pm Pacific Time', JULY)?.source).toBe('3pm')
    expect(stripTrailingZone('15:00Z', JULY)?.source).toBe('15:00')
  })

  it('does not strip am/pm or non-zones', () => {
    expect(stripTrailingZone('5 pm', JULY)).toBeNull()
    expect(stripTrailingZone('noon', JULY)).toBeNull()
    expect(stripTrailingZone('7 in the morning', JULY)).toBeNull()
  })
})
