import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { cookies, headers } from 'next/headers'
import { exec, query, queryOne, type RowDataPacket } from '../db'
import { getSettings } from '../settings'
import type { AuthState, Permission, Role, SessionInfo, SessionUser, UserStatus } from '../types'
import { permissionsForRole } from './roles'

export const SESSION_COOKIE = 'dt_session'

/** 128 random bits, stored as BINARY(16) and handed out as 32 hex chars. */
function newSessionId(): Buffer {
  return randomBytes(16)
}

function cookieSecure(): boolean {
  return process.env.SESSION_COOKIE_SECURE === '1'
}

interface SessionRow extends RowDataPacket {
  sid: Buffer
  user_id: number
  device: string | null
  ip: Buffer | null
  trusted_until: Date | null
  keep_signed_in: number
  mfa_pending: number
  created_at: Date
  last_activity_at: Date
  expires_at: Date
  revoked_at: Date | null
  public_id: string
  email: string
  username: string
  full_name: string
  org: 'internal' | 'external'
  global_role: string
  status: 'invited' | 'active' | 'inactive' | 'suspended'
  must_change_password: number
  mfa_confirmed_at: Date | null
}

export interface ActiveSession {
  id: Buffer
  userId: number
  mfaPending: boolean
  keepSignedIn: boolean
  expiresAt: Date
  lastActivityAt: Date
  user: SessionUser
  /** Mapped from users.status so the guard can answer without a second query. */
  state: AuthState
}

const DB_STATUS_TO_UI: Record<SessionRow['status'], UserStatus> = {
  invited: 'Invited',
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Inactive',
}

/** Packs an IPv4/IPv6 literal into VARBINARY(16); anything unparseable is dropped. */
export function packIp(raw: string | null): Buffer | null {
  if (!raw) return null
  const ip = (raw.split(',')[0] ?? raw).trim()
  const kind = isIP(ip)
  if (kind === 4) {
    const parts = ip.split('.').map(Number)
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    return Buffer.from(parts)
  }
  if (kind === 6) {
    // Expand the :: shorthand, then pack the eight 16-bit groups.
    const [head, tail = ''] = ip.split('::')
    const headGroups = head ? head.split(':').filter(Boolean) : []
    const tailGroups = tail ? tail.split(':').filter(Boolean) : []
    const fill = 8 - headGroups.length - tailGroups.length
    if (fill < 0) return null
    const groups = [...headGroups, ...Array(ip.includes('::') ? fill : 0).fill('0'), ...tailGroups]
    if (groups.length !== 8) return null
    const buf = Buffer.alloc(16)
    groups.forEach((g, i) => {
      buf.writeUInt16BE(parseInt(g, 16) & 0xffff, i * 2)
    })
    return buf
  }
  return null
}

export function unpackIp(buf: Buffer | null): string | null {
  if (!buf) return null
  if (buf.length === 4) return Array.from(buf).join('.')
  if (buf.length === 16) {
    const groups: string[] = []
    for (let i = 0; i < 16; i += 2) groups.push(buf.readUInt16BE(i).toString(16))
    return groups.join(':')
  }
  return null
}

/** Best-effort device label from the UA string — enough for the session list. */
export function describeDevice(ua: string | null): string | null {
  if (!ua) return null
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  const os = /Windows NT 10/.test(ua)
    ? 'Windows 10/11'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /(iPhone|iPad|iPod)/.test(ua)
          ? 'iOS'
          : /Mac OS X/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'unknown OS'
  return `${browser} on ${os}`.slice(0, 160)
}

async function requestContext(): Promise<{ device: string | null; ip: Buffer | null }> {
  const h = await headers()
  return {
    device: describeDevice(h.get('user-agent')),
    ip: packIp(h.get('x-forwarded-for') ?? h.get('x-real-ip')),
  }
}

/**
 * Creates a session row and sets the cookie. `mfaPending` leaves the session
 * half-open: the guard treats it as `mfaRequired` and no console route accepts it.
 */
