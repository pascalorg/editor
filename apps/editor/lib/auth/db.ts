import { resolveMysqlUrl } from '@pascal-app/mcp/storage'

/**
 * Auth stores users and sessions in the same MySQL database as scenes, but
 * through its own small pool rather than reaching into the scene store's
 * private one. mysql2 is a dynamic import (never a static one) so it stays a
 * traceable runtime dependency in the standalone bundle, exactly as the scene
 * store does it. node:crypto covers hashing, so auth adds no new dependency.
 */

interface MysqlQueryable {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
}

export interface MysqlPool extends MysqlQueryable {
  end(): Promise<void>
}

let pool: MysqlPool | null = null
let poolPromise: Promise<MysqlPool> | null = null

/** True when a MySQL target is configured. Auth is unavailable without one. */
export function authAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveMysqlUrl(env))
}

export async function getAuthPool(): Promise<MysqlPool> {
  if (pool) return pool
  if (!poolPromise) {
    poolPromise = (async () => {
      const url = resolveMysqlUrl(process.env)
      if (!url) {
        throw new Error('Auth requires a MySQL connection (DIGITALTWIN_MYSQL_URL or the trio).')
      }
      const mod = (await import('mysql2/promise')) as unknown as {
        createPool: (config: { uri: string; connectionLimit: number }) => MysqlPool
      }
      const created = mod.createPool({ uri: url, connectionLimit: 3 })
      try {
        await migrate(created)
      } catch (err) {
        // Don't cache a failed pool: a database briefly unreachable at boot
        // would otherwise poison auth until the process restarts.
        poolPromise = null
        await created.end().catch(() => {})
        throw err
      }
      pool = created
      return created
    })()
  }
  return poolPromise
}

/** Creates the auth tables. Safe to call repeatedly. */
export async function migrateAuth(): Promise<void> {
  await getAuthPool()
}

async function migrate(p: MysqlPool): Promise<void> {
  // The console owns the identity schema now (users, sessions, roles, ... —
  // see panel/migrations). Creating the editor's old users/user_sessions here
  // would race the console's migrations for the `users` name, so this only
  // verifies the console schema is reachable and reports plainly when the
  // migrations have not been run yet.
  try {
    await p.query('SELECT 1 FROM users LIMIT 1')
  } catch {
    throw new Error(
      "The console's database schema is missing. Run the panel migrations " +
        '(panel/migrate.ts) against this database first.',
    )
  }
}
