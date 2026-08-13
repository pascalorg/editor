import { describe, expect, test } from 'bun:test'
import { isDaylight, solarPosition, sunDirection } from './solar-position'

const utc = (year: number, month: number, day: number, hour = 0, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute))

const ISTANBUL = { latitude: 41.0082, longitude: 28.9784 }
const TROPIC_OF_CANCER = { latitude: 23.4397, longitude: 0 }
const NORTH_POLE = { latitude: 90, longitude: 0 }
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 }

describe('solarPosition', () => {
  test('the June solstice sun stands overhead on the Tropic of Cancer at solar noon', () => {
    // Longitude 0, so solar noon is ~12:00 UTC give or take the equation of time.
    const { altitude } = solarPosition(TROPIC_OF_CANCER, utc(2024, 6, 20, 12, 0))
    expect(altitude).toBeGreaterThan(89)
    expect(altitude).toBeLessThanOrEqual(90)
  })

  test('at northern solar noon the sun is due south', () => {
    // Istanbul is UTC+3; solar noon lands near 09:00 UTC (longitude 29°E).
    const { azimuth } = solarPosition(ISTANBUL, utc(2024, 3, 20, 10, 4))
    expect(azimuth).toBeGreaterThan(175)
    expect(azimuth).toBeLessThan(185)
  })

  test('morning sun is in the east, afternoon sun in the west', () => {
    const morning = solarPosition(ISTANBUL, utc(2024, 6, 21, 4, 0))
    const afternoon = solarPosition(ISTANBUL, utc(2024, 6, 21, 15, 0))

    expect(morning.azimuth).toBeLessThan(180)
    expect(morning.azimuth).toBeGreaterThan(0)
    expect(afternoon.azimuth).toBeGreaterThan(180)
    expect(afternoon.azimuth).toBeLessThan(360)
  })

  test('azimuth is mirrored about south for equal times either side of solar noon', () => {
    const site = { latitude: 45, longitude: 0 }
    const day = utc(2024, 3, 20)

    // Solar noon is not clock noon — the equation of time moves it by up to a
    // quarter hour — so find it rather than assume it.
    let noonMinute = 0
    let best = -Infinity
    for (let minute = 0; minute < 1440; minute++) {
      const { altitude } = solarPosition(site, new Date(day.getTime() + minute * 60_000))
      if (altitude > best) {
        best = altitude
        noonMinute = minute
      }
    }

    const at = (offsetMinutes: number) =>
      solarPosition(site, new Date(day.getTime() + (noonMinute + offsetMinutes) * 60_000))
    const before = at(-180)
    const after = at(180)

    expect(before.altitude).toBeCloseTo(after.altitude, 0)
    expect(360 - after.azimuth).toBeCloseTo(before.azimuth, 0)
  })

  test('the summer sun climbs higher than the winter sun at the same place and clock time', () => {
    const summer = solarPosition(ISTANBUL, utc(2024, 6, 21, 9, 0))
    const winter = solarPosition(ISTANBUL, utc(2024, 12, 21, 9, 0))

    expect(summer.altitude).toBeGreaterThan(winter.altitude + 30)
  })

  test('the midnight sun never sets at the north pole in June', () => {
    for (const hour of [0, 6, 12, 18]) {
      const position = solarPosition(NORTH_POLE, utc(2024, 6, 21, hour))
      expect(isDaylight(position)).toBe(true)
      // Only ever as high as the axial tilt.
      expect(position.altitude).toBeLessThan(24)
    }
  })

  test('polar night keeps the sun down all day at the north pole in December', () => {
    for (const hour of [0, 6, 12, 18]) {
      expect(isDaylight(solarPosition(NORTH_POLE, utc(2024, 12, 21, hour)))).toBe(false)
    }
  })

  test('night is reported as a negative altitude rather than clamped away', () => {
    const midnight = solarPosition(ISTANBUL, utc(2024, 1, 15, 0, 0))
    expect(midnight.altitude).toBeLessThan(0)
    expect(isDaylight(midnight)).toBe(false)
  })

  test('the southern hemisphere sees the midday sun in the north', () => {
    // Longitude 151°E puts solar noon near 01:55 UTC.
    const { azimuth, altitude } = solarPosition(SYDNEY, utc(2024, 12, 21, 1, 55))
    // Summer solstice at 34°S: the sun clears 79°, just shy of overhead.
    expect(altitude).toBeGreaterThan(75)
    // Due north is 0/360 — the midday bearing sits at one end, not at south.
    expect(Math.min(azimuth, 360 - azimuth)).toBeLessThan(5)
  })

  test('azimuth always lands inside one full turn', () => {
    for (let hour = 0; hour < 24; hour++) {
      const { azimuth } = solarPosition(ISTANBUL, utc(2024, 8, 13, hour))
      expect(azimuth).toBeGreaterThanOrEqual(0)
      expect(azimuth).toBeLessThan(360)
    }
  })

  test('longitude shifts solar noon by four minutes per degree', () => {
    const west = solarPosition({ latitude: 40, longitude: -15 }, utc(2024, 3, 20, 13, 0))
    const prime = solarPosition({ latitude: 40, longitude: 0 }, utc(2024, 3, 20, 12, 0))
    // 15° west = one hour later, so the two see the same sun.
    expect(west.altitude).toBeCloseTo(prime.altitude, 0)
    expect(west.azimuth).toBeCloseTo(prime.azimuth, 0)
  })
})

describe('sunDirection', () => {
  const near = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6)

  test('returns a unit vector', () => {
    const [x, y, z] = sunDirection({ azimuth: 137, altitude: 32 })
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9)
  })

  test('an overhead sun points straight up', () => {
    const [x, y, z] = sunDirection({ azimuth: 0, altitude: 90 })
    near(x, 0)
    near(y, 1)
    near(z, 0)
  })

  test('scene axes: east is +X, south is +Z', () => {
    const east = sunDirection({ azimuth: 90, altitude: 0 })
    near(east[0], 1)
    near(east[2], 0)

    const south = sunDirection({ azimuth: 180, altitude: 0 })
    near(south[0], 0)
    near(south[2], 1)

    const north = sunDirection({ azimuth: 0, altitude: 0 })
    near(north[2], -1)
  })

  test('a sun below the horizon points below the ground plane', () => {
    expect(sunDirection({ azimuth: 90, altitude: -10 })[1]).toBeLessThan(0)
  })

  test('project north rotates the whole sky with the model', () => {
    // Plan-up pointing east (offset 90) means true south now reads as bearing
    // 90 in model space, so the due-south sun arrives from the model's +X.
    const [x, , z] = sunDirection({ azimuth: 180, altitude: 0 }, 90)
    near(x, 1)
    near(z, 0)
  })

  test('a north offset of zero changes nothing', () => {
    const plain = sunDirection({ azimuth: 210, altitude: 25 })
    const offset = sunDirection({ azimuth: 210, altitude: 25 }, 0)
    expect(offset).toEqual(plain)
  })

  test('a full turn of north offset is the identity', () => {
    const plain = sunDirection({ azimuth: 210, altitude: 25 })
    const turned = sunDirection({ azimuth: 210, altitude: 25 }, 360)
    for (let i = 0; i < 3; i++) expect(turned[i]).toBeCloseTo(plain[i] as number, 9)
  })
})
