import { describe, expect, test } from 'bun:test'
import {
  type GeoAnchor,
  type LonLat,
  localMetersToLonLat,
  lonLatToLocalMeters,
  PARCEL_AREA_TOLERANCE,
  parcelAreaDeviation,
  resolveGeoAnchor,
  ringCentroid,
  ringToLocalMeters,
} from './geo-projection'
import { polygonArea, polygonSignedArea } from './polygon-relations'

/**
 * Vincenty's inverse solution — the reference the projection is measured
 * against. Haversine would be the obvious choice and is the wrong one here: on
 * a sphere of mean radius it disagrees with the ellipsoid by ~0.2% at these
 * latitudes, which is two orders of magnitude larger than the error we are
 * trying to detect.
 */
function vincentyDistance(a: LonLat, b: LonLat): number {
  const semiMajor = 6_378_137
  const flattening = 1 / 298.257223563
  const semiMinor = (1 - flattening) * semiMajor
  const toRad = Math.PI / 180

  const L = (b.longitude - a.longitude) * toRad
  const U1 = Math.atan((1 - flattening) * Math.tan(a.latitude * toRad))
  const U2 = Math.atan((1 - flattening) * Math.tan(b.latitude * toRad))
  const sinU1 = Math.sin(U1)
  const cosU1 = Math.cos(U1)
  const sinU2 = Math.sin(U2)
  const cosU2 = Math.cos(U2)

  let lambda = L
  let sinSigma = 0
  let cosSigma = 0
  let sigma = 0
  let cosSquaredAlpha = 0
  let cos2SigmaM = 0

  for (let iteration = 0; iteration < 200; iteration++) {
    const sinLambda = Math.sin(lambda)
    const cosLambda = Math.cos(lambda)
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
    if (sinSigma === 0) return 0
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda
    sigma = Math.atan2(sinSigma, cosSigma)
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma
    cosSquaredAlpha = 1 - sinAlpha * sinAlpha
    cos2SigmaM = cosSquaredAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSquaredAlpha
    const C = (flattening / 16) * cosSquaredAlpha * (4 + flattening * (4 - 3 * cosSquaredAlpha))
    const previous = lambda
    lambda =
      L +
      (1 - C) *
        flattening *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))
    if (Math.abs(lambda - previous) < 1e-12) break
  }

  const uSquared =
    (cosSquaredAlpha * (semiMajor * semiMajor - semiMinor * semiMinor)) / (semiMinor * semiMinor)
  const A = 1 + (uSquared / 16384) * (4096 + uSquared * (-768 + uSquared * (320 - 175 * uSquared)))
  const B = (uSquared / 1024) * (256 + uSquared * (-128 + uSquared * (74 - 47 * uSquared)))
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)))

  return semiMinor * A * (sigma - deltaSigma)
}

const ankara: GeoAnchor = { latitude: 39.90166, longitude: 32.85587 }

describe('lonLatToLocalMeters', () => {
  test('round-trips to under a millimetre across Turkey’s latitude band', () => {
    for (const latitude of [36, 38, 39.9, 41, 42]) {
      const anchor: GeoAnchor = { latitude, longitude: 32 }
      for (const [dx, dz] of [
        [0, 0],
        [120, -85],
        [-2_400, 1_900],
        [15_000, 15_000],
      ] as const) {
        const back = lonLatToLocalMeters(localMetersToLonLat([dx, dz], anchor), anchor)
        expect(Math.hypot(back[0] - dx, back[1] - dz)).toBeLessThan(1e-3)
      }
    }
  })

  test('matches the geodesic distance to better than 0.01%', () => {
    // A parcel-sized offset, and one far larger than any parcel.
    for (const [dLon, dLat] of [
      [0.001, 0],
      [0, 0.001],
      [0.0015, -0.0012],
      [0.02, 0.02],
    ] as const) {
      const point: LonLat = {
        longitude: ankara.longitude + dLon,
        latitude: ankara.latitude + dLat,
      }
      const projected = lonLatToLocalMeters(point, ankara)
      const planar = Math.hypot(projected[0], projected[1])
      const geodesic = vincentyDistance(ankara, point)
      expect(Math.abs(planar - geodesic) / geodesic).toBeLessThan(1e-4)
    }
  })

  test('puts east on +X and north on -Z', () => {
    const east = lonLatToLocalMeters(
      { longitude: ankara.longitude + 0.001, latitude: ankara.latitude },
      ankara,
    )
    expect(east[0]).toBeGreaterThan(0)
    expect(Math.abs(east[1])).toBeLessThan(1e-9)

    const north = lonLatToLocalMeters(
      { longitude: ankara.longitude, latitude: ankara.latitude + 0.001 },
      ankara,
    )
    expect(north[1]).toBeLessThan(0)
    expect(Math.abs(north[0])).toBeLessThan(1e-9)
  })
})

