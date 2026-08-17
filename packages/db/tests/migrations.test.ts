import { afterAll, describe, expect, test } from 'bun:test'
import postgres from 'postgres'
import { runMigrations } from '../src/migrate'

/**
 * The migrations against a real, empty Postgres. Generated SQL is easy to
 * review and still wrong — an index on a column a later edit renamed only
 * fails when it runs.
 *
 * Skipped without `POSTGRES_URL`, so a contributor with no database can still
 * run the suite. CI sets it (see `.github/workflows/ci.yml`), which is where
 * this has to pass.
 */
const POSTGRES_URL = process.env.POSTGRES_URL

const EXPECTED_TABLES = [
  'agent_requests',
  'api_tokens',
  'auth_accounts',
  'auth_sessions',
  'auth_users',
  'auth_verifications',
  'project_members',
  'projects',
  'scene_events',
  'scene_versions',
  'scenes',
  'share_links',
]

const describeWithDb = POSTGRES_URL ? describe : describe.skip

let client: ReturnType<typeof postgres> | null = null

afterAll(async () => {
  await client?.end()
})

describeWithDb('migrations apply to an empty database', () => {
  test('every table lands, and re-running is a no-op', async () => {
    const url = POSTGRES_URL as string
    client = postgres(url, { prepare: false, max: 1 })

    // A fresh schema each run, so this is genuinely "empty database" and not
    // "whatever the last run left".
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await client.unsafe('CREATE SCHEMA public')

    await runMigrations(url)

    const rows = await client<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `
    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES)

    // The deploy step can run twice — a retried job, a re-triggered release.
    await runMigrations(url)
    const after = await client<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `
    expect(after.map((row) => row.table_name)).toEqual(EXPECTED_TABLES)
  })

  test('a scene version cannot outlive its scene', async () => {
    const url = POSTGRES_URL as string
    const db = postgres(url, { prepare: false, max: 1 })
    try {
      await db`INSERT INTO scenes (id, name) VALUES ('scene_fk', 'fk check')`
      await db`
        INSERT INTO scene_versions (scene_id, version, graph, graph_hash)
        VALUES ('scene_fk', 1, '{"nodes":{}}'::jsonb, 'hash')
      `
      await db`DELETE FROM scenes WHERE id = 'scene_fk'`
      const left = await db`SELECT 1 FROM scene_versions WHERE scene_id = 'scene_fk'`
      expect(left).toHaveLength(0)
    } finally {
      await db.end()
    }
  })
})
