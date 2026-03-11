import { relations } from 'drizzle-orm'
import { pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, timestampsColumnsSoftDelete } from '../../helpers'
import { projects } from './projects'

export const models = pgTable('projects_models', (t) => ({
  id: id('model'),
  name: t.text('name'),
  version: t.integer('version').default(1),
  description: t.text('description'),
  draft: t.boolean('draft').default(true),
  projectId: t
    .text('project_id')
    .references(() => projects.id, { onDelete: 'set null' }),
  sceneGraph: t.jsonb('scene_graph'),
  metadata: t.jsonb('metadata'),
  ...timestampsColumnsSoftDelete,
})).enableRLS()

export const modelsRelations = relations(models, ({ one }) => ({
  project: one(projects, {
    fields: [models.projectId],
    references: [projects.id],
  }),
}))

export type Model = typeof models.$inferSelect
export type NewModel = typeof models.$inferInsert
export const insertModelSchema = createInsertSchema(models)
export const selectModelSchema = createSelectSchema(models)
