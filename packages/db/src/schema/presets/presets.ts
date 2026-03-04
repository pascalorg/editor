import { pgTable, index, text, boolean, jsonb } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { id, timestampsColumns } from '../../helpers'
import { users } from '../auth/users'

export const presets = pgTable(
  'presets',
  (t) => ({
    id: id('preset'),
    type: t.text('type').notNull(), // 'door' | 'window'
    name: t.text('name').notNull(),
    data: t.jsonb('data').notNull(),
    thumbnailUrl: t.text('thumbnail_url'),
    userId: t
      .text('user_id')
      .references(() => users.id, { onDelete: 'cascade' }),
    isCommunity: t.boolean('is_community').notNull().default(false),
    ...timestampsColumns,
  }),
  (t) => [
    index('presets_type_idx').on(t.type),
    index('presets_user_id_idx').on(t.userId),
    index('presets_is_community_idx').on(t.isCommunity),
  ],
).enableRLS()

export type Preset = typeof presets.$inferSelect
export type NewPreset = typeof presets.$inferInsert
export const insertPresetSchema = createInsertSchema(presets)
export const selectPresetSchema = createSelectSchema(presets)
