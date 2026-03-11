import { relations } from 'drizzle-orm'
import { pgTable, unique } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, createdAt } from '../../helpers'
import { projects } from './projects'
import { users } from '../auth/users'

export const projectsLikes = pgTable(
  'projects_likes',
  (t) => ({
    id: id('like'),
    projectId: t
      .text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: t
      .text('user_id')
      .notNull(),
    createdAt,
  }),
  (t) => [
    unique('projects_likes_project_user_unique').on(t.projectId, t.userId),
  ],
).enableRLS()

export const projectsLikesRelations = relations(projectsLikes, ({ one }) => ({
  project: one(projects, {
    fields: [projectsLikes.projectId],
    references: [projects.id],
  }),
}))

export type ProjectLike = typeof projectsLikes.$inferSelect
export type NewProjectLike = typeof projectsLikes.$inferInsert
export const insertProjectLikeSchema = createInsertSchema(projectsLikes)
export const selectProjectLikeSchema = createSelectSchema(projectsLikes)
