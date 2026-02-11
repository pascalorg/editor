/**
 * Database package
 * Exports Supabase clients, Drizzle ORM, and types
 */

export { supabase } from './client'
export { supabaseAdmin } from './server'
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
