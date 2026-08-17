/**
 * better-auth's own tables. The column names are dictated by the library's
 * default schema, so they are not ours to tidy — renaming any of them means
 * carrying a field mapping in `packages/auth` forever.
 */
import { index, pgEnum, pgTable, uniqueIndex } from 'drizzle-orm/pg-core'
import { id, lower, timestamps } from '../helpers'

export const USER_ROLES = ['user', 'admin'] as const
export const userRoles = pgEnum('auth_user_roles', USER_ROLES)

export const users = pgTable(
  'auth_users',
  (t) => ({
    id: id('user'),
    email: t.text('email').notNull(),
    emailVerified: t.boolean('email_verified').notNull().default(false),
    name: t.text('name').notNull(),
    image: t.text('image'),
    role: userRoles('role').notNull().default('user'),
    banned: t.boolean('banned').notNull().default(false),
    banReason: t.text('ban_reason'),
    banExpires: t.timestamp('ban_expires', { withTimezone: true }),
    ...timestamps,
  }),
  // Case-insensitive: `Ali@x.com` and `ali@x.com` are one account, and letting
  // both exist is how a magic link ends up signing in the wrong row.
  (t) => [uniqueIndex('auth_users_email_unique').on(lower(t.email))],
)

export const sessions = pgTable(
  'auth_sessions',
  (t) => ({
    id: id('session'),
    userId: t
      .text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: t.timestamp('expires_at', { withTimezone: true }).notNull(),
    token: t.text('token').notNull(),
    ipAddress: t.text('ip_address'),
    userAgent: t.text('user_agent'),
    impersonatedBy: t.text('impersonated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  }),
  (t) => [
    uniqueIndex('auth_sessions_token_unique').on(t.token),
    index('auth_sessions_user_idx').on(t.userId),
  ],
)

export const accounts = pgTable(
  'auth_accounts',
  (t) => ({
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
    accessTokenExpiresAt: t.timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: t.timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: t.text('scope'),
    ...timestamps,
  }),
  // One row per provider identity. Without this, account linking can duplicate
  // a Google identity across two users and the second sign-in picks arbitrarily.
  (t) => [uniqueIndex('auth_accounts_provider_unique').on(t.providerId, t.accountId)],
)

export const verifications = pgTable(
  'auth_verifications',
  (t) => ({
    id: id('verification'),
    identifier: t.text('identifier').notNull(),
    value: t.text('value').notNull(),
    expiresAt: t.timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  }),
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type Account = typeof accounts.$inferSelect
export type Verification = typeof verifications.$inferSelect
