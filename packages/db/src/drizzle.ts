import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let _db: PostgresJsDatabase<typeof schema> | null = null
let _client: ReturnType<typeof postgres> | null = null

function getDb() {
  if (!_db) {
    const postgresUrl = process.env.POSTGRES_URL

    if (!postgresUrl) {
      throw new Error(
        'Missing POSTGRES_URL environment variable. Please configure it in your deployment settings or .env.local file.',
      )
    }

    // Create postgres connection
    _client = postgres(postgresUrl)

    // Create drizzle instance
    _db = drizzle(_client, { schema })
  }
  return _db
}

/**
 * Drizzle database instance
 * Initialized lazily to avoid requiring env vars at build time
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop)
  },
})

export type Database = typeof db
