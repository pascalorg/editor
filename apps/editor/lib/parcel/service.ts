/**
 * Typed access to the vendored `server-parcel.cjs`. Node runtime only —
 * the module `require`s `node:https`.
 */
import { createRequire } from 'node:module'

const requireCjs = createRequire(import.meta.url)

export interface ParcelSuggestion {
  label?: string
  description?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  latitude?: number
  longitude?: number
  [key: string]: unknown
}

export interface ParcelRecord {
  apn?: string
  lotAreaSqFt?: number
  lotWidthFt?: number
  lotDepthFt?: number
  lotPerimeterFt?: number
  county?: string
  zoning?: string
  ownerName?: string
  state?: string
  zip?: string
  country?: string
  source?: string
  note?: string
  attributes?: Record<string, unknown>
}

export interface ParcelResult {
  parcel: ParcelRecord
  address?: { street?: string; city?: string; state?: string; zip?: string } | null
  geometry: {
    rings: [number, number][][]
    bounds: { n: number; s: number; e: number; w: number } | null
  }
  coordinates: { latitude: number; longitude: number }
  source: string
}

interface ServerParcelModule {
  geocode: (address: string) => Promise<Record<string, unknown> | null>
  parcel: (address: string) => Promise<ParcelResult | null>
  parcelAt: (
    lat: number,
    lng: number,
    opts?: Record<string, unknown>,
  ) => Promise<ParcelResult | null>
  parcelsNear: (lat: number, lng: number, opts?: Record<string, unknown>) => Promise<unknown>
  parcelByApn: (apn: string) => Promise<ParcelResult | null>
  parcelBySiteAddr: (parts: Record<string, unknown>) => Promise<ParcelResult | null>
  autocomplete: (q: string, opts?: Record<string, unknown>) => Promise<ParcelSuggestion[]>
  reverseGeocode: (lat: number, lng: number) => Promise<Record<string, unknown> | null>
  elevation: (
    points: { latitude: number; longitude: number }[],
    opts?: Record<string, unknown>,
  ) => Promise<unknown>
  staticMapUrl: (opts: Record<string, unknown>) => string | null
}

export const parcelService: ServerParcelModule = requireCjs('./server-parcel.cjs')
