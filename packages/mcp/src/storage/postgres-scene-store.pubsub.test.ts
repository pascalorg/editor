import { describe, expect, test } from 'bun:test'
import { createDatabaseClient } from '@pascal-app/db'
import { PostgresSceneStore } from './postgres-scene-store'
import type { SceneEvent } from './types'

/**
 * Skipped without `POSTGRES_URL` (CI sets it). Pub/sub is the Postgres-only half
 * of the live-sync story: SQLite keeps polling, so these tests only run against
 * a real database.
 */
const POSTGRES_URL = process.env.POSTGRES_URL

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

if (POSTGRES_URL) {
  describe('PostgresSceneStore pub/sub', () => {
    test('an event appended on one connection notifies a subscriber on another', async () => {
      // Two pools stand in for two replicas sharing only the database.
      const a = createDatabaseClient({ connectionString: POSTGRES_URL, poolSize: 2 })
      const b = createDatabaseClient({ connectionString: POSTGRES_URL, poolSize: 2 })
      const storeA = new PostgresSceneStore({ database: a.db, client: a.client })
      const storeB = new PostgresSceneStore({ database: b.db, client: b.client })

      const sceneId = `pubsub-${Date.now()}`

      try {
        // `scene_events` has a foreign key to `scenes`, so seed one first.
        await storeA.save({
          id: sceneId,
          name: 'pubsub',
          graph: { nodes: {}, rootNodeIds: [] },
        })

        const received: SceneEvent[] = []
        const subscription = await storeB.subscribeSceneEvents(sceneId, (event) => {
          received.push(event)
        })

        const appended = await storeA.appendSceneEvent({
          sceneId,
          version: 1,
          kind: 'pubsub:test',
        })

        await waitFor(() => received.some((event) => event.eventId === appended.eventId))

        const delivered = received.find((event) => event.eventId === appended.eventId)
        expect(delivered).toBeDefined()
        expect(delivered?.sceneId).toBe(sceneId)
        expect(delivered?.version).toBe(1)
        expect(delivered?.kind).toBe('pubsub:test')

        await subscription.unsubscribe()
      } finally {
        await storeA.delete(sceneId).catch(() => {})
        await a.client.end()
        await b.client.end()
      }
    })
  })
}
