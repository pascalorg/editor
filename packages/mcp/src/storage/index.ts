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
  if (resolveMysqlUrl(env ?? process.env)) {
    const mod = await import('./mysql-scene-store')
    return new mod.MysqlSceneStore({ env })
  }
  const mod = await import('./sqlite-scene-store')
  return new mod.SqliteSceneStore({ env })
}