export async function createSession(opts: {
  userId: number
  keepSignedIn: boolean
  mfaPending: boolean
  trustedUntil?: Date | null
}): Promise<Buffer> {
  const settings = await getSettings()
  const { device, ip } = await requestContext()

  const keepSignedIn = opts.keepSignedIn && settings.keepSignedInAllowed
  const lifetimeMs = keepSignedIn
    ? settings.keepSignedInDays * 24 * 60 * 60 * 1000
    : settings.sessionMinutes * 60 * 1000

  const id = newSessionId()
  const expiresAt = new Date(Date.now() + lifetimeMs)

  await exec(
    `INSERT INTO sessions (id, user_id, device, ip, trusted_until, keep_signed_in, mfa_pending,
                           last_activity_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
    [
      id,
      opts.userId,
      device,
      ip,
      opts.trustedUntil ?? null,
      keepSignedIn ? 1 : 0,
      opts.mfaPending ? 1 : 0,
      expiresAt,
    ],
  )

  // Concurrent-session limit is enforced here, not in the console: oldest first.
  await enforceConcurrencyLimit(opts.userId, id, settings.concurrentSessionLimit)

  const jar = await cookies()
  jar.set(SESSION_COOKIE, id.toString('hex'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    // A session cookie for the idle case; a dated cookie when "keep me signed in"
    // is on, so the browser keeps it across restarts for the full window.
    ...(keepSignedIn ? { expires: expiresAt } : {}),
  })

  return id
}

async function enforceConcurrencyLimit(
  userId: number,
  keepId: Buffer,
  limit: number,
): Promise<void> {
  if (limit <= 0) return
  const rows = await query<RowDataPacket & { id: Buffer }>(
    `SELECT id FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_activity_at DESC`,
    [userId],
  )
  const surplus = rows.slice(limit).filter((r) => !r.id.equals(keepId))
  for (const row of surplus) {
    await exec('UPDATE sessions SET revoked_at = NOW() WHERE id = ?', [row.id])
  }
}

/** Reads and validates the cookie-bound session, sliding the idle window forward. */
export async function getSession(opts: { touch?: boolean } = {}): Promise<ActiveSession | null> {
  const jar = await cookies()
  const raw = jar.get(SESSION_COOKIE)?.value
  if (!raw || !/^[0-9a-f]{32}$/.test(raw)) return null

  const id = Buffer.from(raw, 'hex')
  const row = await queryOne<SessionRow>(
    `SELECT s.id AS sid, s.user_id, s.device, s.ip, s.trusted_until, s.keep_signed_in,
            s.mfa_pending, s.created_at, s.last_activity_at, s.expires_at, s.revoked_at,
            u.public_id, u.email, u.username, u.full_name, u.org, u.global_role, u.status,
            u.must_change_password, tf.confirmed_at AS mfa_confirmed_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN two_factor tf ON tf.user_id = u.id
      WHERE s.id = ?`,
    [id],
  )

  if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now()) return null
  if (row.status === 'suspended' || row.status === 'inactive') return null

  const settings = await getSettings()

  if (opts.touch !== false) {
    // Sliding idle window. "Keep me signed in" sessions keep their absolute
    // expiry — extending it on every request would make the setting unbounded.
    const nextExpiry =
      row.keep_signed_in === 1
        ? row.expires_at
        : new Date(Date.now() + settings.sessionMinutes * 60 * 1000)
    await exec('UPDATE sessions SET last_activity_at = NOW(), expires_at = ? WHERE id = ?', [
      nextExpiry,
      id,
    ])
    row.expires_at = nextExpiry
  }

  const siteRoles = await loadSiteRoles(row.user_id)
  const permissions = await effectivePermissions(row.global_role, siteRoles)

  const user: SessionUser = {
    id: row.public_id,
    name: row.full_name,
    email: row.email,
    username: row.username,
    role: row.global_role as Role,
    org: row.org,
    status: DB_STATUS_TO_UI[row.status],
    mfa: row.mfa_confirmed_at ? 'On' : 'Off',
    permissions,
    mustChangePassword: row.must_change_password === 1,
    siteRoles,
  }

  const state: AuthState =
    row.mfa_pending === 1
      ? 'mfaRequired'
      : row.must_change_password === 1
        ? 'firstSignIn'
        : 'signedIn'

  return {
    id,
    userId: row.user_id,
    mfaPending: row.mfa_pending === 1,
    keepSignedIn: row.keep_signed_in === 1,
    expiresAt: row.expires_at,
    lastActivityAt: row.last_activity_at,
    user,
    state,
  }
}

/** Clears the pending flag once the OTP (or a recovery code) checks out. */
export async function clearMfaPending(id: Buffer): Promise<void> {
  await exec('UPDATE sessions SET mfa_pending = 0 WHERE id = ?', [id])
}

export async function revokeSession(id: Buffer): Promise<void> {
  await exec('UPDATE sessions SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [id])
}

/** Revokes every live session for a user, optionally sparing the current one. */
export async function revokeAllSessions(userId: number, except?: Buffer | null): Promise<number> {
  const res = except
    ? await exec(
        'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
        [userId, except],
      )
    : await exec(
        'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
        [userId],
      )
  return res.affectedRows
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: 0,
  })
}

export async function listSessions(userId: number, currentId: Buffer): Promise<SessionInfo[]> {
  const rows = await query<
    RowDataPacket & {
      id: Buffer
      device: string | null
      ip: Buffer | null
      created_at: Date
      last_activity_at: Date
      expires_at: Date
      trusted_until: Date | null
    }
  >(
    `SELECT id, device, ip, created_at, last_activity_at, expires_at, trusted_until
       FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_activity_at DESC`,
    [userId],
  )

  return rows.map((r) => ({
    id: r.id.toString('hex'),
    device: r.device,
    ip: unpackIp(r.ip),
    current: r.id.equals(currentId),
    createdAt: r.created_at.toISOString(),
    lastActivityAt: r.last_activity_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    trustedUntil: r.trusted_until ? r.trusted_until.toISOString() : null,
  }))
}

/** Is there a live trusted-device grant for this user? Skips the OTP step. */
export async function hasTrustedDevice(userId: number): Promise<boolean> {
  const row = await queryOne<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM sessions
      WHERE user_id = ? AND trusted_until IS NOT NULL AND trusted_until > NOW()`,
    [userId],
  )
  return (row?.n ?? 0) > 0
}

async function loadSiteRoles(userId: number): Promise<Record<string, Role>> {
  const rows = await query<RowDataPacket & { name: string; role: string }>(
    `SELECT s.name, a.role
       FROM assignments a
       JOIN sites s ON s.id = a.site_id
      WHERE a.user_id = ?`,
    [userId],
  )
  return Object.fromEntries(rows.map((r) => [r.name, r.role as Role]))
}

/**
 * Effective permission rule (WP3): global role ∪ every site assignment, widest
 * wins. Resolved by union at read time — no materialised "effective" table.
 */
async function effectivePermissions(
  globalRole: string,
  siteRoles: Record<string, Role>,
): Promise<Permission[]> {
  const names = new Set<string>([globalRole, ...Object.values(siteRoles)])
  const granted = new Set<Permission>()
  for (const name of names) {
    for (const perm of await permissionsForRole(name)) granted.add(perm)
  }
  return [...granted]
}
