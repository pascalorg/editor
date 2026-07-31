import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { getAuthPool, migrateAuth } from './db'
import {
  createSession,
  destroySession,
  EmailTakenError,
  InvalidCredentialsError,
  loginUser,
  registerUser,
} from './service'
import { hashToken } from './session'

// Runs only when a MySQL target is configured, mirroring the scene-store
// integration approach. In CI/dev: PASCAL_MYSQL_URL=mysql://root@127.0.0.1:3306/dt_test
const hasDb = Boolean(process.env.PASCAL_MYSQL_URL || process.env.PASCAL_MYSQL_HOST)

describe.skipIf(!hasDb)('auth service (integration)', () => {
  beforeAll(async () => {
    await migrateAuth()
    const pool = await getAuthPool()
    await pool.query('DELETE FROM user_sessions')
    await pool.query('DELETE FROM users')
  })

  afterAll(async () => {
    const pool = await getAuthPool()
    await pool.end()
  })

  const email = 'tester@example.com'
  const password = 'super-secret-1'

  it('registers a user and rejects a duplicate email (case-insensitive)', async () => {
    const user = await registerUser({ email, password })
    expect(user.email).toBe(email)
    expect(user.role).toBe('user')
    await expect(registerUser({ email: 'TESTER@example.com', password })).rejects.toBeInstanceOf(
      EmailTakenError,
    )
  })

  it('logs in with the right password and rejects the wrong one', async () => {
    const user = await loginUser({ email, password })
    expect(user.email).toBe(email)
    await expect(loginUser({ email, password: 'nope' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    )
    await expect(loginUser({ email: 'ghost@example.com', password })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    )
  })

  it('creates and destroys a session row keyed by token hash', async () => {
    const user = await loginUser({ email, password })
    const token = await createSession(user.id)
    const pool = await getAuthPool()
    const [rows] = await pool.execute('SELECT user_id FROM user_sessions WHERE token_hash = ?', [
      hashToken(token),
    ])
    expect(Array.isArray(rows) && rows.length).toBe(1)
    await destroySession(token)
    const [after] = await pool.execute('SELECT user_id FROM user_sessions WHERE token_hash = ?', [
      hashToken(token),
    ])
    expect(Array.isArray(after) && after.length).toBe(0)
  })

  it('seeds the admin role from DIGITALTWIN_ADMIN_EMAIL on login', async () => {
    const adminEmail = 'admin@example.com'
    await registerUser({ email: adminEmail, password })
    process.env.DIGITALTWIN_ADMIN_EMAIL = adminEmail
    const promoted = await loginUser({ email: adminEmail, password })
    expect(promoted.role).toBe('admin')
    process.env.DIGITALTWIN_ADMIN_EMAIL = undefined
  })
})
