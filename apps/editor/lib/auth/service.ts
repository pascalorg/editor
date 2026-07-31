import { generateSlug } from '@pascal-app/mcp/storage'
import { getAuthPool } from './db'
import { hashPassword, verifyPassword } from './password'
import { hashToken, newToken, type SessionUser, sessionExpiry } from './session'

export class EmailTakenError extends Error {
  readonly code = 'email_taken'
  constructor() {
    super('That email is already registered.')
  }
}

export class InvalidCredentialsError extends Error {
  readonly code = 'invalid_credentials'
  constructor() {
    super('Invalid email or password.')
  }
}

/** Lowercase + trim so lookups and the unique index are case-insensitive. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** The first admin: whoever registers or signs in as DIGITALTWIN_ADMIN_EMAIL. */
function isAdminEmail(email: string): boolean {
  const configured = process.env.DIGITALTWIN_ADMIN_EMAIL?.trim().toLowerCase()
  return Boolean(configured) && configured === email
}

interface UserRow {
  id: string
  email: string
  password_hash: string
  role: 'user' | 'admin'
}

export async function registerUser(input: {
  email: string
  password: string
}): Promise<SessionUser> {
  const email = normalizeEmail(input.email)
  const pool = await getAuthPool()
  const id = generateSlug()
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(input.password)
  const role = isAdminEmail(email) ? 'admin' : 'user'

  try {
    await pool.execute(
      `INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email, passwordHash, role, now, now],
    )
  } catch (err) {
    if ((err as { code?: string })?.code === 'ER_DUP_ENTRY') {
      throw new EmailTakenError()
    }
    throw err
  }
  return { id, email, role }
}

export async function loginUser(input: { email: string; password: string }): Promise<SessionUser> {
  const email = normalizeEmail(input.email)
  const pool = await getAuthPool()
  const [rows] = await pool.execute(
    'SELECT id, email, password_hash, role FROM users WHERE email = ?',
    [email],
  )
  const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as UserRow) : null

  // Verify against the stored hash when present, otherwise against a throwaway
  // hash, so a missing email and a wrong password take the same time and the
  // response can't be used to enumerate accounts.
  const ok = await verifyPassword(
    input.password,
    row?.password_hash ??
      'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  )
  if (!row || !ok) throw new InvalidCredentialsError()

  // Promote the configured admin if they registered before the env was set.
  let role = row.role
  if (isAdminEmail(email) && role !== 'admin') {
    await pool.execute('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [
      'admin',
      new Date().toISOString(),
      row.id,
    ])
    role = 'admin'
  }

  return { id: row.id, email: row.email, role }
}

export async function createSession(userId: string): Promise<string> {
  const pool = await getAuthPool()
  const token = newToken()
  const now = new Date()
  await pool.execute(
    `INSERT INTO user_sessions (id, token_hash, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [generateSlug(), hashToken(token), userId, now.toISOString(), sessionExpiry(now)],
  )
  return token
}

export async function destroySession(token: string): Promise<void> {
  const pool = await getAuthPool()
  await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(token)])
}
