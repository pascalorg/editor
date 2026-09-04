import { fail, handler, ok } from '@panel/lib/api'
import type { TempPasswordResponse } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { generateTempPassword, hashPassword } from '@panel/lib/auth/password'
import { revokeAllSessions } from '@panel/lib/auth/session'
import { exec } from '@panel/lib/db'
import { deliverTemporaryPassword } from '@panel/lib/mail'
import { findInternalId, getUserDetail } from '@panel/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/users/:id/temp-password
 *
 * Returns the raw password exactly once, the same way a new API key does. It is
 * never stored in readable form and never reappears — which is the whole point
 * of removing the old panel's readable password column.
 *
 * must_change_password is set, so the temporary credential can only be used to
 * reach the set-password screen.
 */
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

  const temporaryPassword = generateTempPassword()
  await exec(
    `UPDATE users
        SET password_hash = ?, password_set_at = NOW(), must_change_password = 1,
            failed_attempts = 0, locked_until = NULL,
            status = CASE WHEN status = 'invited' THEN 'active' ELSE status END
      WHERE id = ?`,
    [await hashPassword(temporaryPassword), internalId],
  )
  await revokeAllSessions(internalId, null)

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'warn',
    kind: 'user',
    message: `Temporary password issued for ${user.email}`,
    event: { k: 'tempPassword', p: { email: user.email } },
  })

  // Still returned to the administrator once, for the case where mail is down
  // — but the credential now has a way to reach its owner that is not a phone
  // call.
  await deliverTemporaryPassword({
    email: user.email,
    fullName: user.name,
    temporaryPassword,
  })

  const body: TempPasswordResponse = { temporaryPassword }
  return ok(body)
})
