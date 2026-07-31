import { getSession } from '@panel/lib/auth/session'

export interface SessionUser {
  id: string
  email: string
  role: 'user' | 'admin'
}

/**
 * Identity is owned by the console: it signs people in (password, 2FA,
 * invitations, lockout) and issues the dt_session cookie. The editor no
 * longer keeps its own accounts — this bridge validates the console's
 * session and folds its permission model down to the editor's two roles.
 *
 * A half-open session (2FA pending, forced password change) is treated as
 * signed out here: the person has not finished proving who they are, so the
 * editor must not act on their behalf yet.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession()
  if (session?.state !== 'signedIn') return null
  const user = session.user
  return {
    id: user.id,
    email: user.email,
    role: user.permissions.includes('admin_access') ? 'admin' : 'user',
  }
}

/**
 * Secure must be off on localhost http (or login can't set a cookie in dev)
 * and on in production. Hostinger terminates TLS at its proxy, so the internal
 * request scheme is http — the real scheme comes from x-forwarded-proto.
 */
export function isSecureScheme(
  forwardedProto: string | null,
  nodeEnv: string | undefined,
): boolean {
  const proto = forwardedProto?.split(',')[0]?.trim()
  return proto === 'https' || nodeEnv === 'production'
}