describe('ringToLocalMeters', () => {
  // ~100 m square, given counter-clockwise in lon/lat.
  const dLat = 0.0009
  const dLon = 0.001172
  const square: LonLat[] = [
    { longitude: ankara.longitude - dLon, latitude: ankara.latitude - dLat },
    { longitude: ankara.longitude + dLon, latitude: ankara.latitude - dLat },
    { longitude: ankara.longitude + dLon, latitude: ankara.latitude + dLat },
    { longitude: ankara.longitude - dLon, latitude: ankara.latitude + dLat },
  ]

  test('drops the repeated closing point a GeoJSON ring carries', () => {
    const closed = [...square, square[0]!]
    expect(ringToLocalMeters(closed, ankara)).toHaveLength(4)
  })

  test('normalises winding, and the reversed ring lands on the same shape', () => {
    const forward = ringToLocalMeters(square, ankara)
    const backward = ringToLocalMeters([...square].reverse(), ankara)

    expect(polygonSignedArea(forward)).toBeGreaterThan(0)
    expect(polygonSignedArea(backward)).toBeGreaterThan(0)
    expect(polygonArea(forward)).toBeCloseTo(polygonArea(backward), 6)
  })

  test('produces the metric area the coordinates describe', () => {
    const ring = ringToLocalMeters(square, ankara)
    const width = vincentyDistance(square[0]!, square[1]!)
    const height = vincentyDistance(square[1]!, square[2]!)
    const expected = width * height
    expect(Math.abs(polygonArea(ring) - expected) / expected).toBeLessThan(1e-4)
  })

  test('a shared anchor keeps two parcels apart instead of stacking them', () => {
    const neighbour = square.map((point) => ({ ...point, longitude: point.longitude + 2 * dLon }))
    const anchor = resolveGeoAnchor(undefined, square)

    const first = ringToLocalMeters(square, anchor)
    // The second import must reuse the anchor the site already carries.
    const second = ringToLocalMeters(neighbour, resolveGeoAnchor(anchor, neighbour))

    const firstMaxX = Math.max(...first.map(([x]) => x))
    const secondMinX = Math.min(...second.map(([x]) => x))
    expect(secondMinX).toBeCloseTo(firstMaxX, 6)

    // Re-anchoring on the neighbour is exactly the bug this guards.
    const reanchored = ringToLocalMeters(neighbour, ringCentroid(neighbour))
    expect(Math.min(...reanchored.map(([x]) => x))).toBeCloseTo(
      Math.min(...first.map(([x]) => x)),
      6,
    )
  })
})

describe('parcelAreaDeviation', () => {
  test('flags a gross mismatch and stays quiet on a small one', () => {
    expect(parcelAreaDeviation(1295, 1295)).toBe(0)
    expect(parcelAreaDeviation(1300, 1295)).toBeLessThan(PARCEL_AREA_TOLERANCE)
    expect(parcelAreaDeviation(1450, 1295)).toBeGreaterThan(PARCEL_AREA_TOLERANCE)
  })

  test('reports nothing when there is no recorded area to compare against', () => {
    expect(parcelAreaDeviation(1295, 0)).toBe(0)
    expect(parcelAreaDeviation(1295, Number.NaN)).toBe(0)
  })
})
