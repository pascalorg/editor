/**
 * Where the sun is computed for. In order: the site's own geocoded point, a device location the
 * user granted (cached by the host), a coarse guess from the browser's timezone, a mid-latitude
 * default. Never prompts by itself: requesting the device location is a user action.
 */

export type LatLng = { lat: number; lng: number }
export type LocationSource = 'site' | 'device' | 'timezone' | 'default'

type SiteLike = {
  parcel?: { originLngLat?: readonly [number, number] | null } | null
  dossier?: { point?: { lat?: number; lng?: number } | null } | null
}

export function siteLocation(site: SiteLike | null | undefined): LatLng | null {
  const origin = site?.parcel?.originLngLat
  if (origin && Number.isFinite(origin[0]) && Number.isFinite(origin[1]))
    return { lat: origin[1], lng: origin[0] }
  const point = site?.dossier?.point
  if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng))
    return { lat: point.lat!, lng: point.lng! }
  return null
}

/** A representative city per common IANA zone — only to pick a plausible latitude/longitude. */
const ZONE_POINTS: Record<string, LatLng> = {
  'America/New_York': { lat: 40.71, lng: -74.0 },
  'America/Chicago': { lat: 41.88, lng: -87.63 },
  'America/Denver': { lat: 39.74, lng: -104.99 },
  'America/Phoenix': { lat: 33.45, lng: -112.07 },
  'America/Los_Angeles': { lat: 34.05, lng: -118.24 },
  'America/Toronto': { lat: 43.65, lng: -79.38 },
  'America/Vancouver': { lat: 49.28, lng: -123.12 },
  'America/Mexico_City': { lat: 19.43, lng: -99.13 },
  'America/Sao_Paulo': { lat: -23.55, lng: -46.63 },
  'Europe/London': { lat: 51.51, lng: -0.13 },
  'Europe/Paris': { lat: 48.86, lng: 2.35 },
  'Europe/Berlin': { lat: 52.52, lng: 13.4 },
  'Europe/Madrid': { lat: 40.42, lng: -3.7 },
  'Europe/Rome': { lat: 41.9, lng: 12.5 },
  'Europe/Amsterdam': { lat: 52.37, lng: 4.9 },
  'Europe/Stockholm': { lat: 59.33, lng: 18.07 },
  'Asia/Tokyo': { lat: 35.68, lng: 139.69 },
  'Asia/Shanghai': { lat: 31.23, lng: 121.47 },
  'Asia/Singapore': { lat: 1.35, lng: 103.82 },
  'Asia/Dubai': { lat: 25.2, lng: 55.27 },
  'Asia/Kolkata': { lat: 19.08, lng: 72.88 },
  'Australia/Sydney': { lat: -33.87, lng: 151.21 },
  'Pacific/Auckland': { lat: -36.85, lng: 174.76 },
}

export const DEFAULT_LOCATION: LatLng = { lat: 40.71, lng: -74.0 }

export function timezoneLocation(timeZone?: string): LatLng | null {
  let zone = timeZone
  if (!zone) {
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return null
    }
  }
  return (zone && ZONE_POINTS[zone]) || null
}

export function resolveLocation(
  site: SiteLike | null | undefined,
  device: LatLng | null | undefined,
): { location: LatLng; source: LocationSource } {
  const fromSite = siteLocation(site)
  if (fromSite) return { location: fromSite, source: 'site' }
  if (device) return { location: device, source: 'device' }
  const fromZone = timezoneLocation()
  if (fromZone) return { location: fromZone, source: 'timezone' }
  return { location: DEFAULT_LOCATION, source: 'default' }
}

/** Ask the browser for the device position (call from a user gesture). */
export function requestDeviceLocation(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => reject(error),
      { enableHighAccuracy: false, maximumAge: 24 * 3_600_000, timeout: 10_000 },
    )
  })
}
