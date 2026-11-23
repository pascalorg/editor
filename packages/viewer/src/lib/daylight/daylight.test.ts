// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import { presetInstant, solarPosition } from '../../index'
import { resolveLocation, siteLocation, timezoneLocation } from './location'
import { skyPhase, solarClockMinutes, solarLight } from './solar'

const PARIS = { lat: 48.86, lng: 2.35 }
const JUNE = new Date(Date.UTC(2026, 5, 21))

describe('solar position', () => {
  test('Paris at the June solstice: high noon sun due south', () => {
    const noon = presetInstant(JUNE, PARIS.lat, PARIS.lng, 'midday')
    const { azimuth, elevation } = solarPosition(noon, PARIS.lat, PARIS.lng)
    expect(elevation).toBeGreaterThan(64)
    expect(elevation).toBeLessThan(65.5)
    expect(Math.abs(azimuth - 180)).toBeLessThan(3)
  })

  test('presets land on their sun elevation in the evening', () => {
    const noon = presetInstant(JUNE, PARIS.lat, PARIS.lng, 'midday').getTime()
    for (const [preset, target] of [
      ['golden', 6],
      ['blue', -4],
      ['night', -14],
    ] as const) {
      const when = presetInstant(JUNE, PARIS.lat, PARIS.lng, preset)
      expect(when.getTime()).toBeGreaterThan(noon)
      expect(Math.abs(solarPosition(when, PARIS.lat, PARIS.lng).elevation - target)).toBeLessThan(1)
    }
  })

  test.each([
    [48.86, 2.35, 5],
    [-33.87, 151.21, 11],
  ])('dawn rises east of noon and golden sets west at latitude %s', (lat, lng, month) => {
    const day = new Date(2026, month, 21)
    const dawn = presetInstant(day, lat, lng, 'dawn')
    const noon = presetInstant(day, lat, lng, 'midday')
    const golden = presetInstant(day, lat, lng, 'golden')
    const morning = solarPosition(dawn, lat, lng)
    const evening = solarPosition(golden, lat, lng)
    expect(dawn.getTime()).toBeLessThan(noon.getTime())
    expect(golden.getTime()).toBeGreaterThan(noon.getTime())
    expect(morning.azimuth).toBeGreaterThan(0)
    expect(morning.azimuth).toBeLessThan(180)
    expect(evening.azimuth).toBeGreaterThan(180)
    expect(Math.abs(morning.elevation - 6)).toBeLessThan(0.6)
    expect(Math.abs(morning.elevation - evening.elevation)).toBeLessThan(0.6)
    expect(skyPhase(morning.elevation, solarClockMinutes(dawn, lng))).toBe('dawn')
    expect(skyPhase(evening.elevation, solarClockMinutes(golden, lng))).toBe('golden')
  })

  test.each([5, 11])('unreachable dawn uses the closest polar elevation in month %s', (month) => {
    const day = new Date(2026, month, 21)
    const dawn = presetInstant(day, 80, 18.96, 'dawn')
    const elevation = solarPosition(dawn, 80, 18.96).elevation
    expect(Number.isFinite(dawn.getTime())).toBe(true)
    expect(month === 5 ? elevation > 6 : elevation < 0).toBe(true)
    // Every sampled instant that morning is at least as far from the target.
    const noon = presetInstant(day, 80, 18.96, 'midday')
    for (let minutes = -720; minutes <= 0; minutes += 1) {
      const candidate = solarPosition(new Date(noon.getTime() + minutes * 60_000), 80, 18.96)
      expect(Math.abs(elevation - 6)).toBeLessThanOrEqual(Math.abs(candidate.elevation - 6) + 0.02)
    }
  })

  test.each([
    [
      48.86,
      2.35,
      5,
      [
        '2026-06-21T19:10:36.000Z',
        '2026-06-21T11:50:36.000Z',
        '2026-06-21T20:25:36.000Z',
        '2026-06-22T01:35:36.000Z',
      ],
    ],
    [
      -33.87,
      151.21,
      11,
      [
        '2026-12-21T08:30:09.600Z',
        '2026-12-21T01:55:09.600Z',
        '2026-12-21T09:25:09.600Z',
        '2026-12-21T10:25:09.600Z',
      ],
    ],
    [
      80,
      18.96,
      5,
      [
        '2026-06-21T22:44:09.600Z',
        '2026-06-21T10:44:09.600Z',
        '2026-06-21T22:44:09.600Z',
        '2026-06-21T22:44:09.600Z',
      ],
    ],
    [
      80,
      18.96,
      11,
      [
        '2026-12-21T10:44:09.600Z',
        '2026-12-21T10:44:09.600Z',
        '2026-12-21T10:44:09.600Z',
        '2026-12-21T09:24:09.600Z',
      ],
    ],
  ] as const)(
    'existing preset instants stay stable at latitude %s in month %s',
    (lat, lng, month, expected) => {
      const day = new Date(2026, month, 21)
      expect(
        ['golden', 'midday', 'blue', 'night'].map((preset) =>
          presetInstant(
            day,
            lat,
            lng,
            preset as 'golden' | 'midday' | 'blue' | 'night',
          ).toISOString(),
        ),
      ).toEqual(expected)
    },
  )

  test('polar summer falls back to the lowest sun instead of failing', () => {
    const tromso = { lat: 69.65, lng: 18.96 }
    const when = presetInstant(JUNE, tromso.lat, tromso.lng, 'night')
    const { elevation } = solarPosition(when, tromso.lat, tromso.lng)
    expect(Number.isFinite(elevation)).toBe(true)
    expect(elevation).toBeGreaterThan(-1)
  })

  test('north rotation turns the sun direction with the plan', () => {
    const noon = presetInstant(JUNE, PARIS.lat, PARIS.lng, 'midday')
    const plain = solarLight(noon, PARIS.lat, PARIS.lng, 0)
    // South is plan +z with true north along plan −z.
    expect(plain.direction.z).toBeGreaterThan(0.4)
    const turned = solarLight(noon, PARIS.lat, PARIS.lng, Math.PI / 2)
    expect(turned.direction.x).toBeLessThan(-0.4)
    expect(plain.night).toBe(0)
  })

  test('the sun warms and fades towards the horizon', () => {
    const golden = solarLight(
      presetInstant(JUNE, PARIS.lat, PARIS.lng, 'golden'),
      PARIS.lat,
      PARIS.lng,
      0,
    )
    const noon = solarLight(
      presetInstant(JUNE, PARIS.lat, PARIS.lng, 'midday'),
      PARIS.lat,
      PARIS.lng,
      0,
    )
    expect(golden.color.b).toBeLessThan(noon.color.b)
    expect(golden.strength).toBeLessThan(noon.strength)
    const night = solarLight(
      presetInstant(JUNE, PARIS.lat, PARIS.lng, 'night'),
      PARIS.lat,
      PARIS.lng,
      0,
    )
    expect(night.strength).toBe(0)
    expect(night.night).toBe(1)
  })
})

describe('location', () => {
  test('the site point wins, parcel origin before dossier point', () => {
    expect(siteLocation({ parcel: { originLngLat: [2.35, 48.86] } })).toEqual(PARIS)
    expect(siteLocation({ dossier: { point: { lat: 1, lng: 2 } } })).toEqual({ lat: 1, lng: 2 })
    expect(siteLocation({ parcel: { originLngLat: null }, dossier: { point: null } })).toBeNull()
    expect(
      resolveLocation({ parcel: { originLngLat: [2.35, 48.86] } }, { lat: 0, lng: 0 }),
    ).toEqual({
      location: PARIS,
      source: 'site',
    })
  })

  test('a granted device location comes before the timezone guess', () => {
    expect(resolveLocation(null, { lat: 10, lng: 20 })).toEqual({
      location: { lat: 10, lng: 20 },
      source: 'device',
    })
    expect(['timezone', 'default']).toContain(resolveLocation(null, null).source)
  })

  test('timezone guesses only known zones', () => {
    expect(timezoneLocation('Europe/Paris')).toEqual(PARIS)
    expect(timezoneLocation('Antarctica/Troll')).toBeNull()
  })
})
