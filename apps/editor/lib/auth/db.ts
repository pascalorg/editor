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
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      email VARCHAR(320) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user','admin') NOT NULL DEFAULT 'user',
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      -- email is normalized to lowercase in app code before every insert and
      -- lookup, so a plain unique prefix index enforces case-insensitive
      -- uniqueness. 191 keeps the key under the 767-byte COMPACT-row cap.
      UNIQUE KEY users_email_uidx (email(191))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await p.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      token_hash CHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      expires_at VARCHAR(32) NOT NULL,
      UNIQUE KEY user_sessions_token_uidx (token_hash),
      INDEX user_sessions_user_idx (user_id),
      CONSTRAINT user_sessions_user_fk FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}
