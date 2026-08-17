import { type AnyColumn, type SQL, sql } from 'drizzle-orm'
import { text, timestamp } from 'drizzle-orm/pg-core'
import { customAlphabet } from 'nanoid'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const nanoid = customAlphabet(ALPHABET, 16)

/**
 * Prefixed ids, so a value read out of a log or a URL says what it is.
 *
 * @example createId('user') => 'user_Abc123…'
 */
export const createId = (prefix?: string): string => {
  const value = nanoid()
  return prefix ? `${prefix}_${value}` : value
}

/** Primary key carrying its own prefixed default. */
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

export const timestamps = { createdAt, updatedAt }

/** Case-insensitive comparison, for the unique indexes on email and slug. */
export const lower = (column: AnyColumn): SQL => sql`lower(${column})`
