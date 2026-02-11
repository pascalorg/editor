import { pgTable, unique } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { id, timestampsColumns } from '../../helpers'

export const addresses = pgTable(
  'properties_addresses',
  (t) => ({
    id: id('address'),
    streetNumber: t.text('street_number'),
    route: t.text('route'),
    routeShort: t.text('route_short'),
    neighborhood: t.text('neighborhood'),
    city: t.text('city'),
    county: t.text('county'),
    state: t.text('state'),
    stateLong: t.text('state_long'),
    postalCode: t.text('postal_code'),
    postalCodeSuffix: t.text('postal_code_suffix'),
    country: t.text('country'),
    countryLong: t.text('country_long'),
    latitude: t.numeric('latitude'),
    longitude: t.numeric('longitude'),
    rawJson: t.jsonb('raw_json'),
    ...timestampsColumns,
  }),
  (t) => [
    // Unique constraint on core address components to prevent duplicates
    unique('address_components_unique').on(t.streetNumber, t.route, t.city, t.state, t.postalCode),
  ],
).enableRLS()

// Create address schema manually to avoid issues with generated columns
export const addressSchema = z.object({
  streetNumber: z.string().optional(),
  route: z.string().optional(),
  routeShort: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  stateLong: z.string().optional(),
  postalCode: z.string().optional(),
  postalCodeSuffix: z.string().optional(),
  country: z.string().default('US'),
  countryLong: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  rawJson: z.record(z.string(), z.unknown()).optional(),
})

export type AddressSchema = z.infer<typeof addressSchema>
export type Address = typeof addresses.$inferSelect
export type NewAddress = typeof addresses.$inferInsert
