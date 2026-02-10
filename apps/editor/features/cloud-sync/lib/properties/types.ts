/**
 * Property-related type definitions
 * Isolated from monorepo database schema
 */

export type Property = {
  id: string
  name: string
  ownerId: string
  organizationId: string | null
  addressId: string
  createdAt: Date
  updatedAt: Date
  address: {
    id: string
    streetNumber?: string
    route?: string
    city?: string
    state?: string
    postalCode?: string
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
}
