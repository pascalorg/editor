import { index, pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, timestamps } from '../../helpers'

export const verifications = pgTable(
  'auth_verifications',
  (t) => ({
    id: id('verification'),
    value: t.text('value').notNull(),
    identifier: t.text('identifier').notNull(),
    expiresAt: t.timestamp('expires_at', {
      withTimezone: true,
    }),
    ...timestamps,
  }),
  (t) => [index('verification_identifier_index').on(t.identifier)],
).enableRLS()

export type Verification = typeof verifications.$inferSelect
export type NewVerification = typeof verifications.$inferInsert
export const insertVerificationSchema = createInsertSchema(verifications)
export const selectVerificationSchema = createSelectSchema(verifications)
