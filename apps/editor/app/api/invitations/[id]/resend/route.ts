import { fail, handler, ok } from '@panel/lib/api'
import type { InvitationResponse } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { resendInvitation } from '@panel/lib/auth/invitations'
import { queryOne, type RowDataPacket } from '@panel/lib/db'
import { deliverInvite } from '@panel/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/invitations/:id/resend — new token, resent_count + 1, fresh expiry.
 * The old token stops working the moment this succeeds.
 */
export const POST = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const guard = await requirePermission('edit_users')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const { id } = await ctx.params
  const issued = await resendInvitation(id)
  if (!issued) return fail('not_found', 'err.inviteNotResendable')

  const recipient = await queryOne<RowDataPacket & { email: string; full_name: string }>(
    'SELECT u.email, u.full_name FROM invitations i JOIN users u ON u.id = i.user_id WHERE i.public_id = ?',
    [id],
  )
  if (recipient) {
    await deliverInvite({
      email: recipient.email,
      fullName: recipient.full_name,
      token: issued.token,
      expiresAt: issued.invitation.expiresAt,
    })
  }

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'invite',
    message: `Invitation resent to ${recipient?.email ?? id}`,
    event: { k: 'inviteResent', p: { email: recipient?.email ?? id } },
    meta: { invitation: id, resentCount: issued.invitation.resentCount },
  })

  const body: InvitationResponse = { invitation: issued.invitation }
  return ok(body)
})
