import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashPassword } from '@panel/lib/auth/password'
import { db, exec, query, queryOne } from '@panel/lib/db'
import { ulid } from 'ulid'

/**
 * Brings a live database — wherever it is in its history — up to the console
 * schema at boot, so a redeploy is the whole upgrade and nobody runs SQL by
 * hand in a hosting panel.
 *
 * Three states are handled, all idempotently:
 *  1. The editor's old auth era: a `users` table WITHOUT `public_id`. It is
 *     renamed aside (nothing is dropped), the console migrations run, and the
 *     old accounts are carried over with a fresh temporary password — scrypt
 *     hashes cannot become argon2 ones — printed ONCE to the boot log, which
 *     is exactly where the operator of this deployment reads. Scene ownership
 *     follows the accounts to their new ids.
 *  2. A fresh database: migrations plus a settings row.
 *  3. Already migrated: the recorded migration names short-circuit everything.
 */
export async function ensureConsoleSchema(): Promise<void> {
  const oldUsers = await tableExists('users')
  const isLegacyShape = oldUsers && !(await columnExists('users', 'public_id'))

  if (isLegacyShape) {
    console.log('[digitaltwin:migrate] legacy editor auth tables found — setting them aside')
    await exec('RENAME TABLE users TO legacy_editor_users', [])
    if (await tableExists('user_sessions')) {
      await exec('RENAME TABLE user_sessions TO legacy_editor_sessions', [])
    }
  }

  await runSqlMigrations()
  await ensureSettingsRow()

  if (isLegacyShape || (await tableExists('legacy_editor_users'))) {
    await migrateLegacyAccounts()
  }
}

async function runSqlMigrations(): Promise<void> {
  await exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name VARCHAR(128) NOT NULL PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    [],
  )
  const done = new Set(
    (await query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name),
  )
  const dir = join(process.cwd(), 'panel-migrations')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    if (done.has(file)) continue
    console.log(`[digitaltwin:migrate] applying ${file}`)
    for (const statement of splitStatements(readFileSync(join(dir, file), 'utf8'))) {
      await db().query(statement)
    }
    await exec('INSERT INTO schema_migrations (name) VALUES (?)', [file])
  }
}

async function ensureSettingsRow(): Promise<void> {
  // 2FA starts optional here — the operator turns it on from the Settings tab
  // once they have enrolled, rather than being locked out by a default.
  await exec(
    `INSERT INTO settings (id, mfa_required, sso_enforced_domains)
     SELECT 1, 0, '[]' FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1)`,
    [],
  )
}

interface LegacyUser {
  id: string
  email: string
  role: string
}

async function migrateLegacyAccounts(): Promise<void> {
  const legacy = await query<LegacyUser>('SELECT id, email, role FROM legacy_editor_users')
  for (const row of legacy) {
    const email = row.email.trim().toLowerCase()
    const existing = await queryOne<{ public_id: string }>(
      'SELECT public_id FROM users WHERE email = ?',
      [email],
    )
    let publicId = existing?.public_id
    if (!publicId) {
      publicId = ulid()
      const username = (email.split('@')[0] ?? 'user').replace(/[^a-z0-9._-]/g, '') || 'user'
      const temp = tempPassword()
      await exec(
        `INSERT INTO users (public_id, email, username, full_name, org, global_role, status,
                            password_hash, must_change_password)
         VALUES (?, ?, ?, ?, 'internal', ?, 'active', ?, 1)`,
        [
          publicId,
          email,
          username,
          username,
          row.role === 'admin' ? 'Admin' : 'Viewer',
          Buffer.from(await hashPassword(temp)),
        ],
      )
      // The one place the operator can read: the runtime log. Shown once; the
      // first sign-in forces a change, after which this value is dead.
      console.log(
        `[digitaltwin:migrate] account carried over: ${email} — temporary password: ${temp}`,
      )
    }
    await exec(
      'UPDATE scenes SET owner_id = ? WHERE CONVERT(owner_id USING utf8mb4) = CONVERT(? USING utf8mb4)',
      [publicId, row.id],
    )
  }
}

function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (const byte of randomBytes(14)) {
    out += alphabet[byte % alphabet.length]
  }
  return `Gecici!${out.slice(0, 10)}`
}

async function tableExists(name: string): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [name],
  )
  return Number(row?.n ?? 0) > 0
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column],
  )
  return Number(row?.n ?? 0) > 0
}

/** Statement splitter matching panel/migrate.ts: semicolons outside strings and comments. */
function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let quote: string | null = null
  let lineComment = false
  let blockComment = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string
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
      if (ch === '\\') {
        buf += ch + (next ?? '')
        i++
        continue
      }
      if (ch === quote) quote = null
      buf += ch
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '-' && next === '-') {
      lineComment = true
      buf += ch
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      buf += '/*'
      i++
      continue
    }
    if (ch === ';') {
      const trimmed = buf.trim()
      if (trimmed) out.push(trimmed)
      buf = ''
      continue
    }
    buf += ch
  }
  const trimmed = buf.trim()
  if (trimmed) out.push(trimmed)
  return out
}
