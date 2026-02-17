import { pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, timestamps } from '../../helpers'
import { users } from './users'

export const sessions = pgTable('auth_sessions', (t) => ({
  id: id('session'),
  userId: t
    .text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: t.timestamp('expires_at', { withTimezone: true }),
  token: t.text('token').notNull(),
  ipAddress: t.text('ip_address'),
  userAgent: t.text('user_agent'),
  // Custom: active project for the session context
  activeProjectId: t.text('active_project_id'),
  // Admin plugin support: tracks who is impersonating this session
  impersonatedBy: t
    .text('impersonated_by')
    .references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
})).enableRLS()

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export const insertSessionSchema = createInsertSchema(sessions)
export const selectSessionSchema = createSelectSchema(sessions)
