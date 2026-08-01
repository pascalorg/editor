import { getSession } from '@panel/lib/auth/session'

export interface SessionUser {
  id: string
  email: string
  /**
   * The console's permission model folded down to the editor's three tiers:
   * admins run everything, editors build, viewers only look — a viewer opens
   * scenes in preview and cannot save.
   */
  role: 'admin' | 'editor' | 'viewer'
}

export function canEdit(user: SessionUser): boolean {
  return user.role !== 'viewer'
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
  const permissions = user.permissions
  const role = permissions.includes('admin_access')
    ? 'admin'
    : permissions.includes('edit_projects') || permissions.includes('create_projects')
      ? 'editor'
      : 'viewer'
  return { id: user.id, email: user.email, role }
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
