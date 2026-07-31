import { readEnv } from '../lib/env'
import { resolveMysqlUrl } from './mysql-scene-store'
import { SceneInvalidError, type SceneStore } from './types'

export { readEnv } from '../lib/env'
export * from './mysql-scene-store'
export * from './slug'
export * from './sqlite-scene-store'
export * from './types'

/**
 * Factory for the scene store.
 *
 * Defaults to the local-first SQLite backend; set `DIGITALTWIN_DB_PATH` for an
 * exact file path or `DIGITALTWIN_DATA_DIR` for a directory to hold it.
 *
 * Set `DIGITALTWIN_MYSQL_URL` (or the HOST/USER/DATABASE trio) to store scenes
 * in MySQL. In production MySQL is required: a host's filesystem rarely
 * survives a redeploy, so silently writing to a local file loses every scene.
 * Set `DIGITALTWIN_ALLOW_SQLITE=1` to override for throwaway production runs.
 */
export async function createSceneStore(env?: NodeJS.ProcessEnv): Promise<SceneStore> {
  const resolved = env ?? process.env
  const mysqlUrl = resolveMysqlUrl(resolved)
  if (mysqlUrl) {
    const mod = await import('./mysql-scene-store')
    const store = new mod.MysqlSceneStore({ env })
    console.log(`[digitaltwin:storage] backend=mysql ${describeMysqlTarget(mysqlUrl)}`)
    return store
  }

  if (resolved.NODE_ENV === 'production' && readEnv(resolved, 'ALLOW_SQLITE') !== '1') {
    throw new SceneInvalidError(
      'No MySQL configuration found, and the SQLite fallback is disabled in production ' +
        'because scenes written to the local filesystem are lost on redeploy. ' +
        'Set DIGITALTWIN_MYSQL_URL (mysql://user:password@host:3306/database) or all of ' +
        'DIGITALTWIN_MYSQL_HOST, DIGITALTWIN_MYSQL_USER and DIGITALTWIN_MYSQL_DATABASE ' +
        '(plus DIGITALTWIN_MYSQL_PASSWORD/_PORT as needed). ' +
        'Only set DIGITALTWIN_ALLOW_SQLITE=1 for a throwaway local production run.',
    )
  }

  const mod = await import('./sqlite-scene-store')
  const store = new mod.SqliteSceneStore({ env })
  console.log(
    `[digitaltwin:storage] backend=sqlite path=${store.databasePath} (set DIGITALTWIN_MYSQL_URL to use MySQL)`,
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
