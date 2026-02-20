import { pgEnum, pgTable, uniqueIndex } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, lower, timestampsColumns } from '../../helpers'

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
    /** Public username for the community hub */
    username: t.text('username'),
    /** GitHub profile URL */
    githubUrl: t.text('github_url'),
    /** X/Twitter profile URL */
    xUrl: t.text('x_url'),
    /** Whether the user wants to receive email notifications about new features and updates */
    emailNotifications: t.boolean('email_notifications').notNull().default(true),
    role: userRoles('role').notNull().default('user'),
    banned: t.boolean('banned').notNull().default(false),
    banReason: t.text('ban_reason'),
    banExpires: t.timestamp('ban_expires', { withTimezone: true }),
    ...timestampsColumns,
  }),
  (t) => [
    uniqueIndex('email_unique_index').on(lower(t.email)),
    uniqueIndex('username_unique_index').on(lower(t.username)),
  ],
).enableRLS()

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export const insertUserSchema = createInsertSchema(users)
export const selectUserSchema = createSelectSchema(users)
