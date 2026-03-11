/**
 * Database package
 * Exports Drizzle ORM and types
 * Note: Supabase clients are kept in the app's lib directory to avoid build-time initialization
 */

export type { Database as SupabaseDatabase } from './types'

// Drizzle exports
export { type Database, db } from './drizzle'
export * from './schema'


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
