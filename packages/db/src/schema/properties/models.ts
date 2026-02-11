import { relations } from 'drizzle-orm'
import { pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, timestampsColumnsSoftDelete } from '../../helpers'
import { properties } from './properties'

export const models = pgTable('properties_models', (t) => ({
  id: id('model'),
  name: t.text('name'),
  version: t.integer('version').default(1),
  description: t.text('description'),
  draft: t.boolean('draft').default(true),
  propertyId: t
    .text('property_id')
    .references(() => properties.id, { onDelete: 'set null' }),
  sceneGraph: t.jsonb('scene_graph'),
  metadata: t.jsonb('metadata'),
  ...timestampsColumnsSoftDelete,
})).enableRLS()

export const modelsRelations = relations(models, ({ one }) => ({
  property: one(properties, {
    fields: [models.propertyId],
    references: [properties.id],
  }),
}))

export type Model = typeof models.$inferSelect
export type NewModel = typeof models.$inferInsert
export const insertModelSchema = createInsertSchema(models)
export const selectModelSchema = createSelectSchema(models)
