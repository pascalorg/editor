import { pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, createdAt } from '../../helpers'

export const feedback = pgTable('feedback', (t) => ({
  id: id('feedback'),
  userId: t.text('user_id'),
  userEmail: t.text('user_email'),
  userName: t.text('user_name'),
  projectId: t.text('project_id'),
  message: t.text('message').notNull(),
  images: t.jsonb('images').$type<string[]>(),
  sceneGraph: t.jsonb('scene_graph'),
  createdAt,
})).enableRLS()

export type Feedback = typeof feedback.$inferSelect
export type NewFeedback = typeof feedback.$inferInsert
export const insertFeedbackSchema = createInsertSchema(feedback)
export const selectFeedbackSchema = createSelectSchema(feedback)
