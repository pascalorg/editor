import type { SceneStore } from './types'

export * from './slug'
export * from './sqlite-scene-store'
export * from './types'

/**
 * Factory for Pascal's local-first scene store.
 *
 * The store is backed by the runtime's built-in SQLite driver. By default it
 * writes to `~/.pascal/data/pascal.db`; set `PASCAL_DB_PATH` for an exact file
 * path or `PASCAL_DATA_DIR` for a directory containing `pascal.db`.
 */
export async function createSceneStore(env?: NodeJS.ProcessEnv): Promise<SceneStore> {
  const mod = await import('./sqlite-scene-store')
  return new mod.SqliteSceneStore({ env })
}
