import { fail, handler, ok } from '@panel/lib/api'
import { audit } from '@panel/lib/auth/audit'
import { clearSessionCookie, getSession, revokeSession } from '@panel/lib/auth/session'
import { queryOne, type RowDataPacket } from '@panel/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/auth/sessions/:id — revoke one device.
 *
 * Ownership is re-checked against the row rather than trusted from the URL, so a
 * guessed session id from another account is a 404, not a revocation.
 */
export const DELETE = handler(
  async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session || session.mfaPending) return fail('unauthenticated', 'err.sessionExpired')

    const { id } = await ctx.params
    if (!/^[0-9a-f]{32}$/.test(id)) return fail('not_found', 'err.notFound')

    const target = Buffer.from(id, 'hex')
    const row = await queryOne<RowDataPacket & { user_id: number }>(
      'SELECT user_id FROM sessions WHERE id = ? AND revoked_at IS NULL',
      [target],
    )
    if (!row || row.user_id !== session.userId) return fail('not_found', 'err.notFound')

    await revokeSession(target)
    await audit({
      actorUserId: session.userId,
      actorLabel: session.user.email,
      level: 'info',
      kind: 'session',
      message: 'Session revoked',
      event: { k: 'sessionRevoked' },
      meta: { self: target.equals(session.id) },
    })

    // Revoking your own session should also drop the cookie, otherwise the tab
    // keeps sending a dead id until the next navigation.
    if (target.equals(session.id)) await clearSessionCookie()

    return ok({ revoked: 1, self: target.equals(session.id) })
  },
)
