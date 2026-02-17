import { relations } from 'drizzle-orm'
import { index, pgTable } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, timestampsColumns } from '../../helpers'
import { users } from '../auth/users'
import { addresses } from './addresses'

export const projects = pgTable(
  'projects',
  (t) => ({
    id: id('project'),
    name: t.text('name'),
    addressId: t
      .text('address_id')
      .references(() => addresses.id, { onDelete: 'set null' }),
    ownerId: t
      .text('owner_id')
      .references(() => users.id, { onDelete: 'set null' }),
    detailsJson: t.jsonb('details_json'),
    metadata: t.jsonb('metadata'),
    // Community features
    isPrivate: t.boolean('is_private').notNull().default(true),
    views: t.integer('views').notNull().default(0),
    likes: t.integer('likes').notNull().default(0),
    thumbnailUrl: t.text('thumbnail_url'),
    ...timestampsColumns,
  }),
  (t) => [
    index('project_address_idx').on(t.addressId),
    index('project_owner_idx').on(t.ownerId),
    index('project_is_private_idx').on(t.isPrivate),
    index('project_views_idx').on(t.views),
    index('project_likes_idx').on(t.likes),
  ],
).enableRLS()

export const projectsRelations = relations(projects, ({ one }) => ({
  address: one(addresses, {
    fields: [projects.addressId],
    references: [addresses.id],
  }),
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
}))

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export const insertProjectSchema = createInsertSchema(projects)
export const selectProjectSchema = createSelectSchema(projects)
