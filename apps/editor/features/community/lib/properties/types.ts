/**
 * Property-related type definitions
 * Isolated from monorepo database schema
 */

export type Property = {
  id: string
  name: string
  owner_id: string
  organization_id: string | null
  address_id: string
  created_at: string
  updated_at: string
  // Community features
  is_private: boolean
  views: number
  likes: number
  thumbnail_url: string | null
  address: {
    id: string
    street_number?: string
    route?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
    latitude?: string
    longitude?: string
  }
}

export type CreatePropertyParams = {
  name: string
  center: [number, number]
  streetNumber?: string
  route?: string
  routeShort?: string
  neighborhood?: string
  city?: string
  county?: string
  state?: string
  stateLong?: string
  postalCode?: string
  postalCodeSuffix?: string
  country?: string
  countryLong?: string
  rawJson?: Record<string, unknown>
  isPrivate?: boolean
  sceneGraph?: any
}
