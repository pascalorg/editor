import { queryOne, type RowDataPacket } from '../db'

export const WORK_DOMAIN = '@netlog.com.tr'

export interface UserRow extends RowDataPacket {
  id: number
  public_id: string
  email: string
  username: string
  full_name: string
  org: 'internal' | 'external'
  global_role: string
  status: 'invited' | 'active' | 'inactive' | 'suspended'
  password_hash: Buffer | null
  must_change_password: number
  failed_attempts: number
  locked_until: Date | null
}

/**
 * Sign-in accepts three shapes for the same account, exactly as the prototype's
 * hint line promises: the username (`Admin`, `r.ovur`), the local part of the
 * work address, or the full address. Resolution is a single indexed query.
 */
export async function findUserByIdentifier(identifier: string): Promise<UserRow | null> {
  const raw = identifier.trim()
  if (!raw) return null

  const asEmail = raw.includes('@') ? raw.toLowerCase() : `${raw.toLowerCase()}${WORK_DOMAIN}`

  return queryOne<UserRow>(
    `SELECT id, public_id, email, username, full_name, org, global_role, status,
            password_hash, must_change_password, failed_attempts, locked_until
       FROM users
      WHERE username = ? OR email = ?
      LIMIT 1`,
    [raw, asEmail],
  )
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `SELECT id, public_id, email, username, full_name, org, global_role, status,
            password_hash, must_change_password, failed_attempts, locked_until
       FROM users
      WHERE email = ?
      LIMIT 1`,
    [email.trim().toLowerCase()],
  )
}

export async function findUserById(id: number): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `SELECT id, public_id, email, username, full_name, org, global_role, status,
            password_hash, must_change_password, failed_attempts, locked_until
       FROM users
      WHERE id = ?`,
    [id],
  )
}

/** Label shown on the OTP screen: the username for accounts without a real inbox. */
export function pendingLabel(user: UserRow): string {
  return user.email.startsWith('admin@') && user.username.toLowerCase() === 'admin'
    ? user.username
    : user.email
}
