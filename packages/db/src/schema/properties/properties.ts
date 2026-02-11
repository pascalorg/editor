import { relations } from 'drizzle-orm'
import { index, pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, timestampsColumns } from '../../helpers'
import { users } from '../auth/users'
import { addresses } from './addresses'

export const properties = pgTable(
  'properties',
  (t) => ({
    id: id('property'),
    name: t.text('name'),
    addressId: t
      .text('address_id')
      .references(() => addresses.id, { onDelete: 'set null' })
      .unique(),
    ownerId: t
      .text('owner_id')
      .references(() => users.id, { onDelete: 'set null' }),
    detailsJson: t.jsonb('details_json'),
    metadata: t.jsonb('metadata'),
    ...timestampsColumns,
  }),
  (t) => [
    index('property_address_idx').on(t.addressId),
    index('property_owner_idx').on(t.ownerId),
  ],
).enableRLS()

export const propertiesRelations = relations(properties, ({ one }) => ({
  address: one(addresses, {
    fields: [properties.addressId],
    references: [addresses.id],
  }),
  owner: one(users, {
    fields: [properties.ownerId],
    references: [users.id],
  }),
}))

export type Property = typeof properties.$inferSelect
export type NewProperty = typeof properties.$inferInsert
export const insertPropertySchema = createInsertSchema(properties)
export const selectPropertySchema = createSelectSchema(properties)
