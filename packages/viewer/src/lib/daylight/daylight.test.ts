// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import { resolveLocation, siteLocation, timezoneLocation } from './location'
import { presetInstant, solarLight, solarPosition } from './solar'

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
