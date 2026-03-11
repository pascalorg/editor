import { relations } from 'drizzle-orm'
import { pgTable } from 'drizzle-orm/pg-core'
import { id, timestampsColumns } from '../../helpers'
import { projects } from './projects'

export const projectAssets = pgTable('project_assets', (t) => ({
  id: id('asset'),
  projectId: t.text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  storageKey: t.text('storage_key').notNull(),
  url: t.text('url').notNull(),
  type: t.text('type').notNull(), // 'scan' | 'guide'
  originalName: t.text('original_name'),
  mimeType: t.text('mime_type'),
  ...timestampsColumns,
})).enableRLS()

export const projectAssetsRelations = relations(projectAssets, ({ one }) => ({
  project: one(projects, {
    fields: [projectAssets.projectId],
    references: [projects.id],
  }),
}))

export type ProjectAsset = typeof projectAssets.$inferSelect
export type NewProjectAsset = typeof projectAssets.$inferInsert
