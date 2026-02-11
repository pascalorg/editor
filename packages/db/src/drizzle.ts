import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

if (!process.env.POSTGRES_URL) {
  throw new Error(
    'Missing POSTGRES_URL environment variable. Add your Supabase database connection string.',
  )
}

// Create postgres connection
const client = postgres(process.env.POSTGRES_URL)

// Create drizzle instance
export const db = drizzle(client, { schema })

export type Database = typeof db
