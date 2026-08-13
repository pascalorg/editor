/**
 * Solar position — where the sun is, for a place and an instant.
 *
 * The NOAA Solar Calculator algorithm, transcribed straight from the
 * spreadsheet NOAA publishes (General Solar Position Calculations, based on
 * Meeus, *Astronomical Algorithms*). Accurate to well under a degree for years
 * 1901–2099, which is far finer than any shadow study needs.
 *
 * Pure arithmetic with no dependencies, so it satisfies core's "no Three.js,
 * no rendering" rule and stays trivially testable.
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

export type GeoLocation = {
  /** Degrees north of the equator; negative is south. */
  latitude: number
  /** Degrees east of Greenwich; negative is west. */
  longitude: number
}

export type SolarPosition = {
  /**
   * Compass bearing of the sun in degrees, clockwise from true north.
   * 0 = north, 90 = east, 180 = south, 270 = west.
   */
  azimuth: number
  /**
   * Degrees above the horizon. Negative means the sun is down, which callers
   * must handle rather than clamp — night is a real answer for a shadow study.
   */
  altitude: number
}

/** Days since the J2000.0 epoch, as a fractional Julian day count. */
function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5
}

/** Julian centuries since J2000.0. */
function julianCentury(date: Date): number {
  return (julianDay(date) - 2_451_545) / 36_525
}

function geomMeanLongSun(t: number): number {
  return mod360(280.46646 + t * (36000.76983 + t * 0.0003032))
}

function geomMeanAnomalySun(t: number): number {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t)
}

function eccentricityEarthOrbit(t: number): number {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
}

function sunEqOfCenter(t: number): number {
  const m = geomMeanAnomalySun(t) * DEG
  return (
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289
  )
}

function sunApparentLong(t: number): number {
  const trueLong = geomMeanLongSun(t) + sunEqOfCenter(t)
  const omega = 125.04 - 1934.136 * t
  return trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG)
}

function meanObliquityOfEcliptic(t: number): number {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))
  return 23 + (26 + seconds / 60) / 60
}

function obliquityCorrection(t: number): number {
  const omega = 125.04 - 1934.136 * t
  return meanObliquityOfEcliptic(t) + 0.00256 * Math.cos(omega * DEG)
}

/** Sun's declination in degrees. */
function sunDeclination(t: number): number {
  const e = obliquityCorrection(t) * DEG
  const lambda = sunApparentLong(t) * DEG
  return Math.asin(Math.sin(e) * Math.sin(lambda)) * RAD
}

/** Equation of time in minutes — the sundial/clock discrepancy. */
function equationOfTime(t: number): number {
  const epsilon = obliquityCorrection(t) * DEG
  const l0 = geomMeanLongSun(t) * DEG
  const e = eccentricityEarthOrbit(t)
  const m = geomMeanAnomalySun(t) * DEG

  const y = Math.tan(epsilon / 2) ** 2

  const eTime =
    y * Math.sin(2 * l0) -
    2 * e * Math.sin(m) +
    4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
    0.5 * y * y * Math.sin(4 * l0) -
    1.25 * e * e * Math.sin(2 * m)

  return eTime * 4 * RAD
}

function mod360(value: number): number {
  return ((value % 360) + 360) % 360
}

/**
 * Where the sun is at `date`, seen from `location`.
 *
 * `date` is an absolute instant — its UTC value is what matters, so a caller
 * building "10:00 local time in Istanbul" has to construct that instant
 * itself. Keeping the conversion out here is deliberate: time zones move with
 * politics and DST, and a solar formula that quietly guessed one would be
 * wrong in ways nobody could see.
 */
export function solarPosition(location: GeoLocation, date: Date): SolarPosition {
  const t = julianCentury(date)

  const declination = sunDeclination(t) * DEG
  const latitude = location.latitude * DEG

  // Minutes past local solar midnight.
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + equationOfTime(t)
  const trueSolarTime = (((utcMinutes + location.longitude * 4) % 1440) + 1440) % 1440

  // Hour angle: 0 at solar noon, negative before, positive after.
  const hourAngle =
    (trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180) * DEG

  const zenithCos =
    Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle)
  const zenith = Math.acos(Math.max(-1, Math.min(1, zenithCos)))
  const altitude = 90 - zenith * RAD

  // Azimuth from the spherical triangle. At the poles the denominator
  // collapses, so fall back on the declination's sign — the sun is due south
  // from the north pole and due north from the south pole.
  const denominator = Math.sin(zenith) * Math.cos(latitude)
  let azimuth: number
  if (Math.abs(denominator) < 1e-9) {
    azimuth = location.latitude > 0 ? 180 : 0
  } else {
    const ratio = (Math.sin(latitude) * Math.cos(zenith) - Math.sin(declination)) / denominator
    const clamped = Math.max(-1, Math.min(1, ratio))
    azimuth =
      hourAngle > 0
        ? mod360(Math.acos(clamped) * RAD + 180)
        : mod360(540 - Math.acos(clamped) * RAD)
  }

  return { azimuth, altitude }
}

/** True when the sun is above the horizon at all. */
export function isDaylight(position: SolarPosition): boolean {
  return position.altitude > 0
}

/**
 * Direction *towards* the sun in scene space, as a unit vector.
 *
 * Scene axes are +X east, +Z south, +Y up when project north is zero — which
 * is the plan-view convention, where screen-up (-Z) is north.
 *
 * `northOffsetDeg` is **the true compass bearing that plan-up points at**. Zero
 * means the model is drawn with north up; 90 means plan-up faces east. It lets
 * a site drawn square to the page still be studied at its real bearing: a true
 * bearing `B` reads as `B - northOffsetDeg` in model space.
 */
export function sunDirection(
  position: SolarPosition,
  northOffsetDeg = 0,
): [number, number, number] {
  const altitude = position.altitude * DEG
  // Scene bearing measured the same way as the compass, then offset by how far
  // the model is rotated away from true north.
  const bearing = (position.azimuth - northOffsetDeg) * DEG

  const horizontal = Math.cos(altitude)
  return [
    horizontal * Math.sin(bearing),
    Math.sin(altitude),
    // Bearing 180° (due south) has to point along +Z, so the Z component is
    // the negated cosine.
    -horizontal * Math.cos(bearing),
  ]
}
