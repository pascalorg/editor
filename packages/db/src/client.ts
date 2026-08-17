import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Connection pool sizing is the thing that breaks first in production: N app
 * replicas × this number has to stay under Postgres' `max_connections`, which
 * is why deployments put PgBouncer in front in transaction mode. `prepare:
 * false` is required for that — a transaction pooler hands each statement a
 * different backend, so a prepared statement from an earlier one is not there.
 */
const DEFAULT_POOL_SIZE = 10

export type DatabaseOptions = {
  connectionString?: string
  /** Per-replica pool size. Keep `replicas × poolSize` under `max_connections`. */
  poolSize?: number
}

export function createDatabaseClient(options: DatabaseOptions = {}) {
  const connectionString = options.connectionString ?? process.env.POSTGRES_URL
  if (!connectionString) {
    throw new Error('POSTGRES_URL is not set')
  }

  const poolSize =
    options.poolSize ??
    (process.env.POSTGRES_POOL_SIZE ? Number(process.env.POSTGRES_POOL_SIZE) : DEFAULT_POOL_SIZE)

  const client = postgres(connectionString, { prepare: false, max: poolSize })
  return { client, db: drizzle({ client, schema }) }
}

let cached: ReturnType<typeof createDatabaseClient> | null = null

/**
 * Per-process singleton. Route handlers and Server Components run in the same
 * process, and each one opening its own pool is how a single replica exhausts
 * `max_connections` on its own.
 */
export function getDatabase() {
  if (!cached) cached = createDatabaseClient()
  return cached.db
}

export type Database = ReturnType<typeof getDatabase>
