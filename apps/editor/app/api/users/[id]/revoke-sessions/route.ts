import { fail, handler, ok } from '@panel/lib/api'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { revokeAllSessions } from '@panel/lib/auth/session'
import { findInternalId, getUserDetail } from '@panel/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/users/:id/revoke-sessions — the drawer's "sign out all sessions". */
export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('edit_users')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const { id } = await ctx.params
  const user = await getUserDetail(id)
  const internalId = await findInternalId(id)
  if (!user || !internalId) return fail('not_found', 'err.notFound')

  const revoked = await revokeAllSessions(internalId, null)
  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'session',
    message: `All sessions revoked for ${user.email}`,
    event: { k: 'allSessionsRevoked', p: { email: user.email } },
    meta: { revoked },
  })

  return ok({ revoked })
})
