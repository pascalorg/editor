/**
 * Applies every db/migrations/*.sql not yet recorded in schema_migrations.
 * Creates the database if it is missing, so a fresh MySQL 8 needs no manual step.
 *
 *   node --experimental-strip-types scripts/migrate.ts
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { loadEnv } from './env'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, 'migrations')

/**
 * Splits a migration into statements on semicolons that sit outside string
 * literals, comments and BEGIN...END blocks. Naive `split(';')` breaks on the
 * functional index in 002, whose CASE expression contains no semicolon but whose
 * surrounding parentheses matter for readability of the error if it ever does.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let quote: string | null = null
  let lineComment = false
  let blockComment = false

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (lineComment) {
      if (ch === '\n') lineComment = false
      buf += ch
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        buf += '*/'
        i++
        continue
      }
      buf += ch
      continue
    }
    if (quote) {
      buf += ch
      if (ch === '\\') {
        if (next !== undefined) {
          buf += next
          i++
        }
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '-' && next === '-') {
      lineComment = true
      buf += '--'
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      buf += '/*'
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      buf += ch
      continue
    }
    if (ch === ';') {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)

  return out
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0)
}

async function main() {
  loadEnv()

  const host = process.env.DATABASE_HOST ?? '127.0.0.1'
  const port = Number(process.env.DATABASE_PORT ?? 3306)
  const user = process.env.DATABASE_USER ?? 'root'
  const password = process.env.DATABASE_PASSWORD ?? ''
  const database = process.env.DATABASE_NAME ?? 'digitaltwin'

  const bootstrap = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: false,
  })
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  )
  await bootstrap.end()

  const cx = await mysql.createConnection({ host, port, user, password, database })
  await cx.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(190) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  const [appliedRows] = await cx.query<mysql.RowDataPacket[]>('SELECT name FROM schema_migrations')
  const applied = new Set(appliedRows.map((r) => r.name as string))

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  let ran = 0

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    const statements = splitStatements(sql)

    await cx.beginTransaction()
    try {
      for (const statement of statements) await cx.query(statement)
      await cx.query('INSERT INTO schema_migrations (name) VALUES (?)', [file])
      await cx.commit()
    } catch (err) {
      // MySQL 8 commits DDL implicitly, so a rollback here cannot undo half a
      // migration. Report loudly instead of pretending it was clean.
      await cx.rollback().catch(() => {})
      console.error(`\n  ✗ ${file} failed. DDL already executed in this file is NOT rolled back.`)
      throw err
    }
    console.log(`  ✓ ${file} (${statements.length} statements)`)
    ran++
  }

  await cx.end()
  console.log(ran === 0 ? 'Schema already up to date.' : `Applied ${ran} migration(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
