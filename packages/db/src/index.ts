/**
 * Database package
 * Exports Drizzle ORM and types
 * Note: Supabase clients are kept in the app's lib directory to avoid build-time initialization
 */

export type { Database as SupabaseDatabase } from './types'

// Drizzle exports
export { type Database, db } from './drizzle'
export * from './schema'

// Re-export drizzle-orm query operators so consumers can import everything
// from '@pascal-app/db' and avoid duplicate-instance type mismatches.
export {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'

import * as dbSchema from './schema'
export const schema = dbSchema
export {
  createId,
  deletedAt,
  id,
  lower,
  timestamps,
  timestampsColumns,
  timestampsColumnsSoftDelete,
} from './helpers'
