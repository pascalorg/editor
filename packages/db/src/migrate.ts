/**
 * Applies the committed SQL migrations.
 *
 * Run as a **one-off deploy step**, never on app boot: N replicas starting
 * together would all try to migrate at once, and the loser of that race either
 * crashes or serves traffic against a half-migrated schema.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDatabaseClient } from './client'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export async function runMigrations(connectionString?: string): Promise<void> {
  const { client, db } = createDatabaseClient({ connectionString, poolSize: 1 })
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await client.end()
  }
}

if (import.meta.main) {
  runMigrations()
    .then(() => {
      console.log('[db] migrations applied')
    })
    .catch((error) => {
      console.error('[db] migration failed:', error)
      process.exit(1)
    })
}
