#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { migrateScenes } from '../storage/scene-migration'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'

const HELP = `pascal-migrate — migrate scenes from a SQLite file to Postgres

USAGE:
  pascal-migrate --from <sqlite-path> --to <postgres-url> [options]

OPTIONS:
  --from <path>       Source SQLite file (e.g. ~/.pascal/data/pascal.db)
  --to <url>          Target Postgres URL (the POSTGRES_URL the app reads)
  --owner <id>        Owner id for scenes that have none (early dev data)
  --overwrite         Re-save scenes the target already has, instead of skipping
  --dry-run           Print what would happen without writing to the target
  --help              Print this help

The run is idempotent: scenes the target already has are skipped unless
--overwrite is passed, so a half-finished run can be restarted safely.
`

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      owner: { type: 'string' },
      overwrite: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })

  if (values.help) {
    console.log(HELP)
    process.exit(0)
  }

  if (!values.from) throw new Error('--from <sqlite-path> is required')
  if (!values.to) throw new Error('--to <postgres-url> is required')

  const source = new SqliteSceneStore({ databasePath: values.from })

  // Postgres is imported lazily so a SQLite-only process never loads
  // `@pascal-app/db` — the same boundary `createSceneStore` keeps.
  const { PostgresSceneStore } = await import('../storage/postgres-scene-store')
  const target = new PostgresSceneStore({ env: { POSTGRES_URL: values.to } })

  const report = await migrateScenes(source, target, {
    ownerId: values.owner,
    overwrite: values.overwrite,
    dryRun: values['dry-run'],
  })

  console.log(`migrated:    ${report.migrated}`)
  console.log(`overwritten: ${report.overwritten}`)
  console.log(`skipped:     ${report.skipped}`)
  console.log(`failed:      ${report.failed.length}`)
  for (const failure of report.failed) {
    console.error(`  - ${failure.id}: ${failure.error}`)
  }

  if (report.failed.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('[pascal-migrate] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(1)
})
