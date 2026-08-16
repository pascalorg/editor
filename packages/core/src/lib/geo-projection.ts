import type { Point2D } from './polygon-relations'
import { polygonSignedArea } from './polygon-relations'

export type LonLat = { longitude: number; latitude: number }

/** The scene origin's place on earth. Everything local is measured from here. */
export type GeoAnchor = { latitude: number; longitude: number }

const WGS84_SEMI_MAJOR = 6_378_137
const WGS84_FLATTENING = 1 / 298.257223563
const WGS84_ECCENTRICITY_SQUARED = WGS84_FLATTENING * (2 - WGS84_FLATTENING)

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

/**
 * How far apart the polygon's own area and the registry's recorded area may sit
 * before the import is worth questioning. Winding, coordinate-order and anchor
 * mistakes all show up as a gross area error, so this one number catches the
 * whole class.
 */
export const PARCEL_AREA_TOLERANCE = 0.01

/**
 * Metres per radian of latitude and of longitude at a given latitude — the
 * meridian and prime-vertical radii of curvature of the WGS84 ellipsoid.
 *
 * Holding these fixed at the anchor is what makes the projection a local
 * tangent plane (ENU) rather than a map projection. The scale error grows as
 * (d/R)², so a 200 m parcel is off by well under a millimetre and a 5 km site
 * by under a centimetre. A conformal projection (UTM, or Turkey's TM30 zones
 * EPSG:5254–5259) plus a `proj4` dependency would buy nothing at that size.
 */
function curvatureRadii(latitudeDegrees: number) {
  const sinLatitude = Math.sin(latitudeDegrees * DEG_TO_RAD)
  const oneMinusESinSquared = 1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude
  const meridian =
    (WGS84_SEMI_MAJOR * (1 - WGS84_ECCENTRICITY_SQUARED)) / oneMinusESinSquared ** 1.5
  const primeVertical = WGS84_SEMI_MAJOR / Math.sqrt(oneMinusESinSquared)
  return { meridian, primeVertical }
}

/**
 * WGS84 → scene metres, with `+X` east and `-Z` north.
 *
 * The Z flip is the scene's own convention (plan-up is `-Z`), not a projection
 * detail: it means a ring that runs counter-clockwise on a map comes back
 * clockwise here, which is why `ringToLocalMeters` normalises winding after
 * converting rather than before.
 */
export function lonLatToLocalMeters(point: LonLat, anchor: GeoAnchor): Point2D {
  const { meridian, primeVertical } = curvatureRadii(anchor.latitude)
  const east =
    (point.longitude - anchor.longitude) *
    DEG_TO_RAD *
    primeVertical *
    Math.cos(anchor.latitude * DEG_TO_RAD)
  const north = (point.latitude - anchor.latitude) * DEG_TO_RAD * meridian
  return [east, -north]
}

/** The exact inverse of {@link lonLatToLocalMeters} for the same anchor. */
export function localMetersToLonLat(point: Point2D, anchor: GeoAnchor): LonLat {
  const { meridian, primeVertical } = curvatureRadii(anchor.latitude)
  const longitude =
    anchor.longitude +
    (point[0] * RAD_TO_DEG) / (primeVertical * Math.cos(anchor.latitude * DEG_TO_RAD))
  const latitude = anchor.latitude + (-point[1] * RAD_TO_DEG) / meridian
  return { longitude, latitude }
}

/** Mean of the ring's vertices — good enough for an anchor, and cheap. */
export function ringCentroid(ring: readonly LonLat[]): GeoAnchor {
  if (ring.length === 0) return { latitude: 0, longitude: 0 }
  let latitude = 0
  let longitude = 0
  for (const point of ring) {
    latitude += point.latitude
    longitude += point.longitude
  }
  return { latitude: latitude / ring.length, longitude: longitude / ring.length }
}

/**
 * The anchor a ring should be projected against.
 *
 * An anchor the scene already carries wins over the ring's own centroid. Two
 * parcels imported into one scene are neighbours in the world and have to stay
 * neighbours here; re-anchoring on the second one lands it on top of the first.
 */
export function resolveGeoAnchor(
  existing: { latitude?: number | null; longitude?: number | null } | undefined,
  ring: readonly LonLat[],
): GeoAnchor {
  if (
    existing &&
    typeof existing.latitude === 'number' &&
    Number.isFinite(existing.latitude) &&
    typeof existing.longitude === 'number' &&
    Number.isFinite(existing.longitude)
  ) {
    return { latitude: existing.latitude, longitude: existing.longitude }
  }
  return ringCentroid(ring)
}

/**
 * A GeoJSON ring as the scene wants it: scene metres, open (no repeated closing
 * point), and wound so the signed area is positive — the winding the default
 * site polygon already uses, and the one the offset walk in `setback-offset`
 * assumes. Neither is guaranteed by the source: GeoJSON closes its rings, and
 * cadastral services are inconsistent about direction.
 */
export function ringToLocalMeters(ring: readonly LonLat[], anchor: GeoAnchor): Point2D[] {
  const points = ring.map((point) => lonLatToLocalMeters(point, anchor))

  const first = points[0]
  const last = points[points.length - 1]
  if (
    points.length > 1 &&
    first &&
    last &&
    Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6
  ) {
    points.pop()
  }

  if (polygonSignedArea(points) < 0) points.reverse()
  return points
}

/** Relative gap between the polygon's own area and a recorded one, as a fraction. */
export function parcelAreaDeviation(computedArea: number, registeredArea: number): number {
  if (!Number.isFinite(registeredArea) || registeredArea <= 0) return 0
  return Math.abs(computedArea - registeredArea) / registeredArea
}
