import type { SceneStore } from './types'

export * from './scene-graph-codec'
export * from './slug'
export * from './sqlite-scene-store'
export * from './types'

/**
 * Factory for the scene store.
 *
 * `POSTGRES_URL` selects Postgres; otherwise the local SQLite file. The SQLite
 * store is not a fallback to be removed later — `pascal-mcp` has to work on a
 * laptop with no server, and the suite runs against it.
 *
 * SQLite writes to `~/.pascal/data/pascal.db` by default; `PASCAL_DB_PATH`
 * names an exact file and `PASCAL_DATA_DIR` a directory containing `pascal.db`.
 *
 * The Postgres module is imported lazily so a SQLite-only process never loads
 * `packages/db` or opens a pool.
 */
export async function createSceneStore(env?: NodeJS.ProcessEnv): Promise<SceneStore> {
  const resolved = env ?? process.env
  if (resolved.POSTGRES_URL) {
    const mod = await import('./postgres-scene-store')
    return new mod.PostgresSceneStore({ env: resolved })
  }
  const mod = await import('./sqlite-scene-store')
  return new mod.SqliteSceneStore({ env })
}
