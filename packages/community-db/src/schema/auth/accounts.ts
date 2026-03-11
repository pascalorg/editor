import { pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, timestamps } from '../../helpers'
import { users } from './users'

export const accounts = pgTable('auth_accounts', (t) => ({
  id: id('account'),
  userId: t
    .text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  providerId: t.text('provider_id').notNull(),
  accountId: t.text('account_id').notNull(),
  password: t.text('password'),
  accessToken: t.text('access_token'),
  refreshToken: t.text('refresh_token'),
  idToken: t.text('id_token'),
  accessTokenExpiresAt: t.timestamp('access_token_expires_at', {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: t.timestamp('refresh_token_expires_at', {
    withTimezone: true,
  }),
  scope: t.text('scope'),
  ...timestamps,
})).enableRLS()

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
export const insertAccountSchema = createInsertSchema(accounts)
export const selectAccountSchema = createSelectSchema(accounts)
