import { type AnyColumn, type SQL, sql } from 'drizzle-orm'
import { text, timestamp } from 'drizzle-orm/pg-core'
import { customAlphabet } from 'nanoid'

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const nanoid = customAlphabet(alphabet, 16)

/**
 * Generate a unique ID with optional prefix
 * @example createId('user') => 'user_Abc123...'
 */
export const createId = (prefix?: string) => {
  const id = nanoid()
  return prefix ? `${prefix}_${id}` : id
}

/**
 * Primary key column with auto-generated prefixed ID
 * @example id('user') => text('id').notNull().primaryKey().$defaultFn(() => createId('user'))
 */
export const id = (prefix?: string) =>
  text('id')
    .notNull()
    .primaryKey()
    .$defaultFn(() => createId(prefix))
    .$type<string>()

export const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date())

export const deletedAt = timestamp('deleted_at', { withTimezone: true })

/**
 * Standard timestamp columns for created_at and updated_at
 */
export const timestamps = {
  createdAt,
  updatedAt,
}

// Alias for backwards compatibility with existing code
export const timestampsColumns = timestamps

export const timestampsColumnsSoftDelete = {
  ...timestampsColumns,
  deletedAt,
}

/**
 * SQL helper for case-insensitive comparison
 */
export const lower = (column: AnyColumn): SQL => sql`lower(${column})`
