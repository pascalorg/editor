import { resolveMysqlUrl } from './mysql-scene-store'
import type { SceneStore } from './types'

export * from './mysql-scene-store'
export * from './slug'
export * from './sqlite-scene-store'
export * from './types'

/**
 * Factory for Pascal's scene store.
 *
 * Defaults to the local-first SQLite backend, which writes to
 * `~/.pascal/data/pascal.db`; set `PASCAL_DB_PATH` for an exact file path or
 * `PASCAL_DATA_DIR` for a directory containing `pascal.db`.
 *
 * Set `PASCAL_MYSQL_URL` to store scenes in MySQL instead — the backend for
 * hosts whose filesystem does not survive a redeploy.
 */
export async function createSceneStore(env?: NodeJS.ProcessEnv): Promise<SceneStore> {
  const resolved = env ?? process.env
  const mysqlUrl = resolveMysqlUrl(resolved)
  if (mysqlUrl) {
    const mod = await import('./mysql-scene-store')
    const store = new mod.MysqlSceneStore({ env })
    console.log(`[pascal:storage] backend=mysql ${describeMysqlTarget(mysqlUrl)}`)
    return store
  }
  const mod = await import('./sqlite-scene-store')
  const store = new mod.SqliteSceneStore({ env })
  console.log(
    `[pascal:storage] backend=sqlite path=${store.databasePath} (set PASCAL_MYSQL_URL to use MySQL)`,
  )
  return store
}

/** Host and database only — the URL carries a password. */
function describeMysqlTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return `host=${parsed.hostname}:${parsed.port || '3306'} database=${parsed.pathname.replace(/^\//, '')}`
  } catch {
    return 'target=unparseable'
  }
}
