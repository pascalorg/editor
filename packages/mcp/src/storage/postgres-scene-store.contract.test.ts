import { createDatabaseClient } from '@pascal-app/db'
import { PostgresSceneStore } from './postgres-scene-store'
import { runSceneStoreContract } from './scene-store-contract.test'

/**
 * Skipped without `POSTGRES_URL` so a contributor with no database keeps a
 * green suite; CI sets it (see `.github/workflows/ci.yml`).
 */
const POSTGRES_URL = process.env.POSTGRES_URL

if (POSTGRES_URL) {
  const { client, db } = createDatabaseClient({ connectionString: POSTGRES_URL, poolSize: 5 })

  runSceneStoreContract({
    name: 'PostgresSceneStore',
    create(options) {
      // One shared pool: the contract opens several stores per case, and a pool
      // each would exhaust `max_connections` long before the suite finished.
      return new PostgresSceneStore({
        database: db,
        ...(options?.maxSceneBytes !== undefined ? { maxSceneBytes: options.maxSceneBytes } : {}),
      })
    },
    async reset() {
      await client`TRUNCATE scenes, scene_versions, scene_events, agent_requests CASCADE`
    },
    async cleanup() {},
  })

  process.on('beforeExit', () => {
    void client.end()
  })
}
