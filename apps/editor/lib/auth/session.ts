import { createHash, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { getAuthPool } from './db'

export const SESSION_COOKIE = 'dt_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface SessionUser {
  id: string
  email: string
  role: 'user' | 'admin'
}

/** A raw token is delivered to the browser; only its hash is ever stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Secure must be off on localhost http (or login can't set a cookie in dev)
 * and on in production. Hostinger terminates TLS at its proxy, so the internal
 * request scheme is http — we detect the real scheme from x-forwarded-proto,
 * the same header the scene API uses for its origin check.
 */
export function isSecureScheme(forwardedProto: string | null, nodeEnv: string | undefined): boolean {
  const proto = forwardedProto?.split(',')[0]?.trim()
  return proto === 'https' || nodeEnv === 'production'
}

export async function cookieSecure(): Promise<boolean> {
  const h = await headers()
  return isSecureScheme(h.get('x-forwarded-proto'), process.env.NODE_ENV)
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await cookieSecure(),
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: await cookieSecure(),
    path: '/',
    maxAge: 0,
  })
}

export function sessionExpiry(now = new Date()): string {
  return new Date(now.getTime() + SESSION_TTL_MS).toISOString()
}

interface SessionRow {
  user_id: string
  email: string
  role: 'user' | 'admin'
  expires_at: string
}

/**
 * Resolves the signed-in user from the session cookie, or null. Expired
 * sessions are treated as signed-out and lazily deleted.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const pool = await getAuthPool()
  const [rows] = await pool.execute(
    `SELECT s.user_id, s.expires_at, u.email, u.role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [hashToken(token)],
  )
  const row = Array.isArray(rows) && rows.length > 0 ? (rows[0] as SessionRow) : null
  if (!row) return null

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(token)])
    return null
  }

  return { id: row.user_id, email: row.email, role: row.role }
}
