import { randomBytes } from 'node:crypto'
import { getAuthPool } from '@/lib/auth/db'
import { hashToken, newToken, type SessionUser } from '@/lib/auth/session'

/**
 * Agent access to the scene API is granted per user from the admin panel and
 * carried by a bearer token, because an MCP client is a desktop app rather
 * than a browser and has no session cookie to send.
 *
 * The token identifies a user, so an agent edits as that person: scenes it
 * creates are owned, listed and authorized exactly like ones made in the
 * editor. Without this the agent would write ownerless scenes that appear in
 * nobody's list yet anyone holding the link could change.
 */

/** Prefixed so a leaked string is recognisable in a log or a paste. */
const TOKEN_PREFIX = 'dtmcp_'

export interface McpGrant {
  userId: string
  createdAt: string
  lastUsedAt: string | null
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : []
}

/**
 * Issues a token for a user, replacing any existing one. Returns the raw
 * token — the only time it exists in readable form, so the caller must show
 * it once and never store it.
 */
export async function grantMcpAccess(userId: string): Promise<string> {
  const pool = await getAuthPool()
  const token = `${TOKEN_PREFIX}${newToken()}`
  const id = randomBytes(16).toString('hex')
  const now = new Date().toISOString()
  // Replacing rather than adding: a second grant should retire the first, so
  // revoking access from one machine cannot be undone by an older token.
  await pool.execute('DELETE FROM mcp_tokens WHERE user_id = ?', [userId])
  await pool.execute(
    'INSERT INTO mcp_tokens (id, token_hash, user_id, created_at) VALUES (?, ?, ?, ?)',
    [id, hashToken(token), userId, now],
  )
  return token
}

export async function revokeMcpAccess(userId: string): Promise<void> {
  const pool = await getAuthPool()
  await pool.execute('DELETE FROM mcp_tokens WHERE user_id = ?', [userId])
}

/** Which users currently hold agent access, for the admin table. */
export async function listMcpGrants(): Promise<McpGrant[]> {
  const pool = await getAuthPool()
  const [result] = await pool.query(
    'SELECT user_id, created_at, last_used_at FROM mcp_tokens ORDER BY created_at DESC',
  )
  return rows(result).map((row) => ({
    userId: String(row.user_id),
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
  }))
}

/**
 * Resolves a bearer token to the user it belongs to, or null. A revoked user
 * row cascades the token away, so a deleted account cannot keep agent access.
 */
export async function userForMcpToken(token: string | null): Promise<SessionUser | null> {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null
  const pool = await getAuthPool()
  const [result] = await pool.query(
    `SELECT u.id, u.email, u.role
       FROM mcp_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?
      LIMIT 1`,
    [hashToken(token)],
  )
  const row = rows(result)[0]
  if (!row) return null
  // Best-effort: a failed timestamp write must not deny a valid request.
  void pool
    .execute('UPDATE mcp_tokens SET last_used_at = ? WHERE token_hash = ?', [
      new Date().toISOString(),
      hashToken(token),
    ])
    .catch(() => {})
  return {
    id: String(row.id),
    email: String(row.email),
    role: row.role === 'admin' ? 'admin' : 'user',
  }
}

/** Reads the bearer token from an MCP request. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}
