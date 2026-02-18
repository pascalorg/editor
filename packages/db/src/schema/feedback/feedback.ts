import { pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, createdAt } from '../../helpers'

export const feedback = pgTable('feedback', (t) => ({
  id: id('feedback'),
  userId: t.text('user_id'), // nullable — stores Better Auth user ID or null for anonymous
  message: t.text('message').notNull(),
  createdAt,
})).enableRLS()

export type Feedback = typeof feedback.$inferSelect
export type NewFeedback = typeof feedback.$inferInsert
export const insertFeedbackSchema = createInsertSchema(feedback)
export const selectFeedbackSchema = createSelectSchema(feedback)
