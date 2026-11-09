import { Color, MathUtils, Vector3 } from 'three'

/**
 * Sun position (NOAA / Meeus low-precision, ~0.01° for 1950–2050) and a small art-directed
 * model of the light it gives. Angles in degrees unless noted. The site frame is x east,
 * y up, z south; `northRotation` (radians, clockwise) is true north's offset from plan −z,
 * so a compass bearing `az` points along plan angle `az + northRotation`.
 */

const RAD = Math.PI / 180

export function solarPosition(date: Date, lat: number, lng: number) {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5
  const t = (jd - 2_451_545) / 36_525
  const l0 = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360
  const m = 357.52911 + t * (35_999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289
  const omega = 125.04 - 1934.136 * t
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD)
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD
  const y = Math.tan((eps / 2) * RAD) ** 2
  const eqTime =
    (4 / RAD) *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD))
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const solarTime = (((minutes + eqTime + 4 * lng) % 1440) + 1440) % 1440
  let hourAngle = solarTime / 4 - 180
  if (hourAngle < -180) hourAngle += 360
  const cosZenith =
    Math.sin(lat * RAD) * Math.sin(decl * RAD) +
    Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(hourAngle * RAD)
  const zenith = Math.acos(MathUtils.clamp(cosZenith, -1, 1)) / RAD
  const azimuth =
    (Math.atan2(
      Math.sin(hourAngle * RAD),
      Math.cos(hourAngle * RAD) * Math.sin(lat * RAD) - Math.tan(decl * RAD) * Math.cos(lat * RAD),
    ) /
      RAD +
      180) %
    360
  let elevation = 90 - zenith
  // Atmospheric refraction only matters near the horizon.
  if (elevation > -1)
    elevation += 1.02 / Math.tan((elevation + 10.3 / (elevation + 5.11)) * RAD) / 60
  return { azimuth, elevation }
}

export type SolarLight = {
  azimuth: number
  elevation: number
  /** Unit vector towards the sun, site frame. */
  direction: Vector3
  /** Linear RGB, max channel 1: white at noon, gold low, orange at sunset. */
  color: Color
  /** 0…1 relative strength of the disc (horizon fade × air-mass extinction). */
  strength: number
  /** 0 day … 1 night (sun below −7°). */
  night: number
}

// Rayleigh (680/550/440 nm) plus a light aerosol term.
const TAU = [0.043 + 0.07, 0.098 + 0.08, 0.236 + 0.095]

function airMass(elevation: number) {
  const z = 90 - Math.max(elevation, -0.5)
  return 1 / (Math.cos(z * RAD) + 0.50572 * (96.07995 - z) ** -1.6364)
}

export function solarLight(
  date: Date,
  lat: number,
  lng: number,
  northRotation: number,
  out?: SolarLight,
): SolarLight {
  const { azimuth, elevation } = solarPosition(date, lat, lng)
  const s = out ?? {
    azimuth: 0,
    elevation: 0,
    direction: new Vector3(),
    color: new Color(),
    strength: 0,
    night: 0,
  }
  s.azimuth = azimuth
  s.elevation = elevation
  const bearing = azimuth * RAD + northRotation
  const el = elevation * RAD
  s.direction
    .set(Math.sin(bearing) * Math.cos(el), Math.sin(el), -Math.cos(bearing) * Math.cos(el))
    .normalize()
  const m = airMass(elevation)
  const ratio = TAU.map((tau) => Math.exp(-tau * m) / Math.exp(-tau))
  const peak = Math.max(...ratio, 1e-6)
  // pow 0.6: golden rather than raw-physical orange.
  s.color.setRGB((ratio[0]! / peak) ** 0.6, (ratio[1]! / peak) ** 0.6, (ratio[2]! / peak) ** 0.6)
  s.strength =
    MathUtils.smoothstep(elevation, -1, 1.5) *
    peak *
    Math.min(1, Math.sin(Math.max(el, 0)) * 0.5 + 0.55)
  s.night = 1 - MathUtils.smoothstep(elevation, -7, 2)
  return s
}

/** Sun elevation each preset aims for (degrees); midday takes the day's highest sun. */
const PRESET_ELEVATION = {
  golden: 6,
  midday: Number.POSITIVE_INFINITY,
  blue: -4,
  night: -14,
} as const
export type TimeOfDay = keyof typeof PRESET_ELEVATION

/**
 * The instant on `day` (local calendar day at the site's longitude) when the sun reaches the
 * preset's elevation on the afternoon/evening side. Defined by the sun, not the clock, so no
 * timezone is needed. Falls back to the closest elevation reached (polar summer/winter).
 */
export function presetInstant(day: Date, lat: number, lng: number, preset: TimeOfDay): Date {
  // Solar noon in UTC for this longitude: 12:00 local mean time.
  const noonUtc =
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12) - (lng / 15) * 3_600_000
  const target = PRESET_ELEVATION[preset]
  let best = noonUtc
  let bestScore = Number.POSITIVE_INFINITY
  for (let minutes = -120; minutes <= 14 * 60; minutes += 5) {
    const t = noonUtc + minutes * 60_000
    const { elevation } = solarPosition(new Date(t), lat, lng)
    const score = Number.isFinite(target) ? Math.abs(elevation - target) : -elevation
    if (score < bestScore) {
      bestScore = score
      best = t
    }
  }
  return new Date(best)
}

/**
 * Times of day as minutes after local mean midnight at the site's longitude (sun time, no
 * timezone): 720 is roughly when the sun is highest, give or take the equation of time.
 */
function meanMidnightUtc(day: Date, lng: number): number {
  return Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - (lng / 15) * 3_600_000
}

/** The instant `minutes` after local mean midnight on `day` at longitude `lng`. */
export function solarClockInstant(day: Date, lng: number, minutes: number): Date {
  return new Date(meanMidnightUtc(day, lng) + minutes * 60_000)
}

/** Minutes after local mean midnight of `date` at longitude `lng`, 0…1440. */
export function solarClockMinutes(date: Date, lng: number): number {
  const minutes = (date.getTime() - meanMidnightUtc(date, lng)) / 60_000
  return ((minutes % 1440) + 1440) % 1440
}

/** Sunrise and sunset on `day` (local mean minutes), or null where the sun never crosses. */
export function sunEvents(
  day: Date,
  lat: number,
  lng: number,
): { sunrise: number; sunset: number } | null {
  const above = (minutes: number) =>
    solarPosition(solarClockInstant(day, lng, minutes), lat, lng).elevation > -0.833
  let sunrise: number | null = null
  let sunset: number | null = null
  let previous = above(0)
  for (let minutes = 5; minutes <= 1440; minutes += 5) {
    const now = above(minutes)
    if (now && !previous && sunrise === null) sunrise = minutes
    if (!now && previous && sunrise !== null) sunset = minutes
    previous = now
  }
  return sunrise !== null && sunset !== null ? { sunrise, sunset } : null
}

/** The phase a moment of the day reads as, from the sun's elevation and the side of noon. */
export type SkyPhase = 'night' | 'blue' | 'golden' | 'morning' | 'midday' | 'afternoon'

export function skyPhase(elevation: number, minutes: number): SkyPhase {
  if (elevation < -6) return 'night'
  if (elevation < 0) return 'blue'
  if (elevation < 10) return 'golden'
  if (minutes < 11 * 60) return 'morning'
  if (minutes > 14.5 * 60) return 'afternoon'
  return 'midday'
}
