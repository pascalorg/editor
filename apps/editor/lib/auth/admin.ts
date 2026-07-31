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
  role: 'user' | 'admin'
  created_at: string
  scene_count: number | string
}

/** All users, each with how many scenes they own, newest first. */
export async function listUsers(): Promise<AdminUser[]> {
  const pool = await getAuthPool()
  const [rows] = await pool.query(`
    SELECT u.id, u.email, u.role, u.created_at,
           (SELECT COUNT(*) FROM scenes s WHERE s.owner_id = u.id) AS scene_count
      FROM users u
     ORDER BY u.created_at DESC
  `)
  return (Array.isArray(rows) ? (rows as UserRow[]) : []).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
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
    `SELECT id, email FROM users WHERE id IN (${placeholders})`,
    unique,
  )
  const map = new Map<string, string>()
  for (const row of Array.isArray(rows) ? (rows as { id: string; email: string }[]) : []) {
    map.set(row.id, row.email)
  }
  return map
}

export async function setUserRole(userId: string, role: 'user' | 'admin'): Promise<void> {
  const pool = await getAuthPool()
  await pool.execute('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [
    role,
    new Date().toISOString(),
    userId,
  ])
}

export async function userExists(userId: string): Promise<boolean> {
  const pool = await getAuthPool()
  const [rows] = await pool.execute('SELECT 1 FROM users WHERE id = ?', [userId])
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
