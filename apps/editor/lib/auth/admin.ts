import { getAuthPool } from './db'
import { getSessionUser, type SessionUser } from './session'

export interface AdminUser {
  id: string
  email: string
  role: 'user' | 'admin'
  createdAt: string
  sceneCount: number
}

/** The current user if they are an admin, otherwise null. */
export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await getSessionUser()
  return user && user.role === 'admin' ? user : null
}

interface UserRow {
  id: string
  email: string
  global_role: string
  created_at: string
  scene_count: number | string
}

/**
 * All users, each with how many scenes they own, newest first. Reads the
 * console's users table: ids are the console's public ULIDs (which is what
 * scenes.owner_id now stores) and the editor's two-role view is derived from
 * the console's global role.
 */
export async function listUsers(): Promise<AdminUser[]> {
  const pool = await getAuthPool()
  const [rows] = await pool.query(`
    SELECT u.public_id AS id, u.email, u.global_role, u.created_at,
           (SELECT COUNT(*) FROM scenes s
            WHERE CONVERT(s.owner_id USING utf8mb4) = CONVERT(u.public_id USING utf8mb4)) AS scene_count
      FROM users u
     ORDER BY u.created_at DESC
  `)
  return (Array.isArray(rows) ? (rows as UserRow[]) : []).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.global_role === 'Admin' ? 'admin' : 'user',
    createdAt: String(r.created_at),
    sceneCount: Number(r.scene_count),
  }))
}

/** Maps owner ids to emails so scene listings can show a human owner. */
export async function ownerEmails(ownerIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ownerIds.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const pool = await getAuthPool()
  const placeholders = unique.map(() => '?').join(',')
  const [rows] = await pool.query(
    `SELECT public_id AS id, email FROM users WHERE public_id IN (${placeholders})`,
    unique,
  )
  const map = new Map<string, string>()
  for (const row of Array.isArray(rows) ? (rows as { id: string; email: string }[]) : []) {
    map.set(row.id, row.email)
  }
  return map
}

export async function setUserRole(userId: string, role: 'user' | 'admin'): Promise<void> {
  // Console roles are richer than the editor's pair; promoting maps to the
  // console's Admin, demoting to Viewer. Finer grades belong to the console UI.
  const pool = await getAuthPool()
  await pool.execute('UPDATE users SET global_role = ? WHERE public_id = ?', [
    role === 'admin' ? 'Admin' : 'Viewer',
    userId,
  ])
}

export async function userExists(userId: string): Promise<boolean> {
  const pool = await getAuthPool()
  const [rows] = await pool.execute('SELECT 1 FROM users WHERE public_id = ?', [userId])
  return Array.isArray(rows) && rows.length > 0
}

/** Reassigns a scene's owner. `null` makes it unowned again. */
export async function reassignScene(sceneId: string, ownerId: string | null): Promise<void> {
  const pool = await getAuthPool()
  await pool.execute('UPDATE scenes SET owner_id = ? WHERE id = ?', [ownerId, sceneId])
}

/** Adopts every unowned (legacy) scene to a user in one shot. */
export async function adoptUnownedScenes(ownerId: string): Promise<number> {
  const pool = await getAuthPool()
  const [result] = await pool.execute('UPDATE scenes SET owner_id = ? WHERE owner_id IS NULL', [
    ownerId,
  ])
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0)
}
